"""
Coleta de métricas de hardware usando psutil.

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

logger = logging.getLogger('agent.hardware')

# Inicializa CPU percent tracking (primeira chamada sempre retorna 0)
psutil.cpu_percent(interval=None)

# ============================================================
# GPU NVIDIA (opcional - graceful degradation se não disponível)
# ============================================================
_HAS_NVIDIA = False
try:
    import pynvml
    pynvml.nvmlInit()
    _HAS_NVIDIA = True
    logger.info('GPU NVIDIA detectada via pynvml')
except Exception:
    logger.info('Sem GPU NVIDIA detectada (pynvml indisponível). Métricas de GPU serão zero.')


# ============================================================
# Rastreador de uso de rede (calcula Mbps via delta)
# ============================================================
class _NetworkTracker:
    """Calcula uso de rede em Mbps baseado no delta entre leituras."""

    def __init__(self):
        self._last_counters = psutil.net_io_counters()
        self._last_time = time.time()

    def get_usage_mbps(self) -> tuple:
        """Retorna (download_mbps, upload_mbps)."""
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


# ============================================================
# Funções de coleta individual
# ============================================================

def get_cpu_usage() -> int:
    """Retorna uso de CPU na escala 0-1000."""
    return int(psutil.cpu_percent(interval=None) * 10)


def get_cpu_temp() -> int:
    """Retorna temperatura da CPU na escala 0-1500."""
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return 0

        # Tenta sensores comuns de CPU no Linux
        for name in ['coretemp', 'k10temp', 'cpu_thermal', 'zenpower', 'acpitz']:
            if name in temps and temps[name]:
                readings = temps[name]
                avg_temp = sum(r.current for r in readings) / len(readings)
                return int(avg_temp * 10)

        # Fallback: primeiro sensor disponível
        first_key = list(temps.keys())[0]
        if temps[first_key]:
            return int(temps[first_key][0].current * 10)
    except Exception:
        pass
    return 0


def get_gpu_usage() -> int:
    """Retorna uso de GPU na escala 0-1000."""
    if not _HAS_NVIDIA:
        return 0
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        return int(util.gpu * 10)
    except Exception:
        return 0


def get_gpu_temp() -> int:
    """Retorna temperatura da GPU na escala 0-1500."""
    if not _HAS_NVIDIA:
        return 0
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        return int(temp * 10)
    except Exception:
        return 0


def get_ram_usage() -> int:
    """Retorna uso de RAM na escala 0-1000."""
    return int(psutil.virtual_memory().percent * 10)


def get_disk_usage() -> int:
    """Retorna uso de disco (/) na escala 0-1000."""
    return int(psutil.disk_usage('/').percent * 10)


def get_network_usage() -> tuple:
    """Retorna (download_mbps, upload_mbps)."""
    return _network_tracker.get_usage_mbps()


def get_mobo_temp():
    """Retorna temperatura da placa-mãe na escala 0-1500, ou None se indisponível."""
    try:
        temps = psutil.sensors_temperatures()
        for name in ['acpitz', 'it8728', 'nct6775', 'nct6776', 'asus', 'gigabyte']:
            if name in temps and temps[name]:
                return int(temps[name][0].current * 10)
    except Exception:
        pass
    return None


def get_logged_user() -> str:
    """Retorna o nome do usuário logado no SO."""
    try:
        return getpass.getuser()
    except Exception:
        return 'unknown'


# ============================================================
# Coleta completa (usado pela telemetria)
# ============================================================

def collect_telemetry() -> dict:
    """Coleta todas as métricas de telemetria no formato esperado pela API."""
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


# ============================================================
# Especificações de hardware (usado no sync-specs)
# ============================================================

def get_system_specs() -> dict:
    """Coleta especificações de hardware para sincronização com o servidor."""
    specs = {}

    # CPU Model
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

    # GPU Model (NVIDIA)
    if _HAS_NVIDIA:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            specs['gpuModel'] = name if isinstance(name, str) else name.decode()
        except Exception:
            pass

    # RAM total (GB)
    try:
        ram_bytes = psutil.virtual_memory().total
        specs['totalRamGb'] = round(ram_bytes / (1024 ** 3))
    except Exception:
        pass

    # Disco total (GB)
    try:
        disk_bytes = psutil.disk_usage('/').total
        specs['totalDiskGb'] = round(disk_bytes / (1024 ** 3))
    except Exception:
        pass

    # IP local
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        specs['ipAddress'] = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    return specs
