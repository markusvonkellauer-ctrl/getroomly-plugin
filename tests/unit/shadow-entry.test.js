/**
 * shadow-entry.tsx — window.GetRoomly.open() first-mount race
 *
 * Regression coverage for a Copilot review finding on PR #83: the
 * 'getroomly-open-modal' listener is registered inside App.tsx's useEffect,
 * which only runs once React has committed — asynchronously, since
 * createRoot().render() never renders synchronously. Dispatching the open
 * event immediately after mounting the plugin for the first time raced that
 * effect and could silently do nothing on a host page's very first
 * window.GetRoomly.open() call (e.g. a container injected dynamically after
 * DOMContentLoaded, so auto-init never ran ahead of time).
 *
 * react-dom/client's createRoot is mocked out here: the fix under test is
 * shadow-entry's own dispatch-timing decision (defer on first mount, dispatch
 * immediately once already mounted), not React's effect scheduling itself —
 * mocking it keeps the test deterministic instead of racing jsdom/act
 * internals unrelated to this change.
 */

import { act } from '@testing-library/react';

jest.mock('../../src/config/app-config', () => require('../__mocks__/app-config.js'));

jest.mock('../../src/App', () => () => null);

const mockRender = jest.fn();
jest.mock('react-dom/client', () => ({
  createRoot: () => ({ render: mockRender, unmount: jest.fn() }),
}));

describe('shadow-entry — window.GetRoomly.open() first-mount race', () => {
  let openHandler;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockRender.mockClear();
    // No #getroomly-plugin-container yet — mirrors a host page whose
    // container is injected dynamically, after script load/DOMContentLoaded
    // already ran, so shadow-entry's own auto-init found nothing to mount.
    document.body.innerHTML = '';
    delete window.__getroomlyModalListenersRegistered;
    openHandler = jest.fn();
    window.addEventListener('getroomly-open-modal', openHandler);
  });

  afterEach(() => {
    window.removeEventListener('getroomly-open-modal', openHandler);
    // Discards any still-pending deferred dispatch instead of letting it
    // leak into the next test as a real timer would.
    jest.useRealTimers();
  });

  it('does not dispatch getroomly-open-modal synchronously on the very first open() call', () => {
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });

    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(openHandler).not.toHaveBeenCalled();
  });

  it('still delivers the open request once deferred to a macrotask', () => {
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });
    expect(openHandler).not.toHaveBeenCalled();

    act(() => {
      jest.runAllTimers();
    });

    expect(openHandler).toHaveBeenCalledTimes(1);
  });

  it('dispatches synchronously on subsequent opens, once the plugin is already mounted', () => {
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });
    act(() => {
      jest.runAllTimers();
    });
    expect(openHandler).toHaveBeenCalledTimes(1);

    act(() => {
      window.GetRoomly.open();
    });

    // No deferral needed the second time — dispatched within the same act().
    expect(openHandler).toHaveBeenCalledTimes(2);
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it('cancels the deferred first-mount open dispatch when close() is called before it fires', () => {
    // Regression coverage for a Copilot review finding on PR #83: without
    // tracking and cancelling the pending macrotask, open() immediately
    // followed by close() (before the deferred dispatch fires) would still
    // reopen the modal moments after the host asked to close it.
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });
    expect(openHandler).not.toHaveBeenCalled();

    act(() => {
      window.GetRoomly.close();
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(openHandler).not.toHaveBeenCalled();
  });

  it('does not leave a duplicate deferred dispatch pending when open() is called again before it fires', () => {
    // Regression coverage for a Copilot review finding on PR #83: the
    // second open() call (already mounted, dispatches synchronously) used
    // to leave the first call's deferred timer untouched, firing an extra
    // 'getroomly-open-modal' event later — and bypassing close()'s
    // cancellation too, since only the most recent timer ID was tracked.
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });
    expect(openHandler).not.toHaveBeenCalled();

    act(() => {
      window.GetRoomly.open();
    });
    expect(openHandler).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runAllTimers();
    });

    expect(openHandler).toHaveBeenCalledTimes(1);
  });

  it('remounts and re-defers when the cached plugin instance has been disconnected from the DOM', () => {
    // Regression coverage for a Copilot review finding on PR #86: a host
    // page that removes/replaces #getroomly-plugin-container (e.g. a SPA
    // re-render) leaves pluginInstance pointing at a detached element.
    // Treating that as "already mounted" would dispatch synchronously with
    // no listener left to receive it (the detached element's React root
    // already unmounted via disconnectedCallback) — open() would report
    // success while silently doing nothing.
    require('../../src/shadow-entry');
    document.body.innerHTML = '<div id="getroomly-plugin-container"></div>';

    act(() => {
      window.GetRoomly.open();
    });
    act(() => {
      jest.runAllTimers();
    });
    expect(openHandler).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);

    // Host removes the plugin element entirely — e.g. re-rendering the
    // container from scratch — detaching it from the DOM.
    const mountedElement = document.querySelector('getroomly-plugin');
    expect(mountedElement).not.toBeNull(); // fail with a clear message if the mount above didn't happen
    mountedElement.remove();

    act(() => {
      window.GetRoomly.open();
    });

    // A fresh instance was mounted (second render call)...
    expect(mockRender).toHaveBeenCalledTimes(2);
    // ...and, being a fresh mount, deferred rather than dispatched
    // synchronously — same as the very first open() call ever.
    expect(openHandler).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runAllTimers();
    });
    expect(openHandler).toHaveBeenCalledTimes(2);
  });
});

