#!/usr/bin/env bash
# CASTE -> Hermes installation script.
# Clones the repo, installs deps, provisions the database, verifies the MCP server.
set -euo pipefail

REPO="${REPO:-https://github.com/castefeudal/caste.git}"
DIR="${DIR:-$HOME/caste}"

echo "==> 1/5 Clone"
git clone "$REPO" "$DIR" 2>/dev/null || (cd "$DIR" && git pull)

echo "==> 2/5 Install (pnpm required: npm i -g pnpm)"
cd "$DIR" && pnpm install

echo "==> 3/5 Database (Postgres 15 required; adjust credentials as needed)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='caste'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE caste"
DATABASE_URL="postgresql://caste:caste@localhost:5432/caste" pnpm --filter @caste/api exec drizzle-kit push --force

echo "==> 4/5 API (pick one)"
echo "    hosted:  https://caste-api-markovmade.zocomputer.io  (already running)"
echo "    local:   cd $DIR/apps/api && DATABASE_URL=... pnpm dev"

echo "==> 5/5 Verify MCP stdio handshake"
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' \
  | DATABASE_URL="postgresql://caste:caste@localhost:5432/caste" \
    CASTE_AGENT_TOKEN="${CASTE_AGENT_TOKEN:-}" \
    pnpm --filter @caste/mcp exec tsx src/index.ts | head -1 \
  && echo "OK: caste-mcp speaks JSON-RPC. Put the token into mcp.caste.json and load it into Hermes."
