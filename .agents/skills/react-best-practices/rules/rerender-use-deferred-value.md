---
title: Use useDeferredValue for Expensive Derived Renders
impact: MEDIUM
impactDescription: keeps input responsive during heavy computation
tags: rerender, useDeferredValue, optimization, concurrent
---

## Use useDeferredValue for Expensive Derived Renders

User input triggers expensive computations/renders → `useDeferredValue` keeps input responsive. Deferred value lags behind → React prioritizes input update + renders expensive result when idle.

**Incorrect (input feels laggy during filter):**

```tsx
function Search({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('')
  const filtered = items.filter(item => fuzzyMatch(item, query))

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <ResultsList results={filtered} />
    </>
  )
}
```

**Correct (input stays snappy, results render when ready):**

```tsx
function Search({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(
    () => items.filter(item => fuzzyMatch(item, deferredQuery)),
    [items, deferredQuery]
  )
  const isStale = query !== deferredQuery

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.7 : 1 }}>
        <ResultsList results={filtered} />
      </div>
    </>
  )
}
```

**Use for:**

- Filter/search large lists
- Expensive visualizations (charts, graphs) reacting to input
- Any derived state causing noticeable render delays

**Note:** Wrap expensive computation in `useMemo` with deferred value as dep — otherwise still runs on every render.

Reference: [React useDeferredValue](https://react.dev/reference/react/useDeferredValue)
