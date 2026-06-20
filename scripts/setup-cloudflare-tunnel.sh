#!/usr/bin/env bash
# Provision Cloudflare Zero Trust tunnel + DNS for pokt.metalift.ai
# Requires API token with: Account Cloudflare Tunnel Edit, Zone DNS Edit
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID"
  exit 1
fi

# shellcheck disable=SC1091
set -a && source .env && set +a

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID required}"

HOSTNAME="${CLOUDFLARE_APP_HOSTNAME:-pokt.metalift.ai}"
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-pokt-mcp-metalift}"
APP_SERVICE="${CLOUDFLARE_APP_SERVICE:-http://web:5000}"
API="https://api.cloudflare.com/client/v4"

auth_header=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

echo "==> Resolving Cloudflare account ID..."
ZONE_JSON=$(curl -sS "${API}/zones/${CLOUDFLARE_ZONE_ID}" "${auth_header[@]}")
ACCOUNT_ID=$(echo "$ZONE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('account',{}).get('id',''))")
ZONE_NAME=$(echo "$ZONE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('name',''))")

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Failed to read account ID from zone. Check CLOUDFLARE_ZONE_ID and token Zone:Read permission."
  exit 1
fi

echo "    Zone: ${ZONE_NAME}  Account: ${ACCOUNT_ID}"

TUNNEL_ID="${CLOUDFLARE_TUNNEL_ID:-}"

if [[ -z "$TUNNEL_ID" ]]; then
  echo "==> Creating Cloudflare Tunnel '${TUNNEL_NAME}'..."
  CREATE=$(curl -sS -X POST "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel" \
    "${auth_header[@]}" \
    -d "{\"name\":\"${TUNNEL_NAME}\",\"config_src\":\"cloudflare\"}")

  SUCCESS=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))")
  if [[ "$SUCCESS" != "True" ]]; then
    echo "Failed to create tunnel via API:"
    echo "$CREATE" | python3 -m json.tool
    echo ""
    echo "Your API token likely needs: Account → Cloudflare Tunnel → Edit"
    echo "Create a tunnel manually in Zero Trust dashboard, then set in .env:"
    echo "  CLOUDFLARE_TUNNEL_ID=<uuid>"
    echo "  CLOUDFLARE_TUNNEL_TOKEN=<token from dashboard>"
    echo "Re-run this script to configure ingress + DNS only."
    exit 1
  fi

  TUNNEL_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  TUNNEL_TOKEN=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('token',''))")
  echo "    Tunnel ID: ${TUNNEL_ID}"
else
  echo "==> Using existing tunnel ID: ${TUNNEL_ID}"
  TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
  if [[ -z "$TUNNEL_TOKEN" ]]; then
    echo "==> Fetching tunnel token..."
    TOKEN_RESP=$(curl -sS "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token" "${auth_header[@]}")
    TUNNEL_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))" 2>/dev/null || true)
  fi
fi

echo "==> Configuring tunnel ingress (${HOSTNAME} -> ${APP_SERVICE})..."
INGRESS=$(cat <<EOF
{
  "config": {
    "ingress": [
      {
        "hostname": "${HOSTNAME}",
        "service": "${APP_SERVICE}",
        "originRequest": {
          "connectTimeout": "30s",
          "keepAliveTimeout": "120s",
          "noHappyEyeballs": true
        }
      },
      {
        "service": "http_status:404"
      }
    ]
  }
}
EOF
)

CFG=$(curl -sS -X PUT "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  "${auth_header[@]}" \
  -d "$INGRESS")

echo "$CFG" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" || {
  echo "Failed to set tunnel configuration:"
  echo "$CFG" | python3 -m json.tool
  exit 1
}

ensure_dns() {
  local name="$1"
  echo "==> Ensuring DNS CNAME ${name} -> ${CNAME_TARGET}..."
  local EXISTING
  EXISTING=$(curl -sS "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${name}" "${auth_header[@]}")
  local RECORD_ID RECORD_TYPE
  RECORD_ID=$(echo "$EXISTING" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',[]); print(r[0]['id'] if r else '')")
  RECORD_TYPE=$(echo "$EXISTING" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',[]); print(r[0]['type'] if r else '')")

  if [[ -n "$RECORD_ID" && "$RECORD_TYPE" != "CNAME" ]]; then
    echo "    Removing existing ${RECORD_TYPE} record for ${name}..."
    curl -sS -X DELETE "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" "${auth_header[@]}" >/dev/null
    RECORD_ID=""
  fi

  if [[ -n "$RECORD_ID" ]]; then
    curl -sS -X PATCH "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
      "${auth_header[@]}" \
      -d "{\"type\":\"CNAME\",\"name\":\"${name}\",\"content\":\"${CNAME_TARGET}\",\"proxied\":true}" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('Updated DNS' if d.get('success') else d)"
  else
    curl -sS -X POST "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
      "${auth_header[@]}" \
      -d "{\"type\":\"CNAME\",\"name\":\"${name}\",\"content\":\"${CNAME_TARGET}\",\"proxied\":true}" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created DNS' if d.get('success') else d)"
  fi
}

CNAME_TARGET="${TUNNEL_ID}.cfargotunnel.com"
ensure_dns "${HOSTNAME}"

if [[ -z "${TUNNEL_TOKEN}" ]]; then
  echo "==> Fetching tunnel run token..."
  TOKEN_RESP=$(curl -sS "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token" "${auth_header[@]}")
  TUNNEL_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))")
fi

if [[ -z "${TUNNEL_TOKEN}" ]]; then
  echo "Could not obtain tunnel token. Copy from Zero Trust → Networks → Tunnels → ${TUNNEL_NAME}"
  exit 1
fi

echo "==> Updating .env..."
touch .env
grep -v '^CLOUDFLARE_TUNNEL_ID=' .env | grep -v '^CLOUDFLARE_TUNNEL_TOKEN=' | grep -v '^CLOUDFLARE_ACCOUNT_ID=' | grep -v '^CLOUDFLARE_APP_HOSTNAME=' | grep -v '^PUBLIC_APP_URL=' > .env.tmp || true
mv .env.tmp .env
if ! grep -q '^INTERNAL_API_KEY=.' .env 2>/dev/null; then
  echo "==> Generating INTERNAL_API_KEY..."
  echo "INTERNAL_API_KEY=$(openssl rand -hex 32)" >> .env
fi
if ! grep -q '^SESSION_SIGNING_SECRET=.' .env 2>/dev/null; then
  echo "==> Generating SESSION_SIGNING_SECRET..."
  echo "SESSION_SIGNING_SECRET=$(openssl rand -hex 32)" >> .env
fi
{
  echo "CLOUDFLARE_ACCOUNT_ID=${ACCOUNT_ID}"
  echo "CLOUDFLARE_TUNNEL_ID=${TUNNEL_ID}"
  echo "CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}"
  echo "CLOUDFLARE_APP_HOSTNAME=${HOSTNAME}"
  echo "PUBLIC_APP_URL=https://${HOSTNAME}"
} >> .env

echo ""
echo "Done."
echo "  App:    https://${HOSTNAME}"
echo "  API:    https://${HOSTNAME}/api (proxied via Next.js)"
echo ""
echo "Start production stack:"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
