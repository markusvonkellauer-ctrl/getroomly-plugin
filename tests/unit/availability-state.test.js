/**
 * Availability State Tests
 */

describe('availability-state', () => {
  afterEach(() => {
    // Some tests below set apiKey on the shared window.GetRoomlyEmbedConfig
    // (pre-populated by tests/setup.js without one) — restore it so later
    // tests default back to an undefined key.
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
});
