"""
Orquestrador principal do agente de servidor (HPC/Renderização).

Responsabilidades:
  - Heartbeat periódico (polling do estado da máquina)
  - Coleta e envio de telemetria
  - Sincronização de specs na inicialização
  - Gerenciamento de sessões SSH temporárias
  - Controle de recursos via cgroups v2 (pesos de CPU)
  - Aplicação de cgroups baseada em alocação ativa

Diferenças do agente PC:
  - Sem GUI/overlay — roda como daemon/systemd service
  - Gerencia chaves SSH ao invés de bloquear tela
  - Aplica cgroups v2 para controle de recursos
  - Múltiplos usuários podem estar logados simultaneamente
"""

import time
import threading
import logging

from api_client import APIClient
from hardware import collect_telemetry, get_system_specs
from ssh_manager import SSHManager
from cgroup_manager import CGroupManager
from config import HEARTBEAT_INTERVAL, TELEMETRY_INTERVAL, SSH_POLL_INTERVAL

logger = logging.getLogger('agent')


class ServerAgent:
    """Agente daemon para servidores de alto desempenho."""

    def __init__(self):
        self.api = APIClient()
        self.ssh = SSHManager()
        self.cgroup = CGroupManager()
        self.running = False

        # Estado derivado do heartbeat
        self.has_active_allocation = False
        self.current_allocation = None
        self.current_owner_username = None
        self._heartbeat_data = None

        # Rastreamento de sessões SSH ativas (allocation_id -> info)
        self._active_ssh_allocations: set[int] = set()

    # ============================================================
    # Ciclo de vida
    # ============================================================

    def start(self):
        """Inicia o agente de servidor."""
        self.running = True

        logger.info('══════════════════════════════════════════')
        logger.info('   Agente de Servidor iniciando')
        logger.info('══════════════════════════════════════════')

        # Sincroniza specs
        self._sync_specs()

        # Threads de background
        threading.Thread(target=self._heartbeat_loop, daemon=True, name='heartbeat').start()
        threading.Thread(target=self._telemetry_loop, daemon=True, name='telemetry').start()
        threading.Thread(target=self._ssh_poll_loop, daemon=True, name='ssh-poll').start()

        logger.info(f'Heartbeat a cada {HEARTBEAT_INTERVAL}s')
        logger.info(f'Telemetria a cada {TELEMETRY_INTERVAL}s')
        logger.info(f'SSH polling a cada {SSH_POLL_INTERVAL}s')
        logger.info(f'cgroups v2: {"ATIVO" if self.cgroup.available else "INDISPONÍVEL"}')
        logger.info('Agente de servidor pronto.')

    def start_blocking(self):
        """Inicia o agente e bloqueia até SIGINT/SIGTERM."""
        self.start()
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        """Para o agente e faz cleanup."""
        logger.info('Parando agente de servidor...')
        self.running = False

        # Revoga todas as sessões SSH ativas
        revoked = self.ssh.revoke_all()
        if revoked > 0:
            logger.info(f'{revoked} sessão(ões) SSH revogada(s)')

        # Restaura pesos de CPU
        self.cgroup.reset_all()

        # Reporta logout
        self.api.report_logout()

        logger.info('Agente de servidor finalizado.')

    # ============================================================
    # Heartbeat
    # ============================================================

    def _heartbeat_loop(self):
        """Loop de heartbeat periódico."""
        self._do_heartbeat()  # Primeiro imediato
        while self.running:
            time.sleep(HEARTBEAT_INTERVAL)
            if not self.running:
                break
            self._do_heartbeat()

    def _do_heartbeat(self):
        """Executa um heartbeat e atualiza estado do agente."""
        try:
            data = self.api.heartbeat()
        except Exception as e:
            logger.error(f'Erro no heartbeat: {e}')
            return

        if data is None:
            logger.warning('Heartbeat sem resposta')
            return

        self._heartbeat_data = data

        current_alloc = data.get('currentAllocation')
        prev_has_alloc = self.has_active_allocation
        self.has_active_allocation = current_alloc is not None

        machine = data.get('machine', {})
        name = machine.get('name', '?')
        status = machine.get('status', '?')

        if self.has_active_allocation:
            user_name = current_alloc.get('userName', '?')
            remaining = current_alloc.get('remainingMinutes', '?')
            alloc_id = current_alloc.get('id')

            logger.info(
                f'Heartbeat OK | {name} [{status}] | '
                f'Alocação: {user_name} ({remaining}min restantes) [id={alloc_id}]'
            )

            # Atualiza estado da alocação
            self.current_allocation = current_alloc

            # Aplica cgroups para o dono da alocação
            self._apply_cgroup_for_allocation(current_alloc)

        else:
            logger.info(f'Heartbeat OK | {name} [{status}] | Sem alocação ativa')

            # Se acabou de perder a alocação, faz cleanup
            if prev_has_alloc:
                self._handle_allocation_ended()

            self.current_allocation = None
            self.current_owner_username = None

    def _apply_cgroup_for_allocation(self, allocation: dict):
        """Aplica pesos cgroup baseado na alocação ativa."""
        if not self.cgroup.available:
            return

        # O system_username vem do heartbeat (atrelado à máquina)
        heartbeat_machine = self._heartbeat_data.get('machine', {})

        # Precisamos determinar quem é o "dono" da alocação
        # O sistema mapeia: allocation.userId → machine.systemUsername
        # Como o heartbeat não retorna systemUsername diretamente,
        # usamos o que foi configurado no agente ou retornado pela API

        # Na prática, o mapeamento é simples para servidores:
        # machine.system_username = o usuário Linux associado
        # O dono da alocação acessa via SSH como esse usuário

        user_email = allocation.get('userEmail', '')
        user_name = allocation.get('userName', '')
        alloc_id = allocation.get('id')

        if alloc_id and alloc_id not in self._active_ssh_allocations:
            # Indica que esta alocação é nova — o cgroup será configurado
            # quando o SSH for provisionado (ssh_manager reporta o system_username)
            pass

    def _handle_allocation_ended(self):
        """Cleanup quando uma alocação termina."""
        logger.info('Alocação encerrada - executando cleanup...')

        # Restaura cgroups
        self.cgroup.reset_all()

        # Revoga sessões SSH de alocações finalizadas
        for alloc_id in list(self._active_ssh_allocations):
            self.ssh.revoke_session(alloc_id)
            self.api.ssh_report_teardown(alloc_id)

        self._active_ssh_allocations.clear()
        logger.info('Cleanup concluído.')

    # ============================================================
    # SSH Session Management
    # ============================================================

    def _ssh_poll_loop(self):
        """Loop que verifica pedidos SSH pendentes na API."""
        while self.running:
            time.sleep(SSH_POLL_INTERVAL)
            if not self.running:
                break
            self._process_ssh_requests()

    def _process_ssh_requests(self):
        """Verifica e processa pedidos SSH pendentes."""
        try:
            pending = self.api.ssh_get_pending()
        except Exception as e:
            logger.error(f'Erro ao buscar SSH pendentes: {e}')
            return

        for request in pending:
            session_id = request.get('sessionId')
            alloc_id = request.get('allocationId')
            system_username = request.get('systemUsername')

            if not system_username:
                logger.warning(f'SSH request sem system_username (alloc={alloc_id})')
                continue

            if alloc_id in self._active_ssh_allocations:
                continue  # Já processado

            logger.info(
                f'Processando SSH request: alloc={alloc_id} user={system_username}'
            )

            # Gera par de chaves
            result = self.ssh.generate_keypair(system_username, alloc_id)
            if result is None:
                logger.error(f'Falha ao gerar chave SSH para alloc={alloc_id}')
                continue

            # Reporta setup para a API (envia chave privada)
            report = self.api.ssh_report_setup(
                allocation_id=alloc_id,
                system_username=result['systemUsername'],
                public_key_fingerprint=result['fingerprint'],
                private_key=result['privateKey'],
            )

            if report and report.get('success'):
                self._active_ssh_allocations.add(alloc_id)

                # Aplica cgroup: dono recebe prioridade máxima
                self.cgroup.set_owner(system_username)
                self.current_owner_username = system_username

                logger.info(
                    f'SSH sessão ativa: alloc={alloc_id} user={system_username} '
                    f'fp={result["fingerprint"]}'
                )
            else:
                # Se falhou o report, revoga a chave local
                self.ssh.revoke_session(alloc_id)
                logger.error(f'Falha ao reportar SSH setup para alloc={alloc_id}')

    # ============================================================
    # Telemetria
    # ============================================================

    def _telemetry_loop(self):
        """Loop de envio de telemetria."""
        while self.running:
            time.sleep(TELEMETRY_INTERVAL)
            if not self.running:
                break
            self._send_telemetry()

    def _send_telemetry(self):
        """Coleta e envia telemetria."""
        try:
            data = collect_telemetry()
            success = self.api.send_telemetry(data)

            if success:
                logger.debug(
                    f'Telemetria | CPU: {data["cpuUsage"] / 10:.1f}% '
                    f'RAM: {data["ramUsage"] / 10:.1f}% '
                    f'Disco: {data.get("diskUsage", 0) / 10:.1f}%'
                )
            else:
                logger.warning('Falha ao enviar telemetria')
        except Exception as e:
            logger.error(f'Erro na telemetria: {e}')

    # ============================================================
    # Hardware Specs Sync
    # ============================================================

    def _sync_specs(self):
        """Sincroniza especificações de hardware."""
        specs = get_system_specs()
        if not specs:
            logger.warning('Nenhuma spec detectada')
            return

        success = self.api.sync_specs(specs)
        if success:
            logger.info(f'Specs sincronizadas: {specs}')
        else:
            logger.warning('Falha ao sincronizar specs')
