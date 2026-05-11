---
name: test-environments
description: Configure environments like jsdom, happy-dom for browser APIs
---

# Test Environments

## Available Environments

- `node` (default) — Node.js
- `jsdom` — browser-like, DOM APIs
- `happy-dom` — faster jsdom alternative
- `edge-runtime` — Vercel Edge Runtime

## Configuration

```ts
// vitest.config.ts
defineConfig({
  test: {
    environment: 'jsdom',
    
    // Environment-specific options
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
  },
})
```

## Installing Environment Packages

```bash
# jsdom
npm i -D jsdom

# happy-dom (faster, fewer APIs)
npm i -D happy-dom
```

## Per-File Environment

Magic comment at file top:

```ts
// @vitest-environment jsdom

import { expect, test } from 'vitest'

test('DOM test', () => {
  const div = document.createElement('div')
  expect(div).toBeInstanceOf(HTMLDivElement)
})
```

## jsdom Environment

Full browser sim:

```ts
// @vitest-environment jsdom

test('DOM manipulation', () => {
  document.body.innerHTML = '<div id="app"></div>'
  
  const app = document.getElementById('app')
  app.textContent = 'Hello'
  
  expect(app.textContent).toBe('Hello')
})

test('window APIs', () => {
  expect(window.location.href).toBeDefined()
  expect(localStorage).toBeDefined()
})
```

### jsdom Options

```ts
defineConfig({
  test: {
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
        html: '<!DOCTYPE html><html><body></body></html>',
        userAgent: 'custom-agent',
        resources: 'usable',
      },
    },
  },
})
```

## happy-dom Environment

Faster, fewer APIs:

```ts
// @vitest-environment happy-dom

test('basic DOM', () => {
  const el = document.createElement('div')
  el.className = 'test'
  expect(el.className).toBe('test')
})
```

## Multiple Environments per Project

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
          name: 'dom',
          include: ['tests/dom/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
```

## Custom Environment

```ts
// vitest-environment-custom/index.ts
import type { Environment } from 'vitest/runtime'

export default <Environment>{
  name: 'custom',
  viteEnvironment: 'ssr', // or 'client'
  
  setup() {
    // Setup global state
    globalThis.myGlobal = 'value'
    
    return {
      teardown() {
        delete globalThis.myGlobal
      },
    }
  },
}
```

```ts
defineConfig({
  test: {
    environment: 'custom',
  },
})
```

## Environment with VM

```ts
export default <Environment>{
  name: 'isolated',
  viteEnvironment: 'ssr',
  
  async setupVM() {
    const vm = await import('node:vm')
    const context = vm.createContext()
    
    return {
      getVmContext() {
        return context
      },
      teardown() {},
    }
  },
  
  setup() {
    return { teardown() {} }
  },
}
```

## Browser Mode (Separate from Environments)

Real browser testing via Vitest Browser Mode:

```ts
defineConfig({
  test: {
    browser: {
      enabled: true,
      name: 'chromium', // or 'firefox', 'webkit'
      provider: 'playwright',
    },
  },
})
```

## CSS and Assets

```ts
defineConfig({
  test: {
    css: true, // Process CSS
    
    // Or with options
    css: {
      include: /\.module\.css$/,
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
})
```

## Fixing External Dependencies

```ts
defineConfig({
  test: {
    server: {
      deps: {
        inline: ['problematic-package'],
      },
    },
  },
})
```

## Key Points

- Default `node` — no browser APIs
- `jsdom` = full browser sim
- `happy-dom` = faster, basic DOM
- Per-file env via `// @vitest-environment`
- Projects for multiple env configs
- Browser Mode = real browser, not environment

<!-- 
Source references:
- https://vitest.dev/guide/environment.html
-->
