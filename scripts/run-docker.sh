#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export CERT_EXTRA_IPS="${CERT_EXTRA_IPS:-${LAN_IP:-}}"

echo "zalupa228local: docker compose up --build"
echo "  HTTP  http://localhost:3000"
echo "  HTTPS https://localhost:3443"
if [[ -n "${CERT_EXTRA_IPS:-}" ]]; then
  echo "  CERT_EXTRA_IPS=$CERT_EXTRA_IPS (добавлено в SAN сертификата)"
fi
echo ""

docker compose up --build
