"""
agentd.py — Lab Agent Daemon Unificado (TCC)

Executa o ciclo completo da máquina:
1. Sync Specs (Sincronização de hardware no boot)
2. Thread de Heartbeat (Polling C2 a cada 30s para atualizar as configs)
3. Thread de Telemetria (Loop configurável e batching dinâmico)
"""

import time
import getpass
import socket
import platform
import subprocess
import psutil
import requests
import threading
import glob
from datetime import datetime, timezone # <--- NOVO'

# ── Configuração Base ─────────────────────────────────────────────────────────
API_BASE = "http://localhost:7372/api/v1/agent"
TOKEN    = "871f482430e0fbea09e8fe6335b1d5c7d37efe5ec8037cea27c4b98b449484635c567f3c1aaffc0600a9880dfa12ba17a427f8075976f04b62af902b9d2a24df"
MACHINE  = "PCCASA"
SYSTEM_USER = getpass.getuser()

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# ── Estado Dinâmico e Concorrência (C2) ───────────────────────────────────────
CONFIG_LOCK = threading.Lock()

# Configuração Padrão (Fallback caso o Adonis esteja offline no boot)
AGENT_CONFIG = {
    "telemetry": {
        "intervalSeconds": 2,
        "batchSize": 5,
        "telemetrySet": {
            "cpu": True, "gpu": True, "ramAndSwap": True,
            "diskSpace": True, "diskIO": True, "networkIO": True,
            "temperatures": True, "activeUsers": True
        }
    }
}

# Caches de Telemetria
_net_prev = {}
_disk_io_prev = {"t": 0.0, "total_read": 0, "total_write": 0, "disks": {}}

# ==============================================================================
# FUNÇÕES DE COLETA DE HARDWARE (Utility)
# ==============================================================================

def _active_users() -> list[dict]:
    users = []
    try:
        for u in psutil.users():
            if u.name == SYSTEM_USER:
                continue
            is_ssh = bool(u.host and u.host not in ('localhost', ':0'))
            users.append({
                "username": u.name, "terminal": u.terminal or "",
                "host": u.host or "local", "isSsh": is_ssh,
                "connectedSince": int(u.started)
            })
    except Exception: pass
    return users

def _cpu_model() -> str:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError: pass
    return platform.processor() or "Unknown CPU"

def _gpu_model() -> str | None:
    try:
        out = subprocess.check_output(["lspci", "-mm"], text=True, stderr=subprocess.DEVNULL, timeout=3)
        for line in out.splitlines():
            if "VGA" in line or "3D" in line or "Display" in line:
                parts = [p.strip('"') for p in line.split('"')]
                if len(parts) >= 6: return f"{parts[3]} {parts[5]}"
    except Exception: pass
    return None

def _local_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception: return None

def _read_temperatures() -> dict:
    result = {"cpuTemp": 0.0, "gpuTemp": 0.0, "moboTemp": None}
    try:
        sensors = psutil.sensors_temperatures()
        for name in ("coretemp", "k10temp", "cpu_thermal"):
            if name in sensors and sensors[name]:
                result["cpuTemp"] = max(e.current for e in sensors[name])
                break
        else:
            if "acpitz" in sensors and sensors["acpitz"]:
                result["cpuTemp"] = sensors["acpitz"][0].current
        
        if "amdgpu" in sensors:
            for e in sensors["amdgpu"]:
                if e.label in ("edge", "") or not e.label:
                    result["gpuTemp"] = e.current
                    break
        if result["cpuTemp"] != 0.0 and "acpitz" in sensors and sensors["acpitz"]:
            result["moboTemp"] = sensors["acpitz"][0].current
    except Exception: pass
    return result

def _net_delta() -> tuple[int, int]:
    global _net_prev
    net = psutil.net_io_counters()
    now = time.monotonic()
    if _net_prev:
        dt = now - _net_prev["t"]
        if dt > 0:
            down = max(0, net.bytes_recv - _net_prev["recv"]) * 8 / 1_000_000 / dt
            up   = max(0, net.bytes_sent - _net_prev["sent"]) * 8 / 1_000_000 / dt
        else: down = up = 0.0
    else: down = up = 0.0
    _net_prev = {"t": now, "recv": net.bytes_recv, "sent": net.bytes_sent}
    return round(down), round(up)

