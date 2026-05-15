# UI patterns

Canonical structure for the `ui/` codebase. **Read this before adding components, fetching, or styling anything.** If you're tempted to deviate, leave a comment with why — pattern drift turns into the next refactor PR.

Two architectural rules, each with a small set of mechanics.

---

## 1. Styling: CSS Modules per component

**One golden rule:** never write a class name as a string. Every class comes from a `*.module.css` import.

### File layout

```
ui/src/
  styles/
    tokens.css        ← global, design tokens (colors, spacing, shadows)
    base.css          ← global, reset + prefers-reduced-motion
    index.css         ← imports tokens + base only
    Button.module.css ← shared design-system module
    Badge.module.css
    Tab.module.css
    Chip.module.css
    Banner.module.css
    Dock.module.css
    Spinner.module.css
  jobs/
    AppHeader.tsx
    AppHeader.module.css   ← co-located, component-local
    ...
  swipe/
    SwipeCard.tsx
    SwipeCard.module.css
    ...
```

### What stays global vs. modular

- `tokens.css` + `base.css` — **global**. Design tokens and the CSS reset are correctly cross-cutting.
- Everything else — **module**. Including animations (`@keyframes`) and media queries scoped to one component.

### Conventions

- **camelCase selectors** in `.module.css` files. Matches JS access (`styles.signalChip`, not `styles['signal-chip']`).
- **`composes:`** for variant→base inheritance inside a single module. Example: `.primary { composes: base; background: ... }` in `Button.module.css`. Consumer writes `<button className={buttonStyles.primary}>` and gets both classes applied.
- **Cross-module composition** happens at the JS level via `clsx`, not via `composes: foo from '../Other.module.css'`. Modules stay self-contained.
- **Conditional joining** uses `clsx(...)`:
  ```tsx
  className={clsx(styles.pill, isActive && styles.pillActive, variant && styles[variant])}
  ```
- **Mutually-exclusive variants** use a ternary, not clsx with both true/false branches:
  ```tsx
  className={isActive ? styles.tabActive : styles.tab}
  ```
- **Variant maps** for class lookups by string key — `as const` to keep TypeScript happy with `noUncheckedIndexedAccess`:
  ```tsx
  const STATUS_VARIANT_CLASS = {
    applied: styles.applied,
    interview: styles.interview,
    // ...
  } as const;
  ```

### Adding styles to a new component

1. Create `Component.module.css` next to `Component.tsx`.
2. Import as `import styles from './Component.module.css'`.
3. Import shared modules as `buttonStyles`, `badgeStyles`, `tabStyles`, `chipStyles`, `bannerStyles`, `dockStyles`, `spinnerStyles` — never repurpose a name.
4. Use only `var(--token)` for colours / spacing / shadows. No raw hex / rgba.

### Anti-patterns (don't do this)

- ❌ Writing `className="some-class"` as a string literal.
- ❌ Creating a new global `*.css` file outside `tokens.css` / `base.css`.
- ❌ Hardcoded colours or pixel values. Use tokens.
- ❌ Inline styles for anything reusable. (One-off positioning is fine.)
- ❌ Importing the same shared module under different alias names.

### Canonical examples to copy from

- **Simple co-located**: `ui/src/jobs/AppHeader.tsx` + `AppHeader.module.css`
- **Variant + composes**: `ui/src/styles/Button.module.css`
- **Conditional joining with shared + local**: `ui/src/jobs/AppliedBar.tsx`
- **Cross-module sharing of a chip primitive**: `ui/src/styles/Chip.module.css`, consumed by `SignalChips` and `SwipeCard`

---

## 2. HTTP: the typed `api` client

**One golden rule:** never write `fetch('/api/...')` at a call site. Every server call goes through `ui/src/lib/api/`.

### File layout

```
ui/src/lib/api/
  client.ts   ← low-level: request(), Result<T>, ApiError, formatError(), path()
  index.ts    ← typed resource surface: api.jobs, api.applyQueue, api.applied, ...
```

### The model

