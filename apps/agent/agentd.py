# agentd.py — Lab Agent Daemon Unificado (TCC)
# Configurar o handshake ssh para funcionar sempre encima de ed25519.

import time
import getpass
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

API_BASE    = "http://localhost:7372/api/v1/agent"
TOKEN       = "e748e281830727794aab400a3daf938f8e6d4bd1542e4db6273d87677788e273c377cac05b943f1349711c80ce27cf90052cceb501e889b164a6bbd5fb90c176"
MACHINE     = "PC-LAB-01"
SYSTEM_USER = getpass.getuser()

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
_process_io_prev = {} # Cache para calcular velocidade de disco (PID -> bytes)
SSH_AUDIT_BUFFER = []

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

CONFIG_LOCK = threading.Lock()
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
    def vram(self) -> tuple[int, int]: return 0, 0   # (used_mb, total_mb)
    def power(self) -> int: return 0


class _NvidiaBackend(_GpuBackend):
    """pynvml — binding oficial da NVML. Funciona em Linux, Windows e WSL2."""
    name = "nvidia"

    def __init__(self):
        import pynvml
        pynvml.nvmlInit()
        # Pega o handle da primeira GPU (índice 0).
        # Para multi-GPU, itere nvmlDeviceGetCount() e some/faça média.
        self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        self._pynvml = pynvml

    def usage(self) -> float:
        rates = self._pynvml.nvmlDeviceGetUtilizationRates(self._handle)
        return float(rates.gpu)

    def temp(self) -> float:
        NVML_TEMPERATURE_GPU = 0
        return float(self._pynvml.nvmlDeviceGetTemperature(self._handle, NVML_TEMPERATURE_GPU))

    def vram(self) -> tuple[int, int]:
        info = self._pynvml.nvmlDeviceGetMemoryInfo(self._handle)
        # Converte de Bytes para GB com 1 casa decimal (escalado x10)
        return round((info.used / 1024**3) * 10), round((info.total / 1024**3) * 10)
    
    def power(self) -> int:
        try:
            # A NVML retorna miliWatts. Dividimos por 1000 para Watts.
            mw = self._pynvml.nvmlDeviceGetPowerUsage(self._handle)
            return int(mw / 1000)
        except Exception:
            return 0


class _AmdSysfsBackend(_GpuBackend):
    """
    Lê diretamente do sysfs do kernel — sem dependências extras.
    Funciona em qualquer Linux com driver amdgpu carregado (sem ROCm).
    """
    name = "amd_sysfs"

    def usage(self) -> float:
        try:
            paths = glob.glob("/sys/class/drm/card*/device/gpu_busy_percent")
            if paths:
                return float(open(paths[0]).read().strip())
        except Exception:
            pass
        return 0.0

    def temp(self) -> float:
        # psutil já lê o hwmon do amdgpu; reutilizamos aqui para não duplicar lógica
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
        try:
            used_path  = glob.glob("/sys/class/drm/card*/device/mem_info_vram_used")
            total_path = glob.glob("/sys/class/drm/card*/device/mem_info_vram_total")
            if used_path and total_path:
                used_bytes  = int(open(used_path[0]).read().strip())
                total_bytes = int(open(total_path[0]).read().strip())
                # Converte de Bytes para GB com 1 casa decimal (escalado x10)
                return round((used_bytes / 1024**3) * 10), round((total_bytes / 1024**3) * 10)
        except Exception:
            pass
        return 0, 0
    
    def power(self) -> int:
        try:
            # A AMD geralmente expõe a potência em microWatts no hwmon
            paths = glob.glob("/sys/class/drm/card*/device/hwmon/hwmon*/power1_average")
            if not paths:
                paths = glob.glob("/sys/class/drm/card*/device/hwmon/hwmon*/power1_input")
            if paths:
                uw = int(open(paths[0]).read().strip())
                return int(uw / 1_000_000) # De microWatts para Watts
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

    # 1. NVIDIA via pynvml (mais rico: uso, temp, VRAM, power, clocks)
    try:
        backend = _NvidiaBackend()
        print(f"[GPU] Backend: NVIDIA/pynvml (nvml ok)")
        return backend
    except Exception as e:
        print(f"[GPU] NVIDIA indisponível: {e}")

    # 2. AMD via sysfs (sem dependências, só kernel amdgpu)
    if glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
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
# FUNÇÕES DE COLETA DE HARDWARE (sem alteração na interface pública)
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