def _disk_metrics(collect_space: bool, collect_io: bool) -> tuple[int, int, list[dict]]:
    global _disk_io_prev
    now = time.monotonic()
    io_total = psutil.disk_io_counters() if collect_io else None
    io_per_disk = psutil.disk_io_counters(perdisk=True) if collect_io else {}
    dt = now - _disk_io_prev["t"]
    
    total_read = total_write = 0.0
    if collect_io and dt > 0 and _disk_io_prev["t"] > 0 and io_total:
        total_read  = max(0, io_total.read_bytes  - _disk_io_prev["total_read"])  / 1_048_576 / dt
        total_write = max(0, io_total.write_bytes - _disk_io_prev["total_write"]) / 1_048_576 / dt

    prev_disks = _disk_io_prev["disks"]
    new_prev_disks = {}
    disks = []
    real_fs = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "vfat", "exfat", "zfs", "f2fs"}
    
    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs: continue
                
            dev_name = part.device.split('/')[-1]
            p_read = p_write = 0.0
            
            if collect_io and (io := io_per_disk.get(dev_name)):
                if dt > 0 and dev_name in prev_disks:
                    p_read  = max(0, io.read_bytes  - prev_disks[dev_name]["read"])  / 1_048_576 / dt
                    p_write = max(0, io.write_bytes - prev_disks[dev_name]["write"]) / 1_048_576 / dt
                new_prev_disks[dev_name] = {"read": io.read_bytes, "write": io.write_bytes}
            
            if collect_space:
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                    disks.append({
                        "mountpoint": part.mountpoint,
                        "usagePct": round(usage.percent * 10),
                        "freeGb": round(usage.free / 1024**3, 2),
                        "readMbps": round(p_read) if collect_io else None,
                        "writeMbps": round(p_write) if collect_io else None
                    })
                except (PermissionError, OSError): continue
    except Exception: pass
        
    _disk_io_prev = {
        "t": now, 
        "total_read": io_total.read_bytes if io_total else 0, 
        "total_write": io_total.write_bytes if io_total else 0, 
        "disks": new_prev_disks
    }
    return round(total_read), round(total_write), disks

def _disk_partitions() -> list[dict]:
    """Coleta informações estáticas e completas das partições para o sync-specs."""
    partitions = []
    real_fs = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "vfat", "exfat", "zfs", "f2fs"}
    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs: continue
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
                pass
    except Exception:
        pass
    return partitions

# ==============================================================================
# WORKERS E THREADS
# ==============================================================================

def _amd_gpu_usage() -> float:
    try:
        usage = 0.0
        # O Linux expõe o uso das GPUs AMD nativamente neste caminho
        for path in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
            with open(path, "r") as f:
                val = float(f.read().strip())
                if val > usage: 
                    usage = val
        return usage
    except Exception:
        return 0.0

