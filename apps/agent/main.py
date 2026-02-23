#!/usr/bin/env python3
"""
Agente de Monitoramento — Sistema de Laboratórios

Ponto de entrada principal.

Modos de execução:
    python main.py              Inicia o agente daemon (heartbeat + telemetria)
    python main.py --login      Abre a janela de login para validação de usuário
    python main.py --sync       Sincroniza specs de hardware e encerra
"""

import sys
import logging

from config import SERVER_URL, MACHINE_TOKEN, MAC_ADDRESS

# ── Logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger('agent')


# ── Validação de configuração ────────────────────────────────────────

def _validate_config():
    """Verifica se as variáveis obrigatórias estão configuradas."""
    if not MACHINE_TOKEN:
        logger.error('MACHINE_TOKEN não configurado! Edite o arquivo .env')
        sys.exit(1)

    if not MAC_ADDRESS:
        logger.error(
            'MAC_ADDRESS não detectado automaticamente e não configurado no .env.\n'
            '  Dica: defina MAC_ADDRESS=XX:XX:XX:XX:XX:XX no arquivo .env'
        )
        sys.exit(1)

    token_preview = f'{MACHINE_TOKEN[:8]}...{MACHINE_TOKEN[-4:]}' if len(MACHINE_TOKEN) > 12 else '***'
    logger.info(f'Servidor : {SERVER_URL}')
    logger.info(f'MAC      : {MAC_ADDRESS}')
    logger.info(f'Token    : {token_preview}')


# ── Modos de execução ───────────────────────────────────────────────

def run_agent():
    """Modo padrão: inicia o agente daemon (heartbeat + telemetria)."""
    from agent import Agent

    agent = Agent()
    agent.start()


def run_login():
    """Modo --login: abre a janela de login para validação de usuário."""
    from api_client import APIClient
    from login_window import show_login

    api = APIClient()

    def on_success(result):
        user = result.get('user', {})
        logger.info(f'Login bem-sucedido: {user.get("fullName")}')

    show_login(api, on_success=on_success)


def run_sync():
    """Modo --sync: sincroniza specs de hardware e encerra."""
    from api_client import APIClient
    from hardware import get_system_specs

    api = APIClient()
    specs = get_system_specs()

    logger.info(f'Specs detectadas: {specs}')

    if api.sync_specs(specs):
        logger.info('Specs sincronizadas com sucesso!')
    else:
        logger.error('Falha ao sincronizar specs com o servidor')
        sys.exit(1)


# ── Main ─────────────────────────────────────────────────────────────

def main():
    _validate_config()

    if '--login' in sys.argv:
        run_login()
    elif '--sync' in sys.argv:
        run_sync()
    else:
        run_agent()


if __name__ == '__main__':
    main()
