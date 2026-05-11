---
name: projects-workspaces
description: Multi-project configuration for monorepos and different test types
---

# Projects

Run different test configs in same Vitest process.

## Basic Setup

```ts
// vitest.config.ts
defineConfig({
  test: {
    projects: [
      // Glob patterns for config files
      'packages/*',
      
      // Inline config
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
```

## Monorepo Pattern

```ts
defineConfig({
  test: {
    projects: [
      // Each package has its own vitest.config.ts
      'packages/core',
      'packages/cli',
      'packages/utils',
    ],
  },
})
```

Package config:

```ts
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

## Different Environments

```ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'happy-dom',
          root: './shared-tests',
          environment: 'happy-dom',
          setupFiles: ['./setup.happy-dom.ts'],
        },
      },
      {
        test: {
          name: 'node',
          root: './shared-tests',
          environment: 'node',
          setupFiles: ['./setup.node.ts'],
        },
      },
    ],
  },
})
```

## Browser + Node Projects

```ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            name: 'chromium',
            provider: 'playwright',
          },
        },
      },
    ],
  },
})
```

## Shared Configuration

```ts
// vitest.shared.ts
export const sharedConfig = {
  testTimeout: 10000,
  setupFiles: ['./tests/setup.ts'],
}

// vitest.config.ts
import { sharedConfig } from './vitest.shared'

defineConfig({
  test: {
    projects: [
      {
        test: {
          ...sharedConfig,
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          ...sharedConfig,
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
        },
      },
    ],
  },
})
```

## Project-Specific Dependencies

```ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'project-a',
          server: {
            deps: {
              inline: ['package-a'],
            },
          },
        },
      },
    ],
  },
})
```

## Running Specific Projects

```bash
# Run specific project
vitest --project unit
vitest --project integration

# Multiple projects
vitest --project unit --project e2e

# Exclude project
vitest --project.ignore browser
```

## Providing Values to Projects

```ts
// vitest.config.ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'staging',
          provide: {
            apiUrl: 'https://staging.api.com',
            debug: true,
          },
        },
      },
      {
        test: {
          name: 'production',
          provide: {
            apiUrl: 'https://api.com',
            debug: false,
          },
        },
      },
    ],
  },
})

// In tests, use inject
import { inject } from 'vitest'

test('uses correct api', () => {
  const url = inject('apiUrl')
  expect(url).toContain('api.com')
})
```

## With Fixtures

```ts
const test = base.extend({
  apiUrl: ['/default', { injected: true }],
})

test('uses injected url', ({ apiUrl }) => {
  // apiUrl comes from project's provide config
})
```

## Project Isolation

Each project = own thread pool default:

```ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'isolated',
          isolate: true, // Full isolation
          pool: 'forks',
        },
      },
    ],
  },
})
```

## Global Setup per Project

```ts
defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'with-db',
          globalSetup: ['./tests/db-setup.ts'],
        },
      },
    ],
  },
})
```

## Key Points

- Projects run in same Vitest process
- Each project: different environment, config
- Glob patterns for monorepo packages
- `--project` flag runs specific projects
- `provide` injects config values into tests
- Projects inherit root config unless overridden

<!-- 
Source references:
- https://vitest.dev/guide/projects.html
-->
