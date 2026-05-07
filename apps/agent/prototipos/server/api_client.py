"""
Cliente HTTP para comunicação com a API do servidor.

Todas as rotas do agente exigem dois cabeçalhos:
  - Authorization: Bearer <machine_token>
  - X-Machine-Mac: <mac_address>

Inclui endpoints específicos do agente servidor:
  - SSH session management
  - cgroup status reporting
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

    # ─── Heartbeat ───────────────────────────────────────────────

    def heartbeat(self, logged_user_id: int | None = None) -> dict | None:
        """
        POST /api/agent/heartbeat
        Retorna: machine, currentAllocation, nextAllocation, shouldBlock, etc.
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

    # ─── Telemetria ──────────────────────────────────────────────

    def send_telemetry(self, data: dict) -> bool:
        """POST /api/agent/telemetry"""
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

    # ─── Sync Specs ──────────────────────────────────────────────

    def sync_specs(self, specs: dict) -> bool:
        """PUT /api/agent/sync-specs"""
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

    # ─── Reports de Login/Logout ─────────────────────────────────

    def report_login(self, username: str) -> bool:
        """POST /api/agent/report-login"""
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
        """POST /api/agent/report-logout"""
        try:
            resp = self.session.post(self._url('report-logout'), timeout=self.timeout)
            return resp.status_code == 200
        except Exception as e:
            logger.error(f'Report logout falhou: {e}')
            return False

    # ─── SSH Session Management ──────────────────────────────────

    def ssh_get_pending(self) -> list[dict]:
        """
        GET /api/agent/ssh/pending
        Retorna lista de sessões SSH pendentes que precisam de geração de chave.
        """
        try:
            resp = self.session.get(self._url('ssh/pending'), timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            return data.get('pending', [])
        except requests.ConnectionError:
            logger.warning('Servidor inacessível (ssh/pending)')
            return []
        except Exception as e:
            logger.error(f'SSH pending falhou: {e}')
            return []

    def ssh_report_setup(
        self,
        allocation_id: int,
        system_username: str,
        public_key_fingerprint: str,
        private_key: str,
    ) -> dict | None:
        """
        POST /api/agent/ssh/setup
        Reporta que a chave SSH foi gerada e envia a chave privada para o frontend.
        """
        try:
            resp = self.session.post(
                self._url('ssh/setup'),
                json={
                    'allocationId': allocation_id,
                    'systemUsername': system_username,
                    'publicKeyFingerprint': public_key_fingerprint,
                    'privateKey': private_key,
                },
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f'SSH setup report falhou: {e}')
            return None

    def ssh_report_teardown(self, allocation_id: int) -> dict | None:
        """
        POST /api/agent/ssh/teardown
        Reporta que a sessão SSH foi revogada (chave removida).
        """
        try:
            resp = self.session.post(
                self._url('ssh/teardown'),
                json={'allocationId': allocation_id},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f'SSH teardown report falhou: {e}')
            return None

    # ─── Day Schedule ────────────────────────────────────────────

    def day_schedule(self, date: str | None = None, tz: str | None = None) -> dict | None:
        """GET /api/agent/day-schedule"""
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
