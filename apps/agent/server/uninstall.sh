#!/bin/bash
# ─────────────────────────────────────────────────────
# Desinstalação do Agente de Servidor
# ─────────────────────────────────────────────────────
set -e

SERVICE_NAME="lab-server-agent"
INSTALL_DIR="/opt/lab-server-agent"

echo "═══════════════════════════════════════════"
echo "  Desinstalação do Agente de Servidor"
echo "═══════════════════════════════════════════"

if [ "$EUID" -ne 0 ]; then
    echo "ERRO: Execute como root (sudo ./uninstall.sh)"
    exit 1
fi

echo "[1/3] Parando serviço..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

echo "[2/3] Removendo arquivos..."
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo "[3/3] Removendo instalação..."
rm -rf "$INSTALL_DIR"

echo ""
echo "Desinstalação concluída."
echo "NOTA: O .env e chaves SSH NÃO foram preservados."
echo ""
