#!/bin/sh
# Installer for the NeoLeaf local agent (Linux x86_64 and macOS, no sudo).
#
#   curl -fsSL __SITE__/install.sh | sh
#
# What it does: downloads the agent from __SITE__, checks the SHA-256 published in version.json, copies it to
# ~/.local/bin/neoleaf-agent and registers a service for your user (systemd --user on Linux, LaunchAgent on macOS). Nothing is installed
# outside your home folder. To see what it does before running it: curl -fsSL __SITE__/install.sh | less
set -eu

SITE="${NEOLEAF_SITE:-__SITE__}"
SITE="${SITE%/}"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os="$(uname -s)"
case "$os" in
  Linux)
    asset="neoleaf-agent-linux-x86_64"; hashkey="sha256"
    case "$(uname -m)" in
      x86_64 | amd64) ;;
      *) die "on Linux only an x86_64 binary is available (this machine is $(uname -m))." ;;
    esac ;;
  Darwin)
    asset="neoleaf-agent-macos-universal"; hashkey="sha256_macos" ;;
  *) die "the agent only exists for Linux and macOS (this system is $os)." ;;
esac
[ "$(id -u)" != "0" ] || die "do not run as root: the agent is installed for your user, without sudo."

if have curl; then
  fetch() { curl -fsSL --retry 3 "$1" -o "$2"; }
elif have wget; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "curl or wget is required."
fi

hash_of() {
  if have sha256sum; then
    sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "sha256sum (or shasum) is required to verify the download."
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading the NeoLeaf agent from $SITE ..."
fetch "$SITE/static/agent/version.json" "$tmp/version.json" || die "could not download $SITE/static/agent/version.json"
expected="$(sed -n 's/.*"'"$hashkey"'" *: *"\([0-9a-fA-F]\{64\}\)".*/\1/p' "$tmp/version.json" | head -n 1 | tr 'A-F' 'a-f')"
version="$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$tmp/version.json" | head -n 1)"
[ -n "$expected" ] || die "could not find the SHA-256 in version.json: I will not install without being able to verify."

fetch "$SITE/static/agent/$asset" "$tmp/neoleaf-agent" || die "could not download the agent."
actual="$(hash_of "$tmp/neoleaf-agent")"
[ "$actual" = "$expected" ] || die "the SHA-256 of the downloaded file does not match the published one. Nothing was installed."
chmod +x "$tmp/neoleaf-agent"
# macOS (Apple Silicon) only runs signed binaries: ad hoc, local signature, no developer account
if [ "$os" = "Darwin" ]; then codesign --force --sign - "$tmp/neoleaf-agent" >/dev/null 2>&1 || true; fi
say "Agent ${version:-?} downloaded and verified (SHA-256)."

bin="$HOME/.local/bin/neoleaf-agent"
if ! "$tmp/neoleaf-agent" install; then
  say ""
  say "The agent was copied to $bin, but the service could not be registered (is the user service manager unavailable?)."
  say "You can run it by hand, in a terminal that stays open:"
  say "  $bin"
  exit 1
fi

# No LaTeX compiler on the machine? Offers to install TinyTeX (asks on the terminal, even when the script comes through a pipe).
if "$bin" engines 2>/dev/null | grep -q "Nenhum compilador\|No compiler"; then
  say ""
  say "This machine does not have a LaTeX compiler yet (TeX Live, TinyTeX or Tectonic)."
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf 'Install TinyTeX now? [y/N] ' > /dev/tty
    answer=""
    read -r answer < /dev/tty || answer=""
    case "$answer" in
      y | Y | yes) "$bin" install-tinytex --yes < /dev/tty || say "The TinyTeX installation failed; try again later: $bin install-tinytex" ;;
      *) say "All right. Whenever you want: $bin install-tinytex" ;;
    esac
  else
    say "To install TinyTeX: $bin install-tinytex"
  fi
fi

say ""
say "Done. Open a project in NeoLeaf and choose the \"Local\" engine in the compile selector."
say "On the first compilation the browser asks for the pairing code (the agent also shows it in a notification)."
say "To generate a code now: $bin code"