- **`Result<T>`** = `{ ok: true; value: T } | { ok: false; error: ApiError }`. Methods never throw; they return Results.
- **`ApiError`** discriminated union — four kinds:
  - `http` — non-2xx response, carries `status`, `statusText`, best-effort `body`.
  - `network` — fetch threw (offline, DNS, CORS).
  - `abort` — caller's `AbortSignal` fired.
  - `parse` — server returned invalid JSON when JSON was expected.
- **`formatError(err)`** renders any `ApiError` to a user-facing string. Use this in every `setApiError(...)`.
- **AbortSignal** is opt-in via the last `{ signal }` arg on every method. Required for effect-loaders / pollers; optional for fire-and-forget handlers.

### The call-site pattern

```ts
const r = await api.applied.set({ url, status, date });
if (!r.ok) {
  if (r.error.kind === 'abort') return;
  setApiError(formatError(r.error));
  return;
}
setApplied(r.value);
```

Variations:

- **Silent error tolerance** (pollers): drop the `setApiError`; just no-op on `!r.ok`.
- **Specific HTTP status is fine** (e.g. 409 = "already queued"):
  ```ts
  if (!r.ok && !(r.error.kind === 'http' && r.error.status === 409)) { ... }
  ```
- **Inside `useEffect` with cleanup**: pass `signal` from the AbortController, branch on `r.error.kind === 'abort'` to skip the cleanup.

### Adding a new endpoint

1. Add the response shape to `ui/src/lib/api/index.ts` (or to `ui/src/types.ts` if cross-cutting).
2. Add the method under the appropriate `api.<resource>` namespace.
3. Use `path('/api/foo', segment)` for URL-encoded path segments — never inline `\`/api/foo/\${encodeURIComponent(x)}\``.
4. Use `expectJson: false` on the `request<T>(...)` call when the server returns 204 / non-JSON; the typed return is `void`.
5. **DO NOT** add an inline `fetch('/api/...')` at a call site. If a method is missing, add it to the api module in a focused edit and continue.

### Anti-patterns (don't do this)

- ❌ `fetch('/api/...')` anywhere except inside `ui/src/lib/api/client.ts`.
- ❌ Inline `interface FooResponse { … }` in a component. Hoist it to `lib/api/index.ts`.
- ❌ `try/catch` + `err instanceof Error && err.name === 'AbortError'`. Use `r.error.kind === 'abort'`.
- ❌ Throwing from an api method. Return a `Result` instead.
- ❌ `JSON.stringify(...)` + manual `Content-Type` headers. Use `{ json: ... }` on `request()`.
- ❌ Constructing the same `\`HTTP \${res.status}\`` string at every call site. Use `formatError(err)`.

### Canonical examples to copy from

- **Read with abort**: `ui/src/App.tsx` — the preferences load `useEffect` (around the mount).
- **Mutation with optimistic + rollback**: `ui/src/App.tsx` — `setApplied` callback.
- **Polling**: `ui/src/FetchProgress.tsx` — `api.fetchJobs.status` tick.
- **409 as success**: `ui/src/swipe/SwipeDeck.tsx` — `handleAction('apply')` and `App.tsx`'s `enqueueJob`.

---

## 3. Feature hooks: one resource per hook

**One golden rule:** if `App.tsx` would carry more than ~2 `useState` calls for one concern, extract it to a feature hook under `ui/src/lib/hooks/`. App is a composer; hooks own data + lifecycle.

### File layout

```
ui/src/lib/hooks/
  useJobsData.ts        ← server snapshot (jobs.json + ai-reviews.json) + mount-load
  useApplied.ts         ← applied tracking, optimistic mutate + rollback
  useApplyQueue.ts      ← AI Apply queue, tab-gated polling, derived helpers
  useSwipeSkips.ts      ← unified isJobSkipped predicate (server + AI verdict + localStorage)
  useUrlSyncedState.ts  ← all filter / sort / group / tab state + history.replaceState writer
```

### Conventions

