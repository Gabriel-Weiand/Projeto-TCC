# agentd.py — Lab Agent Daemon Unificado (TCC)
# Configurar o handshake ssh para funcionar sempre encima de ed25519.

import time
import socket
import platform
import subprocess
import psutil
import requests
import threading
import glob
import os
import re
import pwd
import shutil
from datetime import datetime, timezone

_AGENT_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv(path: str) -> None:
    """Carrega KEY=VALUE do .env sem dependência externa."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            key, sep, val = line.partition("=")
            if not sep:
                continue
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                os.environ.setdefault(key, val)


_load_dotenv(os.path.join(_AGENT_DIR, ".env"))

def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


SERVER_URL = _env("SERVER_URL", "http://localhost:3333").rstrip("/")
API_BASE = f"{SERVER_URL}/api/v1/agent"
TOKEN = _env("MACHINE_TOKEN")
MACHINE = _env("MACHINE_NAME") or socket.gethostname()

# Heartbeat: intervalo fixo de controle (provisionamento SSH). Não é configurável pelo admin.
HEARTBEAT_INTERVAL = 30

if not TOKEN:
    raise SystemExit(
        "[Config] MACHINE_TOKEN ausente. Copie .env.example para .env e preencha o token da máquina."
    )

# Detecta o caminho real do sftp-server uma vez no boot.
# O caminho varia por distro/versão — hardcoding quebraria silenciosamente.
SFTP_SHELL  = (
    shutil.which("sftp-server")
    or next(iter(glob.glob("/usr/lib/openssh/sftp-server")), None)
    or next(iter(glob.glob("/usr/lib/sftp-server")), None)
    or "/usr/lib/openssh/sftp-server"  # fallback explícito
)
LAST_PROCESS_REQUEST_TS = None
PROCESS_BATCHES_REMAINING = 0
# Último accessState por usuário lab.* (pkill na transição full_shell → sftp_only)
LAST_ACCESS_STATE: dict[str, str] = {}
_process_io_prev = {} # Cache para calcular velocidade de disco (PID -> bytes)
# psutil soma % por núcleo lógico; usamos o total para normalizar processos à capacidade do host.
_LOGICAL_CPUS = psutil.cpu_count(logical=True) or 1
SSH_AUDIT_BUFFER = []

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

CONFIG_LOCK = threading.Lock()

# Fallback local (eco) até a API responder — alinhado aos defaults em telemetry_presets.ts
_ECO_TELEMETRY_OFFLINE = {
    "intervalSeconds": 60,
    "batchSize": 15,
    "telemetryPreset": "eco",
    "telemetrySet": {
        "cpu": True, "gpu": False, "ramAndSwap": True,
        "disk": True, "networkIO": False,
        "temperatures": False, "activeUsers": True,
        "processCapture": False,
    },
    "processCaptureConfig": {
        "compareMetric": "cpuPercent",
        "topX": 10,
        "userScope": "all",
    },
}

AGENT_CONFIG = {"telemetry": dict(_ECO_TELEMETRY_OFFLINE)}


def bootstrap_telemetry_from_lab_config() -> None:
    """
    Tenta GET /api/config (público) antes do 1º heartbeat.
    Se a API estiver fora, permanece no perfil eco local.
    """
    try:
        resp = requests.get(f"{SERVER_URL}/api/config", timeout=5)
        if resp.status_code != 200:
            print("[Config] API sem /api/config — telemetria em eco (offline).")
            return
        tel = (resp.json() or {}).get("telemetry") or {}
        presets = tel.get("presets") or {}
        preset_name = tel.get("defaultOfflinePreset") or "eco"
        profile = presets.get(preset_name) or presets.get("eco")
        if not profile:
            print("[Config] /api/config sem presets — telemetria em eco (offline).")
            return
        t_set = {**_ECO_TELEMETRY_OFFLINE["telemetrySet"], **(profile.get("telemetrySet") or {})}
        patch = {
            "intervalSeconds": profile.get("intervalSeconds", 60),
            "batchSize": profile.get("batchSize", 15),
            "telemetryPreset": preset_name,
            "telemetrySet": t_set,
            "processCaptureConfig": profile.get("processCaptureConfig")
            or _ECO_TELEMETRY_OFFLINE["processCaptureConfig"],
        }
        with CONFIG_LOCK:
            AGENT_CONFIG["telemetry"] = {**AGENT_CONFIG.get("telemetry", {}), **patch}
        print(
            f"[Config] Telemetria inicial '{preset_name}' "
            f"({patch['intervalSeconds']}s, lote {patch['batchSize']}) via /api/config."
        )
    except Exception as e:
        print(f"[Config] API indisponível — telemetria em eco local. ({e})")

_net_prev    = {}
_disk_io_prev = {"t": 0.0, "total_read": 0, "total_write": 0, "disks": {}}


# ==============================================================================
# GPU — DETECÇÃO DE VENDOR E BACKENDS
# ==============================================================================

class _GpuBackend:
    """Interface base. Cada vendor implementa usage() e temp()."""
    name = "none"
    def usage(self) -> float: return 0.0
    def temp(self) -> float:  return 0.0
    def vram(self) -> tuple[int, int]: return 0, 0   # (used_wire, total_wire) GB×10
    def power(self) -> int: return 0


class _NvidiaBackend(_GpuBackend):
    """
    NVIDIA via nvitop (uso GPU, VRAM e processos).
    pynvml permanece apenas para nome da placa em sync-specs.
    Modelos NVIDIA muito antigos podem não ser compatíveis com nvitop/NVML moderno.
    """
    name = "nvidia"

    def __init__(self):
        import pynvml
        pynvml.nvmlInit()
        self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        self._pynvml = pynvml
        self._nvitop_device = None
        try:
            from nvitop import Device
            self._nvitop_device = Device(0)
        except Exception:
            pass

    def _nvitop_ready(self) -> bool:
        return self._nvitop_device is not None

    def usage(self) -> float:
        if not self._nvitop_ready():
            return 0.0
        try:
            return float(self._nvitop_device.gpu_utilization())
        except Exception:
            return 0.0

    def temp(self) -> float:
        if self._nvitop_ready():
            try:
                return float(self._nvitop_device.temperature())
            except Exception:
                pass
        try:
            NVML_TEMPERATURE_GPU = 0
            return float(self._pynvml.nvmlDeviceGetTemperature(self._handle, NVML_TEMPERATURE_GPU))
        except Exception:
            return 0.0

    def vram(self) -> tuple[int, int]:
        if self._nvitop_ready():
            try:
                used = self._nvitop_device.memory_used()
                total = self._nvitop_device.memory_total()
                return _gb_wire(used), _gb_wire(total)
            except Exception:
                pass
        try:
            info = self._pynvml.nvmlDeviceGetMemoryInfo(self._handle)
            return _gb_wire(info.used), _gb_wire(info.total)
        except Exception:
            return 0, 0
    
    def power(self) -> int:
        if self._nvitop_ready():
            try:
                watts = self._nvitop_device.power_usage()
                if watts is not None:
                    return int(watts / 1000) if watts > 1000 else int(watts)
            except Exception:
                pass
        try:
            mw = self._pynvml.nvmlDeviceGetPowerUsage(self._handle)
            return int(mw / 1000)
        except Exception:
            return 0

    def gpu_process_metrics(self) -> dict[int, dict]:
        """PID -> {vramMb, gpuUse} via nvitop (somente NVIDIA compatível)."""
        metrics: dict[int, dict] = {}
        if not self._nvitop_ready():
            return metrics
        try:
            for pid, gpu_proc in self._nvitop_device.processes().items():
                sm = gpu_proc.gpu_sm_utilization()
                mem = gpu_proc.gpu_memory()
                vram_mb = int(mem / 1_048_576) if mem else 0
                gpu_use = round(float(sm) * 10) if sm is not None else 0
                metrics[int(pid)] = {"vramMb": vram_mb, "gpuUse": gpu_use}
        except Exception:
            pass
        return metrics


def _pick_amd_drm_device_dir() -> str | None:
    """
    Escolhe o card DRM com amdgpu (evita pegar o primeiro glob aleatório).
    Prefere o dispositivo com mais VRAM dedicada (dGPU vs iGPU).
    """
    best_dir: str | None = None
    best_vram = -1
    for busy in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
        dev_dir = busy.rsplit("/", 1)[0]
        total_path = os.path.join(dev_dir, "mem_info_vram_total")
        vram = 0
        try:
            if os.path.isfile(total_path):
                vram = int(open(total_path).read().strip())
        except Exception:
            pass
        if vram > best_vram:
            best_vram = vram
            best_dir = dev_dir
    return best_dir


class _AmdSysfsBackend(_GpuBackend):
    """
    Lê diretamente do sysfs do kernel — sem dependências extras.
    Funciona em qualquer Linux com driver amdgpu carregado (sem ROCm).
    """
    name = "amd_sysfs"

    def __init__(self):
        self._dev_dir = _pick_amd_drm_device_dir()

    def usage(self) -> float:
        if not self._dev_dir:
            return 0.0
        try:
            path = os.path.join(self._dev_dir, "gpu_busy_percent")
            if os.path.isfile(path):
                return float(open(path).read().strip())
        except Exception:
            pass
        return 0.0

    def temp(self) -> float:
        try:
            sensors = psutil.sensors_temperatures()
            if "amdgpu" in sensors:
                for e in sensors["amdgpu"]:
                    if e.label in ("edge", "") or not e.label:
                        return float(e.current)
        except Exception:
            pass
        return 0.0

    def vram(self) -> tuple[int, int]:
        if not self._dev_dir:
            return 0, 0
        try:
            used_path = os.path.join(self._dev_dir, "mem_info_vram_used")
            total_path = os.path.join(self._dev_dir, "mem_info_vram_total")
            if os.path.isfile(used_path) and os.path.isfile(total_path):
                used_bytes = int(open(used_path).read().strip())
                total_bytes = int(open(total_path).read().strip())
                return _gb_wire(used_bytes), _gb_wire(total_bytes)
        except Exception:
            pass
        return 0, 0

    def power(self) -> int:
        if not self._dev_dir:
            return 0
        try:
            for pattern in (
                os.path.join(self._dev_dir, "hwmon", "hwmon*", "power1_average"),
                os.path.join(self._dev_dir, "hwmon", "hwmon*", "power1_input"),
            ):
                paths = glob.glob(pattern)
                if paths:
                    uw = int(open(paths[0]).read().strip())
                    return int(uw / 1_000_000)
        except Exception:
            pass
        return 0


class _IntelSysfsBackend(_GpuBackend):
    """
    Intel Arc e iGPU via sysfs i915/xe.
    Disponível em kernels 5.15+ com driver i915 ou xe.
    Uso via intel_gpu_top requer cap_perfmon; este backend é sem privilégios.
    """
    name = "intel_sysfs"

    def usage(self) -> float:
        # O driver i915 expõe frequência atual vs máxima como proxy de carga
        try:
            cur_paths = glob.glob("/sys/class/drm/card*/gt/gt0/rps_cur_freq_mhz")
            max_paths = glob.glob("/sys/class/drm/card*/gt/gt0/rps_max_freq_mhz")
            if cur_paths and max_paths:
                cur = float(open(cur_paths[0]).read().strip())
                mx  = float(open(max_paths[0]).read().strip())
                if mx > 0:
                    return round(cur / mx * 100, 1)
        except Exception:
            pass
        return 0.0

    def temp(self) -> float:
        # iGPU Intel expõe temperatura via hwmon (coretemp ou acpitz)
        try:
            sensors = psutil.sensors_temperatures()
            for name in ("coretemp", "acpitz"):
                if name in sensors and sensors[name]:
                    return float(sensors[name][0].current)
        except Exception:
            pass
        return 0.0

    def vram(self) -> tuple[int, int]:
        # iGPU usa memória compartilhada — não há VRAM dedicada mensurável via sysfs
        return 0, 0


class _NullBackend(_GpuBackend):
    """Fallback silencioso quando nenhum vendor é detectado."""
    name = "none"


def _detect_gpu_backend() -> _GpuBackend:
    """
    Roda uma vez no boot. Tenta cada backend na ordem de riqueza de dados.
    Retorna o primeiro que inicializar sem exceção.
    """

    # 1. NVIDIA via nvitop + pynvml (telemetria e sync-specs)
    try:
        backend = _NvidiaBackend()
        nvitop_status = "nvitop ok" if backend._nvitop_ready() else "nvitop indisponível (uso GPU/processos off)"
        print(f"[GPU] Backend: NVIDIA ({nvitop_status})")
        return backend
    except Exception as e:
        print(f"[GPU] NVIDIA indisponível: {e}")

    # 2. AMD via sysfs (sem dependências, só kernel amdgpu)
    if _pick_amd_drm_device_dir():
        print("[GPU] Backend: AMD/sysfs")
        return _AmdSysfsBackend()

    # 3. Intel Arc / iGPU via sysfs i915
    if glob.glob("/sys/class/drm/card*/gt/gt0/rps_cur_freq_mhz"):
        print("[GPU] Backend: Intel/sysfs (i915/xe)")
        return _IntelSysfsBackend()

    # 4. Sem GPU detectável
    print("[GPU] Nenhum backend de GPU disponível. gpuUsage=0.")
    return _NullBackend()


# Detectado uma única vez no boot — sem overhead em cada coleta
_GPU: _GpuBackend = _detect_gpu_backend()


# ==============================================================================
# MEMÓRIA — wire GB×10 (único formato enviado ao backend; API divide no JSON ao front)
# ==============================================================================

def _gb_wire(byte_count: int) -> int:
    """Bytes → inteiro GB×10 (ex.: 15,5 GB RAM → 155)."""
    return round((byte_count / 1024**3) * 10)


def _ram_wire() -> tuple[int, int]:
    ram = psutil.virtual_memory()
    return _gb_wire(ram.total), _gb_wire(ram.total - ram.available)


def _swap_wire() -> tuple[int, int]:
    swap = psutil.swap_memory()
    return _gb_wire(swap.total), _gb_wire(swap.used)


# ==============================================================================
# FUNÇÕES DE COLETA DE HARDWARE
# ==============================================================================

def _active_users() -> list[dict]:
    """Sessões TTY/SSH — apenas contas provisionadas pelo lab (prefixo lab.)."""
    users = []
    try:
        for u in psutil.users():
            if not u.name.startswith("lab."):
                continue
            is_ssh = bool(u.host and u.host not in ('localhost', ':0'))
            users.append({
                "username": u.name, "terminal": u.terminal or "",
                "host": u.host or "local", "isSsh": is_ssh,
                "connectedSince": int(u.started)
            })
    except Exception:
        pass
    return users

def _cpu_model() -> str:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "Unknown CPU"

def _gpu_model_lspci() -> str | None:
    """
    Nome da GPU via lspci (classe PCI de vídeo) — fallback quando o driver do vendor não expõe nome.
    Filtra por classe PCI — não por "3D" na linha (evita SSD NVMe com "3D NAND").
    """
    gpu_class_markers = (
        "VGA compatible controller",
        "Display controller",
        "3D controller",
    )
    try:
        out = subprocess.check_output(["lspci", "-mm"], text=True, stderr=subprocess.DEVNULL, timeout=3)
        for line in out.splitlines():
            parts = [p.strip() for p in line.split('"') if p.strip()]
            if len(parts) < 4:
                continue
            if not any(marker in parts[1] for marker in gpu_class_markers):
                continue
            name = f"{parts[2]} {parts[3]}".strip()
            if name:
                return name
    except Exception:
        pass
    return None


def _collect_gpu_specs() -> tuple[str | None, int | None]:
    """
    Modelo e VRAM total para sync-specs (mesmo backend da telemetria).
    totalVramGb: int GB×10 via _GPU.vram(); modelo: NVML (NVIDIA) ou lspci.
    """
    model: str | None = None

    if _GPU.name == "nvidia":
        try:
            raw = _GPU._pynvml.nvmlDeviceGetName(_GPU._handle)
            model = (raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)).strip()
        except Exception:
            pass

    if not model:
        model = _gpu_model_lspci()

    _, total_scaled = _GPU.vram()
    total_vram = total_scaled if total_scaled > 0 else None
    return model, total_vram


def _local_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

def _read_temperatures() -> dict:
    """
    Temperatura de CPU e mobo via psutil.
    GPU é agora responsabilidade exclusiva do _GPU backend — não duplicamos aqui.
    """
    result = {"cpuTemp": None, "moboTemp": None}
    try:
        sensors = psutil.sensors_temperatures()
        cpu_temp = None
        for name in ("coretemp", "k10temp", "cpu_thermal"):
            if name in sensors and sensors[name]:
                cpu_temp = max(e.current for e in sensors[name])
                break
        else:
            if "acpitz" in sensors and sensors["acpitz"]:
                cpu_temp = sensors["acpitz"][0].current

        if cpu_temp is not None and cpu_temp > 0:
            result["cpuTemp"] = cpu_temp

        if "acpitz" in sensors and sensors["acpitz"]:
            mobo = sensors["acpitz"][0].current
            if mobo is not None and mobo > 0:
                result["moboTemp"] = mobo
    except Exception:
        pass
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
        else:
            down = up = 0.0
    else:
        down = up = 0.0
    _net_prev = {"t": now, "recv": net.bytes_recv, "sent": net.bytes_sent}
    return round(down), round(up)

def _disk_metrics(collect_space: bool, collect_io: bool) -> tuple[int, int, list[dict]]:
    global _disk_io_prev
    now = time.monotonic()
    io_total    = psutil.disk_io_counters() if collect_io else None
    io_per_disk = psutil.disk_io_counters(perdisk=True) if collect_io else {}
    dt = now - _disk_io_prev["t"]

    total_read = total_write = 0.0
    if collect_io and dt > 0 and _disk_io_prev["t"] > 0 and io_total:
        total_read  = max(0, io_total.read_bytes  - _disk_io_prev["total_read"])  / 1_048_576 / dt
        total_write = max(0, io_total.write_bytes - _disk_io_prev["total_write"]) / 1_048_576 / dt

    prev_disks     = _disk_io_prev["disks"]
    new_prev_disks = {}
    disks          = []
    real_fs        = {"ext2","ext3","ext4","xfs","btrfs","ntfs","vfat","exfat","zfs","f2fs"}

    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs:
                continue
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
                        "usagePct":   round(usage.percent * 10),
                        "freeGb":     round(usage.free / 1024**3, 2),
                        "totalGb":    round(usage.total / 1024**3, 1),
                        "readMbps":   round(p_read)  if collect_io else None,
                        "writeMbps":  round(p_write) if collect_io else None,
                    })
                except (PermissionError, OSError):
                    continue
    except Exception:
        pass

    _disk_io_prev = {
        "t":           now,
        "total_read":  io_total.read_bytes  if io_total else 0,
        "total_write": io_total.write_bytes if io_total else 0,
        "disks":       new_prev_disks,
    }
    return round(total_read), round(total_write), disks

def _partition_role(mountpoint: str) -> str:
    mp = (mountpoint or "").strip()
    if mp in {"/boot", "/boot/efi", "/efi", "/recovery"}:
        return "system"
    for prefix in ("/boot/", "/efi/", "/var/", "/usr/", "/snap/", "/run/", "/dev/", "/proc/", "/sys/"):
        if mp.startswith(prefix):
            return "system"
    return "user"

def _disk_partitions() -> list[dict]:
    partitions = []
    real_fs = {"ext2","ext3","ext4","xfs","btrfs","ntfs","vfat","exfat","zfs","f2fs"}
    try:
        for part in psutil.disk_partitions(all=False):
            if part.fstype not in real_fs:
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                partitions.append({
                    "device":     part.device,
                    "mountpoint": part.mountpoint,
                    "fstype":     part.fstype,
                    "totalGb":    round(usage.total / 1024**3, 1),
                    "freeGb":     round(usage.free  / 1024**3, 1),
                    "role":       _partition_role(part.mountpoint),
                })
            except (PermissionError, OSError):
                pass
    except Exception:
        pass
    return partitions


# ==============================================================================
# WORKERS E THREADS
# ==============================================================================

def parse_ssh_line(line: str) -> dict | None:
    # Ignora rapidamente qualquer log que não seja do serviço SSH
    if "sshd" not in line:
        return None
        
    # 1. Login com Sucesso
    if "Accepted" in line:
        match = re.search(r"Accepted (\w+) for (\S+) from ([\d\.]+)", line)
        if match:
            auth_method, user, ip = match.groups()
            fingerprint = None
            
            # Se for chave pública, extrai a Hash SHA256
            if auth_method == "publickey":
                fp_match = re.search(r"(SHA256:[a-zA-Z0-9+/=]+)", line)
                if fp_match:
                    fingerprint = fp_match.group(1)
                    
            return {
                "sourceIp": ip,
                "targetUsername": user,
                "status": "success",
                "authMethod": auth_method,
                "clientFingerprint": fingerprint
            }
            
    # 2. Falha de Senha/Chave (Usuário válido ou inválido)
    elif "Failed" in line:
        match = re.search(r"Failed (\w+) for (?:invalid user )?(\S+) from ([\d\.]+)", line)
        if match:
            auth_method, user, ip = match.groups()
            status = "invalid_user" if "invalid user" in line else "failed"
            return {
                "sourceIp": ip,
                "targetUsername": user,
                "status": status,
                "authMethod": auth_method,
                "clientFingerprint": None
            }
            
    # 3. Usuário Inválido (Quando a conexão é abortada antes mesmo de enviar a senha/chave)
    elif "Invalid user" in line:
        match = re.search(r"Invalid user (\S+) from ([\d\.]+)", line)
        if match:
            user, ip = match.groups()
            return {
                "sourceIp": ip,
                "targetUsername": user,
                "status": "invalid_user",
                "authMethod": None,
                "clientFingerprint": None
            }
            
    return None

def _user_partition_mountpoints() -> list[str]:
    """Montagens classificadas como espaço de usuário (role=user)."""
    mounts = {
        p["mountpoint"]
        for p in _disk_partitions()
        if p.get("role") == "user" and p.get("mountpoint")
    }
    return sorted(mounts)


def _collect_user_remnant_paths(uname: str) -> set[str]:
    """
    Caminhos candidatos a resquícios de home/dados do usuário lab.*.
    Cobre passwd, /home padrão e cada partição user (multi-disco).
    """
    paths: set[str] = set()
    try:
        paths.add(pwd.getpwnam(uname).pw_dir)
    except KeyError:
        pass
    paths.add(os.path.join("/home", uname))
    for mount in _user_partition_mountpoints():
        paths.add(os.path.join(mount, uname))
    return {p for p in paths if p and p not in ("/", "")}


def _remove_path_tree(path: str) -> None:
    if not path or path in ("/", "/home", "/root"):
        return
    try:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
            print(f"[OS] Removido resquício: {path}")
        elif os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _scan_orphan_lab_dirs() -> None:
    """Remove diretórios lab.* órfãos (sem entrada passwd) em partições de usuário."""
    for mount in _user_partition_mountpoints():
        try:
            for name in os.listdir(mount):
                if not name.startswith("lab."):
                    continue
                try:
                    pwd.getpwnam(name)
                    continue
                except KeyError:
                    _remove_path_tree(os.path.join(mount, name))
        except OSError:
            pass


def _purge_lab_user(uname: str) -> None:
    """Encerra processos, remove conta POSIX e apaga resquícios em todas as partições user."""
    if not uname.startswith("lab."):
        return
    print(f"[OS] Removendo conta e resquícios: {uname}")
    remnant_paths = _collect_user_remnant_paths(uname)
    subprocess.run(["pkill", "-u", uname], stderr=subprocess.DEVNULL)
    subprocess.run(["userdel", "-r", "-f", uname], stderr=subprocess.DEVNULL)
    for path in remnant_paths:
        _remove_path_tree(path)
    LAST_ACCESS_STATE.pop(uname, None)


def _purge_all_lab_users() -> None:
    for entry in pwd.getpwall():
        if entry.pw_name.startswith("lab."):
            _purge_lab_user(entry.pw_name)
    _scan_orphan_lab_dirs()


def _maybe_migrate_user_home(uname: str, target_home: str, user_info) -> object:
    """
    Atualiza pw_dir para target_home quando allowHomeMigration (API).
    Não remove dados na home antiga — só passwd + nova árvore + chave no fluxo seguinte.
    """
    current = (user_info.pw_dir or "").strip()
    target = target_home.strip()
    if not target or os.path.normpath(current) == os.path.normpath(target):
        return user_info

    print(f"[OS] Migrando home de {uname}: {current} → {target}")
    subprocess.run(["pkill", "-u", uname], stderr=subprocess.DEVNULL)
    os.makedirs(target, mode=0o700, exist_ok=True)
    subprocess.run(["usermod", "-d", target, uname], check=True)
    shutil.chown(target, user=uname, group=uname)
    return pwd.getpwnam(uname)


def apply_provisioning(provisioning_data: list) -> None:
    """
    Sincroniza o Linux com a verdade da API.
    FASE 1 — Drift Correction: remove contas 'lab.*' que a API não listou.
    FASE 2 — Provisioning: cria/atualiza conta, chave SSH e shell.
    """
    expected_users = {item["systemUsername"] for item in provisioning_data}

    for entry in pwd.getpwall():
        uname = entry.pw_name
        if uname.startswith("lab.") and uname not in expected_users:
            _purge_lab_user(uname)

    _scan_orphan_lab_dirs()

    for item in provisioning_data:
        uname = item["systemUsername"]
        pubkey = (item.get("sshPublicKey") or "").strip()
        state = item["accessState"]
        revoke_key = item.get("revokeSshKey", False)

        if revoke_key:
            pubkey_to_write = ""
        elif not pubkey:
            pubkey_to_write = None  # não alterar authorized_keys existente
        elif not pubkey.startswith("ssh-ed25519 "):
            print(f"[OS] Aviso: {uname}: chave ignorada (apenas ssh-ed25519); shell será ajustado.")
            pubkey_to_write = None
        else:
            pubkey_to_write = pubkey

        try:
            user_info = pwd.getpwnam(uname)
        except KeyError:
            print(f"[OS] Criando conta: {uname}")
            home_dir = (item.get("homeDirectory") or "").strip()
            useradd_cmd = [
                "useradd", "-m", "-s", "/bin/bash", "-K", "UMASK=0077", "-G", "lab",
            ]
            if home_dir:
                useradd_cmd.extend(["-d", home_dir])
            useradd_cmd.append(uname)
            subprocess.run(useradd_cmd, check=True)
            user_info = pwd.getpwnam(uname)

        target_home = (item.get("homeDirectory") or "").strip()
        if item.get("allowHomeMigration") and target_home:
            user_info = _maybe_migrate_user_home(uname, target_home, user_info)

        try:
            home = user_info.pw_dir
            if not home:
                raise OSError(f"home ausente para {uname}")

            if not os.path.isdir(home):
                print(f"[OS] Recriando home ausente: {home}")
                os.makedirs(home, mode=0o700, exist_ok=True)
            subprocess.run(["chmod", "700", home], check=False)
            shutil.chown(home, user=uname, group=uname)

            ssh_dir = os.path.join(home, ".ssh")
            auth_keys = os.path.join(ssh_dir, "authorized_keys")
            os.makedirs(ssh_dir, mode=0o700, exist_ok=True)

            current_key = ""
            if os.path.isfile(auth_keys):
                try:
                    with open(auth_keys) as f:
                        current_key = f.read().strip()
                except OSError:
                    pass

            if revoke_key:
                with open(auth_keys, "w") as f:
                    f.write("")
                if current_key:
                    print(f"[ACCESS] Chave SSH revogada para {uname}")
            elif pubkey_to_write is not None and current_key != pubkey_to_write:
                with open(auth_keys, "w") as f:
                    f.write(pubkey_to_write + ("\n" if pubkey_to_write else ""))
                print(f"[OS] Chave SSH atualizada para {uname}")

            if os.path.isfile(auth_keys):
                os.chmod(auth_keys, 0o600)
            shutil.chown(ssh_dir, user=uname, group=uname)
            if os.path.isfile(auth_keys):
                shutil.chown(auth_keys, user=uname, group=uname)

            prev_state = LAST_ACCESS_STATE.get(uname)
            if prev_state == "full_shell" and state == "sftp_only":
                print(f"[ACCESS] {uname}: full_shell → sftp_only (encerrando processos)")
                subprocess.run(["pkill", "-u", uname], stderr=subprocess.DEVNULL)

            target_shell = SFTP_SHELL if state == "sftp_only" else "/bin/bash"
            if user_info.pw_shell != target_shell:
                subprocess.run(["usermod", "-s", target_shell, uname], check=True)
                print(f"[OS] Shell de {uname} alterado para {target_shell}")

            LAST_ACCESS_STATE[uname] = state
        except Exception as user_err:
            print(f"[OS] Erro ao provisionar {uname}: {user_err}")

def _host_fingerprint() -> str | None:
    """Extrai o Fingerprint SHA256 da chave ed25519 da máquina (para o front validar)."""
    try:
        # Pega especificamente a chave ED25519
        out = subprocess.check_output(["ssh-keygen", "-l", "-f", "/etc/ssh/ssh_host_ed25519_key.pub"], text=True)
        # Saída esperada: "256 SHA256:abcd1234efgh... root@host (ED25519)"
        match = re.search(r"(SHA256:\S+)", out)
        if match:
            return match.group(1)
    except Exception as e:
        print(f"[Specs] Aviso: Falha ao ler fingerprint ed25519: {e}")
    return None

def sync_specs() -> None:
    print("[Specs] Sincronizando hardware...")
    disk = psutil.disk_usage("/")
    disks_info = _disk_partitions()

    gpu_model, total_vram_wire = _collect_gpu_specs()
    ram_total_wire, _ = _ram_wire()

    specs = {
        "cpuModel":    _cpu_model(),
        "totalRamGb":  ram_total_wire,
        "totalDiskGb": _gb_wire(disk.total),
        "ipAddress":   _local_ip(),
        "disks":       disks_info,
        "hostFingerprint": _host_fingerprint(),
    }
    if gpu_model:
        specs["gpuModel"] = gpu_model
    if total_vram_wire is not None:
        specs["totalVramGb"] = total_vram_wire
    specs = {k: v for k, v in specs.items() if v is not None}

    try:
        resp = requests.put(f"{API_BASE}/sync-specs", json=specs, headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            vram_note = (
                f", VRAM {total_vram_wire / 10:.1f} GB"
                if total_vram_wire is not None
                else ""
            )
            print(f"[Specs] ✓ Hardware registrado ({_GPU.name}{vram_note}).")
        else:
            print(f"[Specs] ✗ Erro {resp.status_code}: {resp.text[:80]}")
    except Exception as e:
        print(f"[Specs] ✗ Erro de conexão: {e}")

def heartbeat_worker():
    global SSH_AUDIT_BUFFER, LAST_PROCESS_REQUEST_TS, PROCESS_BATCHES_REMAINING
    print("[C2] Thread de Heartbeat iniciada.")
    
    while True:
        try:
            users = _active_users()
            
            # Lê os usuários 'lab.*' reais do /etc/passwd para o Drift Detection
            os_users = [entry.pw_name for entry in pwd.getpwall() if entry.pw_name.startswith("lab.")]
            
            payload = {
                "connectedUsers": [u['username'] for u in users],
                "provisionedOsUsers": os_users 
            }

            # Lógica de Despacho de SSH (20 itens ou 12:00 UTC)
            # Lógica de Despacho Seguro de SSH (20 itens ou 12:00 UTC)
            now_utc = datetime.now(timezone.utc)
            buffer_copy = []
            
            with CONFIG_LOCK:
                # Fazemos uma cópia sob lock para evitar perdas
                buffer_size = len(SSH_AUDIT_BUFFER)
                if buffer_size >= 20 or (now_utc.hour == 12 and now_utc.minute == 0 and buffer_size > 0):
                    buffer_copy = list(SSH_AUDIT_BUFFER)
                    payload["sshAttempts"] = buffer_copy

            # ... Envia requests.post ...
            resp = requests.post(f"{API_BASE}/heartbeat", json=payload, headers=HEADERS, timeout=5)
            
            if resp.status_code == 200:
                # Se SUCESSO, removemos do buffer global Apenas a quantidade exata que foi enviada.
                # Assim, se uma tentativa nova de SSH ocorreu durante o `requests.post`, ela NÃO será apagada.
                if buffer_copy:
                    with CONFIG_LOCK:
                        SSH_AUDIT_BUFFER = SSH_AUDIT_BUFFER[len(buffer_copy):]
                
                data = resp.json()
                
                # Atualiza Config e Lê o Gatilho de Processos On-Demand
                new_config = data.get("agentConfig")
                if isinstance(new_config, dict):
                    with CONFIG_LOCK:
                        telemetry_patch = new_config.get("telemetry")
                        if isinstance(telemetry_patch, dict):
                            AGENT_CONFIG["telemetry"] = {
                                **AGENT_CONFIG.get("telemetry", {}),
                                **telemetry_patch,
                            }
                            on_demand = telemetry_patch.get("onDemandProcessConfig")
                            if on_demand:
                                req_ts = on_demand.get("requestTimestamp")
                                if req_ts and req_ts != LAST_PROCESS_REQUEST_TS:
                                    LAST_PROCESS_REQUEST_TS = req_ts
                                    PROCESS_BATCHES_REMAINING = 5
                                    print("[C2] Gatilho de Processos Ativado pelo Admin (5 batches).")
                
                # Aplica as ordens de provisionamento no Sistema Operacional
                provisioning_orders = data.get("provisioning", [])
                if data.get("decommission"):
                    print("[C2] Descomissionamento solicitado — removendo todos lab.*")
                    _purge_all_lab_users()
                else:
                    apply_provisioning(provisioning_orders if provisioning_orders else [])
                    
        except Exception as e:
            print(f"[C2] Erro no Heartbeat: {e}")
            
        time.sleep(HEARTBEAT_INTERVAL)

def _telemetry_disk_enabled(t_set: dict) -> bool:
    if "disk" in t_set:
        return bool(t_set.get("disk"))
    return bool(t_set.get("diskSpace") or t_set.get("diskIO"))


_PROCESS_COMPARE_KEYS = {
    "cpuPercent": "cpuPercent",
    "cpu": "cpuPercent",
    "ramMb": "ramMb",
    "ram": "ramMb",
    "vramMb": "vramMb",
    "vram": "vramMb",
    "gpuUse": "gpuUse",
    "diskReadKbps": "diskReadKbps",
    "diskRead": "diskReadKbps",
    "diskWriteKbps": "diskWriteKbps",
    "diskWrite": "diskWriteKbps",
}


def _gpu_process_metrics() -> dict[int, dict]:
    if _GPU.name == "nvidia" and hasattr(_GPU, "gpu_process_metrics"):
        return _GPU.gpu_process_metrics()
    return {}


def _nvidia_process_gpu_ready() -> bool:
    return _GPU.name == "nvidia" and getattr(_GPU, "_nvitop_ready", lambda: False)()


def _resolve_process_compare_metric(compare_metric: str) -> str:
    """
    Métricas GPU por processo (gpuUse, vramMb) exigem NVIDIA + nvitop.
    Sem isso, faz fallback para cpuPercent.
    """
    key = _PROCESS_COMPARE_KEYS.get(compare_metric, "cpuPercent")
    if key in ("gpuUse", "vramMb") and not _nvidia_process_gpu_ready():
        return "cpuPercent"
    return compare_metric


def _session_lab_usernames() -> set[str]:
    """Contas lab.* com sessão TTY/SSH ativa no instante da coleta."""
    return {u["username"] for u in _active_users()}


_LEGACY_ON_DEMAND_DEFAULTS = {
    "cpuPercent": 2.0,
    "ramMb": 200,
    "vramMb": 50,
    "diskReadKbps": 1000,
    "diskWriteKbps": 1000,
}

# Prioridade de ordenação do on-demand antigo (_get_heavy_processes).
_LEGACY_COMPARE_PRIORITY = (
    "vramMb",
    "cpuPercent",
    "ramMb",
    "diskReadKbps",
    "diskWriteKbps",
)


def _infer_legacy_on_demand_compare_metric(thresholds: dict) -> str:
    """
    Formato legado guardava limiares mínimos (OR) e ordenava VRAM > CPU > RAM > I/O.
    Infere compareMetric pelo primeiro limiar não-default nessa ordem; senão vramMb.
    """
    for key in _LEGACY_COMPARE_PRIORITY:
        if key not in thresholds:
            continue
        try:
            val = float(thresholds[key])
            default = float(_LEGACY_ON_DEMAND_DEFAULTS[key])
        except (TypeError, ValueError):
            continue
        if val != default:
            return key
    return "vramMb"


def _resolve_on_demand_process_params(on_demand: dict) -> tuple[str, int, str]:
    """
    Normaliza onDemandProcessConfig para o formato Top-X atual.
    Aceita compareMetric/topX/userScope no topo, aninhados em thresholds ou legado (limiares mínimos).
    """
    compare_metric = on_demand.get("compareMetric", "cpuPercent")
    top_x = on_demand.get("topX", 10)
    user_scope = on_demand.get("userScope", "all")

    if on_demand.get("compareMetric") is not None:
        return compare_metric, top_x, user_scope

    thresholds = on_demand.get("thresholds")
    if not isinstance(thresholds, dict):
        return compare_metric, top_x, user_scope

    if thresholds.get("compareMetric") is not None:
        return (
            thresholds.get("compareMetric", compare_metric),
            thresholds.get("topX", top_x),
            thresholds.get("userScope", user_scope),
        )

    top_x = thresholds.get("topX", top_x)
    compare_metric = _infer_legacy_on_demand_compare_metric(thresholds)
    return compare_metric, top_x, "all"


def _process_cpu_wire(raw_cpu_percent: float) -> int:
    """
    Converte cpu_percent do psutil (% somada nos núcleos) para % da capacidade total do host.
    Ex.: 330% em 8 threads → 41,25% do host → wire 412 (×10).
    """
    pct_of_machine = min(100.0, max(0.0, raw_cpu_percent / _LOGICAL_CPUS))
    return round(pct_of_machine * 10)


def _get_top_processes(compare_metric: str, top_x: int, user_scope: str = "all") -> list[dict]:
    """
    Captura processos e retorna o Top X pela métrica escolhida.
    compare_metric só define a ordenação; cada item inclui CPU, RAM, VRAM, gpuUse e I/O.
    user_scope: 'session' limita a processos de lab.* conectados; 'all' inclui todo o host.
    """
    global _process_io_prev

    compare_metric = _resolve_process_compare_metric(compare_metric)
    sort_key = _PROCESS_COMPARE_KEYS.get(compare_metric, "cpuPercent")
    top_x = max(1, min(int(top_x or 10), 100))
    gpu_procs = _gpu_process_metrics()

    allowed_users = None
    if user_scope == "session":
        allowed_users = _session_lab_usernames()
        if not allowed_users:
            return []

    procs = []
    current_io = {}
    now = time.monotonic()

    try:
        for p in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_info', 'io_counters']):
            pid = p.info['pid']
            cpu = p.info.get('cpu_percent') or 0.0
            ram_mb = (p.info.get('memory_info').rss / 1_048_576) if p.info.get('memory_info') else 0.0
            gpu_data = gpu_procs.get(pid, {})
            vram_mb = gpu_data.get("vramMb", 0)
            gpu_use = gpu_data.get("gpuUse", 0)

            r_kbps = w_kbps = 0.0
            if p.info.get('io_counters'):
                io = p.info['io_counters']
                current_io[pid] = (io.read_bytes, io.write_bytes, now)

                if pid in _process_io_prev:
                    p_read, p_write, p_time = _process_io_prev[pid]
                    dt = now - p_time
                    if dt > 0:
                        r_kbps = ((io.read_bytes - p_read) / 1024) / dt
                        w_kbps = ((io.write_bytes - p_write) / 1024) / dt

            username = p.info.get('username') or '?'
            if allowed_users is not None and username not in allowed_users:
                continue
            entry = {
                "pid": pid,
                "name": (p.info.get('name') or '?')[:50],
                "username": username,
                "cpuPercent": _process_cpu_wire(cpu),
                "ramMb": round(ram_mb),
            }
            if vram_mb > 0:
                entry["vramMb"] = vram_mb
            if gpu_use > 0:
                entry["gpuUse"] = gpu_use
            if r_kbps > 0:
                entry["diskReadKbps"] = round(r_kbps)
            if w_kbps > 0:
                entry["diskWriteKbps"] = round(w_kbps)
            procs.append(entry)
    except Exception:
        pass

    _process_io_prev = current_io
    procs.sort(key=lambda x: x.get(sort_key, 0), reverse=True)
    return procs[:top_x]

def collect_telemetry() -> dict:
    global PROCESS_BATCHES_REMAINING
    
    with CONFIG_LOCK:
        on_demand = AGENT_CONFIG["telemetry"].get("onDemandProcessConfig") or {}
        p_cfg = AGENT_CONFIG["telemetry"].get("processCaptureConfig") or {
            "compareMetric": "cpuPercent",
            "topX": 10,
            "userScope": "all",
        }
        t_set = AGENT_CONFIG["telemetry"].get("telemetrySet", {
            "cpu": True, "gpu": True, "ramAndSwap": True,
            "disk": True, "networkIO": True,
            "temperatures": True, "activeUsers": True,
            "processCapture": False,
        })

    processes = None
    if t_set.get("processCapture"):
        processes = _get_top_processes(
            p_cfg.get("compareMetric", "cpuPercent"),
            p_cfg.get("topX", 10),
            p_cfg.get("userScope", "all"),
        )
    elif PROCESS_BATCHES_REMAINING > 0:
        compare_metric, top_x, user_scope = _resolve_on_demand_process_params(on_demand)
        processes = _get_top_processes(compare_metric, top_x, user_scope)
        PROCESS_BATCHES_REMAINING -= 1

    cpu_total = psutil.cpu_percent(interval=None)
    temps = _read_temperatures() if t_set.get("temperatures") else {"cpuTemp": None, "moboTemp": None}

    ram_total_wire, ram_used_wire = _ram_wire()

    swap_total_wire = swap_used_wire = None
    if t_set.get("ramAndSwap"):
        swap_total_wire, swap_used_wire = _swap_wire()

    gpu_usage = gpu_temp = gpu_power = None
    vram_used_wire = vram_total_wire = None
    if t_set.get("gpu"):
        if _GPU.name == "nvidia":
            gpu_usage = round(_GPU.usage() * 10) if getattr(_GPU, "_nvitop_ready", lambda: False)() else None
        else:
            gpu_usage = round(_GPU.usage() * 10)
        if t_set.get("temperatures"):
            raw_gpu_temp = _GPU.temp()
            gpu_temp = round(raw_gpu_temp * 10) if raw_gpu_temp and raw_gpu_temp > 0 else None
        gpu_power = _GPU.power()
        vram_used_wire, vram_total_wire = _GPU.vram()

    avg_freq_mhz = None
    if t_set.get("cpu"):
        freq = psutil.cpu_freq(percpu=False)
        if freq and freq.current:
            avg_freq_mhz = round(freq.current)

    down = up = None
    if t_set.get("networkIO"):
        down, up = _net_delta()

    disk_r = disk_w = disks_info = None
    if _telemetry_disk_enabled(t_set):
        disk_r, disk_w, disks_info = _disk_metrics(True, True)

    active_users = _active_users() if t_set.get("activeUsers") else None
    mobo_temp = round(temps["moboTemp"] * 10) if temps.get("moboTemp") is not None else None
    cpu_temp = round(temps["cpuTemp"] * 10) if temps.get("cpuTemp") is not None else None

    cpu_usage = round(cpu_total * 10) if t_set.get("cpu") else None

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "cpuUsage": cpu_usage,
        "cpuTemp": cpu_temp,
        "cpuFreqMhz": avg_freq_mhz,
        "gpuUsage": gpu_usage,
        "gpuTemp": gpu_temp,
        "gpuPowerWatts": gpu_power if gpu_power and gpu_power > 0 else None,
        "disksInfo": disks_info,
        "diskReadMbps": disk_r,
        "diskWriteMbps": disk_w,
        "downloadMbps": down,
        "uploadMbps": up,
        "moboTemperature": mobo_temp,
        "activeUsers": active_users,
        "processes": processes,
    }

    payload["ramTotalGb"] = ram_total_wire
    payload["ramUsedGb"] = ram_used_wire
    if swap_total_wire is not None:
        payload["swapTotalGb"] = swap_total_wire
        payload["swapUsedGb"] = swap_used_wire
    if vram_total_wire is not None and vram_total_wire > 0:
        payload["vramTotalGb"] = vram_total_wire
        payload["vramUsedGb"] = vram_used_wire

    return payload

def telemetry_worker():
    print("[Telemetry] Thread de Coleta iniciada.")
    psutil.cpu_percent(interval=None)   # aquecimento

    buffer    = []
    iteration = 0

    while True:
        with CONFIG_LOCK:
            interval   = AGENT_CONFIG["telemetry"]["intervalSeconds"]
            batch_size = AGENT_CONFIG["telemetry"]["batchSize"]

        iteration += 1
        data = collect_telemetry()
        buffer.append(data)

        gpu_wire = data.get("gpuUsage")
        gpu_log = f"{gpu_wire / 10}%" if gpu_wire is not None else "off"
        print(
            f"[{time.strftime('%H:%M:%S')}] Amostra {len(buffer)}/{batch_size} | "
            f"CPU {data['cpuUsage'] / 10}% | GPU({_GPU.name}) {gpu_log}"
        )

        if len(buffer) >= batch_size:
            try:
                resp = requests.post(
                    f"{API_BASE}/telemetry",
                    json={"data": buffer},
                    headers=HEADERS,
                    timeout=5,
                )
                if resp.status_code in (200, 201, 204):
                    print(f"  ↳ [✓] Lote de {len(buffer)} amostras despachado.")
                else:
                    detail = (resp.text or "").strip().replace("\n", " ")[:160]
                    print(
                        f"  ↳ [✗ {resp.status_code}] Lote de {len(buffer)} amostras despachado."
                        + (f" {detail}" if detail else "")
                    )
            except Exception as e:
                print(f"  ↳ [✗] Erro de rede: {e}")
            buffer = []

        time.sleep(interval)

def ssh_audit_worker():
    global SSH_AUDIT_BUFFER
    log_path = "/var/log/auth.log"
    
    print(f"[Audit] Aguardando {log_path}...")
    while not os.path.exists(log_path):
        time.sleep(5)
        
    print("[Audit] Monitoramento SSH em tempo real iniciado.")
    
    with open(log_path, "r") as f:
        # Pula para o final do arquivo ao ligar.
        # Assim não reenviamos tentativas velhas de dias atrás cada vez que o Agente for reiniciado.
        f.seek(0, os.SEEK_END)
        cur_ino = os.fstat(f.fileno()).st_ino
        
        while True:
            line = f.readline()
            
            # Se não houver linha nova, pausa meio segundo e verifica Rotação de Log
            if not line:
                try:
                    # Se o 'inode' mudou, significa que o Linux rodou um logrotate
                    if os.stat(log_path).st_ino != cur_ino:
                        f.close()
                        f = open(log_path, "r")
                        cur_ino = os.fstat(f.fileno()).st_ino
                        continue
                except Exception:
                    pass
                time.sleep(0.5)
                continue
            
            # Se leu uma linha, analisa!
            parsed = parse_ssh_line(line)
            if parsed:
                with CONFIG_LOCK:
                    # Limita a 500 itens na memória para evitar crash se a API ficar offline por meses
                    if len(SSH_AUDIT_BUFFER) < 500:
                        SSH_AUDIT_BUFFER.append(parsed)

# ==============================================================================
# MAIN
# ==============================================================================

def main():
    print("=== Lab Agent Daemon ===")
    print(f"Máquina : {MACHINE}")
    print(f"Server  : {API_BASE}")
    print(f"GPU     : {_GPU.name}")
    print(f"SFTP    : {SFTP_SHELL}\n")

    # ------------------------------------------------------------------
    # HARDENING BASE (roda uma vez no boot, operações idempotentes)
    # ------------------------------------------------------------------
    try:
        # Garante que o grupo 'lab' existe (usado pelo limits.conf e pelo useradd)
        subprocess.run(["groupadd", "-f", "lab"], stderr=subprocess.DEVNULL)

        # Força UMASK 077 no login.defs para qualquer valor atual que existir
        with open("/etc/login.defs", "r") as f:
            content = f.read()
        new_content = re.sub(r"^(UMASK\s+)\d+", r"\g<1>077", content, flags=re.MULTILINE)
        if new_content != content:
            with open("/etc/login.defs", "w") as f:
                f.write(new_content)
            print("[OS] Hardening: UMASK atualizado para 077 no login.defs")
        else:
            print("[OS] Hardening: UMASK já estava correto.")
    except Exception as e:
        print(f"[OS] Aviso de Hardening: {e}")

    bootstrap_telemetry_from_lab_config()
    sync_specs()

    t_heartbeat = threading.Thread(target=heartbeat_worker, daemon=True)
    t_telemetry = threading.Thread(target=telemetry_worker, daemon=True)
    t_audit     = threading.Thread(target=ssh_audit_worker, daemon=True)

    t_heartbeat.start()
    t_telemetry.start()
    t_audit.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Daemon] Encerrando graciosamente...")

if __name__ == "__main__":
    main()