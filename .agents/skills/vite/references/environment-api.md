---
name: vite-environment-api
description: Vite 6+ Environment API for multiple runtime environments
---

# Environment API (Vite 6+)

Environment API formalizes multiple runtime environments beyond traditional client/SSR split.

## Concept

Before Vite 6: two implicit environments (`client`, `ssr`).

Vite 6+: configure as many environments as needed (browser, node server, edge server, etc.).

## Basic Configuration

SPA/MPA: nothing changes — options apply to implicit `client` environment:

```ts
export default defineConfig({
  build: { sourcemap: false },
  optimizeDeps: { include: ['lib'] },
})
```

## Multiple Environments

```ts
export default defineConfig({
  build: { sourcemap: false },  // Inherited by all environments
  optimizeDeps: { include: ['lib'] },  // Client only
  environments: {
    // SSR environment
    server: {},
    // Edge runtime environment
    edge: {
      resolve: { noExternal: true },
    },
  },
})
```

Environments inherit top-level config. Some options (e.g. `optimizeDeps`) apply only to `client` by default — explicitly set per environment to override.

## Environment Options

```ts
interface EnvironmentOptions {
  define?: Record<string, any>
  resolve?: EnvironmentResolveOptions
  optimizeDeps: DepOptimizationOptions
  consumer?: 'client' | 'server'
  dev: DevOptions
  build: BuildOptions
}
```

`consumer` distinguishes client vs server environments — controls default behavior for `optimizeDeps`, asset handling, etc.

## Custom Environment Instances

Runtime providers define custom environments:

```ts
import { customEnvironment } from 'vite-environment-provider'

export default defineConfig({
  environments: {
    ssr: customEnvironment({
      build: { outDir: '/dist/ssr' },
    }),
  },
})
```

Example: Cloudflare Vite plugin runs code in `workerd` runtime during dev.

## Backward Compatibility

- `server.moduleGraph` returns mixed client/SSR view
- `ssrLoadModule` still works
- Existing SSR apps work unchanged

## When to Use

- **End users**: usually don't configure — frameworks handle it
- **Plugin authors**: environment-aware transformations
- **Framework authors**: custom environments for runtime needs

## Plugin Environment Access

Plugins access environment in hooks:

```ts
{
  name: 'env-aware',
  transform(code, id, options) {
    if (options?.ssr) {
      // SSR-specific transform
    }
  },
}
```

<!--
Source references:
- https://vite.dev/guide/api-environment
- https://vite.dev/blog/announcing-vite6
-->
