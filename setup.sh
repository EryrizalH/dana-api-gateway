#!/usr/bin/env bash
# =================================================================
# DANA Business Merchant Gateway - Automated Setup (VPS & cPanel)
# =================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "=========================================================="
echo "      DANA Business Merchant Gateway - Setup Helper        "
echo "=========================================================="
echo -e "${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js belum terinstall! Install Node.js v18.x (disarankan).${NC}"
    exit 1
fi

NODE_VER=$(node -v)
echo -e "[INFO] Versi Node.js terdeteksi: ${YELLOW}${NODE_VER}${NC}"

NODE_MAJOR=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -ge 20 ]; then
    echo -e "${YELLOW}[PERINGATAN] Node.js v20+ di cPanel Shared Hosting bisa OOM WebAssembly.${NC}"
    echo -e "${YELLOW}Disarankan Node.js 18.x jika pakai cPanel.${NC}\n"
fi

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "[INFO] Membuat file .env dari .env.example..."
        cp .env.example .env
        echo -e "${GREEN}[OK] File .env berhasil dibuat.${NC}"
    else
        cat <<EOT > .env
PORT=3000
API_KEY=cobadulu
QRIS_STATIC=
DANA_MERCHANT_ID=
EOT
        echo -e "${GREEN}[OK] File .env dibuat dengan konfigurasi default.${NC}"
    fi
else
    echo -e "[INFO] File .env sudah ada."
fi

echo -e "\n[INFO] Menginstall dependencies npm..."
npm install
echo -e "${GREEN}[OK] Dependencies berhasil diinstall.${NC}\n"

echo -e "=========================================================="
read -p "Apakah Anda ingin menjalankan login OTP DANA sekarang? (y/n): " RUN_LOGIN

if [[ "$RUN_LOGIN" =~ ^[Yy]$ ]]; then
    echo -e "\n[INFO] Menjalankan login.js..."
    node login.js
else
    echo -e "${YELLOW}[INFO] Login OTP kapan saja: node login.js${NC}"
fi

echo -e "\n${GREEN}=========================================================="
echo "                 SETUP SELESAI SUKSES!                    "
echo "=========================================================="
echo -e "${NC}"
echo "Petunjuk cPanel:"
echo "1. Setup Node.js App → Application Startup File: server.js"
echo "2. Node.js Version: 18.x"
echo "3. Restart aplikasi di cPanel."
echo "=========================================================="
