# GetRoomly Plugin

Drop-in JavaScript widget that lets your customers preview products in a photo of their own room. Built as an ES module loaded with a single `<script>` tag and mounted inside a shadow DOM so it can't conflict with your existing styles.

This is the embeddable artifact. The backend it talks to is [**GetRoomly Backend**](https://github.com/markusvonkellauer-ctrl/GetRoomly-Backend); the showcase demo is [**GetRoomly Frontend**](https://github.com/markusvonkellauer-ctrl/GetRoomly).

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

If any required field is missing, the mount container renders a clear init-time error (`"Partner API key is required in GetRoomlyEmbedConfig.apiKey"`, etc.) and the modal never opens. Real partners always pass these six — there is no silent fallback.

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
    styling:      { buttonColor: '#0d9488', borderRadius: '8px' },

    // optional integrations
    addToCartSelector: '#add-to-cart-btn',
    wishlistSelector:  '#wishlist-btn',
    isFavorite:        false,

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

The plugin renders a trigger button inside `#getroomly-plugin-container`. When clicked, it opens a modal where the user uploads a room photo, picks a point on it, and gets the Gemini render back. See **Authentication** below before going to production.

## Authentication — read this first

You need two things from GetRoomly before going live:

1. **A partner API key** (`grm_pub_...`) — set as `window.GetRoomlyEmbedConfig.apiKey`. Treat it like a public API key: it lives in your HTML, but the backend enforces per-domain origin checks so a leaked key can only be abused from approved origins.
2. **Your domain on the partner allowlist.** The backend rejects any request whose `Origin` header isn't on your partner record's `allowedOrigins`. Subdomains are covered automatically — if `example.com` is on the list, `shop.example.com` works too.

To get added, contact GetRoomly with the list of domains you'll embed from.

### Error semantics

The plugin surfaces backend errors via the `onError` callback (see below). Status codes:

| Status | Code | What it means | What to do |
|---|---|---|---|
| 401 | `unauthorized` | Bad or missing `apiKey` | Check `GetRoomlyEmbedConfig.apiKey` |
| 403 | `forbidden` | Your origin isn't on the allowlist for this key | Contact GetRoomly to add your domain |
| 429 | `quotaExceeded` | Daily render cap exceeded for this partner | Resets at next UTC midnight; contact GetRoomly to raise the cap |
| 503 | `tooBusy` | Upstream model returned no image (often a content refusal) | Retry once or twice; if persistent, the specific (room photo + product) combo may need a different angle |

## Configuration: `window.GetRoomlyEmbedConfig`

Full shape (defined in `src/types/embed-config.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `apiKey` | `string` | **yes** | `grm_pub_...`. Issued via the backend `CreatePartner` tool. The published plugin bundle ships with no fallback key — every host page must provide one. |
| `productImage` | `string` | **yes** | Public URL of the product image |
| `sku` | `string` | **yes** | Product SKU / ID |
| `productName` | `string` | **yes** | Display name shown in the modal |
| `category` | `string` | **yes** | Free-form. The backend uses it to pick the render prompt — `carpets` (or any string containing `carpet`) triggers the carpet-replacement path; small-accessory tokens (`lamp`, `vase`, `decor`, `lighting`, `candle`, `plant`, `pot`, `bowl`, `accessory`) get size-aware copy; everything else (`sofas`, `chairs`, `tables`, `beds`, custom taxonomies, ...) goes through the general furniture prompt |
| `measurements` | `{ width, depth, height }` | **yes** | Product dimensions in cm — backend rejects placement requests without these |
| `productPrice` | `number` | no | Price in cents |
| `language` | `'en' \| 'sv'` | no | UI language (default `en`) |
| `addToCartSelector` | `string` | no | CSS selector the plugin clicks when the user hits "Add to cart" inside the modal |
| `wishlistSelector` | `string` | no | Same, for "Wishlist" |
| `debugCoordinates` | `boolean` | no | Show a coordinate debug overlay (dev only) |
| `showSteps` | `boolean` | no | Show steps progress bar (default `false`) |
| `hideButton` | `boolean` | no | Hide the built-in trigger button (use when you control opening via `window.GetRoomly.open()`) |
| `isFavorite` | `boolean` | no | Initial favorite/wishlist state |
| `buttonText` | `string` | no | Override the trigger button label |
| `buttons` | `object` | no | Toggle in-modal action buttons individually (see below) |
| `styling` | `object` | no | `buttonColor`, `buttonTextColor`, `borderRadius` |
| `callbacks` | `object` | no | Function callbacks for plugin events (see below) |

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

### `styling` — light theming

```js
styling: {
  buttonColor:     '#0d9488',
  buttonTextColor: '#ffffff',
  borderRadius:    '8px',
}
```

## JavaScript control API: `window.GetRoomly`

Once the plugin script loads it attaches a global with four methods:

```js
window.GetRoomly.open();   // open the modal programmatically
window.GetRoomly.close();  // close the modal
window.GetRoomly.isOpen(); // -> boolean
window.GetRoomly.init();   // re-init (mounts plugin if container exists)
```

Useful when you want to trigger the plugin from your own button. Pair with `hideButton: true` to hide the built-in trigger.

## Listening to events

The plugin dispatches `CustomEvent`s on `window`. The host page can listen and react.

### Events dispatched by the plugin

| Event | `detail` payload | When |
|---|---|---|
| `getroomly-open-modal` | — | Modal opens |
| `getroomly-close-modal` | — | Modal closes (user action or `GetRoomly.close()`) |
| `getroomly-modal-closed` | — | Fired alongside `getroomly-close-modal` (legacy alias) |
| `getroomly-add-to-cart` | `{ productId, imageUrl, productName, productPrice, product: { id, name, price, category } }` | User clicks "Add to cart" in the modal |
| `getroomly-add-to-wishlist` | `{ productId, isFavorite, isCurrentlyWishlisted, imageUrl }` | User clicks the heart/wishlist button |
| `getroomly-like` | `{ imageUrl, productId }` | Thumbs-up feedback |
| `getroomly-dislike` | `{ imageUrl, productId }` | Thumbs-down feedback |
| `getroomly-check-favorite` | `{ productId }` | Plugin asks the host page whether this product is favorited — respond with `getroomly-set-favorite` |

### Events the plugin listens for

| Event | `detail` payload | What it does |
|---|---|---|
| `getroomly-open-modal` | — | Opens the modal (same as `GetRoomly.open()`) |
| `getroomly-close-modal` | — | Closes the modal |
| `getroomly-set-favorite` | `{ productId, isFavorite }` | Reply to `getroomly-check-favorite`; updates the heart state |

### Example: hooking your cart and wishlist

```js
window.addEventListener('getroomly-add-to-cart', (e) => {
  console.log('Adding to cart:', e.detail.productId);
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
    onModalOpen:       () => console.log('opened'),
    onModalClose:      () => console.log('closed'),
    onImageGenerated:  (imageUrl) => console.log('rendered', imageUrl),
    onError:           (error) => alert(error),

    // Result-screen action callbacks
    onAddToBasket:  (imageUrl, productId) => { ... },
    onFavorite:     (imageUrl, productId) => { ... },
    onLike:         (imageUrl, productId) => { ... },
    onDislike:      (imageUrl, productId) => { ... },
    onShowOriginal: (originalImage, productId) => { ... },
    onSaveShare:    (imageUrl, productId) => { ... },

    // Legacy convenience
    onAddToCart:  () => { ... },
    onWishlist:   () => { ... },
  },
};
```

Use whichever model is more convenient: events are decoupled and work well when multiple parts of your page need to react; callbacks keep all the logic in one config object.

## CORS / cross-origin

The plugin file (`plugin.js`) is served with `Access-Control-Allow-Origin: *` so any partner site can embed it. The backend API uses a separate CORS allowlist — your domain must also be in the backend's `CORS_ALLOWED_ORIGINS` env var, in addition to the per-partner `allowedOrigins`.

## Local development

### Prerequisites

- Node.js (LTS)

### Setup

```bash
git clone https://github.com/markusvonkellauer-ctrl/getroomly-plugin.git
cd getroomly-plugin
npm install
cp .env.example .env   # set VITE_GETROOMLY_API_KEY (dev partner key); VITE_API_BASE_URL has a sensible default
npm run dev
```

Demo page at [http://localhost:5173](http://localhost:5173).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR (root `index.html` loads the plugin entry) |
| `npm run build` | Library build → `dist/plugin.js` (ES module, ~525 KB) |
| `npm run preview` | Serve the built artifact locally |
| `npm run lint` | ESLint |

## Build modes

`vite.config.ts` runs in **library mode** with `src/shadow-entry.tsx` as the entry point. Output is a single ES-module file (`dist/plugin.js`) that is what partners ultimately load.

The production Docker image wraps that artifact in nginx with:
- CORS headers (`Access-Control-Allow-Origin: *`) and an OPTIONS preflight short-circuit
- A demo `index.html` at `/` so you can sanity-check a deploy by opening the root URL
- A `/health` endpoint for container healthchecks

## Environment variables

Vite inlines `VITE_*` vars at build time. The runtime values come from `window.GetRoomlyEmbedConfig`, so the `.env` is mostly for local dev:

| Var | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | no | `http://178.105.148.65:3000` | Where the plugin POSTs `/v1/generate`. The built-in default points at the live Hetzner backend. |
| `VITE_GETROOMLY_API_KEY` | dev only | — | Convenience for local plugin dev — when set, the dev demo at `npm run dev` uses it as the partner key. **Never set in production builds.** The published plugin bundle has no fallback key; production host pages must always pass `window.GetRoomlyEmbedConfig.apiKey` themselves. |
| `VITE_APP_ENV` | no | `development` | `development` / `staging` / `production` — controls dev-only console logging and warnings. |

## Architecture

Three pieces:

1. **Shadow-DOM mount** — the plugin attaches a shadow root inside `#getroomly-plugin-container` so its CSS doesn't bleed into (or get clobbered by) the host page's styles. See [GET-23](https://linear.app/getroomly/issue/GET-23).
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