---
title: Use Functional setState Updates
impact: MEDIUM
impactDescription: prevents stale closures and unnecessary callback recreations
tags: react, hooks, useState, useCallback, callbacks, closures
---

## Use Functional setState Updates

Updating state based on current value → use functional update form, not direct reference. Prevents stale closures, kills unneeded deps, creates stable callback refs.

**Incorrect (needs state as dep):**

```tsx
function TodoList() {
  const [items, setItems] = useState(initialItems)
  
  // Callback must depend on items, recreated on every items change
  const addItems = useCallback((newItems: Item[]) => {
    setItems([...items, ...newItems])
  }, [items])  // ❌ items dependency causes recreations
  
  // Risk of stale closure if dependency is forgotten
  const removeItem = useCallback((id: string) => {
    setItems(items.filter(item => item.id !== id))
  }, [])  // ❌ Missing items dependency - will use stale items!
  
  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

First callback recreated every `items` change → child re-renders. Second has stale closure bug — always references initial `items`.

**Correct (stable callbacks, no stale closures):**

```tsx
function TodoList() {
  const [items, setItems] = useState(initialItems)
  
  // Stable callback, never recreated
  const addItems = useCallback((newItems: Item[]) => {
    setItems(curr => [...curr, ...newItems])
  }, [])  // ✅ No dependencies needed
  
  // Always uses latest state, no stale closure risk
  const removeItem = useCallback((id: string) => {
    setItems(curr => curr.filter(item => item.id !== id))
  }, [])  // ✅ Safe and stable
  
  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

**Benefits:**

1. **Stable callback refs** — no recreate on state change
2. **No stale closures** — always operates on latest state
3. **Fewer deps** — simpler dep arrays, less memory leak risk
4. **Prevents bugs** — eliminates most common React closure bugs

**Use functional updates for:**

- Any setState depending on current state value
- Inside `useCallback`/`useMemo` when state needed
- Event handlers referencing state
- Async ops updating state

**Direct updates fine for:**

- Static value: `setCount(0)`
- From props/args only: `setName(newName)`
- No dep on previous value

**Note:** [React Compiler](https://react.dev/learn/react-compiler) can auto-optimize some cases, but functional updates still recommended for correctness + stale closure prevention.
