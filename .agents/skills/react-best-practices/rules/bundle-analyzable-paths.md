---
title: Prefer Statically Analyzable Paths
impact: HIGH
impactDescription: avoids accidental broad bundles and file traces
tags: bundle, nextjs, vite, webpack, rollup, esbuild, path
---

## Prefer Statically Analyzable Paths

Build tools work best when import + FS paths are obvious at build time. Hide the real path in a variable or compose too dynamically → tool either includes broad file set, warns it can't analyze, or widens file tracing to be safe.

Use explicit maps or literal paths so reachable file set stays narrow + predictable. Same rule for `import()` and reading files in server/build code.

Broad analysis costs:
- Larger server bundles
- Slower builds
- Worse cold starts
- More memory

### Import Paths

**Incorrect (bundler can't tell what may be imported):**

```ts
const PAGE_MODULES = {
  home: './pages/home',
  settings: './pages/settings',
} as const

const Page = await import(PAGE_MODULES[pageName])
```

**Correct (explicit map of allowed modules):**

```ts
const PAGE_MODULES = {
  home: () => import('./pages/home'),
  settings: () => import('./pages/settings'),
} as const

const Page = await PAGE_MODULES[pageName]()
```

### File-System Paths

**Incorrect (2-value enum hides final path from static analysis):**

```ts
const baseDir = path.join(process.cwd(), 'content/' + contentKind)
```

**Correct (each final path literal at callsite):**

```ts
const baseDir =
  kind === ContentKind.Blog
    ? path.join(process.cwd(), 'content/blog')
    : path.join(process.cwd(), 'content/docs')
```

Next.js server code: matters for output file tracing too. `path.join(process.cwd(), someVar)` can widen traced file set because Next.js statically analyzes `import`, `require`, `fs`.

Reference: [Next.js output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Next.js dynamic imports](https://nextjs.org/learn/seo/dynamic-imports), [Vite features](https://vite.dev/guide/features.html), [esbuild API](https://esbuild.github.io/api/), [Rollup dynamic import vars](https://www.npmjs.com/package/@rollup/plugin-dynamic-import-vars), [Webpack dependency management](https://webpack.js.org/guides/dependency-management/)
