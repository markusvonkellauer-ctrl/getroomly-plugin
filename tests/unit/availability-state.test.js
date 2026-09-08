/**
 * Availability State Tests
 */

import { setAvailability, getAvailability } from '../../src/lib/availability-state';

describe('availability-state', () => {
  it('defaults to available (true) before any check has run', () => {
    // Note: module state persists across tests in the same file since it's
    // a singleton — this only holds as the very first assertion.
    expect(getAvailability()).toBe(true);
  });

  it('getAvailability reflects the value passed to setAvailability', () => {
    setAvailability(false);
    expect(getAvailability()).toBe(false);

    setAvailability(true);
    expect(getAvailability()).toBe(true);
  });

  it('dispatches a getroomly-availability-changed event with the new value in detail', () => {
    const handler = jest.fn();
    window.addEventListener('getroomly-availability-changed', handler);

    setAvailability(false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ available: false });

    window.removeEventListener('getroomly-availability-changed', handler);
  });

  it('dispatches an event on every call, even when the value is unchanged', () => {
    // Simple, predictable semantics for listeners — no hidden de-duplication
    // to reason about.
    setAvailability(true);
    const handler = jest.fn();
    window.addEventListener('getroomly-availability-changed', handler);

    setAvailability(true);

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('getroomly-availability-changed', handler);
  });
});
