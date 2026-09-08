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
// Tracks a first-mount open() call's deferred dispatch (see open() below) so
// close() can cancel it — otherwise open() immediately followed by close()
// before the deferred macrotask fires would still reopen the modal moments
// after the host asked to close it.
let pendingOpenTimeoutId: ReturnType<typeof setTimeout> | null = null;

const initPlugin = () => {
  if (pluginInstance && !pluginInstance.isConnected) {
    // Host removed/replaced the container since this was created (e.g. a
    // SPA re-render) — the cached element is no longer attached to the DOM,
    // and its React root has already been unmounted via
    // disconnectedCallback. Reusing it would silently do nothing: open()
    // would still report success and dispatch 'getroomly-open-modal', but
    // no listener exists anymore to receive it. Drop the stale reference so
    // a fresh instance gets created below instead.
    pluginInstance = null;
  }
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

// Single source of truth for modal-open state. Both events are dispatched
// from exactly one place — App.tsx's centralized effect watching its own
// isModalOpen React state — regardless of what actually changed that state
// (the default EmbedButton's onClick, an open/close request event, or a
// UI-driven close via the X button/backdrop). Deliberately NOT listening
// for the *request* events ('getroomly-open-modal' / 'getroomly-close-
// modal'): those only mean opening/closing was asked for, not that it
// happened — App.tsx can refuse an open request for a suspended partner,
// which would otherwise leave this wrongly true for a modal that never
// actually opened.
//
// Both the registration guard AND the value itself live on `window`, not a
// module-local variable: a module-local isModalOpen closed over by these
// listeners would only ever get updated by whichever module instance
// registered them first — if the bundle is loaded more than once (a
// jest.resetModules()-driven re-require in tests, or an accidental double
// inclusion on a host page), every later instance's own GetRoomly.isOpen()
// would read a local variable the (never re-registered) listeners don't
// write to, permanently diverging from the real state.
if (!window.__getroomlyModalListenersRegistered) {
  window.__getroomlyModalListenersRegistered = true;
  window.__getroomlyIsModalOpen = false;
  window.addEventListener('getroomly-modal-opened', () => {
    window.__getroomlyIsModalOpen = true;
  });
  window.addEventListener('getroomly-modal-closed', () => {
    window.__getroomlyIsModalOpen = false;
  });
}

(window as any).GetRoomly = {
  // Returns false and does nothing if the partner is currently suspended
  // for quota — a safety net for host pages that built their own trigger
  // button (hideButton: true) instead of the plugin's default one, in case
  // that button is still visible/clicked (e.g. a host that doesn't listen
  // for 'getroomly-availability-changed', or a race before it does).
  // getAvailability() reads a locally-cached value (set by App.tsx once
  // its status check resolves), so this check adds no network latency.
  // Returns `false` when open() couldn't do anything (blocked by quota, or
  // the plugin couldn't mount) — otherwise `undefined`, matching what this
  // returned before open() had any return value at all. Deliberately never
  // returns `true`: no old host code could have relied on any particular
  // truthy value from a call that always returned undefined, so this stays
  // purely additive — `false` is new information, not a changed contract
  // for the success path.
  open: (): boolean | undefined => {
    if (!getAvailability()) {
      window.dispatchEvent(new CustomEvent('getroomly-open-blocked'));
      return false;
    }
    // Cancel any still-pending deferred dispatch from an earlier open()
    // call before deciding whether to (re)defer this one — otherwise a
    // second open() arriving before the first's deferred macrotask fires
    // (wasAlreadyMounted now true, dispatching synchronously below) would
    // leave that stale timer to fire an extra, unexpected
    // 'getroomly-open-modal' event later, bypassing close()'s cancellation
    // too since only the most recent timer ID is ever tracked.
    if (pendingOpenTimeoutId !== null) {
      clearTimeout(pendingOpenTimeoutId);
      pendingOpenTimeoutId = null;
    }
    // Captured before initPlugin() runs: whether the plugin element (and
    // therefore the App.tsx instance whose useEffect registers the
    // 'getroomly-open-modal' listener) already existed AND is still
    // attached to the DOM. Checking isConnected too, not just non-null,
    // matters here specifically: initPlugin() below treats a disconnected
    // cached instance as stale and mounts a fresh one — if this check
    // didn't agree, a reconnect after the host removed/replaced the
    // container would wrongly skip the deferral a fresh mount needs (see
    // initPlugin()'s own comment), dispatching before any listener exists.
    const wasAlreadyMounted = pluginInstance !== null && pluginInstance.isConnected;
    // initPlugin() returns null if #getroomly-plugin-container isn't in the
    // DOM (yet, or at all) — don't claim success or dispatch the open event
    // when nothing was actually mounted to receive it.
    if (!initPlugin()) {
      return false;
    }
    // window.__getroomlyIsModalOpen is updated by the listener above, not
    // set here directly — keeps a single source of truth regardless of what
    // triggered the event.
    const dispatchOpenModal = () => {
      pendingOpenTimeoutId = null;
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    };
    if (wasAlreadyMounted) {
      dispatchOpenModal();
    } else {
      // First-time mount: createRoot().render() above schedules React's
      // commit + effects asynchronously — the useEffect in App.tsx that
      // registers the 'getroomly-open-modal' listener hasn't run yet at
      // this point. Dispatching synchronously here would fire before any
      // listener exists to catch it, silently doing nothing on the very
      // first open() call. Deferring to a macrotask lets React finish
      // mounting and running effects first. Tracked in pendingOpenTimeoutId
      // so close() (below) can cancel it if called before it fires.
      pendingOpenTimeoutId = setTimeout(dispatchOpenModal, 0);
    }
  },
  // Only dispatches the *request* to close ('getroomly-close-modal') —
  // symmetric with open() only requesting, not claiming success. App.tsx's
  // centralized isModalOpen effect dispatches 'getroomly-modal-closed' once
  // React has actually processed it; dispatching it here too would
  // double-fire it (and do so before React has actually closed anything).
  close: () => {
    // Cancels a still-pending first-mount open() dispatch (see open()
    // above) — without this, open() immediately followed by close() before
    // that deferred macrotask fires would still reopen the modal moments
    // after the host asked to close it.
    if (pendingOpenTimeoutId !== null) {
      clearTimeout(pendingOpenTimeoutId);
      pendingOpenTimeoutId = null;
    }
    window.dispatchEvent(new CustomEvent('getroomly-close-modal'));
  },
  isOpen: () => window.__getroomlyIsModalOpen ?? false,
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
