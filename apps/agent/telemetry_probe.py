"""
telemetry_probe.py — Sonda de telemetria para o Lab Agent (TCC)

Lê dados de hardware via psutil e os reporta para a API local.
Roda em loop contínuo até Ctrl+C.

Uso:
    python3 telemetry_probe.py

Configuração (edite as variáveis abaixo):
    API_URL  — endereço da API
    TOKEN    — token da máquina (coluna `token` na tabela machines)
    MACHINE  — nome amigável (só para logs)
    INTERVAL — segundos entre cada envio
"""

import time
import getpass
import socket
import platform
import subprocess
import psutil
import requests

# ── Configuração ──────────────────────────────────────────────────────────────
API_BASE = "http://localhost:7372/api/agent"
TOKEN    = "6a84860b3720d422ec2c3856c1b31a87099e96eeda4296dfde2bf8bd60673c7bf0d2f03c734f7c14f854a5f34961a372e5629a71f4d52b0ddcb6fe6d14aa0f85"
MACHINE  = "PC-LAB-01"
INTERVAL = 1  # segundo
# ────────────────────────────────────────────────────────────────────────────

API_URL       = f"{API_BASE}/telemetry"
SYNC_SPECS_URL = f"{API_BASE}/sync-specs"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

SYSTEM_USER = getpass.getuser()

# Cache da leitura de rede anterior (para calcular delta)
_net_prev: dict = {}
# Cache unificado de I/O de disco (total e por partição)
_disk_io_prev: dict = {"t": 0.0, "total_read": 0, "total_write": 0, "disks": {}}

def _active_users() -> list[dict]:
    """Coleta usuários logados (foco em SSH), ignorando o usuário do sistema."""
    users = []
    try:
        for u in psutil.users():
            # Ignora o usuário que está rodando a sonda (SYSTEM_USER)
            if u.name == SYSTEM_USER:
                continue
            
            # Se 'host' possui valor diferente de vazio, localhost ou :0, geralmente é SSH
            is_ssh = bool(u.host and u.host not in ('localhost', ':0'))
            
            users.append({
                "username": u.name,
                "terminal": u.terminal or "",
                "host": u.host or "local",
                "isSsh": is_ssh,
                "connectedSince": int(u.started) # Timestamp UNIX
            })
    except Exception:
        pass
    
    return users

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
                # Formato: 'slot "class" "vendor" "device" ...'
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

def _disk_partitions() -> list[dict]:
    """Coleta informações de todas as partições de dados do sistema."""
    partitions = []
    real_fs = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "vfat", "exfat", "zfs", "f2fs"}
    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs:
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                partitions.append({
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "totalGb": round(usage.total / 1024**3, 1),
                    "freeGb": round(usage.free / 1024**3, 1),
                })
            except (PermissionError, OSError):
                partitions.append({
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "totalGb": None,
                    "freeGb": None,
                })
    except Exception:
        pass
    return partitions

