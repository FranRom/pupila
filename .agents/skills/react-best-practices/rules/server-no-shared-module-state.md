---
title: Avoid Shared Module State for Request Data
impact: HIGH
impactDescription: prevents concurrency bugs and request data leaks
tags: server, rsc, ssr, concurrency, security, state
---

## Avoid Shared Module State for Request Data

For RSC + client components rendered during SSR, don't use mutable module-level vars for request-scoped data. Server renders can run concurrently in same process. One render writes to shared module state, another reads → race conditions, cross-request contamination, security bugs (user A's data appears in user B's response).

Treat module scope on server as process-wide shared memory, NOT request-local state.

**Incorrect (request data leaks across concurrent renders):**

```tsx
let currentUser: User | null = null

export default async function Page() {
  currentUser = await auth()
  return <Dashboard />
}

async function Dashboard() {
  return <div>{currentUser?.name}</div>
}
```

Two overlapping requests: request A sets `currentUser`, request B overwrites before A finishes rendering `Dashboard`.

**Correct (keep request data local to render tree):**

```tsx
export default async function Page() {
  const user = await auth()
  return <Dashboard user={user} />
}

function Dashboard({ user }: { user: User | null }) {
  return <div>{user?.name}</div>
}
```

Safe exceptions:

- Immutable static assets / config loaded once at module scope
- Shared caches designed for cross-request reuse + keyed correctly
- Process-wide singletons not storing request/user-specific mutable data

For static assets + config, see [Hoist Static I/O to Module Level](./server-hoist-static-io.md).
