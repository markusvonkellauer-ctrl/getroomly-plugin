/**
 * Availability State Tests
 */

describe('availability-state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete window.GetRoomlyEmbedConfig?.apiKey;
  });

  it('defaults to available (true) before any check has run', () => {
    // Fresh module instance so this doesn't depend on running before any
    // other test in this file that mutates the shared singleton state.
    jest.resetModules();
    const { getAvailability } = require('../../src/lib/availability-state');
    expect(getAvailability()).toBe(true);
  });

  it('getAvailability reflects the value passed to setAvailabilityValue for the current apiKey', () => {
    jest.resetModules();
    window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
    const { setAvailabilityValue, getAvailability } = require('../../src/lib/availability-state');

    setAvailabilityValue('grm_pub_a', false);
    expect(getAvailability()).toBe(false);

    setAvailabilityValue('grm_pub_a', true);
    expect(getAvailability()).toBe(true);
  });

  it('fails open (true) when the cached result belongs to a different apiKey than the current config', () => {
    // Regression coverage for a Copilot review finding on PR #83:
    // GetRoomly.open() could stay permanently blocked after a host page
    // switched to a different (available) partner, because the cache still
    // held the previous partner's `false` and open() never dispatched the
    // event that would let App.tsx notice the new key and re-check it.
    jest.resetModules();
    window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
    const { setAvailabilityValue, getAvailability } = require('../../src/lib/availability-state');

    setAvailabilityValue('grm_pub_a', false);
    expect(getAvailability()).toBe(false);

    // Host page swaps to a different partner before it's been checked yet.
    window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_b';

    expect(getAvailability()).toBe(true);
  });

  it("setAvailabilityValue does not dispatch an event — that is notifyAvailabilityChanged's job", () => {
    jest.resetModules();
    const { setAvailabilityValue } = require('../../src/lib/availability-state');
    const handler = jest.fn();
    window.addEventListener('getroomly-availability-changed', handler);

    setAvailabilityValue(undefined, false);

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('getroomly-availability-changed', handler);
  });

  it('notifyAvailabilityChanged dispatches a getroomly-availability-changed event with the value in detail', () => {
    jest.resetModules();
    const { notifyAvailabilityChanged } = require('../../src/lib/availability-state');
    const handler = jest.fn();
    window.addEventListener('getroomly-availability-changed', handler);

    notifyAvailabilityChanged(false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ available: false });

    window.removeEventListener('getroomly-availability-changed', handler);
  });

  it('notifyAvailabilityChanged does not itself change what getAvailability returns', () => {
    // The two are deliberately decoupled: setAvailabilityValue is what
    // App.tsx calls during render (safe, no side effect); notifying
    // listeners is a separate side effect called from an effect.
    jest.resetModules();
    const {
      notifyAvailabilityChanged,
      getAvailability,
    } = require('../../src/lib/availability-state');

    expect(getAvailability()).toBe(true);
    notifyAvailabilityChanged(false);
    expect(getAvailability()).toBe(true);
  });

  it('dispatches an event on every notifyAvailabilityChanged call, even when the value is unchanged', () => {
    // Simple, predictable semantics for listeners — no hidden de-duplication
    // to reason about.
    jest.resetModules();
    const { notifyAvailabilityChanged } = require('../../src/lib/availability-state');
    const handler = jest.fn();
    window.addEventListener('getroomly-availability-changed', handler);

    notifyAvailabilityChanged(true);
    notifyAvailabilityChanged(true);

    expect(handler).toHaveBeenCalledTimes(2);
    window.removeEventListener('getroomly-availability-changed', handler);
  });

  describe('persisted (localStorage) availability', () => {
    it('setAvailabilityValue persists the result to localStorage under the apiKey', () => {
      jest.resetModules();
      const { setAvailabilityValue } = require('../../src/lib/availability-state');

      setAvailabilityValue('grm_pub_a', false);

      expect(localStorage.getItem('getroomly:availability:grm_pub_a')).toBe('false');
    });

    it('does not persist anything when the apiKey is undefined', () => {
      jest.resetModules();
      const { setAvailabilityValue } = require('../../src/lib/availability-state');

      setAvailabilityValue(undefined, false);

      expect(localStorage.length).toBe(0);
    });

    it("falls back to a value persisted from an earlier visit when this page load hasn't computed one yet", () => {
      // Regression coverage: without this fallback, a returning visitor's
      // very first render always started from the optimistic "available"
      // default and visibly flashed the trigger button before hiding it,
      // every single page load, for a partner that's actually suspended.
      localStorage.setItem('getroomly:availability:grm_pub_a', 'false');
      jest.resetModules();
      window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
      const { getAvailability } = require('../../src/lib/availability-state');

      // No setAvailabilityValue call this "page load" — simulates a fresh
      // module instance before App.tsx's own check has resolved.
      expect(getAvailability()).toBe(false);
    });

    it('an in-memory result from this page load takes priority over a stale persisted value', () => {
      localStorage.setItem('getroomly:availability:grm_pub_a', 'false');
      jest.resetModules();
      window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
      const { setAvailabilityValue, getAvailability } = require('../../src/lib/availability-state');

      setAvailabilityValue('grm_pub_a', true);

      expect(getAvailability()).toBe(true);
    });

    it('falls back to the optimistic default when nothing is persisted for the current apiKey', () => {
      jest.resetModules();
      window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_never_seen';
      const { getAvailability } = require('../../src/lib/availability-state');

      expect(getAvailability()).toBe(true);
    });

    it('does not throw and falls back to in-memory/optimistic behavior when localStorage.getItem throws', () => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error('storage disabled');
      };

      try {
        jest.resetModules();
        window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
        const { getAvailability } = require('../../src/lib/availability-state');

        expect(() => getAvailability()).not.toThrow();
        expect(getAvailability()).toBe(true);
      } finally {
        Storage.prototype.getItem = original;
      }
    });

    it('does not throw when localStorage.setItem throws', () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error('storage full');
      };

      try {
        jest.resetModules();
        const {
          setAvailabilityValue,
          getAvailability,
        } = require('../../src/lib/availability-state');

        expect(() => setAvailabilityValue('grm_pub_a', false)).not.toThrow();
        // The in-memory value must still be usable even though persisting
        // it failed.
        window.GetRoomlyEmbedConfig.apiKey = 'grm_pub_a';
        expect(getAvailability()).toBe(false);
      } finally {
        Storage.prototype.setItem = original;
      }
    });
  });
});