- **One hook owns one resource.** A resource is a coherent state slice + its mutations + its lifecycle (fetching, polling, persistence). The hook is the single source of truth for that resource.
- **Returns a stable shape.** `{ data, loading, refresh, mutate, ... }` or named-result shape. Document it with an exported `interface UseFooResult { ... }`.
- **Hooks own server + persistence state. App owns UI state (banner, modals).** Errors are surfaced via `onError?: (msg: string) => void` callback, not via an internal `apiError` field. UI display lives in App.
- **Derived values live in the hook**, not the consumer. If a consumer would `useMemo` something out of the hook's return, that memo belongs inside the hook.
- **Effects are encapsulated.** Polling, localStorage sync, AbortController setup — all inside the hook. App doesn't write `setInterval` or `useEffect(..., [])` for anything a hook can own.
- **Composition over coordination.** When one hook depends on another's data (e.g. `useSwipeSkips` reads `useApplyQueue.swipeSkipIds`), App passes the value as an arg. Hooks don't share state via context for first-party concerns.
- **TypeScript-first interface.** Args + result are exported interfaces named `UseFooArgs` / `UseFooResult`. Consumers import the types when needed.

### Adding a new hook

1. Create `ui/src/lib/hooks/useFoo.ts` co-located with its siblings.
2. Define `UseFooArgs` (if any) and `UseFooResult` interfaces. Export both.
3. Implement the hook. Use `useCallback` for all exposed mutators so consumers can pass them to `useEffect` deps without churn.
4. If the hook can fail an async op, accept `onError?: (msg: string) => void` (and optionally `onSuccess?: () => void`) so App can route to its banner.
5. If the hook polls or subscribes, do it inside the hook's `useEffect`. Accept a gate flag (e.g. `pollEnabled`) so the consumer can pause it tab-by-tab.
6. Compose in `App.tsx`. Destructure return at the top of `App()`. Pass cross-hook data through args.

### Anti-patterns (don't do this)

