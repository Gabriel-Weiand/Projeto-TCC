"""
Cliente HTTP para comunicação com a API do servidor.

Todas as rotas do agente exigem dois cabeçalhos:
  - Authorization: Bearer <machine_token>
  - X-Machine-Mac: <mac_address>
"""

import requests
import logging

from config import SERVER_URL, MACHINE_TOKEN, MAC_ADDRESS

logger = logging.getLogger('agent.api')


class APIClient:
    """Cliente para as rotas /api/agent/* do servidor."""

    def __init__(self):
        self.base_url = SERVER_URL.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {MACHINE_TOKEN}',
            'X-Machine-Mac': MAC_ADDRESS,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })
        self.timeout = 10

    def _url(self, path: str) -> str:
        return f'{self.base_url}/api/agent/{path}'

    # ----- Heartbeat -----

    def heartbeat(self, logged_user_id: int | None = None) -> dict | None:
        """
        Envia heartbeat ao servidor. Retorna informações de controle:
        machine, currentAllocation, nextAllocation, quickAllocate, shouldBlock, blockReason.

        POST /api/agent/heartbeat?loggedUserId=<id>
        """
        try:
            params = {}
            if logged_user_id is not None:
                params['loggedUserId'] = logged_user_id
            resp = self.session.post(
                self._url('heartbeat'), params=params, timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.ConnectionError:
            logger.warning('Servidor inacessível')
            return None
        except Exception as e:
            logger.error(f'Heartbeat falhou: {e}')
            return None

    # ----- Validação de Usuário -----

    def validate_user(self, email: str, password: str) -> dict | None:
        """
        Valida credenciais de um usuário e verifica se tem alocação ativa.

        POST /api/agent/validate-user
        Body: { email, password }
        """
        try:
            resp = self.session.post(
                self._url('validate-user'),
                json={'email': email, 'password': password},
                timeout=self.timeout,
            )
            return resp.json()
        except requests.ConnectionError:
            logger.warning('Servidor inacessível')
            return None
        except Exception as e:
            logger.error(f'Validação falhou: {e}')
            return None

    # ----- Telemetria -----

    def send_telemetry(self, data: dict) -> bool:
        """
        Envia dados de telemetria. O servidor armazena no buffer e persiste em lote.
        Retorna 204 em caso de sucesso (com ou sem alocação ativa).

        POST /api/agent/telemetry
        Body: { cpuUsage, cpuTemp, gpuUsage, gpuTemp, ramUsage, ... }
        """
        try:
            resp = self.session.post(
                self._url('telemetry'),
                json=data,
                timeout=self.timeout,
            )
            return resp.status_code == 204
        except Exception as e:
            logger.error(f'Envio de telemetria falhou: {e}')
            return False

    # ----- Reports de Login/Logout -----

    def report_login(self, username: str) -> bool:
        """
        Reporta que um usuário logou no SO da máquina.

        POST /api/agent/report-login
        Body: { username }
        """
        try:
            resp = self.session.post(
                self._url('report-login'),
                json={'username': username},
                timeout=self.timeout,
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f'Report login falhou: {e}')
            return False

    def report_logout(self) -> bool:
        """
        Reporta que o usuário deslogou da máquina.

        POST /api/agent/report-logout
        """
        try:
            resp = self.session.post(self._url('report-logout'), timeout=self.timeout)
            return resp.status_code == 200
        except Exception as e:
            logger.error(f'Report logout falhou: {e}')
            return False

    # ----- Sincronização de Specs -----

    def sync_specs(self, specs: dict) -> bool:
        """
        Sincroniza especificações de hardware detectadas com o servidor.

        PUT /api/agent/sync-specs
        Body: { cpuModel?, gpuModel?, totalRamGb?, totalDiskGb?, ipAddress? }
        """
        try:
            resp = self.session.put(
                self._url('sync-specs'),
                json=specs,
                timeout=self.timeout,
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f'Sync specs falhou: {e}')
            return False

    # ----- Quick Allocate (preparado para uso futuro) -----

    def quick_allocate(self, email: str, password: str, duration_minutes: int | None = None) -> dict | None:
        """
        Cria uma alocação rápida diretamente do agente.

        POST /api/agent/quick-allocate
        Body: { email, password, durationMinutes? }
        """
        try:
            payload = {'email': email, 'password': password}
            if duration_minutes:
                payload['durationMinutes'] = duration_minutes
            resp = self.session.post(
                self._url('quick-allocate'),
                json=payload,
                timeout=self.timeout,
            )
            return resp.json()
        except Exception as e:
            logger.error(f'Quick allocate falhou: {e}')
            return None

    # ----- Agenda do dia -----

    def day_schedule(self, date: str | None = None, tz: str | None = None) -> dict | None:
        """
        Retorna agenda do dia da máquina.

        GET /api/agent/day-schedule?date=YYYY-MM-DD&tz=America/Sao_Paulo
        """
        try:
            params = {}
            if date:
                params['date'] = date
            if tz:
                params['tz'] = tz
            resp = self.session.get(
                self._url('day-schedule'),
                params=params,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f'Day schedule falhou: {e}')
            return None
