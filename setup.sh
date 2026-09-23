#!/usr/bin/env bash
# =================================================================
# QRIS Dynamic Gateway - Automated Setup (VPS & cPanel)
# =================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "=========================================================="
echo "          QRIS Dynamic Gateway - Setup Helper             "
echo "=========================================================="
echo -e "${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js belum terinstall! Install Node.js v18.x+.${NC}"
    exit 1
fi

NODE_VER=$(node -v)
echo -e "[INFO] Versi Node.js terdeteksi: ${YELLOW}${NODE_VER}${NC}"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "[INFO] Membuat file .env dari .env.example..."
        cp .env.example .env
        echo -e "${GREEN}[OK] File .env berhasil dibuat.${NC}"
    else
        cat <<EOT > .env
PORT=3000
API_KEY=secret_api_key
QRIS_STATIC=
EOT
        echo -e "${GREEN}[OK] File .env dibuat dengan konfigurasi default.${NC}"
    fi
else
    echo -e "[INFO] File .env sudah ada."
fi

echo -e "\n[INFO] Menginstall dependencies npm..."
npm install
echo -e "${GREEN}[OK] Dependencies berhasil diinstall.${NC}\n"

echo -e "\n${GREEN}=========================================================="
echo "                 SETUP SELESAI SUKSES!                    "
echo "=========================================================="
echo -e "${NC}"
echo "Jalankan selfcheck: npm test"
echo "Jalankan aplikasi : npm start (atau npm run dev)"
echo "=========================================================="