def sync_specs() -> None:
    """Coleta e envia as especificações estáticas do hardware para a API.
    Chamado uma vez na inicialização.
    """
    ram   = psutil.virtual_memory()
    disk  = psutil.disk_usage("/")
    disks = _disk_partitions()
    specs = {
        "cpuModel":   _cpu_model(),
        "gpuModel":   _gpu_model(),
        "totalRamGb": round(ram.total / 1024**3, 1),
        "totalDiskGb": round(disk.total / 1024**3, 1),
        "ipAddress":  _local_ip(),
        "disks":      disks,
    }
    # Remove campos None para não sobrescrever com null
    specs = {k: v for k, v in specs.items() if v is not None}

    try:
        resp = requests.put(SYNC_SPECS_URL, json=specs, headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            print(f"[specs] Sincronizado: CPU={data.get('machine', {}).get('cpuModel')}  "
                  f"RAM={data.get('machine', {}).get('totalRamGb')}GB  "
                  f"Disk={data.get('machine', {}).get('totalDiskGb')}GB  "
                  f"IP={data.get('machine', {}).get('ipAddress')}  "
                  f"Partições={len(disks)}")
        else:
            print(f"[specs] Falha HTTP {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"[specs] Erro ao sincronizar specs: {e}")

def _read_temperatures() -> dict:
    """Lê todos os sensores de temperatura disponíveis.
    Retorna dict com as temperaturas relevantes encontradas."""
    result = {
        "cpuTemp": 0.0,   # k10temp (AMD Tctl) ou coretemp (Intel)
        "gpuTemp": 0.0,   # amdgpu edge ou nvidia
        "moboTemp": None, # acpitz
    }
    try:
        sensors = psutil.sensors_temperatures()

        # CPU — preferência: k10temp (AMD) > coretemp (Intel) > cpu_thermal > acpitz
        for name in ("coretemp", "k10temp", "cpu_thermal"):
            if name in sensors and sensors[name]:
                result["cpuTemp"] = max(e.current for e in sensors[name])
                break
        else:
            if "acpitz" in sensors and sensors["acpitz"]:
                result["cpuTemp"] = sensors["acpitz"][0].current

        # GPU AMD integrada (amdgpu) — sensor "edge" = temperatura do die
        if "amdgpu" in sensors:
            for e in sensors["amdgpu"]:
                if e.label in ("edge", "") or not e.label:
                    result["gpuTemp"] = e.current
                    break

        # Placa-mãe via acpitz (se não usada para CPU acima)
        if result["cpuTemp"] != 0.0 and "acpitz" in sensors and sensors["acpitz"]:
            result["moboTemp"] = sensors["acpitz"][0].current

    except (AttributeError, NotImplementedError):
        pass
    return result

def _net_delta() -> tuple[float, float]:
    """Retorna (download_mbps, upload_mbps) desde a última chamada."""
    global _net_prev
    net = psutil.net_io_counters()
    now = time.monotonic()
    if _net_prev:
        dt = now - _net_prev["t"]
        if dt > 0:
            down = max(0, net.bytes_recv - _net_prev["recv"]) * 8 / 1_000_000 / dt
            up   = max(0, net.bytes_sent - _net_prev["sent"]) * 8 / 1_000_000 / dt
        else:
            down = up = 0.0
    else:
        down = up = 0.0
    _net_prev = {"t": now, "recv": net.bytes_recv, "sent": net.bytes_sent}
    return round(down), round(up)

def _disk_metrics() -> tuple[float, float, list[dict]]:
    """Coleta métricas de I/O total e uso detalhado por partição numa única passagem."""
    global _disk_io_prev
    now = time.monotonic()
    io_total = psutil.disk_io_counters()
    io_per_disk = psutil.disk_io_counters(perdisk=True) or {}
    dt = now - _disk_io_prev["t"]
    
    total_read = total_write = 0.0
    if dt > 0 and _disk_io_prev["t"] > 0 and io_total:
        total_read  = max(0, io_total.read_bytes  - _disk_io_prev["total_read"])  / 1_048_576 / dt
        total_write = max(0, io_total.write_bytes - _disk_io_prev["total_write"]) / 1_048_576 / dt

    prev_disks = _disk_io_prev["disks"]
    new_prev_disks = {}
    disks = []
    real_fs = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "vfat", "exfat", "zfs", "f2fs"}
    
    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs:
                continue
                
            dev_name = part.device.split('/')[-1]
            io = io_per_disk.get(dev_name)
            p_read = p_write = 0.0
            
            if io:
                if dt > 0 and dev_name in prev_disks:
                    p_read  = max(0, io.read_bytes  - prev_disks[dev_name]["read"])  / 1_048_576 / dt
                    p_write = max(0, io.write_bytes - prev_disks[dev_name]["write"]) / 1_048_576 / dt
                new_prev_disks[dev_name] = {"read": io.read_bytes, "write": io.write_bytes}
            
            try:
                usage = psutil.disk_usage(part.mountpoint)
                disks.append({
                    "mountpoint": part.mountpoint,
                    "usagePct": round(usage.percent * 10),
                    "freeGb": round(usage.free / 1024**3, 2),
                    "readMbps": round(p_read, 3),
                    "writeMbps": round(p_write, 3)
                })
            except (PermissionError, OSError):
                continue
    except Exception:
        pass
        
    _disk_io_prev = {
        "t": now, 
        "total_read": io_total.read_bytes if io_total else 0, 
        "total_write": io_total.write_bytes if io_total else 0, 
        "disks": new_prev_disks
    }
    return round(total_read), round(total_write), disks

def collect() -> dict:
    temps = _read_temperatures()
    ram   = psutil.virtual_memory()
    swap  = psutil.swap_memory()
    down, up = _net_delta()
    disk_read_total, disk_write_total, disks_info = _disk_metrics()

    # ── CPU total e freq ─────────────────────────────────────────────────────────────
    cpu_total = psutil.cpu_percent(interval=None)
    freq = psutil.cpu_freq(percpu=False)
    avg_freq_mhz = round(freq.current) if freq else 0

    # ── DATA (escalares — banco de dados) ────────────────────────────────────
    data = {
        "cpuUsage":      round(cpu_total * 10),                        # 0–1000 Casa decimal abstraída para um digito de int a mais (espaço salvo por não usar float)
        "cpuTemp":       round(temps["cpuTemp"] * 10),                 # °C×10
        "cpuFreqMhz":    avg_freq_mhz,                                 # MHz inteiro
        "gpuUsage":      0,                                            # sem driver GPU
        "gpuTemp":       round(temps["gpuTemp"] * 10),                 # °C×10

        # RAM
        "ramTotalGb":    round((ram.total / 1024**3) * 10),
        "ramUsedGb":     round(((ram.total - ram.available) / 1024**3) * 10),

        # Swap
        "swapTotalGb":   round((swap.total / 1024 ** 3) * 10),
        "swapUsedGb" :   round((swap.used / 1024 ** 3) * 10),

        # "swapTotalGb":   round(swap.total / 1024**3, 2) if swap is not None else None,
        # "swapFreeGb":    round(swap.free / 1024**3, 2) if swap is not None else None,
        # "diskUsage":      round(disk_pct * 10) if disk_pct is not None else None,

        # Disk
        "disks": disks_info,
        "diskReadMbps":   disk_read_total,
        "diskWriteMbps":  disk_write_total,

        # Network
        "downloadUsage":  down,                                         # Mbps (bytes_recv)
        "uploadUsage":    up,                                           # Mbps (bytes_sent)

        "moboTemperature": round(temps["moboTemp"] * 10) if temps["moboTemp"] else None,
        
        "activeUsers": _active_users(),
    }

    return {"data": data}

def print_snapshot(payload: dict) -> None:
    data = payload["data"]
    cpu  = data["cpuUsage"]  / 10
    temp = data["cpuTemp"]   / 10
    freq = data["cpuFreqMhz"]
    ram  = data["ramUsage"]  / 10
    swap = data["swapUsage"] / 10
    
    dr    = data["diskReadMbps"]
    dw    = data["diskWriteMbps"]
    dl    = data["downloadUsage"]
    up    = data["uploadUsage"]
    gpu_t = data["gpuTemp"] / 10
    
    disks_info = data.get("disks", [])
    disk_str = " ".join([f"{d['mountpoint']}:{d['usagePct']/10:.1f}%" for d in disks_info]) if disks_info else "N/A"
    
    print(
        f"  CPU {cpu:5.1f}% {freq}MHz  {temp:.1f}°C  |  "
        f"GPU {gpu_t:.1f}°C  |  RAM {ram:.1f}% swap {swap:.1f}%  |  "
        f"Disk [{disk_str}]  r{dr:.2f}w{dw:.2f}MB/s  |  ↓{dl:.2f}↑{up:.2f}Mbps"
    )

def send(data: dict) -> tuple[int, str]:
    """Envia o payload para a API. Retorna (status_code, body_text)."""
    resp = requests.post(API_URL, json=data, headers=HEADERS, timeout=5)
    return resp.status_code, resp.text

def main():
    print(f"[telemetry_probe] Máquina: {MACHINE}")
    print(f"[telemetry_probe] API:     {API_URL}")
    print(f"[telemetry_probe] User:    {SYSTEM_USER}")
    print(f"[telemetry_probe] Intervalo: {INTERVAL}s  |  Ctrl+C para parar\n")

    sync_specs()

    psutil.cpu_percent(interval=None)
    time.sleep(INTERVAL)

    iteration = 0
    buffer = []  # NOVO: Inicia o buffer vazio

    while True:
        iteration += 1
        data = collect()
        
        # Adiciona apenas o conteúdo interno (dicionário) ao buffer
        buffer.append(data["data"])

        print(f"[#{iteration:04d}] Coletado localmente:")
        print_snapshot(data)

        # Dispara para a API apenas quando acumular 5 itens
        if len(buffer) >= 5:
            try:
                # Envia payload no formato: {"data": [ {..}, {..}, {..}, {..}, {..} ]}
                status, body = send({"data": buffer})
                if status in (200, 201, 204):
                    print("  [✓] Lote de 5 telemetrias enviado com sucesso!")
                elif status == 422:
                    print(f"  [x] VALIDATION ERROR — {body[:120]}")
                else:
                    print(f"  [x] HTTP {status} — {body[:80]}")
            except requests.exceptions.ConnectionError:
                print("  [x] CONN_ERR (API offline?)")
            except requests.exceptions.Timeout:
                print("  [x] TIMEOUT")
            except Exception as e:
                print(f"  [x] ERR {e}")
            
            # Limpa o buffer após o disparo
            buffer = []

        print("-" * 60)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