describe('shadow-entry — modal-opened/closed listener registration', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.__getroomlyModalListenersRegistered;
  });

  it('registers the modal-opened/closed listeners only once across repeated module loads', () => {
    // Regression coverage for a Copilot review finding on PR #83:
    // jest.resetModules()-driven re-requires in tests, or an accidental
    // double inclusion of this bundle on a host page, would otherwise each
    // add their own pair of listeners, accumulating on window indefinitely.
    //
    // Two separate spies, not one spanning both requires: jest.resetModules()
    // itself clears an already-created spy's recorded calls as a side
    // effect in this Jest version, independent of anything shadow-entry.tsx
    // does — a spy created fresh after each resetModules() call sidesteps
    // that entirely.
    const matching = calls =>
      calls.filter(
        ([eventName]) =>
          eventName === 'getroomly-modal-opened' || eventName === 'getroomly-modal-closed'
      );

    const firstSpy = jest.spyOn(window, 'addEventListener');
    require('../../src/shadow-entry');
    expect(matching(firstSpy.mock.calls)).toHaveLength(2);
    firstSpy.mockRestore();

    jest.resetModules();

    const secondSpy = jest.spyOn(window, 'addEventListener');
    require('../../src/shadow-entry');
    expect(matching(secondSpy.mock.calls)).toHaveLength(0);
    secondSpy.mockRestore();
  });

  it('keeps GetRoomly.isOpen() accurate across repeated module loads', () => {
    // Regression coverage for a Copilot review finding on PR #83: isOpen()
    // used to read a module-local variable that only the first-registered
    // listeners ever wrote to — a second module load's own isOpen() would
    // permanently diverge from the real (shared) state instead of tracking
    // it via window.__getroomlyIsModalOpen.
    require('../../src/shadow-entry');

    window.dispatchEvent(new CustomEvent('getroomly-modal-opened'));
    expect(window.GetRoomly.isOpen()).toBe(true);

    jest.resetModules();
    require('../../src/shadow-entry');

    expect(window.GetRoomly.isOpen()).toBe(true);

    window.dispatchEvent(new CustomEvent('getroomly-modal-closed'));
    expect(window.GetRoomly.isOpen()).toBe(false);
  });
});
