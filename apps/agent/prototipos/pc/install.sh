#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║   Instalador do Agente de Monitoramento — Laboratórios      ║
# ╚══════════════════════════════════════════════════════════════╝
#
# Uso:
#   chmod +x install.sh
#   ./install.sh
#
# O que este script faz:
#   1. Instala dependências do sistema (python3-venv, python3-tk)
#   2. Cria ambiente virtual Python e instala pacotes
#   3. Copia .env.example → .env (se não existir)
#   4. Configura autostart no GNOME (copia .desktop para ~/.config/autostart/)
#   5. Imprime instruções de configuração

set -e

# ── Cores ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── Diretório do script ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DIR/lab-agent.desktop"

echo -e "${PURPLE}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Instalador do Agente de Monitoramento — Laboratórios      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Dependências do sistema ───────────────────────────────────
echo -e "${BLUE}[1/5]${NC} Verificando dependências do sistema..."

PACKAGES_NEEDED=""
if ! dpkg -l python3-venv &>/dev/null; then
    PACKAGES_NEEDED="$PACKAGES_NEEDED python3-venv"
fi
if ! dpkg -l python3-tk &>/dev/null; then
    PACKAGES_NEEDED="$PACKAGES_NEEDED python3-tk"
fi

if [ -n "$PACKAGES_NEEDED" ]; then
    echo -e "${YELLOW}Instalando pacotes do sistema:${NC}$PACKAGES_NEEDED"
    sudo apt update -qq
    sudo apt install -y -qq $PACKAGES_NEEDED
    echo -e "${GREEN}✓ Pacotes instalados${NC}"
else
    echo -e "${GREEN}✓ Dependências do sistema já instaladas${NC}"
fi

# ── 2. Ambiente virtual Python ───────────────────────────────────
echo -e "${BLUE}[2/5]${NC} Configurando ambiente virtual Python..."

if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo -e "${GREEN}✓ Ambiente virtual criado em $VENV_DIR${NC}"
else
    echo -e "${GREEN}✓ Ambiente virtual já existe${NC}"
fi

# Instala/atualiza dependências
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" -q
echo -e "${GREEN}✓ Dependências Python instaladas${NC}"

# Tenta instalar pynvml (GPU NVIDIA - opcional)
if "$VENV_DIR/bin/pip" install pynvml -q 2>/dev/null; then
    echo -e "${GREEN}✓ pynvml instalado (métricas de GPU NVIDIA)${NC}"
else
    echo -e "${YELLOW}⚠ pynvml não instalado (sem GPU NVIDIA detectada — ok)${NC}"
fi

# ── 3. Arquivo .env ──────────────────────────────────────────────
echo -e "${BLUE}[3/5]${NC} Verificando configuração (.env)..."

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo -e "${YELLOW}⚠ Arquivo .env criado a partir do template${NC}"
    echo -e "${YELLOW}  Você PRECISA editar o arquivo .env com seus dados!${NC}"
else
    echo -e "${GREEN}✓ Arquivo .env já existe${NC}"
fi

# ── 4. Autostart no GNOME ────────────────────────────────────────
echo -e "${BLUE}[4/5]${NC} Configurando autostart..."

mkdir -p "$AUTOSTART_DIR"

# Gera o .desktop com caminhos absolutos corretos
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Lab Agent - Sistema de Laboratórios
Comment=Agente de monitoramento e controle de acesso do laboratório
Exec=$VENV_DIR/bin/python $SCRIPT_DIR/main.py
Path=$SCRIPT_DIR
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
Terminal=false
Categories=System;
EOF

echo -e "${GREEN}✓ Autostart configurado em: $DESKTOP_FILE${NC}"

# ── 5. Resumo ────────────────────────────────────────────────────
echo -e "${BLUE}[5/5]${NC} Verificação final..."

echo ""
echo -e "${PURPLE}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ Instalação concluída!${NC}"
echo -e "${PURPLE}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}Próximos passos:${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} Edite o arquivo de configuração:"
echo -e "     ${BOLD}nano $SCRIPT_DIR/.env${NC}"
echo ""
echo -e "  ${YELLOW}2.${NC} Configure estas variáveis obrigatórias:"
echo ""
echo -e "     ${BOLD}SERVER_URL${NC}    = IP do servidor API na rede local"
echo -e "                    Ex: ${GREEN}http://192.168.1.100:3333${NC}"
echo ""
echo -e "     ${BOLD}MACHINE_TOKEN${NC} = Token gerado ao cadastrar esta máquina"
echo -e "                    (admin cria via painel web ou seed)"
echo ""
echo -e "  ${YELLOW}3.${NC} Para testar agora (sem reiniciar):"
echo -e "     ${BOLD}cd $SCRIPT_DIR${NC}"
echo -e "     ${BOLD}$VENV_DIR/bin/python main.py${NC}"
echo ""
echo -e "  ${YELLOW}4.${NC} O agente iniciará automaticamente no próximo login do Ubuntu."
echo ""
echo -e "  ${YELLOW}5.${NC} Para encerrar o agente durante testes:"
echo -e "     - Abra o ${BOLD}Monitor de Tarefas${NC} (gnome-system-monitor)"
echo -e "     - Encontre o processo ${BOLD}python${NC} e encerre-o"
echo -e "     - Ou no terminal: ${BOLD}pkill -f 'python.*main.py'${NC}"
echo ""
echo -e "${PURPLE}══════════════════════════════════════════════════════════════${NC}"
