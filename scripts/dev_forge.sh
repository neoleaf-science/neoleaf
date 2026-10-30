#!/usr/bin/env bash
# A real Forgejo or Gitea in Docker for testing NeoLeaf against the real thing (the fake server in tests/fake-github only imitates them).
#
#   scripts/dev_forge.sh up forgejo|gitea     start it (pulls the pinned image the first time), create two users and an OAuth2 application
#   scripts/dev_forge.sh down forgejo|gitea   stop it and delete its data
#   scripts/dev_forge.sh state forgejo|gitea  print the state file (address, test users, OAuth keys) as JSON
#
# Everything created here is test data for a throwaway local instance: the passwords are random, kept only in the state file
# (/tmp/neoleaf-forge-<kind>.json, mode 600), and nothing leaves 127.0.0.1. Needs Docker, curl and python3.
#
# Environment: NEOLEAF_PORT (default 3022): where the NeoLeaf under test will listen, used in the OAuth redirect address;
#              FORGE_TOKEN_TTL (seconds, default 3600): lifetime of the OAuth access token, to test the renewal without waiting an hour.
set -euo pipefail

# Pinned versions (released more than two weeks before they were pinned). Change them here only.
FORGEJO_IMAGE="codeberg.org/forgejo/forgejo:17.0.0"
GITEA_IMAGE="docker.gitea.com/gitea:28.0.0"

cmd="${1:-}"; kind="${2:-}"
case "$kind" in
  forgejo) image="$FORGEJO_IMAGE"; port=3031; prefix=FORGEJO; bin=forgejo ;;
  gitea)   image="$GITEA_IMAGE";   port=3032; prefix=GITEA;   bin=gitea ;;
  *) echo "usage: $0 up|down|state forgejo|gitea" >&2; exit 2 ;;
esac
name="neoleaf-test-$kind"
state="/tmp/neoleaf-forge-$kind.json"
data="/tmp/neoleaf-forge-$kind-data"
url="http://127.0.0.1:$port"
neoleaf_port="${NEOLEAF_PORT:-3022}"
ttl="${FORGE_TOKEN_TTL:-3600}"

rand() { openssl rand -hex 12; }

# the container writes its data as another user (root or git), so the files are removed from inside a container
wipe() {
  if [ -d "$data" ]; then
    docker run --rm -v "$data:/d" debian:bookworm-slim find /d -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "$data" 2>/dev/null || true
  fi
}

case "$cmd" in
  state) cat "$state"; exit 0 ;;
  down)
    docker rm -f "$name" >/dev/null 2>&1 || true
    wipe
    rm -f "$state"
    echo "$kind stopped and its data removed"
    exit 0 ;;
  up) ;;
  *) echo "usage: $0 up|down|state forgejo|gitea" >&2; exit 2 ;;
esac

docker rm -f "$name" >/dev/null 2>&1 || true
wipe
mkdir -p "$data"
docker run -d --name "$name" -p "127.0.0.1:$port:3000" -v "$data:/data" \
  -e "${prefix}__server__ROOT_URL=$url/" -e "${prefix}__server__DOMAIN=127.0.0.1" \
  -e "${prefix}__database__DB_TYPE=sqlite3" -e "${prefix}__security__INSTALL_LOCK=true" \
  -e "${prefix}__service__DISABLE_REGISTRATION=true" -e "${prefix}__mailer__ENABLED=false" \
  -e "${prefix}__oauth2__ACCESS_TOKEN_EXPIRATION_TIME=$ttl" -e "${prefix}__server__OFFLINE_MODE=true" \
  -e "${prefix}__log__LEVEL=Warn" \
  "$image" >/dev/null

echo "waiting for $kind at $url ..."
for _ in $(seq 1 120); do
  if curl -fsS -m 3 "$url/api/v1/version" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS -m 3 "$url/api/v1/version" >/dev/null

admin_pw="Aa1-$(rand)"; alice_pw="Aa1-$(rand)"
docker exec -u git "$name" "$bin" admin user create --admin --username forgeadmin --password "$admin_pw" --email forgeadmin@example.test --must-change-password=false >/dev/null
docker exec -u git "$name" "$bin" admin user create --username alice --password "$alice_pw" --email alice@example.test --must-change-password=false >/dev/null
bob_pw="Aa1-$(rand)"
docker exec -u git "$name" "$bin" admin user create --username bob --password "$bob_pw" --email bob@example.test --must-change-password=false >/dev/null

# the OAuth2 application NeoLeaf will use (created as the admin account; the redirect address is the one NeoLeaf gives this server)
redirect="http://127.0.0.1:$neoleaf_port/auth/callback/git-real"
app=$(curl -fsS -m 20 -u "forgeadmin:$admin_pw" -H 'Content-Type: application/json' \
  -d "{\"name\":\"NeoLeaf test\",\"redirect_uris\":[\"$redirect\"],\"confidential_client\":true}" \
  "$url/api/v1/user/applications/oauth2")

python3 - "$state" "$kind" "$url" "$image" "$admin_pw" "$alice_pw" "$redirect" "$app" "$bob_pw" <<'PY'
import json, os, sys
state, kind, url, image, admin_pw, alice_pw, redirect, app, bob_pw = sys.argv[1:10]
a = json.loads(app)
out = {
    "kind": kind, "url": url, "image": image, "redirect": redirect,
    "admin": {"login": "forgeadmin", "password": admin_pw},
    "alice": {"login": "alice", "password": alice_pw},
    "bob": {"login": "bob", "password": bob_pw},
    "client_id": a["client_id"], "client_secret": a["client_secret"],
}
fd = os.open(state, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(out, f)
PY
echo "$kind is up at $url (image $image); state in $state"
