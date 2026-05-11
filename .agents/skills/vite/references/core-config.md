---
name: vite-config
description: Vite configuration patterns using vite.config.ts
---

# Vite Configuration

## Basic Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  // config options
})
```

Vite auto-resolves `vite.config.ts` from project root. ESM syntax regardless of `package.json` type.

## Conditional Config

Export function to access command + mode:

```ts
export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  if (command === 'serve') {
    return { /* dev config */ }
  } else {
    return { /* build config */ }
  }
})
```

- `command`: `'serve'` dev, `'build'` prod
- `mode`: `'development'` | `'production'` (custom via `--mode`)

## Async Config

```ts
export default defineConfig(async ({ command, mode }) => {
  const data = await fetchSomething()
  return { /* config */ }
})
```

## Environment Variables in Config

`.env` loads **after** config resolution. Use `loadEnv`:

```ts
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load env from cwd, all vars (empty prefix)
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV),
    },
    server: {
      port: env.APP_PORT ? Number(env.APP_PORT) : 5173,
    },
  }
})
```

## Key Config Options

### resolve.alias

```ts
export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
      '~': '/src',
    },
  },
})
```

### define (Global Constants)

```ts
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('1.0.0'),
    __API_URL__: 'window.__backend_api_url',
  },
})
```

Values: JSON-serializable or single identifiers. Non-strings auto-wrapped via `JSON.stringify`.

### plugins

```ts
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
})
```

Plugins array flattened; falsy values ignored.

### server.proxy

```ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

### build.target

Default: Baseline Widely Available browsers. Customize:

```ts
export default defineConfig({
  build: {
    target: 'esnext', // or 'es2020', ['chrome90', 'firefox88']
  },
})
```

## TypeScript Intellisense

Plain JS config:

```js
/** @type {import('vite').UserConfig} */
export default {
  // ...
}
```

Or `satisfies`:

```ts
import type { UserConfig } from 'vite'

export default {
  // ...
} satisfies UserConfig
```

<!--
Source references:
- https://vite.dev/config/
- https://vite.dev/guide/
-->
