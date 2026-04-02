#!/usr/bin/env python3
"""
Diagnóstico completo do agente de monitoramento.

Testa:
  1. Coleta de hardware (CPU, GPU, RAM, Disco, Rede, Temperaturas)
  2. Conectividade com a API (heartbeat, telemetria)
  3. Ciclo de envio de telemetria em tempo real

Uso:
  python3 test_diagnostics.py                  # Só coleta de hardware
  python3 test_diagnostics.py --api            # Testa conexão com API
  python3 test_diagnostics.py --live           # Coleta contínua (5s intervalo)
  python3 test_diagnostics.py --api --live     # Coleta + envio à API
"""

import sys
import time
import argparse


def test_hardware():
    """Testa coleta de hardware."""
    print('=' * 60)
    print('  DIAGNÓSTICO DE HARDWARE')
    print('=' * 60)

    import psutil

    # CPU
    psutil.cpu_percent(interval=None)  # warmup
    time.sleep(1)
    cpu_pct = psutil.cpu_percent(interval=None)
    print(f'\n  CPU uso:      {cpu_pct:.1f}%')

    # CPU Temp
    temps = psutil.sensors_temperatures()
    if temps:
        print(f'  Sensores:     {list(temps.keys())}')
        for name in ['coretemp', 'k10temp', 'cpu_thermal', 'zenpower']:
            if name in temps:
                readings = temps[name]
                avg = sum(r.current for r in readings) / len(readings)
                print(f'  CPU temp:     {avg:.1f}°C (via {name})')
                break
        if 'amdgpu' in temps:
            for e in temps['amdgpu']:
                print(f'  GPU temp:     {e.current}°C ({e.label})')
    else:
        print('  Temperaturas: NENHUM SENSOR ENCONTRADO')

    # RAM
    mem = psutil.virtual_memory()
    print(f'\n  RAM total:    {mem.total / (1024**3):.1f} GB')
    print(f'  RAM uso:      {mem.percent}%')

    # Disco
    disk = psutil.disk_usage('/')
    print(f'\n  Disco total:  {disk.total / (1024**3):.1f} GB')
    print(f'  Disco uso:    {disk.percent}%')

    # GPU AMD (sysfs)
    import glob
    amd_paths = glob.glob('/sys/class/drm/card*/device/gpu_busy_percent')
    if amd_paths:
        for p in amd_paths:
            try:
                with open(p) as f:
                    val = f.read().strip()
                print(f'\n  GPU AMD uso:  {val}% (via {p})')
            except Exception as e:
                print(f'\n  GPU AMD erro: {e}')

    # GPU NVIDIA (pynvml)
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = pynvml.nvmlDeviceGetName(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            print(f'\n  GPU NVIDIA:   {name}')
            print(f'  GPU uso:      {util.gpu}%')
            print(f'  GPU temp:     {temp}°C')
    except ImportError:
        pass
    except Exception as e:
        if 'Driver' not in str(e):
            print(f'\n  GPU NVIDIA erro: {e}')

    # Lspci GPU
    import subprocess
    try:
        r = subprocess.run(['lspci'], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            lower = line.lower()
            if 'vga' in lower or '3d' in lower or 'display' in lower:
                print(f'\n  GPU (lspci):  {line.split(": ", 1)[-1]}')
    except Exception:
        pass

    # Teste via hardware.py
    print('\n' + '-' * 60)
    print('  COLETA VIA hardware.py (formato enviado à API)')
    print('-' * 60)

    try:
        from hardware import collect_telemetry, get_system_specs
        data = collect_telemetry()
        print()
        for k, v in data.items():
            if k.endswith('Usage') and k not in ('downloadUsage', 'uploadUsage'):
                print(f'  {k:20s} = {v:>6d}  ({v / 10:.1f}%)')
            elif k.endswith('Temp') or k == 'moboTemperature':
                print(f'  {k:20s} = {v:>6d}  ({v / 10:.1f}°C)')
            else:
                print(f'  {k:20s} = {v}')

        print()
        specs = get_system_specs()
        for k, v in specs.items():
            print(f'  {k:20s} = {v}')
    except Exception as e:
        print(f'\n  ERRO ao importar hardware.py: {e}')

    print()
    return True


def test_api_connection():
    """Testa conexão com a API."""
    print('=' * 60)
    print('  DIAGNÓSTICO DE CONEXÃO COM API')
    print('=' * 60)

    try:
        from config import SERVER_URL, MACHINE_TOKEN, MAC_ADDRESS
    except Exception as e:
        print(f'\n  ERRO config: {e}')
        print('  Verifique se o arquivo .env existe e está configurado.')
        return False

    print(f'\n  SERVER_URL:   {SERVER_URL}')
    print(f'  TOKEN:        {MACHINE_TOKEN[:8]}...{MACHINE_TOKEN[-8:]}' if len(MACHINE_TOKEN) > 16 else f'  TOKEN:        {MACHINE_TOKEN}')
    print(f'  MAC_ADDRESS:  {MAC_ADDRESS}')

    from api_client import APIClient
    api = APIClient()

    # Heartbeat
    print(f'\n  Testando heartbeat...')
    result = api.heartbeat()
    if result is None:
        print('  ✗ Heartbeat FALHOU — servidor inacessível ou token inválido')
        return False

    print(f'  ✓ Heartbeat OK')
    machine = result.get('machine', {})
    print(f'    Máquina: {machine.get("name")} ({machine.get("status")})')

    alloc = result.get('currentAllocation')
    if alloc:
        print(f'    Alocação ativa: {alloc.get("userName")} ({alloc.get("remainingMinutes")}min)')
    else:
        print(f'    Sem alocação ativa')

    qa = result.get('quickAllocate', {})
    print(f'    Quick-allocate: {"SIM" if qa.get("allowed") else "NÃO"} (max {qa.get("maxDurationMinutes", 0)}min)')
    print(f'    shouldBlock: {result.get("shouldBlock")}')
    print(f'    serverTime: {result.get("serverTime")}')

    # Sync specs
    print(f'\n  Testando sync-specs...')
    from hardware import get_system_specs
    specs = get_system_specs()
    ok = api.sync_specs(specs)
    print(f'  {"✓" if ok else "✗"} Sync specs: {"OK" if ok else "FALHOU"}')

    # Telemetria (precisa ter alocação ativa)
    print(f'\n  Testando envio de telemetria...')
    from hardware import collect_telemetry
    data = collect_telemetry()
    ok = api.send_telemetry(data)
    print(f'  {"✓" if ok else "✗"} Telemetria: {"enviada (204)" if ok else "FALHOU (sem alocação ativa?)"}')

    print()
    return True


def test_live(with_api=False):
    """Coleta contínua em tempo real."""
    print('=' * 60)
    print(f'  COLETA EM TEMPO REAL (Ctrl+C para parar)')
    if with_api:
        print(f'  + Envio à API ativado')
    print('=' * 60)

    from hardware import collect_telemetry
    api = None
    if with_api:
        from api_client import APIClient
        api = APIClient()

    iteration = 0
    try:
        while True:
            iteration += 1
            data = collect_telemetry()

            cpu = data['cpuUsage'] / 10
            cpu_t = data['cpuTemp'] / 10
            gpu = data['gpuUsage'] / 10
            gpu_t = data['gpuTemp'] / 10
            ram = data['ramUsage'] / 10
            disk = data.get('diskUsage', 0) / 10
            dl = data.get('downloadUsage', 0)
            ul = data.get('uploadUsage', 0)

            status = ''
            if api:
                ok = api.send_telemetry(data)
                status = ' [API ✓]' if ok else ' [API ✗]'

            print(
                f'  [{iteration:4d}] '
                f'CPU: {cpu:5.1f}% {cpu_t:4.1f}°C | '
                f'GPU: {gpu:5.1f}% {gpu_t:4.1f}°C | '
                f'RAM: {ram:5.1f}% | '
                f'Disco: {disk:4.1f}% | '
                f'Net: ↓{dl:.1f} ↑{ul:.1f} Mbps'
                f'{status}'
            )

            time.sleep(5)
    except KeyboardInterrupt:
        print(f'\n  Parado após {iteration} iterações.')


def main():
    parser = argparse.ArgumentParser(description='Diagnóstico do agente')
    parser.add_argument('--api', action='store_true', help='Testa conexão com a API')
    parser.add_argument('--live', action='store_true', help='Coleta contínua em tempo real')
    args = parser.parse_args()

    test_hardware()

    if args.api:
        test_api_connection()

    if args.live:
        test_live(with_api=args.api)

    if not args.api and not args.live:
        print('  Dica: use --api para testar conexão, --live para coleta contínua')
        print()


if __name__ == '__main__':
    main()
