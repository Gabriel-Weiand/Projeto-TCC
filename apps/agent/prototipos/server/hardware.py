"""
Coleta de métricas de hardware para o agente servidor.

Reutiliza a lógica do agente PC mas sem dependências de GUI.

Escalas utilizadas pela API:
  - Uso (CPU, GPU, RAM, Disco): 0-1000 (representa 0.0% a 100.0%)
  - Temperatura: 0-1500 (representa 0.0°C a 150.0°C)
  - Rede: Mbps (float, sem escala fixa)
"""

import psutil
import platform
import getpass
import socket
import time
import logging
import glob
import subprocess

logger = logging.getLogger('agent.hardware')

# Inicializa CPU percent tracking
psutil.cpu_percent(interval=None)

# ── GPU NVIDIA (opcional) ────────────────────────────────────────────
_HAS_NVIDIA = False
try:
    import pynvml
    pynvml.nvmlInit()
    _HAS_NVIDIA = True
    logger.info('GPU NVIDIA detectada via pynvml')
except Exception:
    logger.info('Sem GPU NVIDIA detectada via pynvml.')

# ── GPU AMD (via sysfs) ─────────────────────────────────────────────
_AMD_GPU_PATH = None

def _find_amd_gpu_sysfs() -> str | None:
    for path in sorted(glob.glob('/sys/class/drm/card*/device/gpu_busy_percent')):
        try:
            with open(path) as f:
                f.read().strip()
            return path.rsplit('/', 1)[0]
        except Exception:
            continue
    return None

_AMD_GPU_PATH = _find_amd_gpu_sysfs()
if _AMD_GPU_PATH:
    logger.info(f'GPU AMD detectada: {_AMD_GPU_PATH}')
elif not _HAS_NVIDIA:
    logger.info('Nenhuma GPU detectada.')


# ── Network Tracker ─────────────────────────────────────────────────
class _NetworkTracker:
    def __init__(self):
        self._last_counters = psutil.net_io_counters()
        self._last_time = time.time()

    def get_usage_mbps(self) -> tuple:
        current = psutil.net_io_counters()
        current_time = time.time()
        elapsed = current_time - self._last_time
        if elapsed <= 0:
            return 0.0, 0.0

        download_bytes = current.bytes_recv - self._last_counters.bytes_recv
        upload_bytes = current.bytes_sent - self._last_counters.bytes_sent
        self._last_counters = current
        self._last_time = current_time

        download_mbps = (download_bytes * 8) / (elapsed * 1_000_000)
        upload_mbps = (upload_bytes * 8) / (elapsed * 1_000_000)
        return round(download_mbps, 2), round(upload_mbps, 2)


_network_tracker = _NetworkTracker()


# ── Funções de coleta ────────────────────────────────────────────────

def get_cpu_usage() -> int:
    return int(psutil.cpu_percent(interval=None) * 10)

def get_cpu_temp() -> int:
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return 0
        for name in ['coretemp', 'k10temp', 'cpu_thermal', 'zenpower', 'acpitz']:
            if name in temps and temps[name]:
                readings = temps[name]
                avg_temp = sum(r.current for r in readings) / len(readings)
                return int(avg_temp * 10)
        first_key = list(temps.keys())[0]
        if temps[first_key]:
            return int(temps[first_key][0].current * 10)
    except Exception:
        pass
    return 0

def get_gpu_usage() -> int:
    if _HAS_NVIDIA:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            return int(util.gpu * 10)
        except Exception:
            pass
    if _AMD_GPU_PATH:
        try:
            with open(f'{_AMD_GPU_PATH}/gpu_busy_percent') as f:
                return int(float(f.read().strip()) * 10)
        except Exception:
            pass
    return 0

def get_gpu_temp() -> int:
    if _HAS_NVIDIA:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            return int(temp * 10)
        except Exception:
            pass
    try:
        temps = psutil.sensors_temperatures()
        if 'amdgpu' in temps and temps['amdgpu']:
            for entry in temps['amdgpu']:
                if entry.label == 'edge':
                    return int(entry.current * 10)
            return int(temps['amdgpu'][0].current * 10)
    except Exception:
        pass
    return 0

def get_ram_usage() -> int:
    return int(psutil.virtual_memory().percent * 10)

def get_disk_usage() -> int:
    return int(psutil.disk_usage('/').percent * 10)

def get_network_usage() -> tuple:
    return _network_tracker.get_usage_mbps()

def get_mobo_temp():
    try:
        temps = psutil.sensors_temperatures()
        for name in ['acpitz', 'it8728', 'nct6775', 'nct6776', 'asus', 'gigabyte']:
            if name in temps and temps[name]:
                return int(temps[name][0].current * 10)
    except Exception:
        pass
    return None

def get_logged_user() -> str:
    try:
        return getpass.getuser()
    except Exception:
        return 'unknown'


# ── Coleta completa (telemetria) ─────────────────────────────────────

def collect_telemetry() -> dict:
    download, upload = get_network_usage()
    mobo = get_mobo_temp()
    data = {
        'cpuUsage': get_cpu_usage(),
        'cpuTemp': get_cpu_temp(),
        'gpuUsage': get_gpu_usage(),
        'gpuTemp': get_gpu_temp(),
        'ramUsage': get_ram_usage(),
        'diskUsage': get_disk_usage(),
        'downloadUsage': download,
        'uploadUsage': upload,
        'loggedUserName': get_logged_user(),
    }
    if mobo is not None:
        data['moboTemperature'] = mobo
    return data


# ── Especificações (sync-specs) ─────────────────────────────────────

def get_system_specs() -> dict:
    specs = {}

    # CPU
    try:
        with open('/proc/cpuinfo') as f:
            for line in f:
                if line.startswith('model name'):
                    specs['cpuModel'] = line.split(':')[1].strip()
                    break
    except Exception:
        cpu = platform.processor()
        if cpu:
            specs['cpuModel'] = cpu

    # GPU
    if _HAS_NVIDIA:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            specs['gpuModel'] = name if isinstance(name, str) else name.decode()
        except Exception:
            pass
    elif _AMD_GPU_PATH:
        try:
            result = subprocess.run(
                ['lspci'], capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                lower = line.lower()
                if ('vga' in lower or '3d' in lower or 'display' in lower) and 'amd' in lower:
                    parts = line.split(': ', 1)
                    if len(parts) > 1:
                        specs['gpuModel'] = parts[1].strip()
                    break
        except Exception:
            pass

    # RAM
    try:
        ram_bytes = psutil.virtual_memory().total
        specs['totalRamGb'] = round(ram_bytes / (1024 ** 3))
    except Exception:
        pass

    # Disk
    try:
        disk_bytes = psutil.disk_usage('/').total
        specs['totalDiskGb'] = round(disk_bytes / (1024 ** 3))
    except Exception:
        pass

    # IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        specs['ipAddress'] = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    return specs