- ❌ `useState` inside `App()` for a concern that crosses more than one effect or mutation. Extract a hook.
- ❌ Two hooks reading the same server resource — pick one owner; the other reads it as an arg.
- ❌ `apiError` state inside a hook. Hooks surface errors via callback; App owns the banner.
- ❌ A hook that takes a setter as a dep instead of returning data. Dataflow goes hook → App, not App → hook.
- ❌ Mounting a hook conditionally (`if (showSwipe) useApplyQueue(...)`). Rules of Hooks — call unconditionally, pass gate flags inside.
- ❌ Re-deriving a value the hook already exposes (e.g. building a Set from the hook's `appliedById` keys when the hook could expose `appliedIds` directly).

### Canonical examples to copy from

- **Server snapshot + mount-load**: `ui/src/lib/hooks/useJobsData.ts`
- **Optimistic mutate + rollback + error routing**: `ui/src/lib/hooks/useApplied.ts`
- **Tab-gated polling + derived helpers**: `ui/src/lib/hooks/useApplyQueue.ts`
- **Composition (this hook reads another's data)**: `ui/src/lib/hooks/useSwipeSkips.ts`
- **localStorage sync + 13 settable values + URL writer**: `ui/src/lib/hooks/useUrlSyncedState.ts`
- **App as composer**: `ui/src/App.tsx`'s top — 5 destructured hooks before any local state, then a handful of cross-cutting useStates that genuinely belong in the root (banner, AI Apply trio, scheduler bookkeeping).

---

## 4. Testing: hooks + components in jsdom

**One golden rule:** test the public surface, mock the network. Hooks expose `{ data, mutate, ... }` — test those; never reach into implementation details. Components expose rendered DOM + callback wiring — test what the user sees and what fires when they click.

### File layout

```
ui/
  test-setup.ts                     ← jest-dom matchers, cleanup, localStorage/URL reset
  src/
    lib/hooks/
      useJobsData.ts
      useJobsData.test.ts           ← co-located, hook tests
      useApplied.test.ts
      useApplyQueue.test.ts
      useSwipeSkips.test.ts
      useUrlSyncedState.test.ts
    jobs/
      QueueBadge.tsx
      QueueBadge.test.tsx           ← co-located, component tests (.tsx)
      SignalChips.test.tsx
      AppliedBar.test.tsx
vitest.config.ts                    ← multi-project: backend (node) + ui (jsdom)
```

### What to test at each layer

- **`lib/api/`** — not unit-tested directly. Covered transitively by hook tests (they mock `globalThis.fetch` and exercise the full client → request → Result path).
- **`lib/hooks/`** — every hook ships with a test file. Cover: mount load, every public method on the result, error routing via `onError`/`onSuccess`, polling gates, localStorage / URL persistence.
- **Components** — favour high-value canonical examples (state-machine UIs, derived render branches, controlled-input plumbing) over exhaustive snapshot coverage. Three canonical examples ship today: `AppliedBar` (pill state machine + clear + notes), `SignalChips` (top-N sort + label rendering), `QueueBadge` (status-based render branches).
- **`App.tsx`** — not unit-tested. It's a composer; the parts it composes are covered.

### Mocking pattern: fetch, never the api object

Hook tests mock `globalThis.fetch` and route by URL + method. This exercises the **full** path (hook → api/index.ts → request() → fetch) so a regression in `client.ts` or a typo in an api method shows up here. Mocking the api object would skip that.

```ts
type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

// Endpoint-keyed variant when one test needs multiple URLs:
function mockEndpoints(handlers: Record<string, () => Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handlers[url]?.() ?? new Response('not mocked', { status: 500 });
  }) as typeof fetch;
}
```

Return a `new Response(JSON.stringify(body), { status })` or `new Response(null, { status: 204 })` for the 204-on-success endpoints (`expectJson: false`). `vi.restoreAllMocks()` in `afterEach` resets the fetch spy.

### Hook test shape

```ts
import { act, renderHook, waitFor } from '@testing-library/react';

it('does X', async () => {
  mockFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
  const { result } = renderHook(() => useFoo(args));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.mutate(...);
  });

  expect(result.current.data).toEqual(...);
});
```

Always wrap mutations in `act(async () => { ... })`. Always `waitFor` the post-mount state before asserting on hook output.

### Component test shape

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

it('fires callback when pill clicked', () => {
  const setApplied = vi.fn();
  render(<AppliedBar {...defaultProps} setApplied={setApplied} />);
  fireEvent.click(screen.getByTitle('Mark as applied'));
  expect(setApplied).toHaveBeenCalledWith(job, 'applied');
});
```

- Use `getByRole` / `getByTitle` / `getByText` — selectors that match what a screen-reader or human sees. **Do NOT** select by CSS Module class — they're hashed and brittle.
- For focus-dependent handlers (`input.blur()` from a keyDown), explicitly `input.focus()` first. jsdom doesn't auto-focus.
- Prefer `fireEvent` for narrow interaction tests; reach for `@testing-library/user-event` when realism matters (typing, paste, tab order).

### Running

```
pnpm test               # both projects (backend + ui), CI gate
pnpm run test:watch     # both projects in watch mode
```

`vitest.config.ts` defines two `projects`. The ui project sets `environment: 'jsdom'` and loads `ui/test-setup.ts` for matchers + cleanup. No filtering needed — backend tests stay node-only because they live under `tests/`.

### Anti-patterns (don't do this)

- ❌ `vi.mock('../api/index.ts')` to stub the api object. Mock `globalThis.fetch` instead — exercises more code.
- ❌ Asserting on hashed CSS Module class names (`expect(el).toHaveClass(styles.pillActive)`). Use `aria-pressed`, `getByRole`, `toBeInTheDocument`.
- ❌ `setTimeout(...)` to wait for async state. Use `waitFor(...)` from RTL.
- ❌ Calling mutations outside `act(async () => ...)`. React will warn; consumers may see stale renders.
- ❌ Adding a new hook without a co-located test file. The five existing hook tests are the contract.
- ❌ Reaching into `result.current.<internal>` that isn't part of the exported interface. Test the public surface.

### Canonical examples to copy from

- **Hook with mount load + reload**: `ui/src/lib/hooks/useJobsData.test.ts`
- **Hook with optimistic mutate + rollback**: `ui/src/lib/hooks/useApplied.test.ts`
- **Hook with polling gate + 409-as-success**: `ui/src/lib/hooks/useApplyQueue.test.ts`
- **Hook with localStorage**: `ui/src/lib/hooks/useSwipeSkips.test.ts`
- **Hook with URL sync**: `ui/src/lib/hooks/useUrlSyncedState.test.ts`
- **Render-branch component**: `ui/src/jobs/QueueBadge.test.tsx`
- **Sort + truncate render**: `ui/src/jobs/SignalChips.test.tsx`
- **Stateful component with controlled input**: `ui/src/jobs/AppliedBar.test.tsx`

---

## 5. Performance: code-split tabs + memoize hot children

**One golden rule:** the Jobs tab is the default landing surface; everything else loads on demand. Every code-split boundary needs a `React.lazy()` + a per-tab `<Suspense>` fallback. Every component rendered ~100+ times needs `React.memo` and stable-identity props from above.

### Code-split boundaries

```tsx
// App.tsx — lazy import + named-export → default unwrap
const Settings = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.Settings })));

