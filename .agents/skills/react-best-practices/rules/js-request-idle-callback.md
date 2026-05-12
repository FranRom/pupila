---
title: Defer Non-Critical Work with requestIdleCallback
impact: MEDIUM
impactDescription: keeps UI responsive during background tasks
tags: javascript, performance, idle, scheduling, analytics
---

## Defer Non-Critical Work with requestIdleCallback

**Impact: MEDIUM (keeps UI responsive during background tasks)**

`requestIdleCallback()` schedules non-critical work during browser idle. Frees main thread for interactions + animations → less jank, better perceived perf.

**Incorrect (blocks main thread during user interaction):**

```typescript
function handleSearch(query: string) {
  const results = searchItems(query)
  setResults(results)

  // These block the main thread immediately
  analytics.track('search', { query })
  saveToRecentSearches(query)
  prefetchTopResults(results.slice(0, 3))
}
```

**Correct (defers non-critical work to idle):**

```typescript
function handleSearch(query: string) {
  const results = searchItems(query)
  setResults(results)

  // Defer non-critical work to idle periods
  requestIdleCallback(() => {
    analytics.track('search', { query })
  })

  requestIdleCallback(() => {
    saveToRecentSearches(query)
  })

  requestIdleCallback(() => {
    prefetchTopResults(results.slice(0, 3))
  })
}
```

**With timeout for required work:**

```typescript
// Ensure analytics fires within 2 seconds even if browser stays busy
requestIdleCallback(
  () => analytics.track('page_view', { path: location.pathname }),
  { timeout: 2000 }
)
```

**Chunking large tasks:**

```typescript
function processLargeDataset(items: Item[]) {
  let index = 0

  function processChunk(deadline: IdleDeadline) {
    // Process items while we have idle time (aim for <50ms chunks)
    while (index < items.length && deadline.timeRemaining() > 0) {
      processItem(items[index])
      index++
    }

    // Schedule next chunk if more items remain
    if (index < items.length) {
      requestIdleCallback(processChunk)
    }
  }

  requestIdleCallback(processChunk)
}
```

**Fallback for unsupported browsers:**

```typescript
const scheduleIdleWork = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1))

scheduleIdleWork(() => {
  // Non-critical work
})
```

**Use for:**

- Analytics + telemetry
- Save state to `localStorage`/`IndexedDB`
- Prefetch resources for likely next actions
- Non-urgent data transforms
- Lazy init of non-critical features

**Don't use for:**

- User-initiated actions needing immediate feedback
- Render updates user is waiting for
- Time-sensitive ops
