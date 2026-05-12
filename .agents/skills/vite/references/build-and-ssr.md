---
name: vite-build-ssr
description: Vite library mode, multi-page apps, JavaScript API, and SSR guidance
---

# Build and SSR

## Library Mode

Build library for distribution:

```ts
// vite.config.ts
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'lib/main.ts'),
      name: 'MyLib',
      fileName: 'my-lib',
    },
    rolldownOptions: {
      external: ['vue', 'react'],
      output: {
        globals: {
          vue: 'Vue',
          react: 'React',
        },
      },
    },
  },
})
```

### Multiple Entries

```ts
build: {
  lib: {
    entry: {
      'my-lib': resolve(import.meta.dirname, 'lib/main.ts'),
      secondary: resolve(import.meta.dirname, 'lib/secondary.ts'),
    },
    name: 'MyLib',
  },
}
```

### Output Formats

- Single entry: `es` + `umd`
- Multiple entries: `es` + `cjs`

### Package.json Setup

```json
{
  "name": "my-lib",
  "type": "module",
  "files": ["dist"],
  "main": "./dist/my-lib.umd.cjs",
  "module": "./dist/my-lib.js",
  "exports": {
    ".": {
      "import": "./dist/my-lib.js",
      "require": "./dist/my-lib.umd.cjs"
    },
    "./style.css": "./dist/my-lib.css"
  }
}
```

## Multi-Page App

```ts
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        nested: resolve(import.meta.dirname, 'nested/index.html'),
      },
    },
  },
})
```

## SSR Development

**Note:** Vite SSR is **low-level**, designed mostly for meta-framework authors, not app developers. App SSR? Use Vite-based meta-framework:

- **Nuxt** (Vue) — https://nuxt.com
- **SvelteKit** (Svelte) — https://svelte.dev/docs/kit
- **SolidStart** (Solid) — https://start.solidjs.com
- **TanStack Start** (React) — https://tanstack.com/start

Frameworks build on Vite SSR primitives, no manual wiring.

**Need a server?** [Nitro](https://nitro.build) — "Vite for servers." Portable framework-agnostic server layer, file-based API routing, auto-imports, deployment presets (Node.js, Deno, Bun, Cloudflare Workers, Vercel, Netlify, etc.). Integrates with Vite, powers Nuxt server engine. See [Nitro docs](https://nitro.build).

## JavaScript API

### createServer

```ts
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  server: { port: 1337 },
})

await server.listen()
server.printUrls()
```

### build

```ts
import { build } from 'vite'

await build({
  root: './project',
  build: { outDir: 'dist' },
})
```

### preview

```ts
import { preview } from 'vite'

const previewServer = await preview({
  preview: { port: 8080, open: true },
})
previewServer.printUrls()
```

### resolveConfig

```ts
import { resolveConfig } from 'vite'

const config = await resolveConfig({}, 'build')
```

### loadEnv

```ts
import { loadEnv } from 'vite'

const env = loadEnv('development', process.cwd(), '')
// All env vars (empty prefix = no filter)
```

<!--
Source references:
- https://vite.dev/guide/build
- https://vite.dev/guide/api-javascript
- https://nitro.build
-->
