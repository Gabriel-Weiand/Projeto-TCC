#!/bin/bash
# ─────────────────────────────────────────────────────
# Instalação do Agente de Servidor (HPC/Renderização)
# ─────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/opt/lab-server-agent"
VENV_DIR="$INSTALL_DIR/venv"
SERVICE_NAME="lab-server-agent"

echo "═══════════════════════════════════════════"
echo "  Instalação do Agente de Servidor"
echo "═══════════════════════════════════════════"

# Verifica root
if [ "$EUID" -ne 0 ]; then
    echo "ERRO: Execute como root (sudo ./install.sh)"
    exit 1
fi

# Dependências do sistema
echo "[1/5] Instalando dependências do sistema..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip openssh-server

# Copia arquivos
echo "[2/5] Copiando arquivos para $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR"/*.py "$INSTALL_DIR/"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"

# Copia .env se não existir
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
    echo "  → .env criado. EDITE antes de iniciar: $INSTALL_DIR/.env"
fi

# Cria venv e instala dependências
echo "[3/5] Configurando ambiente Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"

# Cria serviço systemd
echo "[4/5] Configurando serviço systemd..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=Lab Server Agent (HPC/Rendering)
After=network-online.target sshd.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$VENV_DIR/bin/python $INSTALL_DIR/main.py
Restart=always
RestartSec=10

# Segurança
ProtectHome=false
ProtectSystem=false

# O agente PRECISA de root para:
# - Gerenciar cgroups v2 (cpu.weight nos user slices)
# - Gerenciar authorized_keys em /home/*/.ssh/
User=root

# Logs
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "[5/5] Instalação concluída!"
echo ""
echo "  Próximos passos:"
echo "  1. Edite o .env:      nano $INSTALL_DIR/.env"
echo "  2. Configure MACHINE_TOKEN e verifique o MAC_ADDRESS"
echo "  3. Inicie o serviço:  systemctl start $SERVICE_NAME"
echo "  4. Verifique logs:    journalctl -u $SERVICE_NAME -f"
echo ""
