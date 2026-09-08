/**
 * Shadow DOM Entry Point for GetRoomly Plugin
 * This creates an isolated Shadow DOM environment for the plugin
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppConfig } from './config/app-config';
import { getAvailability } from './lib/availability-state';

// Import styles as text to inject into Shadow DOM
import styleContent from './index.css?inline';

class GetRoomlyPlugin extends HTMLElement {
  private reactRoot: any;

  constructor() {
    super();

    // Create Shadow DOM (use 'open' mode so this.shadowRoot is accessible)
    const shadowRoot = this.attachShadow({ mode: 'open' });

    // Create container for React app
    const container = document.createElement('div');
    container.id = 'getroomly-root';

    // Create style element for CSS isolation
    const style = document.createElement('style');
    style.textContent = styleContent;

    // Add elements to Shadow DOM
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(container);

    // Set default config if not provided
    if (!window.GetRoomlyEmbedConfig) {
      window.GetRoomlyEmbedConfig = {
        // Empty in the published bundle — host pages must supply their own key,
        // and useEmbedConfig surfaces a clear init error when they don't.
        apiKey: AppConfig.ai.defaultApiKey ?? '',
        productImage: AppConfig.demo.chairImageUrl,
        sku: 'SHADOW-TEST-001',
        productName: 'Shadow DOM Test Product',
        productPrice: 99999,
        category: 'test',
        measurements: { width: 78, depth: 75, height: 80 },
        language: 'en',
        buttonText: 'Visualize in Your Room',
      };
    }

    // Initialize React app in Shadow DOM
    this.reactRoot = createRoot(container);
    this.reactRoot.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }

  disconnectedCallback() {
    if (this.reactRoot) {
      this.reactRoot.unmount();
    }
  }
}

// Define custom element (guard against re-definition on script re-load)
if (!customElements.get('getroomly-plugin')) {
  customElements.define('getroomly-plugin', GetRoomlyPlugin);
}

// Expose global API for host page integration
let pluginInstance: HTMLElement | null = null;
let isModalOpen = false;

const initPlugin = () => {
  if (pluginInstance) {
    return pluginInstance;
  }
  const container = document.getElementById('getroomly-plugin-container');
  if (container) {
    pluginInstance = document.createElement('getroomly-plugin');
    container.appendChild(pluginInstance);
  }
  return pluginInstance;
};

(window as any).GetRoomly = {
  // Returns false and does nothing if the partner is currently suspended
  // for quota — a safety net for host pages that built their own trigger
  // button (hideButton: true) instead of the plugin's default one, in case
  // that button is still visible/clicked (e.g. a host that doesn't listen
  // for 'getroomly-availability-changed', or a race before it does).
  // getAvailability() reads a locally-cached value (set by App.tsx once
  // its status check resolves), so this check adds no network latency.
  open: (): boolean => {
    if (!getAvailability()) {
      window.dispatchEvent(new CustomEvent('getroomly-open-blocked'));
      return false;
    }
    initPlugin();
    isModalOpen = true;
    window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    return true;
  },
  close: () => {
    isModalOpen = false;
    window.dispatchEvent(new CustomEvent('getroomly-close-modal'));
    window.dispatchEvent(new CustomEvent('getroomly-modal-closed'));
  },
  isOpen: () => isModalOpen,
  // Lets a host page check availability on demand — e.g. right before
  // rendering its own trigger button — in addition to the
  // 'getroomly-availability-changed' event for reacting to a change.
  isAvailable: getAvailability,
  init: initPlugin,
};

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  initPlugin();
});

// Also try immediate initialization in case DOM is already loaded
if (document.readyState !== 'loading') {
  initPlugin();
}