// Per-tab Suspense boundary so a tab swap doesn't unmount + re-suspend siblings.
{tab === 'settings' && (
  <Suspense fallback={<p className={styles.placeholder}>Loading settings…</p>}>
    <Settings ... />
  </Suspense>
)}
```

Current splits (`ui/src/App.tsx`): `Onboarding`, `Profile`, `Settings`, `SwipeDeck`. Each is its own bundle chunk. The Jobs view (default landing) loads only the main JS + CSS.

### When to split

- Subtree only rendered when a non-default tab is active.
- One-shot UIs that hide forever after a flag flips (onboarding, modals).
- Subtree >5 kB gzipped that imports its own heavy deps (chart libs, markdown renderers, etc.).

### When NOT to split

- Anything rendered on first paint (the Jobs table, AppHeader, filter bar). It would just add a flash of fallback.
- Components shared across tabs (docks at App root: `FetchProgress`, `AiApplyProgress`, `SchedulerProgress`). They mount once and stay mounted.
- Tiny components (<3 kB). Round-trip overhead outweighs the size saving.

### `React.memo` for hot children

Rule of thumb: components rendered N>50 times per parent render should be memoized. The biggest offender in this codebase is `FragmentRow` (~1k instances). Cell-level components (`ScoreBar`, `SignalChips`, `QueueBadge`) are children of every row and are memoized too — a row that *doesn't* re-render still doesn't pay for its cell re-renders.

```tsx
// Convert this:
function FragmentRow({ ... }: FragmentRowProps) { ... }

