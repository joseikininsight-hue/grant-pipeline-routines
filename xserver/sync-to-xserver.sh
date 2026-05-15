#!/bin/bash
# ローカル grant-pipeline/ → xserver:~/grant-pipeline/ 同期
set -e
cd "$(dirname "$0")"

echo "=== Sync local -> xserver ==="

# config.json + scripts/ + sync-to-xserver.sh のみ送る (data/queue/output/stats/logs はサーバ専用)
tar czf - \
  config.json \
  scripts \
  sync-to-xserver.sh \
  README.md 2>/dev/null \
  | ssh xserver "tar xzf - -C ~/grant-pipeline/"

echo "✅ sync done"
ssh xserver "ls ~/grant-pipeline/scripts/ ~/grant-pipeline/scripts/lib/ 2>/dev/null"
