#!/usr/bin/env bash
set -euo pipefail

schema="packages/db/prisma/schema.prisma"

deploy_output=""
if ! deploy_output="$(npx prisma migrate deploy --schema "$schema" 2>&1)"; then
  echo "$deploy_output"
  if echo "$deploy_output" | grep -q "P3005"; then
    echo "Prisma migrate deploy reported a non-empty schema. Resetting local database to apply migrations."
    npx prisma migrate reset --force --skip-seed --schema "$schema"
    exit 0
  fi
  exit 1
fi

echo "$deploy_output"

if ! echo 'SELECT 1 FROM "AiAgent" LIMIT 1;' | npx prisma db execute --schema "$schema" --stdin >/dev/null 2>&1; then
  echo "AiAgent table missing after migrations. Resetting local database to ensure schema matches."
  npx prisma migrate reset --force --skip-seed --schema "$schema"
fi
