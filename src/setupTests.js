import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

vi.mock('react-modal-sheet', () => {
  const Sheet = ({ children, isOpen }) => isOpen ? React.createElement('div', { 'data-testid': 'mock-sheet' }, children) : null;
  Sheet.Container = ({ children }) => React.createElement('div', { 'data-testid': 'mock-sheet-container' }, children);
  Sheet.Header = () => React.createElement('div', { 'data-testid': 'mock-sheet-header' });
  Sheet.Content = ({ children }) => React.createElement('div', { 'data-testid': 'mock-sheet-content' }, children);
  Sheet.Backdrop = ({ onClick }) => React.createElement('div', { 'data-testid': 'mock-sheet-backdrop', onClick });
  return { default: Sheet };
});
