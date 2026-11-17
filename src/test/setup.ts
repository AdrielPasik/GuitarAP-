import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  if (typeof window === 'undefined') return; // node-environment suites (database tests) have no DOM
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});
import 'fake-indexeddb/auto';
