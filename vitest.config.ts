import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects under a single config so `pnpm test` runs both:
//   - backend: Node env, src/ tests in tests/
//   - ui: jsdom env, ui/src/ tests co-located next to the code they cover
//     with React Testing Library + jest-dom matchers.
//
// Coverage rolls up both projects but excludes infra (entrypoints, type-only
// modules, fetchers — they're integration-tested elsewhere).
export default defineConfig({
  test: {
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts', 'ui/src/**/*.{ts,tsx}'],
      exclude: ['src/index.ts', 'src/types.ts', 'src/fetchers/**', 'ui/src/**/*.test.{ts,tsx}'],
    },
    projects: [
      {
        test: {
          name: 'backend',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./ui/test-setup.ts'],
          include: ['ui/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
