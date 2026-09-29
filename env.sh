# source this file: puts the project-local Node.js on PATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export PATH="$ROOT/.tools/node/bin:$PATH"
