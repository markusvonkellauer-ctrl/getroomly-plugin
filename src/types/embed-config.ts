/**
 * Embed Configuration Types
 *
 * Defines the interface for configuring the GetRoomly embed
 * via window.GetRoomlyEmbedConfig
 */

export interface ProductMeasurements {
  width: number;
  depth: number;
  height: number;
}

/**
 * Categories that unlock special backend rendering behavior. Any category
 * string is accepted — these are just the ones with dedicated handling:
 *  - `carpets` (or any string containing "carpet") → carpet-replacement prompt
 *  - small-accessory tokens (`lamp`, `vase`, `decor`, `lighting`, `candle`,
 *    `plant`, `pot`, `bowl`, `accessory`) → size-aware furniture prompt
 *
 * Anything else (e.g. `sofas`, `chairs`, `tables`, `beds`, `armchairs`,
 * `ottomans`, custom partner taxonomies) goes through the general
 * furniture-placement prompt.
 */
export const KNOWN_CATEGORIES = [
  'carpets',
  'sofas',
  'chairs',
  'tables',
  'beds',
  'tv-benches',
  'lights',
  'accessories',
  'decor',
] as const;

export interface EmbedConfig {
  /**
   * GetRoomly partner API key (required).
   * Format: `grm_pub_<48 hex chars>`. Issued via the backend `CreatePartner` tool.
   * The published plugin bundle ships with no key — every host page must provide one.
   */
  apiKey: string;

  /** Product image URL (required) */
  productImage: string;

  /** Product SKU/ID (required) */
  sku: string;

  /** Product display name (required) */
  productName: string;

  /** Product category (required) — free-form string; see KNOWN_CATEGORIES for ones with special backend handling */
  category: string;

  /** Product dimensions in cm (required) */
  measurements: ProductMeasurements;

  /** Product price in cents (optional) */
  productPrice?: number;

  /** UI language */
  language?: 'en' | 'sv';

  /** Target DOM selector for "Add to Cart" clicks (optional) */
  addToCartSelector?: string;

  /** Target DOM selector for "Wishlist" clicks (optional) */
  wishlistSelector?: string;

  /** Enable coordinate debug overlay (optional) */
  debugCoordinates?: boolean;

  /** Show steps progress bar (optional, default: true) */
  showSteps?: boolean;

  /** Hide the built-in embed button (when modal controlled externally) */
  hideButton?: boolean;

  /** Initial favorite/wishlist state (optional, default: false) */
  isFavorite?: boolean;

  /** Custom button text (optional) */
  buttonText?: string;

  /** Button visibility settings (optional) */
  buttons?: {
    addToBasket?: boolean;     // default: true
    favorite?: boolean;        // default: true (heart/wishlist button)
    feedback?: boolean;        // default: true (thumbs up/down buttons)
    showOriginal?: boolean;    // default: true
    saveShare?: boolean;       // default: true
  };

  /** Custom styling options (optional) */
  styling?: {
    buttonColor?: string;
    buttonTextColor?: string;
    borderRadius?: string;
  };

  /** Callback functions (optional) */
  callbacks?: {
    onModalOpen?: () => void;
    onModalClose?: () => void;
    onImageGenerated?: (imageUrl: string) => void;
    onAddToCart?: () => void;
    onWishlist?: () => void;
    onError?: (error: string) => void;

    // New result action callbacks
    onAddToBasket?: (imageUrl: string, productId: string) => void;
    onFavorite?: (imageUrl: string, productId: string) => void;
    onLike?: (imageUrl: string, productId: string) => void;
    onDislike?: (imageUrl: string, productId: string) => void;
    onShowOriginal?: (originalImage: string, productId: string) => void;
    onSaveShare?: (imageUrl: string, productId: string) => void;
  };
}

declare global {
  interface Window {
    GetRoomlyEmbedConfig?: EmbedConfig;
  }
}