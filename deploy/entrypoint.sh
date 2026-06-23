#!/bin/sh
set -e

# Replace placeholder tokens in the built plugin.js with runtime env values.
# This lets us build one image and configure it per environment via env_file,
# same pattern the backend uses.

PLUGIN_JS="/usr/share/nginx/html/plugin.js"

if [ -n "$API_BASE_URL" ]; then
  sed -i "s|__API_BASE_URL__|${API_BASE_URL}|g" "$PLUGIN_JS"
fi

exec nginx -g 'daemon off;'