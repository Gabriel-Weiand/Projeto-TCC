"""
Configuração do Agente de Servidor (HPC/Renderização).

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


# === Servidor API ===
SERVER_URL = _validate_server_url(os.getenv('SERVER_URL', 'http://localhost:3333'))
MACHINE_TOKEN = os.getenv('MACHINE_TOKEN', '')

# === MAC Address (auto-detectado se não configurado) ===
MAC_ADDRESS = os.getenv('MAC_ADDRESS', '') or _auto_detect_mac()

# === Intervalos (segundos) ===
HEARTBEAT_INTERVAL = int(os.getenv('HEARTBEAT_INTERVAL', '30'))
TELEMETRY_INTERVAL = int(os.getenv('TELEMETRY_INTERVAL', '5'))
SSH_POLL_INTERVAL = int(os.getenv('SSH_POLL_INTERVAL', '5'))

# === cgroups v2 ===
# Peso CPU para o dono da alocação (prioridade máxima)
CGROUP_OWNER_CPU_WEIGHT = int(os.getenv('CGROUP_OWNER_CPU_WEIGHT', '1000'))
# Peso CPU para usuários não-donos (prioridade mínima)
CGROUP_GUEST_CPU_WEIGHT = int(os.getenv('CGROUP_GUEST_CPU_WEIGHT', '10'))
# Peso CPU padrão (sem alocação ativa)
CGROUP_DEFAULT_CPU_WEIGHT = int(os.getenv('CGROUP_DEFAULT_CPU_WEIGHT', '100'))

# === Mapeamento de usuários do sistema ===
# Definido via variável de ambiente ou detectado via API
# Exemplo: SYSTEM_USERS=render01,render02,render03
_raw_users = os.getenv('SYSTEM_USERS', '')
SYSTEM_USERS: list[str] = [u.strip() for u in _raw_users.split(',') if u.strip()] if _raw_users else []
