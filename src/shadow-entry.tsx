/**
 * Shadow DOM Entry Point for GetRoomly Plugin
 * This creates an isolated Shadow DOM environment for the plugin
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppConfig } from './config/app-config';

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
  open: () => {
    initPlugin();
    isModalOpen = true;
    window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
  },
  close: () => {
    isModalOpen = false;
    window.dispatchEvent(new CustomEvent('getroomly-close-modal'));
    window.dispatchEvent(new CustomEvent('getroomly-modal-closed'));
  },
  isOpen: () => isModalOpen,
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
