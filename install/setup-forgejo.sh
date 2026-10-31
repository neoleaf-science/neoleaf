#!/usr/bin/env bash
# One-time setup of the bundled Forgejo (run it from the install folder that `neoleaf init` wrote):
#   - starts Forgejo and Caddy,
#   - creates the administrator account (random password, saved in forgejo-admin.txt, readable only by you),
#   - creates the OAuth application NeoLeaf signs in through and writes its keys into .env,
#   - restarts NeoLeaf so it picks them up.
# Safe to run again: it stops when the keys are already there.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "No .env here: run 'neoleaf init' first." >&2; exit 1; }

get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_var() { # set_var KEY VALUE: replaces the line KEY=... in .env or adds it
  local tmp; tmp=$(mktemp)
  grep -vE "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env; rm -f "$tmp"
}

[ "$(get COMPOSE_PROFILES)" = "forgejo" ] || { echo "This install does not use the bundled Forgejo (COMPOSE_PROFILES is not forgejo in .env)." >&2; exit 1; }
if [ -n "$(get GIT_CLIENT_ID)" ] && [ -n "$(get GIT_CLIENT_SECRET)" ]; then
  echo "Already set up (GIT_CLIENT_ID is in .env). Nothing to do."; exit 0
fi

public=$(get NEOLEAF_PUBLIC_URL); id=$(get GIT_PROVIDER_ID); id=${id:-git}
admin=$(get FORGE_ADMIN_USER); admin=${admin:-forgeadmin}
redirect="$public/auth/callback/$id"

echo "Starting Forgejo ..."
docker compose up -d forgejo caddy
for _ in $(seq 1 120); do
  docker compose exec -T forgejo curl -fsS -m 3 http://localhost:3000/api/healthz >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T forgejo curl -fsS -m 3 http://localhost:3000/api/healthz >/dev/null

# 12 random bytes as hex (no pipe into head: with pipefail the SIGPIPE of tr would stop the script)
pw="Aa1-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
if ! docker compose exec -T -u git forgejo forgejo admin user create --admin --username "$admin" --password "$pw" \
     --email "$admin@users.noreply.localhost" --must-change-password=false >/dev/null; then
  echo "Could not create the administrator '$admin' (it may already exist: remove the forgejo-data volume to start over)." >&2; exit 1
fi
( umask 077; printf 'Forgejo administrator\nlogin: %s\npassword: %s\nChange the password after the first sign-in and delete this file.\n' "$admin" "$pw" > forgejo-admin.txt )

app=$(docker compose exec -T forgejo curl -fsS -m 20 -u "$admin:$pw" -H 'Content-Type: application/json' \
  -d "{\"name\":\"NeoLeaf\",\"redirect_uris\":[\"$redirect\"],\"confidential_client\":true}" \
  http://localhost:3000/api/v1/user/applications/oauth2)
cid=$(printf '%s' "$app" | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')
csec=$(printf '%s' "$app" | sed -n 's/.*"client_secret":"\([^"]*\)".*/\1/p')
[ -n "$cid" ] && [ -n "$csec" ] || { echo "Forgejo did not return the OAuth keys." >&2; exit 1; }
set_var GIT_CLIENT_ID "$cid"
set_var GIT_CLIENT_SECRET "$csec"

echo "Starting NeoLeaf ..."
docker compose up -d --force-recreate neoleaf
echo
echo "Done. Open $public and sign in with the Forgejo account '$admin' (password in forgejo-admin.txt)."
echo "Next: in Forgejo ($(get FORGE_PUBLIC_URL)) add your users or connect your login system (Site administration, Authentication sources)."
