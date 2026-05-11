# Sections

Defines sections, ordering, impact, descriptions.
Section ID (in parens) = filename prefix grouping rules.

---

## 1. Eliminating Waterfalls (async)

**Impact:** CRITICAL
**Description:** Waterfalls = #1 perf killer. Each sequential await adds full network latency. Eliminating yields largest gains.

## 2. Bundle Size Optimization (bundle)

**Impact:** CRITICAL
**Description:** Reducing initial bundle size improves Time to Interactive + Largest Contentful Paint.

## 3. Server-Side Performance (server)

**Impact:** HIGH
**Description:** Optimizing SSR + data fetching eliminates server-side waterfalls + cuts response times.

## 4. Client-Side Data Fetching (client)

**Impact:** MEDIUM-HIGH
**Description:** Auto dedup + efficient fetching cut redundant network requests.

## 5. Re-render Optimization (rerender)

**Impact:** MEDIUM
**Description:** Cutting unnecessary re-renders saves computation + improves UI responsiveness.

## 6. Rendering Performance (rendering)

**Impact:** MEDIUM
**Description:** Optimizing rendering reduces browser work.

## 7. JavaScript Performance (js)

**Impact:** LOW-MEDIUM
**Description:** Hot-path micro-opts add up.

## 8. Advanced Patterns (advanced)

**Impact:** LOW
**Description:** Advanced patterns for specific cases needing careful implementation.
