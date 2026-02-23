"""
Controle de bloqueio de tela no Linux (Ubuntu/GNOME).

Utiliza loginctl como método primário e gnome-screensaver como fallback.
"""

import subprocess
import logging

logger = logging.getLogger('agent.screen')


def lock_screen() -> bool:
    """Bloqueia a tela do usuário atual.

    Tenta loginctl primeiro; se falhar, usa gnome-screensaver como fallback.
    """
    # Método 1: loginctl (systemd - funciona na maioria das distros modernas)
    try:
        subprocess.run(
            ['loginctl', 'lock-session'],
            check=True,
            capture_output=True,
            timeout=5,
        )
        logger.info('Tela bloqueada via loginctl')
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Método 2: gnome-screensaver (GNOME clássico)
    try:
        subprocess.run(
            ['gnome-screensaver-command', '-l'],
            check=True,
            capture_output=True,
            timeout=5,
        )
        logger.info('Tela bloqueada via gnome-screensaver')
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Método 3: xdg-screensaver (genérico)
    try:
        subprocess.run(
            ['xdg-screensaver', 'lock'],
            check=True,
            capture_output=True,
            timeout=5,
        )
        logger.info('Tela bloqueada via xdg-screensaver')
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass

    logger.error('Não foi possível bloquear a tela (nenhum método disponível)')
    return False


def is_session_locked() -> bool:
    """Verifica se a sessão atual está bloqueada."""
    try:
        result = subprocess.run(
            ['loginctl', 'show-session', 'self', '-p', 'LockedHint'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return 'yes' in result.stdout.lower()
    except Exception:
        return False
