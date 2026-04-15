"""
Gerenciador de cgroups v2 para controle de recursos.

Implementa controle de CPU via pesos (weights) ao invés de limites fixos:
  - Dono da alocação: cpu.weight = 1000 (prioridade máxima)
  - Outros usuários:  cpu.weight = 10  (prioridade mínima)
  - Sem alocação:     cpu.weight = 100 (padrão do sistema)

O comportamento é de PRIORIDADE, não de COTA FIXA:
  - Se apenas um "convidado" usa a máquina, ele pode usar 100% da CPU
  - Quando o dono inicia um processo pesado, o kernel redireciona quase toda
    a CPU para o dono, sem matar processos leves do convidado (SSH, bash, ls)

Utiliza systemd slices (user-<UID>.slice) que já são gerenciados pelo
systemd-logind automaticamente quando o usuário faz login via SSH.

Requer: systemd >= 244 com cgroups v2 habilitado.
"""

import subprocess
import logging
import os
from pathlib import Path

from config import (
    CGROUP_OWNER_CPU_WEIGHT,
    CGROUP_GUEST_CPU_WEIGHT,
    CGROUP_DEFAULT_CPU_WEIGHT,
)

logger = logging.getLogger('agent.cgroup')


class CGroupManager:
    """Gerencia pesos de CPU via cgroups v2 / systemd slices."""

    def __init__(self):
        self._cgroups_available = self._check_cgroups_v2()
        if self._cgroups_available:
            logger.info('cgroups v2 detectado e operacional')
        else:
            logger.warning(
                'cgroups v2 NÃO disponível. Controle de recursos desabilitado. '
                'Verifique: mount | grep cgroup2'
            )

        # Rastreia estado atual dos pesos aplicados
        self._current_weights: dict[str, int] = {}

    @property
    def available(self) -> bool:
        """Retorna se cgroups v2 está disponível."""
        return self._cgroups_available

    # ─── Controle de Pesos ───────────────────────────────────────

    def set_owner(self, system_username: str) -> bool:
        """
        Define um usuário como dono da alocação (prioridade máxima de CPU).
        Todos os outros usuários configurados são rebaixados para prioridade mínima.
        """
        if not self._cgroups_available:
            logger.debug('cgroups indisponível, ignorando set_owner')
            return False

        uid = self._get_uid(system_username)
        if uid is None:
            return False

        success = self._set_cpu_weight(system_username, uid, CGROUP_OWNER_CPU_WEIGHT)
        if success:
            self._current_weights[system_username] = CGROUP_OWNER_CPU_WEIGHT
            logger.info(
                f'CPU weight {CGROUP_OWNER_CPU_WEIGHT} aplicado para {system_username} (DONO)'
            )

        # Rebaixa todos os outros usuários logados
        self._demote_others(system_username)

        return success

    def set_guest(self, system_username: str) -> bool:
        """Define um usuário como convidado (prioridade mínima de CPU)."""
        if not self._cgroups_available:
            return False

        uid = self._get_uid(system_username)
        if uid is None:
            return False

        success = self._set_cpu_weight(system_username, uid, CGROUP_GUEST_CPU_WEIGHT)
        if success:
            self._current_weights[system_username] = CGROUP_GUEST_CPU_WEIGHT
            logger.info(
                f'CPU weight {CGROUP_GUEST_CPU_WEIGHT} aplicado para {system_username} (CONVIDADO)'
            )
        return success

    def reset_all(self) -> int:
        """
        Restaura peso padrão para todos os usuários rastreados.
        Retorna quantidade de usuários restaurados.
        """
        if not self._cgroups_available:
            return 0

        count = 0
        for username in list(self._current_weights.keys()):
            uid = self._get_uid(username)
            if uid is not None:
                if self._set_cpu_weight(username, uid, CGROUP_DEFAULT_CPU_WEIGHT):
                    count += 1
        self._current_weights.clear()

        if count > 0:
            logger.info(f'Pesos CPU restaurados para {count} usuário(s)')
        return count

    def reset_user(self, system_username: str) -> bool:
        """Restaura peso padrão de um usuário específico."""
        if not self._cgroups_available:
            return False

        uid = self._get_uid(system_username)
        if uid is None:
            return False

        success = self._set_cpu_weight(system_username, uid, CGROUP_DEFAULT_CPU_WEIGHT)
        if success:
            self._current_weights.pop(system_username, None)
            logger.info(f'CPU weight restaurado para {system_username}')
        return success

    def get_status(self) -> dict:
        """Retorna estado atual dos pesos aplicados."""
        return {
            'available': self._cgroups_available,
            'weights': dict(self._current_weights),
            'config': {
                'ownerWeight': CGROUP_OWNER_CPU_WEIGHT,
                'guestWeight': CGROUP_GUEST_CPU_WEIGHT,
                'defaultWeight': CGROUP_DEFAULT_CPU_WEIGHT,
            },
        }

    # ─── Métodos Internos ────────────────────────────────────────

    def _check_cgroups_v2(self) -> bool:
        """Verifica se cgroups v2 está habilitado no sistema."""
        try:
            # Verifica se o mount de cgroup2 existe
            cgroup_path = Path('/sys/fs/cgroup')
            if not cgroup_path.exists():
                return False

            # Verifica se é cgroups v2 (unified hierarchy)
            controllers = cgroup_path / 'cgroup.controllers'
            if not controllers.exists():
                return False

            with open(controllers) as f:
                content = f.read().strip()

            has_cpu = 'cpu' in content
            if not has_cpu:
                logger.warning('cgroups v2 presente mas controlador "cpu" não disponível')
                return False

            # Verifica se systemctl está disponível
            result = subprocess.run(
                ['systemctl', '--version'],
                capture_output=True, timeout=5,
            )
            if result.returncode != 0:
                logger.warning('systemctl não disponível')
                return False

            return True
        except Exception as e:
            logger.debug(f'Verificação de cgroups falhou: {e}')
            return False

    def _get_uid(self, username: str) -> int | None:
        """Obtém o UID de um usuário do sistema."""
        try:
            import pwd
            pw = pwd.getpwnam(username)
            return pw.pw_uid
        except KeyError:
            logger.error(f'Usuário {username} não encontrado no sistema')
            return None

    def _set_cpu_weight(self, username: str, uid: int, weight: int) -> bool:
        """
        Aplica peso de CPU via systemd para um user slice.

        Usa `systemctl set-property` para definir CPUWeight no slice do usuário.
        O slice user-<UID>.slice é criado automaticamente pelo systemd-logind
        quando o usuário faz login (ex: via SSH).
        """
        slice_name = f'user-{uid}.slice'

        try:
            # Verifica se o slice existe (o usuário precisa estar logado)
            check = subprocess.run(
                ['systemctl', 'is-active', slice_name],
                capture_output=True, text=True, timeout=5,
            )

            if check.returncode != 0:
                # Slice não existe — tenta criar diretamente via sysfs como fallback
                return self._set_cpu_weight_sysfs(username, uid, weight)

            # Aplica via systemctl (forma preferida — persistente enquanto rodando)
            result = subprocess.run(
                ['systemctl', 'set-property', slice_name, f'CPUWeight={weight}'],
                capture_output=True, text=True, timeout=10,
            )

            if result.returncode != 0:
                logger.error(
                    f'Falha ao definir CPUWeight={weight} para {slice_name}: '
                    f'{result.stderr}'
                )
                # Fallback para sysfs
                return self._set_cpu_weight_sysfs(username, uid, weight)

            logger.debug(f'CPUWeight={weight} aplicado em {slice_name}')
            return True

        except subprocess.TimeoutExpired:
            logger.error(f'Timeout ao definir cpu weight para {username}')
            return False
        except Exception as e:
            logger.error(f'Erro ao definir cpu weight para {username}: {e}')
            return False

    def _set_cpu_weight_sysfs(self, username: str, uid: int, weight: int) -> bool:
        """
        Fallback: aplica peso diretamente via sysfs.
        Funciona mesmo que o systemd slice não exista ainda.
        """
        try:
            cgroup_path = Path(f'/sys/fs/cgroup/user.slice/user-{uid}.slice')
            if not cgroup_path.exists():
                logger.debug(
                    f'cgroup slice não existe para {username} (uid={uid}). '
                    f'O usuário precisa estar logado. Peso será aplicado quando logar.'
                )
                return False

            weight_file = cgroup_path / 'cpu.weight'
            if not weight_file.exists():
                logger.debug(f'cpu.weight não disponível em {cgroup_path}')
                return False

            with open(weight_file, 'w') as f:
                f.write(str(weight))

            logger.debug(f'cpu.weight={weight} aplicado via sysfs para {username}')
            return True

        except PermissionError:
            logger.error(
                f'Sem permissão para escrever em cgroup de {username}. '
                f'O agente precisa rodar como root.'
            )
            return False
        except Exception as e:
            logger.error(f'Erro ao definir cpu weight via sysfs para {username}: {e}')
            return False

    def _demote_others(self, owner_username: str):
        """Rebaixa todos os outros usuários logados para peso mínimo."""
        try:
            # Lista usuários logados via `who`
            result = subprocess.run(
                ['who'], capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                return

            logged_users = set()
            for line in result.stdout.strip().splitlines():
                parts = line.split()
                if parts:
                    logged_users.add(parts[0])

            # Remove o dono da lista
            logged_users.discard(owner_username)

            for username in logged_users:
                uid = self._get_uid(username)
                if uid is not None:
                    if self._set_cpu_weight(username, uid, CGROUP_GUEST_CPU_WEIGHT):
                        self._current_weights[username] = CGROUP_GUEST_CPU_WEIGHT

        except Exception as e:
            logger.debug(f'Erro ao rebaixar outros usuários: {e}')

    def get_logged_system_users(self) -> list[str]:
        """Retorna lista de usuários atualmente logados no sistema (via `who`)."""
        try:
            result = subprocess.run(
                ['who'], capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                return []

            users = set()
            for line in result.stdout.strip().splitlines():
                parts = line.split()
                if parts:
                    users.add(parts[0])
            return list(users)
        except Exception:
            return []
