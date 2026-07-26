#!/usr/bin/env bash
# Wrapper around scripts/electron-rc-integration.mjs that resolves the X11
# libraries libnut needs, prepends them to LD_LIBRARY_PATH, and runs the
# harness under xvfb-run so nut-js has a display to attach to.
#
# This is a Linux-only wrapper. On macOS / Windows the .mjs script can be
# run directly with `node scripts/electron-rc-integration.mjs` since nut-js
# links against system frameworks there.
set -euo pipefail

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "electron-rc-integration: xvfb-run not found on PATH." >&2
  echo "  Install xvfb (Debian/Ubuntu: apt-get install xvfb) or run the .mjs" >&2
  echo "  directly on a machine with a real display." >&2
  exit 2
fi

# Best-effort resolve of the X11 shared libs libnut needs. On NixOS-style
# hosts we use nix-build; on Debian/Ubuntu the loader finds them automatically
# so we skip this block.
X11_LIBS=""
if command -v nix-build >/dev/null 2>&1; then
  for pkg in xorg.libX11 xorg.libXtst xorg.libXext xorg.libXi xorg.libXinerama xorg.libXrandr; do
    if libdir="$(nix-build '<nixpkgs>' -A "$pkg" --no-out-link 2>/dev/null)/lib"; then
      X11_LIBS+="${libdir}:"
    fi
  done
fi

export LD_LIBRARY_PATH="${X11_LIBS}${LD_LIBRARY_PATH:-}"

cd "$(dirname "$0")/.."
exec xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/electron-rc-integration.mjs