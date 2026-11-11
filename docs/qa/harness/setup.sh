#!/usr/bin/env bash
# Zet een verse testdatabase op en start de app erop.
#   docs/qa/harness/setup.sh <databasemap> <poort>
# Vereist: pnpm install gedaan. NODE_USE_ENV_PROXY laat Node's fetch (CBS, Forms) de proxy van de omgeving gebruiken.
set -euo pipefail
DB="${1:?databasemap}"; PORT="${2:-3100}"
export NODE_USE_ENV_PROXY=1
export DATABASE_URL="pglite://$DB"
rm -rf "$DB"
pnpm exec tsx docs/qa/harness/seed.ts
pnpm exec tsx scripts/seed-demo.ts
pnpm exec next typegen >/dev/null 2>&1 || true
AUTH_DEV_BYPASS_EMAIL=j.deweert@ci-engineers.com AUTH_SECRET=qa-lokaal \
  nohup pnpm exec next dev -p "$PORT" > "$DB.server.log" 2>&1 &
echo "server-pid $!"
for i in $(seq 1 90); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" | grep -q "200"; then echo "klaar: http://localhost:$PORT"; exit 0; fi
  sleep 2
done
echo "server kwam niet op; zie $DB.server.log"; exit 1
