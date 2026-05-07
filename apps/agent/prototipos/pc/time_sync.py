"""
Sincronização de horário via NTP.

Descobre o offset entre o relógio local e o UTC real (via servidores NTP).
Permite que o agente sempre trabalhe com UTC preciso, independente do
relógio local estar desajustado.

Usa NTP (Network Time Protocol) para obter o horário UTC real.
Fallback: se NTP falhar, usa o relógio local.
"""

import time
import logging
from datetime import datetime, timezone

logger = logging.getLogger('agent.timesync')

# Servidores NTP para consulta (em ordem de prioridade)
NTP_SERVERS = [
    'pool.ntp.org',
    'time.google.com',
    'time.cloudflare.com',
    'a.ntp.br',          # NTP.br brasileiro
    'b.ntp.br',
]

# Offset em segundos entre relógio local e UTC real
_ntp_offset: float = 0.0
_synced: bool = False


def sync_ntp() -> bool:
    """
    Sincroniza com um servidor NTP e calcula o offset do relógio local.
    Retorna True se a sincronização foi bem-sucedida.
    """
    global _ntp_offset, _synced

    try:
        import ntplib
    except ImportError:
        logger.warning('ntplib não instalado — usando relógio local como UTC')
        _synced = False
        return False

    client = ntplib.NTPClient()

    for server in NTP_SERVERS:
        try:
            response = client.request(server, version=3, timeout=5)
            _ntp_offset = response.offset
            _synced = True

            utc_now = datetime.fromtimestamp(time.time() + _ntp_offset, tz=timezone.utc)
            logger.info(
                f'NTP sincronizado com {server} | '
                f'Offset: {_ntp_offset:+.3f}s | '
                f'UTC agora: {utc_now.strftime("%Y-%m-%dT%H:%M:%SZ")}'
            )
            return True
        except Exception as e:
            logger.debug(f'NTP {server} falhou: {e}')
            continue

    logger.warning('Nenhum servidor NTP respondeu — usando relógio local')
    _synced = False
    return False


def utc_now() -> datetime:
    """
    Retorna o horário UTC atual, corrigido pelo offset NTP se disponível.
    """
    ts = time.time() + _ntp_offset
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def utc_iso() -> str:
    """
    Retorna o horário UTC atual em formato ISO 8601.
    Ex: '2026-04-02T17:30:00Z'
    """
    return utc_now().strftime('%Y-%m-%dT%H:%M:%SZ')


def local_utc_offset_hours() -> float:
    """
    Retorna o offset UTC do fuso local em horas.
    Ex: -3.0 para America/Sao_Paulo (UTC-3)
    """
    local_offset = datetime.now(timezone.utc).astimezone().utcoffset()
    if local_offset is None:
        return 0.0
    return local_offset.total_seconds() / 3600


def local_iana_timezone() -> str:
    """
    Tenta descobrir o fuso horário IANA do sistema.
    Ex: 'America/Sao_Paulo'
    Fallback: 'UTC'
    """
    try:
        # Linux: lê /etc/timezone
        with open('/etc/timezone') as f:
            tz = f.read().strip()
            if tz:
                return tz
    except FileNotFoundError:
        pass

    try:
        # Linux alternativo: lê symlink /etc/localtime
        import os
        link = os.readlink('/etc/localtime')
        # /usr/share/zoneinfo/America/Sao_Paulo → America/Sao_Paulo
        if 'zoneinfo/' in link:
            return link.split('zoneinfo/')[-1]
    except (OSError, ValueError):
        pass

    return 'UTC'


def is_synced() -> bool:
    """Retorna True se a sincronização NTP foi bem-sucedida."""
    return _synced


def get_offset() -> float:
    """Retorna o offset NTP em segundos."""
    return _ntp_offset


def sync_from_server(server_iso: str) -> None:
    """
    Ajusta offset usando o horário UTC retornado pela API (serverTime do heartbeat).
    Usado como fallback quando NTP não está disponível.
    """
    global _ntp_offset, _synced

    if _synced:
        # NTP já sincronizou — não sobrescreve com menos precisão
        return

    try:
        server_dt = datetime.fromisoformat(server_iso.replace('Z', '+00:00'))
        local_utc = datetime.now(timezone.utc)
        diff = (server_dt - local_utc).total_seconds()
        if abs(diff) > 1:  # Só corrige se diferença > 1s
            _ntp_offset = diff
            logger.info(f'Offset ajustado via API: {diff:+.1f}s')
    except Exception as e:
        logger.debug(f'Falha ao sincronizar via serverTime: {e}')
