#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"

echo "Smoke test: GET /health"
curl -sf "$API_URL/health" | grep -q '"status":"ok"'

echo "Smoke test: GET /chains"
curl -sf "$API_URL/chains" | grep -q '"chains"'

echo "Smoke test: POST /chat (SSE)"
curl -sf -N -X POST "$API_URL/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message":"latest block on base","chain":"base"}' \
  | head -n 10 | grep -q 'event:'

echo "All smoke tests passed."
