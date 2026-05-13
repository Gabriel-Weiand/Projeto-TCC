"""
sync_specs.py — Sincronização de hardware estático para o Lab Agent (TCC)

Lê as especificações da máquina (CPU, GPU, RAM, Disco, IP) e envia para a API.
Deve ser executado apenas uma vez, idealmente na inicialização da máquina.
"""

import socket
import platform
import subprocess
import psutil
import requests

# ── Configuração ──────────────────────────────────────────────────────────────
API_BASE = "http://localhost:3333/api/agent"
TOKEN    = "2ef0f32b2f7990d82f8d48d27b2d6bc4372b5f065f5aae8b21feb10862bd825ea68a7585610a28fd32d01c1ca90d0897adcc43c26f0247ff111527a4540b8f43"
# ────────────────────────────────────────────────────────────────────────────

SYNC_SPECS_URL = f"{API_BASE}/sync-specs"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

def _cpu_model() -> str:
    """Lê o modelo do CPU a partir de /proc/cpuinfo (Linux) ou platform."""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "Unknown CPU"


def _gpu_model() -> str | None:
    """Tenta detectar GPU via lspci (requer pciutils). Retorna None se não disponível."""
    try:
        out = subprocess.check_output(
            ["lspci", "-mm"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        for line in out.splitlines():
            if "VGA" in line or "3D" in line or "Display" in line:
                parts = [p.strip('"') for p in line.split('"')]
                if len(parts) >= 6:
                    return f"{parts[3]} {parts[5]}"
    except Exception:
        pass
    return None


def _local_ip() -> str | None:
    """Obtém o IP local da interface de saída padrão."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def sync_specs() -> None:
    """Coleta e envia as especificações estáticas do hardware para a API."""
    ram   = psutil.virtual_memory()
    disk  = psutil.disk_usage("/")
    
    specs = {
        "cpuModel":   _cpu_model(),
        "gpuModel":   _gpu_model(),
        "totalRamGb": round(ram.total / 1024**3, 1),
        "totalDiskGb": round(disk.total / 1024**3, 1),
        "ipAddress":  _local_ip(),
    }
    
    # Remove campos None para não sobrescrever com null no banco
    specs = {k: v for k, v in specs.items() if v is not None}

    try:
        resp = requests.put(SYNC_SPECS_URL, json=specs, headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            print(f"[specs] Sincronizado: CPU={data.get('machine', {}).get('cpuModel')}  "
                  f"RAM={data.get('machine', {}).get('totalRamGb')}GB  "
                  f"Disk={data.get('machine', {}).get('totalDiskGb')}GB  "
                  f"IP={data.get('machine', {}).get('ipAddress')}")
        else:
            print(f"[specs] Falha HTTP {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"[specs] Erro ao sincronizar specs: {e}")

if __name__ == "__main__":
    print("[sync_specs] Iniciando sincronização de hardware...")
    sync_specs()