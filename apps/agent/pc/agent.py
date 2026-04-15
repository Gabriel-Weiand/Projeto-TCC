"""
Orquestrador principal do agente de monitoramento.

Responsabilidades:
  - Heartbeat periódico (polling do estado da máquina)
  - Coleta e envio de telemetria quando há alocação ativa
  - Sincronização de specs na inicialização
  - Controle do overlay de bloqueio (show/hide) conforme estado do servidor
  - Login e Quick-Allocate via overlay
"""

import time
import threading
import logging

from api_client import APIClient
from hardware import collect_telemetry, get_system_specs
from config import HEARTBEAT_INTERVAL, TELEMETRY_INTERVAL
from time_sync import sync_ntp, utc_iso, local_iana_timezone, sync_from_server

logger = logging.getLogger('agent')


class Agent:
    """Agente daemon que mantém comunicação contínua com o servidor."""

    def __init__(self, overlay=None):
        """
        Args:
            overlay: Instância de ScreenLockOverlay (ou None para modo sem GUI).
        """
        self.api = APIClient()
        self.overlay = overlay
        self.running = False

        # Estado derivado do heartbeat
        self.has_active_allocation = False
        self.should_block = False
        self.logged_user_id = None
        self.logged_user_name = None
        self._heartbeat_data = None

        # Avisos de fim de sessão (minutos restantes em que já avisou)
        self._warnings_shown: set[int] = set()
        _WARNING_THRESHOLDS = [10, 5, 1]

        # Conecta callbacks do overlay
        if self.overlay:
            self.overlay.set_on_login(self._handle_login)
            self.overlay.set_on_quick_allocate(self._handle_quick_allocate)

    # ============================================================
    # Ciclo de vida
    # ============================================================

    def start(self):
        """Inicia o agente em background (não-bloqueante quando há overlay)."""
        self.running = True

        logger.info('══════════════════════════════════════════')
        logger.info('   Agente de Monitoramento iniciando')
        logger.info('══════════════════════════════════════════')

        # Sincroniza relógio via NTP (UTC)
        sync_ntp()
        self._local_tz = local_iana_timezone()
        logger.info(f'Fuso local: {self._local_tz} | UTC agora: {utc_iso()}')

        # Sincroniza specs uma vez na inicialização
        self._sync_specs()

        # Threads de background
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._telemetry_loop, daemon=True).start()

        logger.info(f'Heartbeat a cada {HEARTBEAT_INTERVAL}s')
        logger.info(f'Telemetria a cada {TELEMETRY_INTERVAL}s')

        # Exibe overlay inicialmente (máquina começa bloqueada)
        if self.overlay:
            self.overlay.after(0, self.overlay.show)
            logger.info('Agente pronto. Overlay de bloqueio ativo.')
        else:
            logger.info('Agente pronto (sem overlay). Pressione Ctrl+C para parar.')

    def start_blocking(self):
        """Inicia o agente de forma bloqueante (sem overlay)."""
        self.start()
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

        # Sincroniza relógio via serverTime (fallback quando NTP indisponível)
        server_time = data.get('serverTime')
        if server_time:
            sync_from_server(server_time)

        # Atualiza estado
        self.should_block = data.get('shouldBlock', False)
        current_alloc = data.get('currentAllocation')
        self.has_active_allocation = current_alloc is not None

        machine = data.get('machine', {})
        name = machine.get('name', '?')
        status = machine.get('status', '?')

        # Atualiza overlay com info da máquina
        if self.overlay:
            self.overlay.after(0, self.overlay.update_machine_info, name, status)

            # Atualiza info de quick-allocate
            qa = data.get('quickAllocate', {})
            qa_allowed = qa.get('allowed', False)
            qa_max = qa.get('maxDurationMinutes', 0)
            self.overlay.after(0, self.overlay.update_quick_allocate_info, qa_allowed, qa_max)

        # Log contextual
        if self.has_active_allocation:
            user_name = current_alloc.get('userName', '?')
            remaining = current_alloc.get('remainingMinutes', '?')
            logger.info(
                f'Heartbeat OK | {name} [{status}] | '
                f'Alocacao: {user_name} ({remaining}min restantes)'
            )

            # Avisos de fim de sessão (10, 5, 1 min)
            if self.overlay and not self.overlay.is_visible and isinstance(remaining, (int, float)):
                for threshold in [10, 5, 1]:
                    if remaining <= threshold and threshold not in self._warnings_shown:
                        self._warnings_shown.add(threshold)
                        self.overlay.show_warning_popup(threshold)
                        logger.info(f'Aviso de fim de sessão: {threshold} min restantes')
        else:
            logger.info(f'Heartbeat OK | {name} [{status}] | Sem alocacao ativa')
            # Limpa avisos quando não há alocação (para a próxima sessão)
            self._warnings_shown.clear()

        # Quick-allocate info (debug)
        qa = data.get('quickAllocate', {})
        if qa.get('allowed'):
            logger.debug(f'Quick-allocate disponivel (max {qa.get("maxDurationMinutes")}min)')

        # Controle do overlay baseado no estado
        if self.overlay:
            if self.should_block:
                reason = data.get('blockReason', 'UNKNOWN')
                logger.warning(f'Bloqueio solicitado pelo servidor: {reason}')

                # Se havia usuário logado, reporta logout ao servidor
                # (ex: alocação expirou, manutenção, etc.)
                if self.logged_user_id:
                    logger.info(
                        f'Sessão encerrada para {self.logged_user_name} — '
                        f'reportando logout (motivo: {reason})'
                    )
                    self.api.report_logout()
                    self.logged_user_id = None
                    self.logged_user_name = None

                self.overlay.after(0, self.overlay.show)
            elif self.has_active_allocation and self.logged_user_id:
                # Tem alocação ativa e usuário logado — libera desktop
                self.overlay.after(0, self.overlay.hide)

    # ============================================================
    # Login via Overlay
    # ============================================================

    def _handle_login(self, email: str, password: str):
        """
        Callback chamado pelo overlay quando o usuário clica em ENTRAR.
        Roda em thread separada (não bloqueia a GUI).
        """
        result = self.api.validate_user(email, password)

        if result is None:
            self.overlay.set_status_message(
                'Erro de conexão com o servidor.', '#f87171'
            )
            self.overlay.reset_buttons()
            return

        if result.get('allowed'):
            user = result.get('user', {})
            name = user.get('fullName', 'Usuário')
            user_id = user.get('id')

            self.logged_user_id = user_id
            self.logged_user_name = name

            # Reporta login ao servidor
            self.api.report_login(name)
            logger.info(f'Login autorizado: {name} (id={user_id})')

            self.overlay.set_status_message(
                f'✓ Bem-vindo(a), {name}!', '#34d399'
            )

            # Esconde overlay após 1.5s
            self.overlay.after(1500, self.overlay.hide)
        else:
            reason = result.get('reason', 'UNKNOWN')
            messages = {
                'INVALID_CREDENTIALS': 'Email ou senha inválidos.',
                'NO_ACTIVE_ALLOCATION': 'Sem alocação ativa para esta máquina.',
                'MACHINE_MAINTENANCE': 'Máquina em manutenção.',
            }
            msg = messages.get(reason, result.get('message', 'Acesso negado.'))
            self.overlay.set_status_message(f'✗ {msg}', '#f87171')
            self.overlay.reset_buttons()

    def _handle_quick_allocate(self, email: str, password: str, duration_minutes: int):
        """
        Callback chamado pelo overlay quando o usuário clica em Alocação Rápida.
        Roda em thread separada.
        """
        result = self.api.quick_allocate(email, password, duration_minutes)

        if result is None:
            self.overlay.set_status_message(
                'Erro de conexão com o servidor.', '#f87171'
            )
            self.overlay.reset_buttons()
            return

        if result.get('success'):
            user = result.get('user', {})
            name = user.get('fullName', 'Usuário')
            user_id = user.get('id')
            alloc = result.get('allocation', {})
            dur = alloc.get('durationMinutes', '?')

            self.logged_user_id = user_id
            self.logged_user_name = name

            # Reporta login ao servidor
            self.api.report_login(name)
            logger.info(f'Quick-allocate bem-sucedido: {name} ({dur}min)')

            self.overlay.set_status_message(
                f'✓ Alocação criada! {name}, você tem {dur} minutos.', '#34d399'
            )

            # Esconde overlay após 1.5s
            self.overlay.after(1500, self.overlay.hide)
        else:
            reason = result.get('reason', 'UNKNOWN')
            msg = result.get('message', 'Não foi possível criar a alocação.')
            self.overlay.set_status_message(f'✗ {msg}', '#f87171')
            self.overlay.reset_buttons()

    # ============================================================
    # Telemetria
    # ============================================================

    def _telemetry_loop(self):
        """Loop que envia telemetria a cada TELEMETRY_INTERVAL segundos.
        Envia SEMPRE para manter o dashboard atualizado em tempo real.
        A API decide se persiste no banco (apenas quando há alocação ativa).
        """
        while self.running:
            time.sleep(TELEMETRY_INTERVAL)
            if not self.running:
                break
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
