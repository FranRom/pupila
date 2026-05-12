---
title: Avoid Barrel File Imports
impact: CRITICAL
impactDescription: 200-800ms import cost, slow builds
tags: bundle, imports, tree-shaking, barrel-files, performance
---

## Avoid Barrel File Imports

Import directly from source files. Don't load thousands of unused modules via barrels. **Barrel files** = entry points re-exporting multiple modules (e.g., `index.js` does `export * from './module'`).

Popular icon/component libs can have **up to 10,000 re-exports** in entry file. Many React packages take **200-800ms just to import** — hits dev speed + prod cold starts.

**Why tree-shaking can't help:** Lib marked external (not bundled) → bundler can't optimize. Bundle it for tree-shaking → builds slow analyzing entire module graph.

**Incorrect (imports entire lib):**

```tsx
import { Check, X, Menu } from 'lucide-react'
// Loads 1,583 modules, takes ~2.8s extra in dev
// Runtime cost: 200-800ms on every cold start

import { Button, TextField } from '@mui/material'
// Loads 2,225 modules, takes ~4.2s extra in dev
```

**Correct - Next.js 13.5+ (recommended):**

```js
// next.config.js - automatically optimizes barrel imports at build time
module.exports = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@mui/material']
  }
}
```

```tsx
// Keep the standard imports - Next.js transforms them to direct imports
import { Check, X, Menu } from 'lucide-react'
// Full TypeScript support, no manual path wrangling
```

Recommended: preserves TS type safety + editor autocomplete, kills barrel cost.

**Correct - Direct imports (non-Next.js):**

```tsx
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
// Loads only what you use
```

> **TS warning:** Some libs (notably `lucide-react`) don't ship `.d.ts` for deep import paths. Importing from `lucide-react/dist/esm/icons/check` resolves to implicit `any` → errors under `strict` or `noImplicitAny`. Prefer `optimizePackageImports` when available, or verify lib exports types for subpaths before direct imports.

These opts: 15-70% faster dev boot, 28% faster builds, 40% faster cold starts, faster HMR.

Libs commonly affected: `lucide-react`, `@mui/material`, `@mui/icons-material`, `@tabler/icons-react`, `react-icons`, `@headlessui/react`, `@radix-ui/react-*`, `lodash`, `ramda`, `date-fns`, `rxjs`, `react-use`.

Reference: [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
