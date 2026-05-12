---
title: Check Cheap Conditions Before Async Flags
impact: HIGH
impactDescription: avoids unnecessary async work when a synchronous guard already fails
tags: async, await, feature-flags, short-circuit, conditional
---

## Check Cheap Conditions Before Async Flags

Branch uses `await` for flag/remote value AND needs a **cheap sync** condition (local props, request metadata, loaded state) — eval cheap one **first**. Otherwise you pay the async call even when compound can't be true.

Specialization of [Defer Await Until Needed](./async-defer-await.md) for `flag && cheapCondition` checks.

**Incorrect:**

```typescript
const someFlag = await getFlag()

if (someFlag && someCondition) {
  // ...
}
```

**Correct:**

```typescript
if (someCondition) {
  const someFlag = await getFlag()
  if (someFlag) {
    // ...
  }
}
```

Matters when `getFlag` hits network, feature-flag service, `React.cache` / DB: skipping when `someCondition` false removes cold-path cost.

Keep original order if `someCondition` expensive, depends on flag, or side effects must run in fixed order.
