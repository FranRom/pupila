---
name: vite-rolldown
description: Vite 8 Rolldown bundler and Oxc transformer migration
---

# Rolldown Migration (Vite 8)

Vite 8 replaces esbuild+Rollup with Rolldown, unified Rust-based bundler.

## What Changed

| Before (Vite 7) | After (Vite 8) |
|-----------------|----------------|
| esbuild (dev transform) | Oxc Transformer |
| esbuild (dep pre-bundling) | Rolldown |
| Rollup (production build) | Rolldown |
| `rollupOptions` | `rolldownOptions` |
| `esbuild` option | `oxc` option |

## Performance Impact

- 10-30x faster than Rollup for production builds
- Matches esbuild dev performance
- Unified behavior across dev + build

## Config Migration

### rollupOptions → rolldownOptions

```ts
// Before (Vite 7)
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['vue'],
      output: { globals: { vue: 'Vue' } },
    },
  },
})

// After (Vite 8)
export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['vue'],
      output: { globals: { vue: 'Vue' } },
    },
  },
})
```

### esbuild → oxc

```ts
// Before (Vite 7)
export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
})

// After (Vite 8)
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'classic',
      pragma: 'h',
      pragmaFrag: 'Fragment',
    },
  },
})
```

### JSX Configuration

```ts
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',  // or 'classic'
      importSource: 'react', // for automatic runtime
    },
    jsxInject: `import React from 'react'`,  // auto-inject
  },
})
```

### Custom Transform Targets

```ts
export default defineConfig({
  oxc: {
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules/**'],
  },
})
```

## Plugin Compatibility

Most Vite plugins work unchanged. Rolldown supports Rollup plugin API.

Plugin only works during build:

```ts
{
  ...rollupPlugin(),
  enforce: 'post',
  apply: 'build',
}
```

## New Capabilities

Rolldown unlocks features previously impossible:

- Full bundle mode (experimental)
- Module-level persistent cache
- More flexible chunk splitting
- Module Federation support

## Gradual Migration

Large projects: migrate via `rolldown-vite` first:

```bash
# Step 1: Test with rolldown-vite
pnpm add -D rolldown-vite

# Replace vite import in config
import { defineConfig } from 'rolldown-vite'

# Step 2: Once stable, upgrade to Vite 8
pnpm add -D vite@8
```

## Overriding Vite in Frameworks

Framework depends on older Vite:

```json
{
  "pnpm": {
    "overrides": {
      "vite": "8.0.0"
    }
  }
}
```

<!--
Source references:
- https://vite.dev/blog/announcing-vite8-beta
- https://vite.dev/blog/announcing-vite7
- https://vite.dev/config/shared-options#oxc
-->
