# GetRoomly Plugin

Drop-in JavaScript widget that lets your customers preview products in a photo of their own room. Built as an ES module loaded with a single `<script>` tag and mounted inside a shadow DOM so it can't conflict with your existing styles.

This is the embeddable artifact. The backend it talks to is [**GetRoomly Backend**](https://github.com/markusvonkellauer-ctrl/GetRoomly); the showcase demo is [**GetRoomly Frontend**](https://github.com/markusvonkellauer-ctrl/GetRoomly).

## 5-minute integration

```html
<script type="module" src="https://plugin.getroomly.ai/plugin.js"></script>

<div id="getroomly-mount"
     data-api-key="grm_pub_YOUR_KEY"
     data-backend-url="https://api.getroomly.ai"
     data-product-id="rug-12345"
     data-category="rugs"></div>
```

The plugin auto-mounts into any element with the data attributes above and renders inside a shadow DOM. See **Authentication** below before you ship.

## Authentication — read this first

You need two things from GetRoomly before you can use the plugin in production:

1. **A partner API key** (`grm_pub_...`) — issued by GetRoomly. Treat it like a public API key: it lives in your HTML, but the backend enforces per-domain origin checks so a leaked key can only be abused from approved origins.
2. **Your domain on the partner allowlist.** The backend rejects any request whose `Origin` header isn't on your partner record's `allowedOrigins`. Subdomains are covered automatically — if `example.com` is on the list, `shop.example.com` works too.

To get added, ping GetRoomly with your domain(s). For ops detail on the allowlist mechanism, see the backend README.

### Error semantics

The plugin surfaces backend errors to the host page via callbacks (or events — see the integration API below):

| Status | Code | What it means | What to do |
|---|---|---|---|
| 401 | `unauthorized` | Bad / missing API key | Check `data-api-key` |
| 403 | `forbidden` | Your origin isn't on the allowlist for this key | Contact GetRoomly to add your domain |
| 429 | `quotaExceeded` | Daily render cap exceeded for this partner | Resets at next UTC midnight; contact GetRoomly to raise the cap |
| 503 | `tooBusy` | Upstream model returned no image (often a content refusal) | Retry once or two times; if persistent, the specific (room photo + product) combo may need a different angle |

## CORS / cross-origin

The plugin is served with `Access-Control-Allow-Origin: *` so any partner site can embed it. The backend API itself uses a CORS allowlist — your domain must be there too, in addition to the per-partner `allowedOrigins`.

## Local development

### Prerequisites

- Node.js (LTS)

### Setup

```bash
git clone https://github.com/markusvonkellauer-ctrl/getroomly-plugin.git
cd getroomly-plugin
npm install
cp .env.example .env   # set VITE_BACKEND_URL and dev partner key
npm run dev
```

Demo page at [http://localhost:5173](http://localhost:5173).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR (root index.html loads the plugin entry) |
| `npm run build` | Library build → `dist/plugin.js` (ES module, ~525 KB) |
| `npm run preview` | Serve the built artifact locally |
| `npm run lint` | ESLint |

## Build modes

`vite.config.ts` runs in **library mode** with `src/shadow-entry.tsx` as the entry point. Output is a single ES-module file (`dist/plugin.js`) that is what partners ultimately load.

The production Docker image (see `Dockerfile`) wraps that artifact in nginx with:
- CORS headers (`Access-Control-Allow-Origin: *`) and an OPTIONS preflight short-circuit
- A demo `index.html` at `/` so you can sanity-check a deploy by opening the root URL
- A `/health` endpoint for container healthchecks

## Environment variables

Vite inlines `VITE_*` vars at build time:

| Var | Required | Notes |
|---|---|---|
| `VITE_BACKEND_URL` | yes | Where the plugin POSTs `/v1/generate` |
| `VITE_PARTNER_API_KEY` | dev only | Convenience for local dev; in production the host page provides the key via data-attribute |

## Architecture

Three pieces:

1. **Shadow-DOM mount** — the plugin attaches a shadow root inside the target element so its CSS doesn't bleed into (or get clobbered by) the host page's styles. See [GET-23](https://linear.app/getroomly/issue/GET-23).
2. **Room upload + click capture** — user uploads a room photo, clicks the point where they want the product placed. Coordinates are sent along with the product info.
3. **API call** — POST to `/v1/generate` with the room image, product image, click coordinates, and product metadata. The response is a WebP render that's drawn back into the shadow DOM.

⚠️ **Known issue**: the coordinate handoff has accuracy problems for non-trivial image / container sizes. See [GET-35](https://linear.app/getroomly/issue/GET-35) for the audit and planned fixes.

## Deploy

`main` push → auto-deploy to Hetzner via GitHub Actions:

1. Vite library build
2. Two-stage Docker image (Node 20-alpine build → nginx 1.27-alpine runtime), pushed to `ghcr.io/markusvonkellauer-ctrl/getroomly-plugin`
3. SCP deploy compose, pull, roll, health-check

Live CDN: [http://178.105.148.65:8081/plugin.js](http://178.105.148.65:8081/plugin.js).
Pipeline details: see [GET-33](https://linear.app/getroomly/issue/GET-33).

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari current + 1). Plugin ships as an ES module — no IE / legacy support.

Bundle size budget: keep `plugin.js` under ~600 KB minified. Currently ~525 KB.

## License

© 2026 GetRoomly. All rights reserved.