import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

// Node.js 26 defines a `localStorage` on globalThis that returns undefined
// unless --localstorage-file is provided. Vitest's populateGlobal() skips
// copying jsdom's Storage because the key already exists on the Node global.
// Provide a functional in-memory shim so all tests can use bare
// `localStorage.*` calls.
const _localStorageMock = (() => {
  let store = Object.create(null)
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = Object.create(null) },
    get length() { return Object.keys(store).length },
    key: (i) => Object.keys(store)[i] ?? null,
  }
})()
Object.defineProperty(globalThis, 'localStorage', {
  value: _localStorageMock,
  writable: true,
  configurable: true,
})

vi.mock('react-modal-sheet', () => {
  const Sheet = ({ children, isOpen }) => isOpen ? React.createElement('div', { 'data-testid': 'mock-sheet' }, children) : null;
  Sheet.Container = ({ children }) => React.createElement('div', { 'data-testid': 'mock-sheet-container' }, children);
  Sheet.Header = () => React.createElement('div', { 'data-testid': 'mock-sheet-header' });
  Sheet.Content = ({ children }) => React.createElement('div', { 'data-testid': 'mock-sheet-content' }, children);
  Sheet.Backdrop = ({ onClick }) => React.createElement('div', { 'data-testid': 'mock-sheet-backdrop', onClick });
  return { Sheet };
});
