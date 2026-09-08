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
});
