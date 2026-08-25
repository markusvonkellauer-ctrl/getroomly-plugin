# GetRoomly Plugin

Drop-in JavaScript widget that lets your customers preview products in a photo of their own room. Built as an ES module loaded with a single `<script>` tag and mounted inside a shadow DOM so it can't conflict with your existing styles.

This is the embeddable artifact. The backend it talks to is [**GetRoomly Backend**](https://github.com/markusvonkellauer-ctrl/GetRoomly-Backend); the showcase demo is [**GetRoomly Frontend**](https://github.com/markusvonkellauer-ctrl/GetRoomly).

## Production endpoints

| What | URL |
|---|---|
| Plugin bundle | `https://plugin.getroomly.ai/plugin.js` |
| Stylesheet (optional) | `https://plugin.getroomly.ai/style.css` |
| Backend API | `https://api.getroomly.ai` — the plugin POSTs `/v1/generate` |

You never configure the backend URL: it is baked into the bundle you load. You only ever set `apiKey` and the product fields.

## 5-minute integration

### Minimum required (6 fields)

```html
<!-- 1. Add a mount container anywhere on the page -->
<div id="getroomly-plugin-container"></div>

<!-- 2. Configure before the script tag runs -->
<script>
  window.GetRoomlyEmbedConfig = {
    apiKey:       'grm_pub_YOUR_KEY',                         // from GetRoomly
    productImage: 'https://cdn.example.com/products/sofa-12345.jpg',
    sku:          'sofa-12345',
    productName:  'Modular sofa',
    category:     'sofas',                                    // see "category" notes below
    measurements: { width: 220, depth: 95, height: 80 },      // cm
  };
</script>

<!-- 3. Load the plugin (auto-mounts when DOM is ready) -->
<script type="module" src="https://plugin.getroomly.ai/plugin.js"></script>
```

If any required field is missing, the mount container renders a clear init-time error (`"Partner API key is required in GetRoomlyEmbedConfig.apiKey"`, etc.) and the modal never opens. Validation happens in `src/hooks/use-embed-config.ts`.

**Order matters.** `window.GetRoomlyEmbedConfig` must be assigned *before* `plugin.js` executes. The script is an ES module, so it is deferred by default and normally runs after inline scripts earlier in the document — but if you inject the script tag dynamically, or load the config asynchronously, set the config first and only then append the script. There is no "config arrived late" retry beyond the `getroomly-open-modal` re-read described below.

### Before you go live, you need

1. **A partner API key** (`grm_pub_...`) from GetRoomly.
2. **Your domain allowlisted** on the backend — see [Authentication](#authentication--read-this-first). Without this every render returns `403 forbidden`.
3. **CORS on your product-image CDN** — see [What the plugin fetches](#what-the-plugin-fetches). This is the most common cause of a working-looking install that fails at generation time.

### Verify the install

1. Load the page — you should see the trigger button inside `#getroomly-plugin-container`. If you see an error message there instead, a required config field is missing.
2. Open the browser console and confirm there is no `Failed to fetch product image` error.
3. Click through a real generation with a room photo. A successful run POSTs once to `https://api.getroomly.ai/v1/generate` and returns a render.
4. If it fails, listen for `getroomly-error` — the plugin deliberately shows nothing itself. See [Error handling](#error-handling).

### With common optional fields

```html
<script>
  window.GetRoomlyEmbedConfig = {
    // required
    apiKey:       'grm_pub_YOUR_KEY',
    productImage: 'https://cdn.example.com/products/sofa-12345.jpg',
    sku:          'sofa-12345',
    productName:  'Modular sofa',
    category:     'sofas',
    measurements: { width: 220, depth: 95, height: 80 },

    // optional UI
    productPrice: 89900,                                      // price in cents
    language:     'en',                                       // 'en' | 'sv'
    buttonText:   'See it in your room',
    hideButton:   false,                                      // hide built-in trigger
    showSteps:    false,                                      // step progress bar
    styling:      { buttonColor: '#0d9488', borderRadius: '8px' },
    isFavorite:   false,

    // optional in-modal action toggles (all default true)
    buttons: { addToBasket: true, favorite: true, feedback: true, showOriginal: true, saveShare: true },

    // optional callbacks (alternative to listening for events)
    callbacks: {
      onModalOpen:      () => {},
      onImageGenerated: (imageUrl) => {},
      onError:          (err) => console.error(err),
    },
  };
</script>
```

The plugin renders a trigger button inside `#getroomly-plugin-container`. Clicking it opens a modal with a three-step flow: **upload** a room photo → **processing** → **result**. The generated render is returned as a data URL and drawn back into the shadow DOM. On the result screen the user can pinch-to-zoom the render (1×–4×, touch only); the zoom resets whenever a new image is generated.

> **Error display is your responsibility.** On any failure the plugin resets silently to the upload step and shows nothing to the user. You must handle the `getroomly-error` event or the `onError` callback to tell the customer what happened. See [Error handling](#error-handling).

### What the modal does to your page

The widget is style-isolated in a shadow root, but it is *not* completely inert on the host page. Two things reach outside it:

- **Scroll lock.** While the modal is open the plugin sets `document.body.style.overflow = 'hidden'` and restores it (to `''`, not to your previous value) on close or unmount. This stops iOS rubber-band scrolling from moving the fixed modal. If your page sets `body { overflow }` itself, or you run your own scroll-lock for a header/drawer, expect to have it cleared after the modal closes.
- **A document-level click listener** for Mode B analytics — see [Analytics](#analytics). It is passive and only reads `data-getroomly-sku` attributes.

The modal is fixed-position at `z-index: 50`, capped at `520px` wide and `80dvh` tall, with the backdrop set to `touch-action: none`.

### Terms & privacy dialog

The modal contains a user-openable terms dialog covering image processing, data retention and ownership, in both supported languages (`src/lib/i18n.ts`). It currently states that the uploaded photo and the generated visualisation are **retained in the EU/EEA for up to 14 days** for quality review — including for refused generations — linked only to a session reference, never used to train models, then deleted automatically.

This is partner-facing legal copy that ships inside the bundle. If your own privacy policy describes what happens to customer uploads, keep the two consistent, and re-check this section when you upgrade the plugin.

See **Authentication** below before going to production.

## Authentication — read this first

You need two things from GetRoomly before going live:

1. **A partner API key** (`grm_pub_...`) — set as `window.GetRoomlyEmbedConfig.apiKey`, sent to the backend as the `X-API-Key` header. Treat it like a public API key: it lives in your HTML, but the backend enforces per-domain origin checks so a leaked key can only be abused from approved origins.
2. **Your domain on two allowlists.** Your partner record's `allowedOrigins` (a mismatch, or a missing `Origin` header, returns `403 forbidden`) *and* the backend's global `CORS_ALLOWED_ORIGINS`. Subdomains are covered automatically on both — if `example.com` is listed, `shop.example.com` works. Matching is hostname-only: scheme and port are ignored, and entries are bare hosts with no `*.` wildcards.

To get added, contact GetRoomly with the list of domains you'll embed from.

## Error handling

The plugin never renders an error state of its own. When generation or file validation fails it clears the uploaded photo, returns to step 1, and hands the error to the host page through **both** channels:

- the `getroomly-error` window event, with `detail: { error, productId, sessionId }`
- the `callbacks.onError(error)` function, if configured

```js
window.addEventListener('getroomly-error', (e) => {
  const { error, sessionId } = e.detail;
  showYourToast(error);
  console.error('GetRoomly failed', { error, sessionId }); // sessionId is the backend trace ID
});
```

`sessionId` is generated once per plugin instance and sent on every `/v1/generate` call, where the backend indexes it in `RenderLog`. Include it in support requests.

### Backend error codes

For non-2xx responses the plugin surfaces the backend's `code` and `description` verbatim (`src/services/ai-generation.ts`). Codes are lowerCamelCase:

| Status | Code | What it means | What to do |
|---|---|---|---|
| 400 | `badParams` | Request body failed validation | Check `measurements` are numbers and images resolved |
| 401 | `unauthorized` | Missing `X-API-Key`, or the key matches no partner | Check `GetRoomlyEmbedConfig.apiKey` |
| 403 | `forbidden` | Your `Origin` isn't on the partner allowlist, no `Origin` was sent, **or** your partner record is suspended (including quota suspension — see below) | Contact GetRoomly to add your domain or lift the suspension |
| 413 | `entityTooLarge` | Request body over the 20 MB limit | Shouldn't happen — the plugin compresses to 1600px first |
| 422 | `generationFailed` | The model returned no image after 3 attempts, often a content refusal | Retry once or twice; if persistent, that room-photo/product combination may need a different angle |
| 429 | `quotaExceeded` | Daily render cap reached | See quota note below |
| 500 | `unknownError` | Unhandled backend error | Report with the `sessionId` |

Client-side codes raised by the plugin itself, before or after the network call:

| Code | Meaning |
|---|---|
| `NO_API_KEY` | No `apiKey` in config and no dev-time fallback |
| `NO_PRODUCT_IMAGE` | `productImage` was empty at request time |
| `INVALID_RESPONSE` | Backend returned 200 but no `image.data` |
| `BACKEND_ERROR` | Backend returned an error without a `code` field |

### Quota: you'll see 403 more often than 429

The daily cap (100 renders unless your partner record says otherwise) is counted per UTC calendar day, so it resets at UTC midnight. But crossing the cap **suspends the partner record**, which means:

- only the single request that crosses the cap returns `429 quotaExceeded`
- every subsequent request returns `403 forbidden` until the first request after UTC rollover un-suspends you

So don't treat 403 as exclusively an allowlist problem — if it starts mid-day after normal traffic, you're most likely quota-suspended. The counter increments before the cap check, so blocked attempts count too.

## Configuration: `window.GetRoomlyEmbedConfig`

Full shape defined in `src/types/embed-config.ts`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `apiKey` | `string` | **yes** | `grm_pub_...`. Issued via the backend `CreatePartner` tool. The published plugin bundle ships with no fallback key — every host page must provide one. |
| `productImage` | `string` | **yes** | Public URL (or data URL) of the product image |
| `sku` | `string` | **yes** | Product SKU / ID |
| `productName` | `string` | **yes** | Display name shown in the modal |
| `category` | `string` | **yes** | Free-form. The backend uses it to pick the render prompt — `carpets` (or any string containing `carpet`) triggers the carpet-replacement path; small-accessory tokens (`lamp`, `vase`, `decor`, `lighting`, `candle`, `plant`, `pot`, `bowl`, `accessory`) get size-aware copy; everything else (`sofas`, `chairs`, `tables`, `beds`, custom taxonomies, ...) goes through the general furniture prompt |
| `measurements` | `{ width, depth, height }` | **yes** | Product dimensions in cm — all three must be numbers or init fails |
| `productPrice` | `number` | no | Price in cents. Forwarded in cart events only; not shown in the modal. |
| `language` | `'en' \| 'sv'` | no | UI language. If omitted, detected from the page's TLD (`.se` → `sv`, otherwise `en`). |
| `showSteps` | `boolean` | no | Show the step progress indicator (default `false`) |
| `hideButton` | `boolean` | no | Hide the built-in trigger button (use when you control opening via `window.GetRoomly.open()`) |
| `isFavorite` | `boolean` | no | Initial favorite/wishlist state (default `false`) |
| `buttonText` | `string` | no | Override the trigger button label |
| `buttons` | `object` | no | Toggle in-modal action buttons individually (see below) |
| `styling` | `object` | no | `buttonColor`, `buttonTextColor`, `borderRadius` — applies to the trigger button only |
| `callbacks` | `object` | no | Function callbacks for plugin events (see below) |

### Config is re-read on every open

The shadow-DOM root is created once per page load, but the plugin re-reads `window.GetRoomlyEmbedConfig` on every `getroomly-open-modal` event. On a listing page you can mutate the global between opens (different product, newly picked size) and the modal will pick up the change — no remount needed.

### `buttons` — toggle in-modal actions

```js
buttons: {
  addToBasket:  true,   // default
  favorite:     true,   // heart / wishlist
  feedback:     true,   // thumbs up/down
  showOriginal: true,
  saveShare:    true,
}
```

Only an explicit `false` hides a button.

### `styling` — light theming

```js
styling: {
  buttonColor:     '#0d9488',   // default '#000'
  buttonTextColor: '#ffffff',   // default '#fff'
  borderRadius:    '8px',       // default '0'
}
```

## JavaScript control API: `window.GetRoomly`

Once the plugin script loads it attaches a global with four methods:

```js
window.GetRoomly.open();   // mount if needed, then open the modal
window.GetRoomly.close();  // close the modal
window.GetRoomly.isOpen(); // -> boolean, see caveat below
window.GetRoomly.init();   // mount the plugin if the container exists (idempotent)
```

Useful when you want to trigger the plugin from your own button. Pair with `hideButton: true` to hide the built-in trigger.

> ⚠️ `isOpen()` only tracks calls made through this API. If the user closes the modal with the X button or by clicking the backdrop, `isOpen()` keeps returning `true`. Listen for `getroomly-modal-closed` if you need reliable state.

## Listening to events

The plugin dispatches `CustomEvent`s on `window`. The host page can listen and react.

### Events dispatched by the plugin

| Event | `detail` payload | When |
|---|---|---|
| `getroomly-error` | `{ error, productId, sessionId }` | Generation or file validation failed. **The plugin shows no error UI — handle this.** |
| `getroomly-modal-closed` | — | Modal closed, by any means (X button, backdrop, or `GetRoomly.close()`) |
| `getroomly-close-modal` | — | Only when `GetRoomly.close()` is called (it is both dispatched and listened for) |
| `getroomly-open-modal` | — | Only when `GetRoomly.open()` is called — **not** when the built-in button is clicked |
| `getroomly-add-to-cart` | `{ productId, imageUrl, productName, productPrice, product: { id, name, price, category } }` | User clicks "Add to cart" in the modal |
| `getroomly-add-to-wishlist` | `{ productId, isFavorite, isCurrentlyWishlisted, imageUrl }` | User clicks the heart/wishlist button |
| `getroomly-like` | `{ imageUrl, productId }` | Thumbs-up feedback (once per result) |
| `getroomly-dislike` | `{ imageUrl, productId }` | Thumbs-down feedback (once per result) |
| `getroomly-check-favorite` | `{ productId }` | Plugin asks the host page whether this product is favorited — respond with `getroomly-set-favorite` |

To detect *every* modal open (including the built-in button), use the `callbacks.onModalOpen` callback rather than the event.

### Events the plugin listens for

| Event | `detail` payload | What it does |
|---|---|---|
| `getroomly-open-modal` | — | Opens the modal and re-reads `GetRoomlyEmbedConfig` |
| `getroomly-close-modal` | — | Closes the modal |
| `getroomly-set-favorite` | `{ productId, isFavorite }` | Reply to `getroomly-check-favorite`; updates the heart state |

### Example: hooking your cart and wishlist

```js
window.addEventListener('getroomly-add-to-cart', (e) => {
  yourCart.add(e.detail.productId, { imageUrl: e.detail.imageUrl });
});

window.addEventListener('getroomly-add-to-wishlist', (e) => {
  yourWishlist.toggle(e.detail.productId, e.detail.isFavorite);
});

window.addEventListener('getroomly-check-favorite', (e) => {
  const isFav = yourWishlist.has(e.detail.productId);
  window.dispatchEvent(
    new CustomEvent('getroomly-set-favorite', {
      detail: { productId: e.detail.productId, isFavorite: isFav },
    })
  );
});
```

> The `productId` field carries the value you passed as `GetRoomlyEmbedConfig.sku` — events use `productId` consistently across the surface, even though the config field is named `sku`.

## Callback functions (alternative to events)

If you prefer plain function references over events, set them on `GetRoomlyEmbedConfig.callbacks`:

```js
window.GetRoomlyEmbedConfig = {
  ...,
  callbacks: {
    onModalOpen:       () => {},                    // built-in trigger button clicked
    onModalClose:      () => {},
    onImageGenerated:  (imageUrl) => {},
    onError:           (error) => {},               // error is a string

    // Result-screen action callbacks — (imageUrl, productId)
    onAddToBasket:  (imageUrl, productId) => {},
    onFavorite:     (imageUrl, productId) => {},
    onLike:         (imageUrl, productId) => {},
    onDislike:      (imageUrl, productId) => {},
    onShowOriginal: (originalImage, productId) => {},
    onSaveShare:    (imageUrl, productId) => {},
  },
};
```

Use whichever model is more convenient: events are decoupled and work well when multiple parts of your page need to react; callbacks keep all the logic in one config object. Note the asymmetry — `onModalOpen` fires only for the built-in button, while `getroomly-open-modal` fires only for the programmatic API.

## Analytics

If the host page has Google Analytics (`gtag`) loaded, the plugin fires a GA4 `getroomly_interaction` event with `product_sku` and `product_category`, and sets the `getroomly_active_user` user property. It no-ops silently when `gtag` is absent and can never throw into the host page.

Two triggers:

- **Mode A** — the built-in trigger button is clicked. Uses `sku` and `category` from the config.
- **Mode B** — *any* element on the page carrying a `data-getroomly-sku` attribute is clicked. The plugin installs one delegated `click` listener on `document` and reads the SKU from the attribute:

```html
<button data-getroomly-sku="sofa-12345">Add to cart</button>
```

Mode B lets you attribute your own storefront buttons without wiring up the widget on them.

## CORS / cross-origin

### What the plugin fetches

From the customer's browser, the plugin makes exactly two network requests of its own:

| Request | To | Why it can fail |
|---|---|---|
| `fetch(productImage)` | **your** CDN | `src/services/ai-generation.ts` fetches the product image and converts it to base64 before sending it to the backend. It is a `fetch`, not an `<img>` — so your CDN **must** return `Access-Control-Allow-Origin` for your storefront's origin. If it doesn't, generation fails with `Failed to fetch product image` even though the image displays fine elsewhere on the page. |
| `POST /v1/generate` | `https://api.getroomly.ai` | Subject to the two allowlist layers below |

Passing a `data:` URL as `productImage` skips the fetch entirely, which is a useful workaround if you can't add CORS headers to your CDN.

### Content Security Policy

If your storefront sends a CSP, it needs to permit:

```
script-src  https://plugin.getroomly.ai
connect-src https://api.getroomly.ai <your-product-image-cdn>
img-src     data: <your-product-image-cdn>
```

`img-src data:` is required because the finished render is returned as base64 and drawn from a data URL, not from a remote file.

Be aware of `style-src` too: the plugin injects a `<style>` element into its shadow root and renders components that set inline styles, so a strict policy without `'unsafe-inline'` is likely to break the widget's appearance. We haven't verified this against every browser — if you enforce a strict `style-src`, test a full generation before rolling out.

### Allowlists

The plugin file (`plugin.js`) is served with `Access-Control-Allow-Origin: *` so any partner site can embed it.

The backend API enforces two independent layers, and you need to be on both:

- **`allowedOrigins`** on your partner record — enforced server-side. A mismatch returns `403 forbidden` and the render never runs.
- **`CORS_ALLOWED_ORIGINS`**, a global backend env allowlist — this one only controls whether the `Access-Control-Allow-Origin` response header is sent. If you're missing from it the request still *executes* on the backend (and burns quota); the browser just blocks you from reading the response. A generation that appears to fail with a CORS console error but still counts against your daily cap is the signature of this.

## Local development

### Prerequisites

- Node.js 20+ (CI runs 22, the Docker build image is 20)

### Setup

```bash
git clone https://github.com/markusvonkellauer-ctrl/getroomly-plugin.git
cd getroomly-plugin
npm install
cp .env.example .env   # set VITE_API_BASE_URL and VITE_GETROOMLY_API_KEY
npm run dev
```

Demo page at [http://localhost:5173](http://localhost:5173).

**`VITE_API_BASE_URL` is required for local dev.** There is no usable default — the built-in value is the literal placeholder `__API_BASE_URL__`, which is only substituted inside the Docker image at container start (see [Environment variables](#environment-variables)). Without it, requests go to `__API_BASE_URL__/v1/generate` and fail.

The dev server loads `src/main.tsx`, which renders `<App>` directly into `#root` with a hardcoded demo product — **it does not exercise the shadow-DOM entry point**. To test the real embed path, run `npm run build` and `npm run preview`, or use the Docker image's demo page.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR (loads `src/main.tsx`, not the plugin entry) |
| `npm run build` | Typecheck (`tsc -b`) then library build → `dist/` |
| `npm run watch` | Library build in watch mode |
| `npm run preview` | Serve the built artifact locally |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc -b` — builds the project references (both set `noEmit`, so nothing is written) |
| `npm test` | Full Jest suite |
| `npm run test:unit` | Component / util / api tests |
| `npm run test:integration` | Integration tests |
| `npm run test:shadow-dom` | Shadow-DOM isolation tests |
| `npm run test:e2e` | Puppeteer end-to-end (serial) |
| `npm run test:all` | unit → integration → shadow-dom → e2e |
| `npm run test:coverage` | Coverage report |

Jest config lives at `tests/jest.config.js`; see `tests/README.md`.

## Build output

`vite.config.ts` runs in **library mode** with `src/shadow-entry.tsx` as the entry point. `dist/` contains:

- `plugin.js` — the ES module partners load (~540 KB)
- `style.css` — emitted from the non-inline `App.css` import
- `favicon.svg`, `icons.svg` — copied from `public/`

Most of the plugin's CSS is inlined into the bundle (`index.css?inline`) and injected into the shadow root, so the widget renders without `style.css`. The nginx image serves `style.css` alongside `plugin.js` and the demo page links it.

The production Docker image wraps `dist/` in nginx with:

- CORS headers (`Access-Control-Allow-Origin: *`) and an OPTIONS preflight short-circuit
- A demo `index.html` at `/` so you can sanity-check a deploy by opening the root URL
- A `/health` endpoint for container healthchecks
- An entrypoint that substitutes `__API_BASE_URL__` in `plugin.js` before nginx starts

## Environment variables

Vite inlines `VITE_*` vars at **build** time, so they are baked into `plugin.js`. The API base URL is the exception: it is baked in as a placeholder and replaced at **container start**.

| Var | Scope | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | build | Where the plugin POSTs `/v1/generate`. Defaults to the literal placeholder `__API_BASE_URL__`. Set it for local dev; leave it unset for Docker builds so the entrypoint can substitute it. |
| `API_BASE_URL` | container runtime | Read by `deploy/entrypoint.sh` and sed-substituted into `plugin.js`. Supplied on the server via `env_file` (`/opt/getroomly/secrets/plugin.env`). **The container refuses to start if it is unset or the placeholder is missing.** |
| `VITE_GETROOMLY_API_KEY` | dev only | Convenience for local dev — when set, it satisfies the `apiKey` requirement so the demo page works without one. **Never set in production builds.** The published bundle has no fallback key. |
| `VITE_APP_ENV` | build | `development` / `staging` / `production` (default `development`) — controls dev-only console logging and warnings. |
| `VITE_GA_MEASUREMENT_ID` | build | Enables the GA4 tracking described in [Analytics](#analytics). Tracking no-ops when unset. |

`src/config/app-config.ts` reads a number of additional `VITE_*` vars (image limits, timeouts, retry counts, demo image URLs). They all have working defaults; see that file for the full list.

## Architecture

Three pieces:

1. **Shadow-DOM mount** — `shadow-entry.tsx` registers a `<getroomly-plugin>` custom element and appends it to `#getroomly-plugin-container`. It attaches an open shadow root and injects the plugin's CSS as inline text, so styles don't bleed into (or get clobbered by) the host page. See [GET-23](https://linear.app/getroomly/issue/GET-23).
2. **Room upload** — the user uploads a room photo. It is validated (JPEG/PNG/WebP, max 10 MB) and compressed client-side to a max dimension of 1600px, applying EXIF orientation so phone photos aren't rotated.
3. **API call** — POST to `/v1/generate` with the room image, product image, category, product ID, dimensions and language, authenticated with `X-API-Key`. The backend owns the Gemini call, all prompt construction and re-encoding, and responds with `{ image: { data, mimeType }, latencyMs, ... }`. The plugin builds a data URL from `image.mimeType` + base64 `image.data` and renders it in the shadow DOM. The render is normally WebP, but the backend falls back to the model's original bytes if re-encoding fails — always trust `image.mimeType` rather than assuming a format.

The product placement is chosen by the model from the room photo and dimensions; there is no click-to-place step in the current flow.

## Deploy

Pushes to `main` and `development` both auto-deploy to Hetzner via GitHub Actions (`.github/workflows/deploy.yml`):

1. Two-stage Docker build (Node 20-alpine build → nginx 1.27-alpine runtime), pushed to `ghcr.io/markusvonkellauer-ctrl/getroomly-plugin`
2. SCP the branch's compose file to the server and merge it into the top-level compose via an `include:`
3. `docker compose pull` + `up -d`, then poll the container healthcheck for up to 90s
4. Slack notification with the result

| Branch | Container | Compose dir | Image tags |
|---|---|---|---|
| `main` | `plugin-cdn` | `/opt/getroomly/compose` | `:latest`, `:main-<sha>` |
| `development` | `plugin-cdn-dev` | `/opt/getroomly-dev/compose` | `:development`, `:development-<sha>` |

The container binds to `127.0.0.1:8081` only; the host nginx reverse-proxies `https://plugin.getroomly.ai/plugin.js` to it (GET-17).

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck and unit tests on every PR and push to those branches. Note the Docker build runs `npx vite build` directly and skips typechecking — CI is what catches type errors.

Pipeline details: see [GET-33](https://linear.app/getroomly/issue/GET-33).

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari current + 1). Plugin ships as an ES module — no IE / legacy support. Uses `customElements`, shadow DOM, `createImageBitmap` (with an `Image()` fallback) and `crypto.randomUUID` (with a fallback).

Bundle size budget: keep `plugin.js` under ~600 KB minified. Currently ~540 KB.

## License

© 2026 GetRoomly. All rights reserved.
