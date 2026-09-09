# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx vite build

FROM nginx:1.27-alpine AS runtime

# Replace dev index.html (which loads /src/main.tsx) with a production
# demo page that loads the built plugin.js. Visit "/" to confirm the
# plugin boots end-to-end against this host.
COPY <<'HTML' /usr/share/nginx/html/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/style.css" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GetRoomly Plugin — demo</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
      pre { background: #f4f4f5; padding: 1rem; border-radius: 6px; overflow: auto; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <h1>GetRoomly Plugin</h1>
    <p>Embed via:</p>
    <pre><code>&lt;script type="module" src="https://this-host/plugin.js"&gt;&lt;/script&gt;</code></pre>
    <div id="root"></div>
    <script type="module" src="/plugin.js"></script>
  </body>
</html>
HTML

COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;

  # Partners embed plugin.js cross-origin — CORS is required.
  add_header Access-Control-Allow-Origin "*" always;
  add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
  add_header Access-Control-Allow-Headers "Content-Type" always;
  add_header Access-Control-Max-Age "86400" always;

  if ($request_method = OPTIONS) {
    return 204;
  }

  location = /plugin.js {
    add_header Cache-Control "no-cache, must-revalidate" always;
    add_header Access-Control-Allow-Origin "*" always;
    try_files $uri =404;
  }

  location = /style.css {
    add_header Cache-Control "no-cache, must-revalidate" always;
    add_header Access-Control-Allow-Origin "*" always;
    try_files $uri =404;
  }

  # LGPL-3.0 attribution for heic-to (see src/lib/heic.ts) — served publicly
  # alongside plugin.js so it's genuinely distributed with the software, not
  # just sitting in a private repo.
  location = /THIRD-PARTY-NOTICES.txt {
    add_header Cache-Control "no-cache, must-revalidate" always;
    add_header Access-Control-Allow-Origin "*" always;
    try_files $uri =404;
  }

  location ~ \.(svg|png|ico)$ {
    add_header Cache-Control "public, max-age=86400" always;
    add_header Access-Control-Allow-Origin "*" always;
    try_files $uri =404;
  }

  # Lazily-imported code split off from plugin.js (e.g. the HEIC→JPEG
  # converter) — dynamic import() inside plugin.js resolves these relative
  # to its own URL, so they're fetched from this same host regardless of
  # which site embeds the widget. Filenames are content-hashed by the build
  # (vite.config.ts's chunkFileNames), so a changed file always gets a new
  # URL — safe to cache forever instead of the no-cache policy plugin.js
  # itself needs.
  location ^~ /chunks/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Access-Control-Allow-Origin "*" always;
    try_files $uri =404;
  }

  location = /health {
    access_log off;
    return 200 "ok\n";
    add_header Content-Type text/plain;
  }

  location = / {
    add_header Cache-Control "no-cache" always;
    try_files /index.html =404;
  }

  location / {
    return 404;
  }
}
NGINX

COPY --from=build /app/dist /usr/share/nginx/html
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]