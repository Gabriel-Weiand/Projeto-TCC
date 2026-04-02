"""
Configuração do Agente de Monitoramento.

Carrega variáveis do arquivo .env ou do ambiente do sistema.
"""

import os
import glob
from dotenv import load_dotenv

load_dotenv()


def _auto_detect_mac() -> str:
    """Detecta automaticamente o endereço MAC da interface de rede principal."""
    try:
        interfaces = glob.glob('/sys/class/net/*/address')
        for iface_path in sorted(interfaces):
            iface_name = iface_path.split('/')[-2]
            # Ignora loopback e interfaces virtuais
            if iface_name in ('lo',) or iface_name.startswith(('veth', 'docker', 'br-', 'virbr')):
                continue
            with open(iface_path) as f:
                mac = f.read().strip().upper()
                if mac and mac != '00:00:00:00:00:00':
                    return mac
    except Exception:
        pass
    return ''


def _validate_server_url(url: str) -> str:
    """Valida e normaliza a URL do servidor."""
    url = url.strip().rstrip('/')
    if not url:
        return 'http://localhost:3333'
    if not url.startswith(('http://', 'https://')):
        url = 'http://' + url
    return url


# === Servidor ===
SERVER_URL = _validate_server_url(os.getenv('SERVER_URL', 'http://localhost:3333'))
MACHINE_TOKEN = os.getenv('MACHINE_TOKEN', '')

# === MAC Address (auto-detectado se não configurado) ===
MAC_ADDRESS = os.getenv('MAC_ADDRESS', '') or _auto_detect_mac()

# === Intervalos (segundos) ===
HEARTBEAT_INTERVAL = int(os.getenv('HEARTBEAT_INTERVAL', '30'))
TELEMETRY_INTERVAL = int(os.getenv('TELEMETRY_INTERVAL', '5'))
