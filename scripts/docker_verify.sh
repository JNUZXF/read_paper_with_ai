#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="http://127.0.0.1:43117"

echo "[1/6] Health endpoint..."
curl -fsS "$BASE_URL/health" >/dev/null

echo "[2/6] Catalog sync endpoints..."
curl -fsS "$BASE_URL/v1/catalog/sync/status" >/dev/null
curl -fsS -X POST "$BASE_URL/v1/catalog/sync/trigger" >/dev/null

echo "[3/6] Provider create/list/delete..."
provider_create_json="$(mktemp)"
curl -fsS -X POST "$BASE_URL/v1/providers" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"docker-check-provider",
    "api_key":"sk-docker-health-123456",
    "base_url":"https://api.openai.com/v1",
    "model":"gpt-4o-mini",
    "is_default":false
  }' >"$provider_create_json"
provider_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$provider_create_json")"

provider_list_json="$(mktemp)"
curl -fsS "$BASE_URL/v1/providers" >"$provider_list_json"
python3 -c 'import json,sys; arr=json.load(open(sys.argv[1])); assert isinstance(arr,list) and len(arr)>=1' "$provider_list_json"
curl -fsS -X DELETE "$BASE_URL/v1/providers/$provider_id" >/dev/null

echo "[4/6] Non-stream paper analyze (mock)..."
pdf_file="$(find papers -type f -name '*.pdf' -print -quit)"
if [[ -z "$pdf_file" ]]; then
  echo "No PDF file found under papers/"
  exit 1
fi
non_stream_json="$(mktemp)"
curl -fsS -X POST "$BASE_URL/v1/papers/analyze" \
  -F 'options_json={"mock_mode":true,"angles":["主题","方法"]};type=application/json' \
  -F "file=@${pdf_file};type=application/pdf" >"$non_stream_json"
python3 -c 'import json,sys; obj=json.load(open(sys.argv[1])); assert obj.get("final_report")' "$non_stream_json"

echo "[5/6] Stream paper analyze sequential (mock)..."
seq_stream="$(curl -fsS -N -X POST "$BASE_URL/v1/papers/analyze/stream" \
  -F 'options_json={"mock_mode":true,"stream_mode":"sequential","angles":["主题","方法"]};type=application/json' \
  -F "file=@${pdf_file};type=application/pdf")"
printf "%s" "$seq_stream" | grep -q '"event": "final_done"'

echo "[6/6] Stream paper analyze parallel (mock)..."
par_stream="$(curl -fsS -N -X POST "$BASE_URL/v1/papers/analyze/stream" \
  -F 'options_json={"mock_mode":true,"stream_mode":"parallel","parallel_limit":2,"angles":["主题","方法"]};type=application/json' \
  -F "file=@${pdf_file};type=application/pdf")"
printf "%s" "$par_stream" | grep -q '"event": "final_done"'

echo "Docker deployment verification passed."
