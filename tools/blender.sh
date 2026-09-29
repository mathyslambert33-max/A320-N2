#!/bin/sh
# Run a Blender Python script headless:  tools/blender.sh tools/blender/<module>/<script>.py [-- args...]
# Blender 5.2.2 LTS is installed in the project (.tools/blender/Blender.app).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$1"; shift
exec "$DIR/.tools/blender/Blender.app/Contents/MacOS/Blender" -b --factory-startup --python "$SCRIPT" "$@"
