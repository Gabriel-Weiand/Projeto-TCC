"""
telemetry_probe.py — Sonda de telemetria para o Lab Agent (TCC)

Lê dados de hardware via psutil e os reporta para a API local.
Roda em loop contínuo até Ctrl+C.

Dois datasets gerados por coleta:
  - RICH  (campo "rich"):  por core, frequência, todas as temperaturas → dashboard live
  - LEAN  (campo "lean"):  escalares compactos → persistência no banco + métricas de sessão

A API recebe um único POST com ambos os payloads aninhados.

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
API_BASE = "http://localhost:3333/api/agent"
TOKEN    = "6a84860b3720d422ec2c3856c1b31a87099e96eeda4296dfde2bf8bd60673c7bf0d2f03c734f7c14f854a5f34961a372e5629a71f4d52b0ddcb6fe6d14aa0f85"
MACHINE  = "PC-LAB-01"
INTERVAL = 2  # segundos
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
# Cache da leitura de disco I/O anterior (para calcular delta)
_disk_io_prev: dict = {}


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


def sync_specs() -> None:
    """Coleta e envia as especificações estáticas do hardware para a API.
    Chamado uma vez na inicialização.
    """
    ram   = psutil.virtual_memory()
    disk  = psutil.disk_usage("/")
    specs = {
        "cpuModel":   _cpu_model(),
        "gpuModel":   _gpu_model(),
        "totalRamGb": round(ram.total / 1024**3, 1),
        "totalDiskGb": round(disk.total / 1024**3, 1),
        "ipAddress":  _local_ip(),
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
                  f"IP={data.get('machine', {}).get('ipAddress')}")
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
        "nvmeTemp": None, # SSD NVMe Composite
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

        # NVMe — "Composite" é a temperatura representativa do SSD
        if "nvme" in sensors:
            for e in sensors["nvme"]:
                if "composite" in e.label.lower() or not e.label:
                    result["nvmeTemp"] = e.current
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
    return round(down, 3), round(up, 3)


def _disk_io_delta() -> tuple[float, float]:
    """Retorna (read_mbps, write_mbps) de I/O de disco desde a última chamada."""
    global _disk_io_prev
    try:
        io = psutil.disk_io_counters()
        if io is None:
            return 0.0, 0.0
    except Exception:
        return 0.0, 0.0
    now = time.monotonic()
    if _disk_io_prev:
        dt = now - _disk_io_prev["t"]
        if dt > 0:
            read  = max(0, io.read_bytes  - _disk_io_prev["read"])  / 1_048_576 / dt
            write = max(0, io.write_bytes - _disk_io_prev["write"]) / 1_048_576 / dt
        else:
            read = write = 0.0
    else:
        read = write = 0.0
    _disk_io_prev = {"t": now, "read": io.read_bytes, "write": io.write_bytes}
    return round(read, 3), round(write, 3)


def _top_processes(n: int = 5) -> list[dict]:
    """Retorna os N processos que mais consomem CPU no momento.
    Usa cpu_percent() não-bloqueante (requer que o processo já tenha sido amostrado
    ao menos uma vez — psutil faz isso automaticamente no process_iter).
    """
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            info = p.info
            if info["cpu_percent"] is not None:
                procs.append({
                    "pid":    info["pid"],
                    "name":   info["name"] or "",
                    "cpuPct": round(info["cpu_percent"], 1),
                    "ramPct": round(info["memory_percent"] or 0, 1),
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    # Ordena por CPU desc, pega os top N com CPU > 0
    procs.sort(key=lambda x: x["cpuPct"], reverse=True)
    return procs[:n]


def collect() -> dict:
    """
    Coleta completa de métricas.

    Retorna dois sub-dicionários:
      lean: campos escalares compactos (persistência no banco)
      rich: dados granulares por core (dashboard realtime)
    """
    temps = _read_temperatures()
    ram   = psutil.virtual_memory()
    swap  = psutil.swap_memory()
    down, up = _net_delta()
    disk_read, disk_write = _disk_io_delta()
    top_procs = _top_processes(5)

    # ── Espaço em disco ───────────────────────────────────────────────────────────────────
    disk_pct  = None
    disk_free = None
    disk_total = None
    try:
        du = psutil.disk_usage("/")
        disk_pct   = du.percent
        disk_free  = round(du.free  / 1024**3, 1)  # GB
        disk_total = round(du.total / 1024**3, 1)  # GB
    except Exception:
        pass

    # ── CPU total ─────────────────────────────────────────────────────────────
    cpu_total = psutil.cpu_percent(interval=None)

    # ── CPU por core ──────────────────────────────────────────────────────────
    core_usage = psutil.cpu_percent(interval=None, percpu=True)  # list[float]

    # ── Frequência ────────────────────────────────────────────────────────────
    freqs = psutil.cpu_freq(percpu=True)
    core_freq_mhz = [round(f.current) for f in freqs] if freqs else []
    avg_freq_mhz  = round(sum(core_freq_mhz) / len(core_freq_mhz)) if core_freq_mhz else 0

    # ── LEAN (escalares — banco de dados) ────────────────────────────────────
    lean = {
        "cpuUsage":      round(cpu_total * 10),                       # 0–1000
        "cpuTemp":       round(temps["cpuTemp"] * 10),                 # °C×10
        "cpuFreqMhz":    avg_freq_mhz,                                 # MHz inteiro
        "gpuUsage":      0,                                            # sem driver GPU
        "gpuTemp":       round(temps["gpuTemp"] * 10),                 # °C×10
        "ramUsage":      round(ram.percent * 10),                      # 0–1000
        "swapUsage":     round(swap.percent * 10),                     # 0–1000
        "diskUsage":      round(disk_pct * 10) if disk_pct is not None else None,
        "diskReadMbps":   disk_read,                                    # MB/s leitura
        "diskWriteMbps":  disk_write,                                   # MB/s escrita
        "downloadUsage":  down,                                         # Mbps (bytes_recv)
        "uploadUsage":    up,                                           # Mbps (bytes_sent)
        "moboTemperature": round(temps["moboTemp"] * 10) if temps["moboTemp"] else None,
        "loggedUserName": SYSTEM_USER,
    }

    # ── RICH (granular — memória real-time do dashboard) ─────────────────────────
    rich = {
        **lean,
        "cpuCoreUsage":   [round(u * 10) for u in core_usage],         # lista 0–1000
        "cpuCoreFreqMhz": core_freq_mhz,                               # lista MHz
        "ramAvailableGb": round(ram.available / 1024**3, 2),           # GB real livre
        "ramTotalGb":     round(ram.total / 1024**3, 2),
        "nvmeTemp":       round(temps["nvmeTemp"] * 10) if temps["nvmeTemp"] else None,
        # Espaço livre no disco
        "diskFreeGb":     disk_free,
        "diskTotalGb":    disk_total,
        # Top processos por CPU (só no dashboard, não persiste)
        "topProcesses":   top_procs,
    }

    return {"lean": lean, "rich": rich}


def print_snapshot(data: dict) -> None:
    lean = data["lean"]
    rich = data["rich"]
    cpu  = lean["cpuUsage"]  / 10
    temp = lean["cpuTemp"]   / 10
    freq = lean["cpuFreqMhz"]
    ram  = lean["ramUsage"]  / 10
    swap = lean["swapUsage"] / 10
    disk  = (lean["diskUsage"] or 0) / 10
    dr    = lean["diskReadMbps"]
    dw    = lean["diskWriteMbps"]
    dl    = lean["downloadUsage"]
    up    = lean["uploadUsage"]
    gpu_t = lean["gpuTemp"] / 10
    cores = rich["cpuCoreUsage"]
    max_core = max(cores) / 10 if cores else 0
    top = rich.get("topProcesses", [])
    top_str = "  ".join(f"{p['name']}({p['cpuPct']}%)" for p in top if p["cpuPct"] > 0)
    print(
        f"  CPU {cpu:5.1f}% (max {max_core:.0f}%)  {freq}MHz  {temp:.1f}°C  |  "
        f"GPU {gpu_t:.1f}°C  |  RAM {ram:.1f}% swap {swap:.1f}%  |  "
        f"Disk {disk:.1f}%  r{dr:.2f}w{dw:.2f}MB/s  |  ↓{dl:.2f}↑{up:.2f}Mbps"
    )
    if top_str:
        print(f"  TOP: {top_str}")


def send(data: dict) -> tuple[int, str]:
    """Envia o payload para a API. Retorna (status_code, body_text)."""
    resp = requests.post(API_URL, json=data, headers=HEADERS, timeout=5)
    return resp.status_code, resp.text


def main():
    print(f"[telemetry_probe] Máquina: {MACHINE}")
    print(f"[telemetry_probe] API:     {API_URL}")
    print(f"[telemetry_probe] User:    {SYSTEM_USER}")
    print(f"[telemetry_probe] Intervalo: {INTERVAL}s  |  Ctrl+C para parar\n")

    # Reporta especificações de hardware na inicialização
    sync_specs()

    # Aquece a janela de CPU do psutil antes de começar
    psutil.cpu_percent(interval=None)
    psutil.cpu_percent(interval=None, percpu=True)
    time.sleep(INTERVAL)

    iteration = 0
    while True:
        iteration += 1
        data = collect()

        try:
            status, body = send(data)
            if status == 204:
                tag = "OK  "
            elif status == 422:
                tag = f"VALIDATION ERROR — {body[:120]}"
            else:
                tag = f"HTTP {status} — {body[:80]}"
        except requests.exceptions.ConnectionError:
            tag = "CONN_ERR (API offline?)"
        except requests.exceptions.Timeout:
            tag = "TIMEOUT"
        except Exception as e:
            tag = f"ERR {e}"

        print(f"[#{iteration:04d}] {tag}")
        print_snapshot(data)

        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
