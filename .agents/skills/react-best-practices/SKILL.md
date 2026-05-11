---
name: vercel-react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on tasks involving React components, Next.js pages, data fetching, bundle optimization, or performance improvements.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# Vercel React Best Practices

Perf optimization guide for React/Next.js, by Vercel. 70 rules across 8 categories, prioritized by impact.

## When to Apply

Reference when:
- Writing new React components / Next.js pages
- Implementing data fetching (client or server)
- Reviewing code for perf issues
- Refactoring React/Next.js code
- Optimizing bundle size / load times

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Eliminating Waterfalls | CRITICAL | `async-` |
| 2 | Bundle Size Optimization | CRITICAL | `bundle-` |
| 3 | Server-Side Performance | HIGH | `server-` |
| 4 | Client-Side Data Fetching | MEDIUM-HIGH | `client-` |
| 5 | Re-render Optimization | MEDIUM | `rerender-` |
| 6 | Rendering Performance | MEDIUM | `rendering-` |
| 7 | JavaScript Performance | LOW-MEDIUM | `js-` |
| 8 | Advanced Patterns | LOW | `advanced-` |

## Quick Reference

### 1. Eliminating Waterfalls (CRITICAL)

- `async-cheap-condition-before-await` - Check cheap sync conditions before awaiting flags/remote values
- `async-defer-await` - Move await into branches where used
- `async-parallel` - `Promise.all()` for independent ops
- `async-dependencies` - better-all for partial deps
- `async-api-routes` - Start promises early, await late in API routes
- `async-suspense-boundaries` - Suspense to stream content

### 2. Bundle Size Optimization (CRITICAL)

- `bundle-barrel-imports` - Import directly, avoid barrel files
- `bundle-analyzable-paths` - Statically analyzable import/FS paths — avoid broad bundles/traces
- `bundle-dynamic-imports` - `next/dynamic` for heavy components
- `bundle-defer-third-party` - Load analytics/logging post-hydration
- `bundle-conditional` - Load modules only when feature activates
- `bundle-preload` - Preload on hover/focus for perceived speed

### 3. Server-Side Performance (HIGH)

- `server-auth-actions` - Authenticate server actions like API routes
- `server-cache-react` - `React.cache()` for per-request dedup
- `server-cache-lru` - LRU cache for cross-request caching
- `server-dedup-props` - Avoid duplicate serialization in RSC props
- `server-hoist-static-io` - Hoist static I/O (fonts, logos) to module level
- `server-no-shared-module-state` - Avoid module-level mutable request state in RSC/SSR
- `server-serialization` - Minimize data to client components
- `server-parallel-fetching` - Restructure components to parallelize fetches
- `server-parallel-nested-fetching` - Chain nested fetches per item in `Promise.all`
- `server-after-nonblocking` - `after()` for non-blocking ops

### 4. Client-Side Data Fetching (MEDIUM-HIGH)

- `client-swr-dedup` - SWR for auto request dedup
- `client-event-listeners` - Dedup global event listeners
- `client-passive-event-listeners` - Passive listeners for scroll
- `client-localstorage-schema` - Version + minimize localStorage data

### 5. Re-render Optimization (MEDIUM)

- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-memo-with-default-value` - Hoist default non-primitive props
- `rerender-dependencies` - Primitive deps in effects
- `rerender-derived-state` - Subscribe to derived booleans, not raw values
- `rerender-derived-state-no-effect` - Derive state during render, not in effects
- `rerender-functional-setstate` - Functional setState for stable callbacks
- `rerender-lazy-state-init` - Pass function to `useState` for expensive values
- `rerender-simple-expression-in-memo` - No memo for simple primitives
- `rerender-split-combined-hooks` - Split hooks with independent deps
- `rerender-move-effect-to-event` - Interaction logic in event handlers
- `rerender-transitions` - `startTransition` for non-urgent updates
- `rerender-use-deferred-value` - Defer expensive renders to keep input responsive
- `rerender-use-ref-transient-values` - Refs for transient frequent values
- `rerender-no-inline-components` - No components inside components

### 6. Rendering Performance (MEDIUM)

- `rendering-animate-svg-wrapper` - Animate div wrapper, not SVG element
- `rendering-content-visibility` - `content-visibility` for long lists
- `rendering-hoist-jsx` - Extract static JSX outside components
- `rendering-svg-precision` - Reduce SVG coord precision
- `rendering-hydration-no-flicker` - Inline script for client-only data
- `rendering-hydration-suppress-warning` - Suppress expected mismatches
- `rendering-activity` - `Activity` component for show/hide
- `rendering-conditional-render` - Ternary, not `&&`, for conditionals
- `rendering-usetransition-loading` - Prefer `useTransition` for loading state
- `rendering-resource-hints` - React DOM resource hints for preload
- `rendering-script-defer-async` - `defer` or `async` on script tags

### 7. JavaScript Performance (LOW-MEDIUM)

- `js-batch-dom-css` - Group CSS changes via classes or `cssText`
- `js-index-maps` - Build Map for repeated lookups
- `js-cache-property-access` - Cache object props in loops
- `js-cache-function-results` - Cache function results in module-level Map
- `js-cache-storage` - Cache `localStorage`/`sessionStorage` reads
- `js-combine-iterations` - Combine multiple filter/map into one loop
- `js-length-check-first` - Check array length before expensive comparison
- `js-early-exit` - Return early
- `js-hoist-regexp` - Hoist `RegExp` creation outside loops
- `js-min-max-loop` - Loop for min/max instead of sort
- `js-set-map-lookups` - Set/Map for O(1) lookups
- `js-tosorted-immutable` - `toSorted()` for immutability
- `js-flatmap-filter` - `flatMap` to map + filter in one pass
- `js-request-idle-callback` - Defer non-critical work to browser idle

### 8. Advanced Patterns (LOW)

- `advanced-effect-event-deps` - Don't put `useEffectEvent` results in effect deps
- `advanced-event-handler-refs` - Store event handlers in refs
- `advanced-init-once` - Init app once per app load
- `advanced-use-latest` - `useLatest` for stable callback refs

## How to Use

Read rule files for details + examples:

```
rules/async-parallel.md
rules/bundle-barrel-imports.md
```

Each rule contains:
- Why it matters
- Incorrect example + explanation
- Correct example + explanation
- Context + refs

## Full Compiled Document

Complete guide with all rules: `AGENTS.md`
