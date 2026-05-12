---
title: Parallel Nested Data Fetching
impact: CRITICAL
impactDescription: eliminates server-side waterfalls
tags: server, rsc, parallel-fetching, promise-chaining
---

## Parallel Nested Data Fetching

Fetching nested data in parallel → chain dependent fetches within each item's promise. Slow item won't block rest.

**Incorrect (one slow item blocks all nested fetches):**

```tsx
const chats = await Promise.all(
  chatIds.map(id => getChat(id))
)

const chatAuthors = await Promise.all(
  chats.map(chat => getUser(chat.author))
)
```

One slow `getChat(id)` out of 100 → authors of other 99 chats can't start loading even though data ready.

**Correct (each item chains own nested fetch):**

```tsx
const chatAuthors = await Promise.all(
  chatIds.map(id => getChat(id).then(chat => getUser(chat.author)))
)
```

Each item independently chains `getChat` → `getUser`. Slow chat doesn't block author fetches for others.
