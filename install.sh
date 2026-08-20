#!/usr/bin/env sh
# PiChat installer — boots a machine with the PiChat pi config and `pichat` command.
#
# Usage: ./install.sh [--force] [--link-auth] [--rc] [--bin-dir <dir>] [--no-bin]
#
#   --force      replace an existing non-empty target directory (backs it up first)
#   --link-auth  symlink ~/.pi/pichat/auth.json -> ~/.pi/agent/auth.json to share
#                your existing pi credentials; skipped if no ~/.pi/agent/auth.json
#   --rc         append a `pichat` shell function to ~/.zshrc (or $PICHAT_RC_FILE)
#   --bin-dir    where to link the pichat command (default ~/.local/bin)
#   --no-bin     skip installing the pichat command
#
# Never writes, copies, or asks for credentials. If you don't --link-auth,
# run `/login` once inside the new harness.
set -eu

# --- defaults -------------------------------------------------------------
SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=${PI_PICHAT_DIR:-$HOME/.pi/pichat}
BIN_DIR=${XDG_BIN_HOME:-$HOME/.local/bin}
BIN_NAME=pichat
RC_FILE=${PICHAT_RC_FILE:-$HOME/.zshrc}

FORCE=0
LINK_AUTH=0
INSTALL_RC=0
INSTALL_BIN=1

# --- flags -----------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --link-auth) LINK_AUTH=1 ;;
    --rc) INSTALL_RC=1 ;;
    --no-bin) INSTALL_BIN=0 ;;
    --bin-dir)
      echo "install.sh: --bin-dir requires a value (use --bin-dir <dir>)" >&2
      exit 2
      ;;
    --bin-dir=*) BIN_DIR=${arg#--bin-dir=} ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "install.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# --- preflight -------------------------------------------------------------
if ! command -v pi >/dev/null 2>&1; then
  echo "install.sh: 'pi' not found on PATH. Install pi first (npm install -g --ignore-scripts @earendil-works/pi-coding-agent, or https://pi.dev/install.sh)." >&2
  exit 1
fi

if [ -e "$BIN_DIR/$BIN_NAME" ] && [ ! -L "$BIN_DIR/$BIN_NAME" ]; then
  echo "install.sh: $BIN_DIR/$BIN_NAME already exists and is not our symlink (back it up or remove it, or pass --bin-dir)." >&2
  exit 1
fi

# --- install the config directory -----------------------------------------
if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "install.sh: $TARGET already exists and is not empty. Pass --force to back it up and replace it." >&2
    exit 1
  fi
  backup="$TARGET.bak.$(date +%Y%m%d%H%M%S)"
  echo "install.sh: backing up existing target to $backup"
  mv "$TARGET" "$backup"
fi

if [ ! -d "$TARGET" ]; then
  # Prefer a real git clone so `pichat update` can pull in place.
  remote=$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || true)
  if [ -n "$remote" ]; then
    echo "install.sh: cloning $remote into $TARGET"
    git clone "$remote" "$TARGET"
  else
    # No remote (e.g. an uncommitted local checkout): copy tracked files only.
    echo "install.sh: no git remote, copying tracked files into $TARGET"
    mkdir -p "$TARGET"
    (cd "$SRC_DIR" && git archive HEAD 2>/dev/null | tar -x -C "$TARGET") \
      || cp -R "$SRC_DIR"/. "$TARGET" \
      || { echo "install.sh: copy into $TARGET failed" >&2; exit 1; }
  fi
fi

# --- credentials: optional auth sharing ------------------------------------
if [ "$LINK_AUTH" -eq 1 ] && [ -f "$HOME/.pi/agent/auth.json" ] && [ ! -e "$TARGET/auth.json" ]; then
  ln -s "$HOME/.pi/agent/auth.json" "$TARGET/auth.json"
  echo "install.sh: linked $TARGET/auth.json -> ~/.pi/agent/auth.json"
fi

# --- pichat command --------------------------------------------------------
chmod +x "$TARGET/bin/pichat"
if [ "$INSTALL_BIN" -eq 1 ]; then
  mkdir -p "$BIN_DIR"
  ln -sf "$TARGET/bin/pichat" "$BIN_DIR/$BIN_NAME"
  echo "install.sh: linked $BIN_DIR/$BIN_NAME -> $TARGET/bin/pichat"
  echo "             ensure $BIN_DIR is on your PATH (add it to ~/.zshrc if needed)"
fi

# --- optional interactive-shell shortcut ------------------------------------
if [ "$INSTALL_RC" -eq 1 ]; then
  if ! grep -q "^pichat()" "$RC_FILE" 2>/dev/null; then
    printf '\npichat() { command %s/%s "$@"; }\n' "$BIN_DIR" "$BIN_NAME" >> "$RC_FILE"
    echo "install.sh: added pichat() function to $RC_FILE"
  else
    echo "install.sh: pichat() already present in $RC_FILE"
  fi
fi

# --- smoke test --------------------------------------------------------------
echo "install.sh: verifying..."
PI_CODING_AGENT_DIR="$TARGET" pi --version

cat <<EOF

PiChat installed at $TARGET
Next steps:
  - Run: $BIN_DIR/$BIN_NAME   (or: pichat)
  - If you did not --link-auth, run  /login  inside the new harness once.
  - Install new state refreshes via: pichat update   (requires a git-clone install)
EOF
