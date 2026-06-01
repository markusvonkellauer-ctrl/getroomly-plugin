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

export interface EmbedConfig {
  /**
   * GetRoomly partner API key (recommended).
   * Format: `grm_pub_<48 hex chars>`. If omitted, falls back to the bundled demo key
   * (only usable from whitelisted dev origins). Production partners must provide their own.
   */
  apiKey?: string;

  /** Product image URL (required) */
  productImage: string;

  /** Product SKU/ID (required) */
  sku: string;

  /** Product name (optional) */
  productName?: string;

  /** Product price in cents (optional) */
  productPrice?: number;

  /** Product category (optional) */
  category?: string;

  /** UI language */
  language?: 'en' | 'sv';

  /** Product dimensions in cm (optional) */
  measurements?: ProductMeasurements;

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