// To this:
const FragmentRow = memo(function FragmentRow({ ... }: FragmentRowProps) { ... });
```

`memo()` does a shallow prop equality check. For it to actually skip renders, every prop must have stable identity across re-renders. That means:

- **Callbacks**: never inline arrows in JSX. Use `useCallback` at the parent (and pass the arg into the callback at the leaf):
  ```tsx
  // ❌ defeats memo — new function every render
  <FragmentRow onToggle={() => setExpanded(j.id === expanded ? null : j.id)} />

  // ✅ stable across renders
  // (toggleExpanded in useUrlSyncedState uses functional setState so its identity never changes)
  <FragmentRow onToggle={toggleExpanded} /> // takes (id: string) => void
  ```
- **Toggles**: prefer functional setState inside a `useCallback(_, [])` so the callback identity never changes — not even when the underlying value changes. See `toggleExpanded` / `toggleExpandedCompany` in `ui/src/lib/hooks/useUrlSyncedState.ts`.
- **Maps as props**: don't pass `appliedById` down to a memo'd row — its identity changes on every set/clear, defeating memo for every row. Pass the per-row entry instead: `applied={appliedById[j.id]}`.
- **Sets as props**: same trap. If you must, ensure the parent doesn't recreate the set on every render (memoize it).

### Bundle-size budget

`.bundle-budget.json` caps the first-paint JS + CSS chunks. `pnpm run lint:bundle-size` runs `scripts/check-bundle-size.sh` after a build to enforce it. Lazy chunks are intentionally not gated — they grow with features.

To raise the budget consciously: edit `.bundle-budget.json`, mention the reason in the PR.

### Anti-patterns (don't do this)

- ❌ `lazy()` without a `<Suspense>` fallback. Tab switch causes Error.
- ❌ Sharing one `<Suspense>` across all tabs. Each tab swap re-suspends the whole subtree.
- ❌ `memo(Component, (prev, next) => ...)` with a custom comparator unless you've measured. The default shallow comparison is usually right; a wrong comparator silently masks bugs.
- ❌ `useMemo`/`useCallback` everywhere. They have their own cost. Only memoize what's measurably hot or what feeds a memoized child.
- ❌ `useMemo` over a primitive (`useMemo(() => count > 0, [count])`). The hook overhead exceeds the saving.

### Canonical examples to copy from

- **Lazy tab subtree**: `ui/src/App.tsx` — the 4 `lazy(() => import(...).then(...))` declarations and matching per-tab `<Suspense>` blocks.
- **Stable functional-setState toggle**: `ui/src/lib/hooks/useUrlSyncedState.ts` — `toggleExpanded` / `toggleExpandedCompany`.
- **Memo'd row + cell components**: `ui/src/App.tsx` `CompanyBlock` / `FragmentRow`, plus `ui/src/jobs/{ScoreBar,SignalChips,QueueBadge}.tsx`.
- **Memoized derivation**: `ui/src/App.tsx` `visible` / `groups` — every cross-cutting filter+sort lives in a `useMemo` with explicit deps.

---

## React effects

Project convention (pre-existing, restated here for context):

- `useEffect` callbacks can't be `async`. Declare a named `const load = async () => { ... }` inside, then `void load()`.
- Pass `ctrl.signal` from a new `AbortController()` to every fetch / api call inside the effect. Cleanup function aborts it.
- Don't use `let cancelled = false` flags. If you find one in legacy code, refactor to AbortController.

Canonical example: `ui/src/lib/hooks/useJobsData.ts`'s mount-load effect.

---

## Enforcement

Documentation explains *why*; lint enforces *what*. Both rules above are gated automatically — neither relies on you remembering to follow them.

- **`fetch('/api/...')` outside `ui/src/lib/api/client.ts`** → Biome `noRestrictedGlobals` flags it at lint time. Configured in `biome.json` `overrides` (scoped to `ui/src/**` excluding `client.ts`). Test it: drop a `fetch(...)` into any UI file and run `pnpm run lint`.
- **String-literal `className="..."`** → `scripts/check-ui-patterns.sh` flags it. Backstop also re-checks for inline /api fetches in case the Biome scope drifts. Runs via `pnpm run lint:ui-patterns`.
- **First-paint bundle size** → `scripts/check-bundle-size.sh` compares the built main JS + CSS chunks against `.bundle-budget.json`. Runs in CI after `pnpm run ui:build` via `pnpm run lint:bundle-size` (not in the pre-commit hook — needs a fresh build, too slow for every commit).
- **Pre-commit hook** chains three gates: `pnpm run lint && pnpm run typecheck && pnpm run lint:ui-patterns`. Bypass-able via `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` only for true emergencies.

If you add a new structural rule that's grep-able or AST-matchable, extend `scripts/check-ui-patterns.sh` or the Biome `overrides` block so it's enforced, not just documented.

## When to update this doc

Add a new section any time we introduce a **structural** pattern that future agents need to discover. Bug fixes, single-component tweaks, and feature work don't belong here — those live in the code + PR description.

Triggers for an update:
- A new shared module under `ui/src/styles/`
- A new top-level pattern in `lib/api/` (e.g. retry, streaming, optimistic-update helper)
- A new convention around hooks, state management, or composition
- A reversal of an existing rule (with reason)

Whenever you add a rule here, ask: can it also be enforced in lint? If yes, extend `scripts/check-ui-patterns.sh` or `biome.json` in the same PR.
