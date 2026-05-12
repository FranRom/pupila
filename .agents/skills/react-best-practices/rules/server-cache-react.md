---
title: Per-Request Deduplication with React.cache()
impact: MEDIUM
impactDescription: deduplicates within request
tags: server, cache, react-cache, deduplication
---

## Per-Request Deduplication with React.cache()

`React.cache()` for server-side request dedup. Auth + DB queries benefit most.

**Usage:**

```typescript
import { cache } from 'react'

export const getCurrentUser = cache(async () => {
  const session = await auth()
  if (!session?.user?.id) return null
  return await db.user.findUnique({
    where: { id: session.user.id }
  })
})
```

Within single request, multiple `getCurrentUser()` calls run query once.

**Avoid inline objects as args:**

`React.cache()` uses shallow eq (`Object.is`) for cache hits. Inline objects = new refs each call → no cache hits.

**Incorrect (always cache miss):**

```typescript
const getUser = cache(async (params: { uid: number }) => {
  return await db.user.findUnique({ where: { id: params.uid } })
})

// Each call creates new object, never hits cache
getUser({ uid: 1 })
getUser({ uid: 1 })  // Cache miss, runs query again
```

**Correct (cache hit):**

```typescript
const getUser = cache(async (uid: number) => {
  return await db.user.findUnique({ where: { id: uid } })
})

// Primitive args use value equality
getUser(1)
getUser(1)  // Cache hit, returns cached result
```

Must pass objects → use same reference:

```typescript
const params = { uid: 1 }
getUser(params)  // Query runs
getUser(params)  // Cache hit (same reference)
```

**Next.js-specific note:**

Next.js auto-extends `fetch` with request memoization. Requests with same URL + options auto-dedup within single request → `React.cache()` not needed for `fetch`. But still essential for other async tasks:

- DB queries (Prisma, Drizzle, etc.)
- Heavy computations
- Auth checks
- FS ops
- Any non-fetch async work

Use `React.cache()` to dedup these across component tree.

Reference: [React.cache documentation](https://react.dev/reference/react/cache)
