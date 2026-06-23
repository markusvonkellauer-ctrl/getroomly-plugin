#!/bin/sh
set -e

# Replace placeholder tokens in the built plugin.js with runtime env values.
# This lets us build one image and configure it per environment via env_file,
# same pattern the backend uses.

PLUGIN_JS="/usr/share/nginx/html/plugin.js"

if [ -z "$API_BASE_URL" ]; then
  echo "FATAL: API_BASE_URL is not set. Check your env_file." >&2
  exit 1
fi

# Escape sed special chars in the value (& and \)
ESCAPED=$(printf '%s' "$API_BASE_URL" | sed 's/[&\\/]/\\&/g')
sed -i "s|__API_BASE_URL__|${ESCAPED}|g" "$PLUGIN_JS"

exec nginx -g 'daemon off;'