def _gpu_model() -> str | None:
    try:
        out = subprocess.check_output(["lspci", "-mm"], text=True, stderr=subprocess.DEVNULL, timeout=3)
        for line in out.splitlines():
            if "VGA" in line or "3D" in line or "Display" in line:
                parts = [p.strip('"') for p in line.split('"')]
                if len(parts) >= 6:
                    return f"{parts[3]} {parts[5]}"
    except Exception:
        pass
    return None

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
    result = {"cpuTemp": 0.0, "moboTemp": None}
    try:
        sensors = psutil.sensors_temperatures()
        for name in ("coretemp", "k10temp", "cpu_thermal"):
            if name in sensors and sensors[name]:
                result["cpuTemp"] = max(e.current for e in sensors[name])
                break
        else:
            if "acpitz" in sensors and sensors["acpitz"]:
                result["cpuTemp"] = sensors["acpitz"][0].current

        if result["cpuTemp"] != 0.0 and "acpitz" in sensors and sensors["acpitz"]:
            result["moboTemp"] = sensors["acpitz"][0].current
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

def apply_provisioning(provisioning_data: list) -> None:
    """
    Sincroniza o Linux com a verdade da API.
    FASE 1 — Drift Correction: remove contas 'lab.*' que a API não listou.
    FASE 2 — Provisioning: cria/atualiza conta, chave SSH, shell e sudo.
    """
    expected_users = {item["systemUsername"] for item in provisioning_data}

    # ------------------------------------------------------------------
    # FASE 1: DRIFT CORRECTION
    # ------------------------------------------------------------------
    for entry in pwd.getpwall():
        uname = entry.pw_name
        if uname.startswith("lab.") and uname not in expected_users:
            print(f"[OS] Removendo conta expirada: {uname}")
            subprocess.run(["pkill", "-u", uname], stderr=subprocess.DEVNULL)
            subprocess.run(["userdel", "-r", "-f", uname], stderr=subprocess.DEVNULL)

    # ------------------------------------------------------------------
    # FASE 2: PROVISIONAMENTO
    # ------------------------------------------------------------------
    import grp  # Importado para consultar os membros do grupo nativamente

    for item in provisioning_data:
        uname   = item["systemUsername"]
        pubkey  = item["sshPublicKey"].strip()
        state   = item["accessState"]           # "full_shell" | "sftp_only"
        is_sudo = item.get("isSudo", False)

        # 1. Cria conta se não existir
        user_exists = True
        try:
            user_info = pwd.getpwnam(uname)
        except KeyError:
            user_exists = False
            print(f"[OS] Criando conta: {uname}")
            subprocess.run(
                ["useradd", "-m", "-s", "/bin/bash", "-K", "UMASK=0077", "-G", "lab", uname],
                check=True
            )
            user_info = pwd.getpwnam(uname)

        # 2. Garante que a home é 700
        home = f"/home/{uname}"
        if os.path.isdir(home):
            subprocess.run(["chmod", "700", home], check=False)

        # 3. Injeção da chave SSH — só reescreve se o conteúdo mudou
        ssh_dir   = os.path.join(home, ".ssh")
        auth_keys = os.path.join(ssh_dir, "authorized_keys")

        os.makedirs(ssh_dir, mode=0o700, exist_ok=True)

        current_key = ""
        if os.path.exists(auth_keys):
            try:
                with open(auth_keys) as f:
                    current_key = f.read().strip()
            except OSError:
                pass

        if current_key != pubkey:
            with open(auth_keys, "w") as f:
                f.write(pubkey + "\n")

        os.chmod(auth_keys, 0o600)
        shutil.chown(ssh_dir,   user=uname, group=uname)
        shutil.chown(auth_keys, user=uname, group=uname)

        # 4. Controlo de shell (SÓ EXECUTA SE HOUVER MUDANÇA REAL)
        target_shell = SFTP_SHELL if state == "sftp_only" else "/bin/bash"
        if user_info.pw_shell != target_shell:
            subprocess.run(["usermod", "-s", target_shell, uname], check=True)
            print(f"[OS] Shell de {uname} alterado para {target_shell}")

        # 5. Gestão de sudo (SÓ EXECUTA SE HOUVER MUDANÇA REAL)
        try:
            is_currently_sudo = uname in grp.getgrnam("sudo").gr_mem
        except KeyError:
            is_currently_sudo = False

        if is_sudo and not is_currently_sudo:
            subprocess.run(["usermod", "-aG", "sudo", uname], stderr=subprocess.DEVNULL)
            print(f"[OS] Usuário {uname} adicionado ao grupo sudo")
        elif not is_sudo and is_currently_sudo:
            subprocess.run(["gpasswd", "-d", uname, "sudo"], stderr=subprocess.DEVNULL)
            print(f"[OS] Usuário {uname} removido do grupo sudo")

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
    ram  = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    disks_info = _disk_partitions()

    specs = {
        "cpuModel":    _cpu_model(),
        "gpuModel":    _gpu_model(),
        "gpuBackend":  _GPU.name,           # informa ao servidor qual backend está ativo
        "totalRamGb":  round(ram.total  / 1024**3, 1),
        "totalDiskGb": round(disk.total / 1024**3, 1),
        "ipAddress":   _local_ip(),
        "disks":       disks_info,
        "hostFingerprint": _host_fingerprint()
    }
    specs = {k: v for k, v in specs.items() if v is not None}

    try:
        resp = requests.put(f"{API_BASE}/sync-specs", json=specs, headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            print(f"[Specs] ✓ Hardware registrado. GPU backend: {_GPU.name}")
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
                if new_config:
                    with CONFIG_LOCK:
                        AGENT_CONFIG.update(new_config)
                        
                        on_demand = new_config["telemetry"].get("onDemandProcessConfig")
                        if on_demand:
                            req_ts = on_demand.get("requestTimestamp")
                            if req_ts and req_ts != LAST_PROCESS_REQUEST_TS:
                                LAST_PROCESS_REQUEST_TS = req_ts
                                PROCESS_BATCHES_REMAINING = 5 # Arma o gatilho para os próximos 5 envios de telemetria
                                print("[C2] Gatilho de Processos Ativado pelo Admin (5 batches).")
                
                # Aplica as ordens de provisionamento no Sistema Operacional
                provisioning_orders = data.get("provisioning", [])
                if provisioning_orders:
                    apply_provisioning(provisioning_orders)
                    
        except Exception as e:
            print(f"[C2] Erro no Heartbeat: {e}")
            
        time.sleep(30)

def _get_heavy_processes(thresholds: dict) -> list[dict]:
    """Captura processos e ordena por VRAM > CPU > RAM > Leitura Disco > Escrita Disco."""
    global _process_io_prev
    
    min_cpu   = thresholds.get("cpuPercent", 2.0)
    min_ram   = thresholds.get("ramMb", 200)
    min_vram  = thresholds.get("vramMb", 50)
    min_read  = thresholds.get("diskReadKbps", 1000)
    min_write = thresholds.get("diskWriteKbps", 1000)
    top_x     = thresholds.get("topX", 10)
    
    # 1. Pega processos na GPU (Somente NVIDIA via pynvml)
    gpu_procs = {}
    if _GPU.name == "nvidia":
        try:
            import pynvml
            nv_procs = pynvml.nvmlDeviceGetComputeRunningProcesses(_GPU._handle)
            for p in nv_procs:
                gpu_procs[p.pid] = int(p.usedGpuMemory / 1_048_576) if p.usedGpuMemory else 0
        except Exception:
            pass

    procs = []
    current_io = {}
    now = time.monotonic()
    
    try:
        for p in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_info', 'io_counters']):
            if p.info['username'] in ('root', 'systemd', 'messagebus'):
                continue
                
            pid = p.info['pid']
            cpu = p.info.get('cpu_percent') or 0.0
            ram_mb = (p.info.get('memory_info').rss / 1_048_576) if p.info.get('memory_info') else 0.0
            vram_mb = gpu_procs.get(pid, 0)
            
            # I/O de Disco Separado (Leitura e Escrita em Kbps)
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

            # Avalia se atinge ALGUM dos limites mínimos solicitados
            if (cpu >= min_cpu or ram_mb >= min_ram or vram_mb >= min_vram or 
                r_kbps >= min_read or w_kbps >= min_write):
                procs.append({
                    "pid": pid,
                    "name": p.info['name'][:50],
                    "username": p.info['username'],
                    "cpuPercent": round(cpu * 10),
                    "ramMb": round(ram_mb),
                    "vramMb": vram_mb,
                    "diskReadKbps": round(r_kbps),
                    "diskWriteKbps": round(w_kbps)
                })
    except Exception:
        pass
        
    _process_io_prev = current_io
    
    # 2. Ordenação mágica em tupla (Prioridade exata que você definiu)
    procs.sort(key=lambda x: (x['vramMb'], x['cpuPercent'], x['ramMb'], x['diskReadKbps'], x['diskWriteKbps']), reverse=True)
    return procs[:top_x]

def collect_telemetry() -> dict:
    global PROCESS_BATCHES_REMAINING
    
    with CONFIG_LOCK:
        # Extrai de forma segura para não dar erro de NoneType se o Admin nunca clicou no botão
        on_demand = AGENT_CONFIG["telemetry"].get("onDemandProcessConfig") or {}
        p_thresholds = on_demand.get("thresholds", {
            "cpuPercent": 2.0, "ramMb": 200, "vramMb": 50, 
            "diskReadKbps": 1000, "diskWriteKbps": 1000, "topX": 10
        })
        t_set = AGENT_CONFIG["telemetry"].get("telemetrySet", {
            "cpu": True, "gpu": True, "ramAndSwap": True,
            "diskSpace": True, "diskIO": True, "networkIO": True,
            "temperatures": True, "activeUsers": True
        })

    processes = None
    if PROCESS_BATCHES_REMAINING > 0:
        processes = _get_heavy_processes(p_thresholds)
        PROCESS_BATCHES_REMAINING -= 1 # Desconta um da lista dos processos restantes para envio

    cpu_total = psutil.cpu_percent(interval=None)
    ram       = psutil.virtual_memory()
    temps     = _read_temperatures() if t_set.get("temperatures") else {"cpuTemp": 0.0, "moboTemp": None}

    # GPU — delega inteiramente ao backend detectado no boot
    gpu_usage = 0
    gpu_temp  = 0.0
    gpu_power = 0
    vram_used_gb = vram_total_gb = 0
    if t_set.get("gpu"):
        gpu_usage    = round(_GPU.usage() * 10)   # mantém escala ×10 igual ao CPU
        gpu_temp     = _GPU.temp()
        gpu_power    = _GPU.power()
        vram_used_gb, vram_total_gb = _GPU.vram()

    if t_set.get("cpu"):
        freq        = psutil.cpu_freq(percpu=False)
        avg_freq_mhz = round(freq.current) if freq else 0
    else:
        avg_freq_mhz = None

    if t_set.get("ramAndSwap"):
        swap     = psutil.swap_memory()
        swap_tg  = round((swap.total / 1024**3) * 10)
        swap_ug  = round((swap.used  / 1024**3) * 10)
    else:
        swap_tg = swap_ug = None

    down, up = _net_delta() if t_set.get("networkIO") else (None, None)

    opt_d_space = t_set.get("diskSpace", False)
    opt_d_io    = t_set.get("diskIO",    False)
    disk_r, disk_w, disks_info = (
        _disk_metrics(opt_d_space, opt_d_io)
        if (opt_d_space or opt_d_io) else (None, None, None)
    )

    active_users = _active_users() if t_set.get("activeUsers") else None

    return {
        "timestamp":      datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "cpuUsage":       round(cpu_total * 10),
        "cpuTemp":        round(temps["cpuTemp"] * 10),
        "cpuFreqMhz":     avg_freq_mhz,
        "gpuUsage":       gpu_usage,
        "gpuTemp":        round(gpu_temp * 10),
        "gpuPowerWatts":  gpu_power if gpu_power > 0 else None,
        "vramUsedGb":     vram_used_gb   if vram_total_gb > 0 else None,
        "vramTotalGb":    vram_total_gb  if vram_total_gb > 0 else None,
        "ramTotalGb":     round((ram.total / 1024**3) * 10),
        "ramUsedGb":      round(((ram.total - ram.available) / 1024**3) * 10),
        "swapTotalGb":    swap_tg,
        "swapUsedGb":     swap_ug,
        "disks":          disks_info,
        "diskReadMbps":   disk_r,
        "diskWriteMbps":  disk_w,
        "downloadMbps":   down,
        "uploadMbps":     up,
        "moboTemperature": round(temps["moboTemp"] * 10) if temps["moboTemp"] else None,
        "activeUsers":    active_users,
        "processes":      processes
    }

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

        print(
            f"[{time.strftime('%H:%M:%S')}] Amostra {len(buffer)}/{batch_size} | "
            f"CPU {data['cpuUsage']/10}% | GPU({_GPU.name}) {data['gpuUsage']/10}%"
        )

        if len(buffer) >= batch_size:
            try:
                resp = requests.post(
                    f"{API_BASE}/telemetry",
                    json={"data": buffer},
                    headers=HEADERS,
                    timeout=5,
                )
                status = "✓" if resp.status_code in (200, 201, 204) else f"✗ {resp.status_code}"
                print(f"  ↳ [{status}] Lote de {len(buffer)} amostras despachado.")
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