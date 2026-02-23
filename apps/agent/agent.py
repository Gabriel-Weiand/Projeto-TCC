"""
Orquestrador principal do agente de monitoramento.

Responsabilidades:
  - Heartbeat periódico (polling do estado da máquina)
  - Coleta e envio de telemetria quando há alocação ativa
  - Sincronização de specs na inicialização
  - Bloqueio de tela quando solicitado pelo servidor
"""

import time
import threading
import logging

from api_client import APIClient
from hardware import collect_telemetry, get_system_specs
from screen_lock import lock_screen
from config import HEARTBEAT_INTERVAL, TELEMETRY_INTERVAL

logger = logging.getLogger('agent')


class Agent:
    """Agente daemon que mantém comunicação contínua com o servidor."""

    def __init__(self):
        self.api = APIClient()
        self.running = False

        # Estado derivado do heartbeat
        self.has_active_allocation = False
        self.should_block = False
        self.logged_user_id = None
        self._heartbeat_data = None

    # ============================================================
    # Ciclo de vida
    # ============================================================

    def start(self):
        """Inicia o agente (bloqueante — roda até Ctrl+C)."""
        self.running = True

        logger.info('══════════════════════════════════════════')
        logger.info('   Agente de Monitoramento iniciando')
        logger.info('══════════════════════════════════════════')

        # Sincroniza specs uma vez na inicialização
        self._sync_specs()

        # Threads de background
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._telemetry_loop, daemon=True).start()

        logger.info(f'Heartbeat a cada {HEARTBEAT_INTERVAL}s')
        logger.info(f'Telemetria a cada {TELEMETRY_INTERVAL}s (quando há alocação ativa)')
        logger.info('Agente pronto. Pressione Ctrl+C para parar.\n')

        # Mantém a thread principal viva
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        """Para o agente graciosamente."""
        logger.info('Parando agente...')
        self.running = False

        # Reporta logout ao servidor se havia usuário autenticado
        if self.logged_user_id:
            self.api.report_logout()
            logger.info('Logout reportado ao servidor')

        logger.info('Agente finalizado.')

    # ============================================================
    # Heartbeat
    # ============================================================

    def _heartbeat_loop(self):
        """Loop que executa heartbeat a cada HEARTBEAT_INTERVAL segundos."""
        # Primeiro heartbeat imediato
        self._do_heartbeat()

        while self.running:
            time.sleep(HEARTBEAT_INTERVAL)
            if not self.running:
                break
            self._do_heartbeat()

    def _do_heartbeat(self):
        """Executa um único heartbeat e atualiza o estado do agente."""
        try:
            data = self.api.heartbeat(logged_user_id=self.logged_user_id)
        except Exception as e:
            logger.error(f'Erro no heartbeat: {e}')
            return

        if data is None:
            logger.warning('Heartbeat sem resposta do servidor')
            return

        self._heartbeat_data = data

        # Atualiza estado
        self.should_block = data.get('shouldBlock', False)
        current_alloc = data.get('currentAllocation')
        self.has_active_allocation = current_alloc is not None

        machine = data.get('machine', {})
        name = machine.get('name', '?')
        status = machine.get('status', '?')

        # Log contextual
        if self.has_active_allocation:
            user_name = current_alloc.get('userName', '?')
            remaining = current_alloc.get('remainingMinutes', '?')
            logger.info(
                f'Heartbeat OK | {name} [{status}] | '
                f'Alocacao: {user_name} ({remaining}min restantes)'
            )
        else:
            logger.info(f'Heartbeat OK | {name} [{status}] | Sem alocacao ativa')

        # Quick-allocate info (debug)
        qa = data.get('quickAllocate', {})
        if qa.get('allowed'):
            logger.debug(f'Quick-allocate disponivel (max {qa.get("maxDurationMinutes")}min)')

        # Bloqueio de tela
        if self.should_block:
            reason = data.get('blockReason', 'UNKNOWN')
            logger.warning(f'Bloqueio solicitado pelo servidor: {reason}')
            lock_screen()

    # ============================================================
    # Telemetria
    # ============================================================

    def _telemetry_loop(self):
        """Loop que envia telemetria a cada TELEMETRY_INTERVAL segundos."""
        while self.running:
            time.sleep(TELEMETRY_INTERVAL)
            if not self.running:
                break
            if self.has_active_allocation:
                self._send_telemetry()

    def _send_telemetry(self):
        """Coleta e envia dados de telemetria ao servidor."""
        try:
            data = collect_telemetry()
            success = self.api.send_telemetry(data)

            if success:
                logger.debug(
                    f'Telemetria enviada | '
                    f'CPU: {data["cpuUsage"] / 10:.1f}% '
                    f'RAM: {data["ramUsage"] / 10:.1f}% '
                    f'Disco: {data.get("diskUsage", 0) / 10:.1f}%'
                )
            else:
                logger.warning('Falha ao enviar telemetria')
        except Exception as e:
            logger.error(f'Erro na telemetria: {e}')

    # ============================================================
    # Hardware specs sync
    # ============================================================

    def _sync_specs(self):
        """Sincroniza especificações de hardware com o servidor."""
        specs = get_system_specs()
        if not specs:
            logger.warning('Nenhuma spec detectada para sincronizar')
            return

        success = self.api.sync_specs(specs)
        if success:
            logger.info(f'Specs sincronizadas: {specs}')
        else:
            logger.warning('Falha ao sincronizar specs (servidor indisponível?)')