def sync_specs() -> None:
    print("[Specs] Sincronizando hardware...")
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    disks_info = _disk_partitions()
    
    specs = {
        "cpuModel": _cpu_model(),
        "gpuModel": _gpu_model(),
        "totalRamGb": round(ram.total / 1024**3, 1),
        "totalDiskGb": round(disk.total / 1024**3, 1),
        "ipAddress": _local_ip(),
        "disks": disks_info,
    }
    specs = {k: v for k, v in specs.items() if v is not None}
    
    try:
        resp = requests.put(f"{API_BASE}/sync-specs", json=specs, headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            print("[Specs] ✓ Hardware registrado com sucesso.")
        else:
            print(f"[Specs] ✗ Erro {resp.status_code}: {resp.text[:80]}")
    except Exception as e:
        print(f"[Specs] ✗ Erro de conexão: {e}")

def heartbeat_worker():
    """Thread 1: Bate ponto no servidor e baixa ordens (C2)."""
    print("[C2] Thread de Heartbeat iniciada.")
    while True:
        try:
            users = _active_users()
            payload = {"connectedUsers": users}
            
            resp = requests.post(f"{API_BASE}/heartbeat", json=payload, headers=HEADERS, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                new_config = data.get("agentConfig")
                
                if new_config:
                    with CONFIG_LOCK:
                        # Faz o merge inteligente da configuração
                        AGENT_CONFIG.update(new_config)
            
        except Exception as e:
            pass # Fica em silêncio para não poluir o log, tenta novamente em 30s
            
        time.sleep(30)

def collect_telemetry() -> dict:
    """Coleta hardware condicionalmente baseado no AGENT_CONFIG."""
    with CONFIG_LOCK:
        t_set = AGENT_CONFIG["telemetry"]["telemetrySet"]
    
    cpu_total = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory()
    temps = _read_temperatures() if t_set.get("temperatures") else {"cpuTemp": 0.0, "gpuTemp": 0.0, "moboTemp": None}
    
    if t_set.get("cpu"):
        freq = psutil.cpu_freq(percpu=False)
        avg_freq_mhz = round(freq.current) if freq else 0
    else:
        avg_freq_mhz = None

    if t_set.get("ramAndSwap"):
        swap = psutil.swap_memory()
        swap_tg = round((swap.total / 1024**3) * 10)
        swap_ug = round((swap.used / 1024**3) * 10)
    else:
        swap_tg = swap_ug = None
        
    down, up = _net_delta() if t_set.get("networkIO") else (None, None)
    opt_d_space = t_set.get("diskSpace", False)
    opt_d_io = t_set.get("diskIO", False)
    disk_r, disk_w, disks_info = _disk_metrics(opt_d_space, opt_d_io) if (opt_d_space or opt_d_io) else (None, None, None)

    active_users = _active_users() if t_set.get("activeUsers") else None

    # Montagem do Payload (Com Timestamp Real da Origem)
    return {
        "timestamp":     datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), # <--- NOVO
        "cpuUsage":      round(cpu_total * 10),
        "cpuTemp":       round(temps["cpuTemp"] * 10),
        "cpuFreqMhz":    avg_freq_mhz,
        "gpuUsage":      0,
        "gpuTemp":       round(temps["gpuTemp"] * 10),
        
        "ramTotalGb":    round((ram.total / 1024**3) * 10),
        "ramUsedGb":     round(((ram.total - ram.available) / 1024**3) * 10),
        "swapTotalGb":   swap_tg,
        "swapUsedGb":    swap_ug,

        "disks":          disks_info,
        "diskReadMbps":   disk_r,
        "diskWriteMbps":  disk_w,
        "downloadMbps":   down,
        "uploadMbps":     up,
        "moboTemperature": round(temps["moboTemp"] * 10) if temps["moboTemp"] else None,
        "activeUsers":    active_users,
    }

def telemetry_worker():
    """Thread 2: Coleta dados em loop e despacha o buffer."""
    print("[Telemetry] Thread de Coleta iniciada.")
    psutil.cpu_percent(interval=None) # Aquecimento
    
    buffer = []
    iteration = 0
    
    while True:
        with CONFIG_LOCK:
            interval = AGENT_CONFIG["telemetry"]["intervalSeconds"]
            batch_size = AGENT_CONFIG["telemetry"]["batchSize"]
            
        iteration += 1
        data = collect_telemetry()
        buffer.append(data)
        
        print(f"[{time.strftime('%H:%M:%S')}] Amostra {len(buffer)}/{batch_size} coletada (CPU: {data['cpuUsage']/10}%)")

        if len(buffer) >= batch_size:
            try:
                resp = requests.post(f"{API_BASE}/telemetry", json={"data": buffer}, headers=HEADERS, timeout=5)
                if resp.status_code in (200, 201, 204):
                    print(f"  ↳ [✓] Lote despachado para a API.")
                else:
                    print(f"  ↳ [x] Erro da API: {resp.status_code} - {resp.text[:80]}")
            except Exception as e:
                print(f"  ↳ [x] Erro de rede: {e}")
            
            buffer = [] # Limpa para o próximo lote

        time.sleep(interval)

# ==============================================================================
# MAIN (Daemon Boot)
# ==============================================================================
def main():
    print(f"=== Lab Agent Daemon ===")
    print(f"Máquina: {MACHINE}")
    print(f"Server : {API_BASE}\n")

    # 1. Sincroniza especificações no boot
    sync_specs()

    # 2. Inicia as Threads como Daemons (Morrem automaticamente se o processo principal cair)
    t_heartbeat = threading.Thread(target=heartbeat_worker, daemon=True)
    t_telemetry = threading.Thread(target=telemetry_worker, daemon=True)
    
    t_heartbeat.start()
    t_telemetry.start()

    # Mantém o processo principal vivo
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Daemon] Encerrando graciosamente...")

if __name__ == "__main__":
    main()