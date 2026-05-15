// Vitest setup for the UI project. Loaded once per worker via the
// `setupFiles` option in vitest.config.ts.
//
// - Imports jest-dom matchers so tests can use expect(el).toBeInTheDocument()
//   etc. without ceremony.
// - Explicitly unmounts rendered components after each test. RTL only
//   auto-cleans when it detects globals=true or runs under Jest; with our
//   Vitest projects config it doesn't, so we call cleanup() ourselves.
// - Resets localStorage and the URL so hook-state tests start fresh.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
