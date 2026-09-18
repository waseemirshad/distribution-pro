#!/usr/bin/env bash
# ==========================================================================
#  Distribution Pro - START.sh   (Linux / macOS)
#  Usage:  ./START.sh        (ya bash START.sh)
#  Zaroorat: Node.js 22.5+  -- koi npm install zaroori nahi.
# ==========================================================================
set -euo pipefail
cd "$(dirname "$0")"

export TZ="${TZ:-Asia/Karachi}"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [X] Node.js nahi mila. Node 22 LTS install karein: https://nodejs.org"
  echo ""
  exit 1
fi

echo ""
echo "  =========================================================="
echo "   DISTRIBUTION PRO  -  Wholesale / FMCG ERP"
echo "  =========================================================="
echo "   Node version : $(node -v)"
echo "   Port         : ${PORT}"
echo "   Data folder  : $(pwd)/data"
echo ""
echo "   Login:  admin / admin123       (Admin / Malik)"
echo "           manager / manager123   (Manager)"
echo "           counter / counter123   (Billing Counter)"
echo "           godown / godown123     (Godown Keeper)"
echo "           accounts / accounts123 (Accountant)"
echo ""
echo "   Browser: http://localhost:${PORT}   (network par: http://<is-machine-ka-IP>:${PORT})"
echo "  =========================================================="
echo ""

exec node --no-warnings server/index.js
