#!/usr/bin/env bash
# Desinstalação do Agente de Monitoramento
# Remove autostart, venv e .env (com confirmação)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$HOME/.config/autostart/lab-agent.desktop"
VENV_DIR="$SCRIPT_DIR/venv"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=== Desinstalação do Lab Agent ==="
echo ""

confirm() {
    read -r -p "$1 [s/N] " resp
    case "$resp" in
        [sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# 1. Autostart
if [ -f "$DESKTOP_FILE" ]; then
    if confirm "Remover autostart ($DESKTOP_FILE)?"; then
        rm -f "$DESKTOP_FILE"
        echo "  ✓ Autostart removido."
    else
        echo "  — Autostart mantido."
    fi
else
    echo "  — Autostart não encontrado (já removido)."
fi

# 2. Venv
if [ -d "$VENV_DIR" ]; then
    if confirm "Remover ambiente virtual ($VENV_DIR)?"; then
        rm -rf "$VENV_DIR"
        echo "  ✓ Ambiente virtual removido."
    else
        echo "  — Ambiente virtual mantido."
    fi
else
    echo "  — Ambiente virtual não encontrado."
fi

# 3. .env
if [ -f "$ENV_FILE" ]; then
    if confirm "Remover configuração ($ENV_FILE)?"; then
        rm -f "$ENV_FILE"
        echo "  ✓ Configuração removida."
    else
        echo "  — Configuração mantida."
    fi
else
    echo "  — Arquivo .env não encontrado."
fi

echo ""
echo "Desinstalação concluída."
echo "Os arquivos de código-fonte foram mantidos."
