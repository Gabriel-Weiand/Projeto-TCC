"""
Gerenciador de chaves SSH temporárias.

Responsabilidades:
  - Gerar par de chaves ed25519 on-the-fly
  - Adicionar chave pública ao authorized_keys do usuário do sistema
  - Remover chave pública ao fim da alocação
  - Limpeza segura de chaves privadas do disco

Segurança:
  - Chaves privadas são deletadas do disco imediatamente após leitura
  - Cada sessão tem uma chave única com comentário identificador
  - Remoção cirúrgica do authorized_keys (por fingerprint)
"""

import os
import time
import subprocess
import logging
import tempfile
import re
from pathlib import Path

logger = logging.getLogger('agent.ssh')


class SSHManager:
    """Gerencia chaves SSH temporárias para sessões de alocação."""

    def __init__(self):
        # Sessões ativas: allocation_id -> { system_user, fingerprint, public_key }
        self._active_sessions: dict[int, dict] = {}

    def generate_keypair(self, system_username: str, allocation_id: int) -> dict | None:
        """
        Gera um par de chaves ed25519 temporário e o instala no authorized_keys.

        Retorna:
            {
                'privateKey': str,       # Conteúdo da chave privada (para enviar ao frontend)
                'publicKey': str,        # Conteúdo da chave pública
                'fingerprint': str,      # Fingerprint SHA256 da chave
                'systemUsername': str,    # Usuário do sistema
            }
            Ou None em caso de erro.
        """
        key_comment = f'lab-session-{allocation_id}-{int(time.time())}'
        tmp_dir = tempfile.mkdtemp(prefix='lab_ssh_')
        key_path = os.path.join(tmp_dir, 'id_session')

        try:
            # 1. Gera o par de chaves
            result = subprocess.run(
                [
                    'ssh-keygen',
                    '-t', 'ed25519',
                    '-f', key_path,
                    '-N', '',        # Sem passphrase
                    '-q',            # Silencioso
                    '-C', key_comment,
                ],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                logger.error(f'ssh-keygen falhou: {result.stderr}')
                return None

            # 2. Lê as chaves
            with open(key_path, 'r') as f:
                private_key = f.read()
            with open(f'{key_path}.pub', 'r') as f:
                public_key = f.read().strip()

            # 3. Obtém fingerprint
            fp_result = subprocess.run(
                ['ssh-keygen', '-lf', f'{key_path}.pub'],
                capture_output=True, text=True, timeout=5,
            )
            if fp_result.returncode != 0:
                logger.error(f'Fingerprint falhou: {fp_result.stderr}')
                return None

            # Extrai o fingerprint (formato: "256 SHA256:xxxx comment (ED25519)")
            fingerprint = fp_result.stdout.strip().split()[1]

            # 4. Instala a chave pública no authorized_keys
            if not self._install_public_key(system_username, public_key):
                return None

            # 5. Registra sessão ativa
            self._active_sessions[allocation_id] = {
                'system_username': system_username,
                'fingerprint': fingerprint,
                'public_key': public_key,
                'comment': key_comment,
            }

            logger.info(
                f'Chave SSH gerada para allocation={allocation_id} '
                f'user={system_username} fp={fingerprint}'
            )

            return {
                'privateKey': private_key,
                'publicKey': public_key,
                'fingerprint': fingerprint,
                'systemUsername': system_username,
            }

        except subprocess.TimeoutExpired:
            logger.error('ssh-keygen timeout')
            return None
        except Exception as e:
            logger.error(f'Erro ao gerar chave SSH: {e}')
            return None
        finally:
            # LIMPEZA OBRIGATÓRIA: remove chaves do disco
            self._secure_delete(key_path)
            self._secure_delete(f'{key_path}.pub')
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass

    def revoke_session(self, allocation_id: int) -> bool:
        """
        Revoga a sessão SSH de uma alocação, removendo a chave do authorized_keys.

        Returns:
            True se revogou com sucesso, False se não encontrou a sessão.
        """
        session = self._active_sessions.pop(allocation_id, None)
        if not session:
            logger.warning(f'Sessão SSH não encontrada para allocation={allocation_id}')
            return False

        system_username = session['system_username']
        public_key = session['public_key']

        success = self._remove_public_key(system_username, public_key)

        if success:
            logger.info(
                f'Chave SSH revogada para allocation={allocation_id} user={system_username}'
            )
        else:
            logger.error(
                f'Falha ao revogar chave SSH para allocation={allocation_id} user={system_username}'
            )

        return success

    def revoke_all(self) -> int:
        """Revoga todas as sessões SSH ativas. Retorna quantidade revogada."""
        count = 0
        for alloc_id in list(self._active_sessions.keys()):
            if self.revoke_session(alloc_id):
                count += 1
        return count

    def get_active_sessions(self) -> dict[int, dict]:
        """Retorna cópia das sessões ativas."""
        return dict(self._active_sessions)

    # ─── Métodos internos ────────────────────────────────────────

    def _get_authorized_keys_path(self, system_username: str) -> Path:
        """Retorna o caminho do authorized_keys de um usuário do sistema."""
        return Path(f'/home/{system_username}/.ssh/authorized_keys')

    def _install_public_key(self, system_username: str, public_key: str) -> bool:
        """Adiciona uma chave pública ao authorized_keys do usuário."""
        try:
            ssh_dir = Path(f'/home/{system_username}/.ssh')
            auth_keys = ssh_dir / 'authorized_keys'

            # Garante que o diretório .ssh existe com permissões corretas
            if not ssh_dir.exists():
                ssh_dir.mkdir(mode=0o700, parents=True)
                # Define dono como o usuário do sistema
                self._chown_to_user(ssh_dir, system_username)

            # Cria arquivo se não existe
            if not auth_keys.exists():
                auth_keys.touch(mode=0o600)
                self._chown_to_user(auth_keys, system_username)

            # Adiciona a chave
            with open(auth_keys, 'a') as f:
                f.write(f'\n{public_key}\n')

            logger.debug(f'Chave instalada em {auth_keys}')
            return True

        except PermissionError:
            logger.error(
                f'Sem permissão para escrever em authorized_keys de {system_username}. '
                f'O agente precisa rodar como root ou com sudo.'
            )
            return False
        except Exception as e:
            logger.error(f'Erro ao instalar chave pública: {e}')
            return False

    def _remove_public_key(self, system_username: str, public_key: str) -> bool:
        """Remove uma chave pública específica do authorized_keys."""
        auth_keys = self._get_authorized_keys_path(system_username)

        if not auth_keys.exists():
            return True  # Nada para remover

        try:
            # Lê o conteúdo atual
            with open(auth_keys, 'r') as f:
                lines = f.readlines()

            # Extrai a parte da chave sem espaços em branco (para comparação segura)
            key_data = public_key.strip()

            # Filtra linhas que NÃO contêm a chave
            new_lines = [
                line for line in lines
                if line.strip() and key_data not in line
            ]

            # Reescreve o arquivo
            with open(auth_keys, 'w') as f:
                f.writelines(new_lines)

            logger.debug(f'Chave removida de {auth_keys}')
            return True

        except PermissionError:
            logger.error(
                f'Sem permissão para editar authorized_keys de {system_username}.'
            )
            return False
        except Exception as e:
            logger.error(f'Erro ao remover chave pública: {e}')
            return False

    def _chown_to_user(self, path: Path, username: str):
        """Muda o dono de um arquivo/diretório para o usuário do sistema."""
        try:
            import pwd
            pw = pwd.getpwnam(username)
            os.chown(str(path), pw.pw_uid, pw.pw_gid)
        except KeyError:
            logger.warning(f'Usuário {username} não encontrado no sistema')
        except Exception as e:
            logger.warning(f'Falha ao chown {path} para {username}: {e}')

    def _secure_delete(self, filepath: str):
        """Deleta um arquivo de forma segura (overwrite + unlink)."""
        try:
            if not os.path.exists(filepath):
                return
            # Sobrescreve com zeros antes de deletar
            size = os.path.getsize(filepath)
            with open(filepath, 'wb') as f:
                f.write(b'\x00' * size)
                f.flush()
                os.fsync(f.fileno())
            os.unlink(filepath)
        except Exception as e:
            # Fallback: tenta deletar sem sobrescrita
            try:
                os.unlink(filepath)
            except Exception:
                logger.warning(f'Falha ao deletar {filepath}: {e}')
