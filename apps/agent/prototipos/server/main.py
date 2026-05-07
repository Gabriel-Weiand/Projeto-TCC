#!/usr/bin/env python3
"""
Agente de Servidor (HPC/Renderização) — Ponto de entrada.

Modos de execução:
    sudo python main.py              Inicia o daemon do agente servidor
    sudo python main.py --sync       Sincroniza specs de hardware e encerra
    sudo python main.py --status     Mostra status do cgroups e sessões SSH
    sudo python main.py --test-ssh   Testa geração de chave SSH (dry-run)

NOTA: Requer execução como root para gerenciar cgroups e authorized_keys.
"""

import sys
import os
import signal
import logging

from config import SERVER_URL, MACHINE_TOKEN, MAC_ADDRESS

# ── Logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger('agent')


# ── Validação ────────────────────────────────────────────────────────

def _validate_config():
    """Verifica configuração obrigatória."""
    if not MACHINE_TOKEN:
        logger.error('MACHINE_TOKEN não configurado! Edite o arquivo .env')
        sys.exit(1)

    if not MAC_ADDRESS:
        logger.error(
            'MAC_ADDRESS não detectado. Defina MAC_ADDRESS=XX:XX:XX:XX:XX:XX no .env'
        )
        sys.exit(1)

    token_preview = f'{MACHINE_TOKEN[:8]}...{MACHINE_TOKEN[-4:]}' if len(MACHINE_TOKEN) > 12 else '***'
    logger.info(f'Servidor : {SERVER_URL}')
    logger.info(f'MAC      : {MAC_ADDRESS}')
    logger.info(f'Token    : {token_preview}')


def _check_root():
    """Avisa se não está rodando como root."""
    if os.geteuid() != 0:
        logger.warning(
            '⚠ Agente NÃO está rodando como root. '
            'cgroups e gerenciamento de SSH podem falhar. '
            'Use: sudo python main.py'
        )


# ── Modos de execução ───────────────────────────────────────────────

def run_daemon():
    """Modo padrão: daemon headless com heartbeat, telemetria, SSH e cgroups."""
    from agent import ServerAgent

    agent = ServerAgent()

    def signal_handler(sig, frame):
        logger.info(f'Sinal recebido ({sig}), encerrando...')
        agent.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    agent.start_blocking()


def run_sync():
    """Modo --sync: sincroniza specs e sai."""
    from api_client import APIClient
    from hardware import get_system_specs

    api = APIClient()
    specs = get_system_specs()

    logger.info(f'Specs detectadas: {specs}')

    if api.sync_specs(specs):
        logger.info('Specs sincronizadas com sucesso!')
    else:
        logger.error('Falha ao sincronizar specs')
        sys.exit(1)


def run_status():
    """Modo --status: mostra status do sistema."""
    from cgroup_manager import CGroupManager
    from ssh_manager import SSHManager

    cgroup = CGroupManager()
    ssh = SSHManager()

    print('\n=== Status do Agente de Servidor ===\n')

    # cgroups
    cg_status = cgroup.get_status()
    print(f'cgroups v2: {"DISPONÍVEL" if cg_status["available"] else "INDISPONÍVEL"}')
    print(f'  Owner weight:  {cg_status["config"]["ownerWeight"]}')
    print(f'  Guest weight:  {cg_status["config"]["guestWeight"]}')
    print(f'  Default weight: {cg_status["config"]["defaultWeight"]}')

    # Usuários logados
    logged = cgroup.get_logged_system_users()
    print(f'\nUsuários logados no sistema: {logged or "(nenhum)"}')

    # SSH sessions
    sessions = ssh.get_active_sessions()
    print(f'\nSessões SSH ativas (agente): {len(sessions)}')
    for alloc_id, info in sessions.items():
        print(f'  alloc={alloc_id} user={info["system_username"]} fp={info["fingerprint"]}')

    print()


def run_test_ssh():
    """Modo --test-ssh: testa geração de chave SSH sem instalar."""
    import tempfile
    import subprocess

    print('\n=== Teste de Geração SSH ===\n')

    tmp_dir = tempfile.mkdtemp(prefix='lab_ssh_test_')
    key_path = os.path.join(tmp_dir, 'test_key')

    try:
        result = subprocess.run(
            ['ssh-keygen', '-t', 'ed25519', '-f', key_path, '-N', '', '-q', '-C', 'test-key'],
            capture_output=True, text=True, timeout=10,
        )

        if result.returncode != 0:
            print(f'ERRO: ssh-keygen falhou: {result.stderr}')
            return

        # Fingerprint
        fp = subprocess.run(
            ['ssh-keygen', '-lf', f'{key_path}.pub'],
            capture_output=True, text=True, timeout=5,
        )

        with open(key_path) as f:
            priv = f.read()
        with open(f'{key_path}.pub') as f:
            pub = f.read()

        print(f'Chave privada ({len(priv)} bytes):')
        print(f'  {priv[:50]}...')
        print(f'\nChave pública:')
        print(f'  {pub.strip()}')
        print(f'\nFingerprint:')
        print(f'  {fp.stdout.strip()}')
        print('\n✓ Geração de chaves SSH funcionando corretamente!')

    except Exception as e:
        print(f'ERRO: {e}')
    finally:
        for f in [key_path, f'{key_path}.pub']:
            try:
                os.unlink(f)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


# ── Main ─────────────────────────────────────────────────────────────

def main():
    _validate_config()
    _check_root()

    if '--sync' in sys.argv:
        run_sync()
    elif '--status' in sys.argv:
        run_status()
    elif '--test-ssh' in sys.argv:
        run_test_ssh()
    else:
        run_daemon()


if __name__ == '__main__':
    main()
