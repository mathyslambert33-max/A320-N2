#!/bin/sh
# Run a Blender Python script headless:  tools/blender.sh tools/blender/<module>/<script>.py [-- args...]
# - macOS: Blender 5.2.2 LTS installed in the project (.tools/blender/Blender.app).
# - Linux / cloud containers (no Blender binary, blender.org downloads blocked): Blender as a Python module,
#   `pip install "bpy==4.5.*"` (Blender 4.5 LTS); the script then runs with python3.
# Scripts must work in both: read their own args after `--` and start with
# `bpy.ops.wm.read_factory_settings(use_empty=True)`; avoid APIs newer than Blender 4.5.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$1"; shift
APP="$DIR/.tools/blender/Blender.app/Contents/MacOS/Blender"
if [ -x "$APP" ]; then exec "$APP" -b --factory-startup --python "$SCRIPT" "$@"; fi
if command -v blender >/dev/null 2>&1; then exec blender -b --factory-startup --python "$SCRIPT" "$@"; fi
if python3 -c "import bpy" >/dev/null 2>&1; then exec python3 "$SCRIPT" "$@"; fi
echo "blender.sh: no Blender found (install the module with: pip install \"bpy==4.5.*\")" >&2
exit 1
