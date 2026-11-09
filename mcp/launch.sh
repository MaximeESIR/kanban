#!/usr/bin/env bash
set -euo pipefail
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$script_dir/dist/server.js" ]]; then
  echo 'Atelier MCP : lancez npm ci --prefix mcp puis npm run build --prefix mcp dans le dépôt kanban.' >&2
  exit 1
fi
# Keep the client's working directory unchanged. No secret is passed in arguments.
exec node "$script_dir/dist/server.js"
