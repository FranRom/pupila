# React Best Practices

Structured repo for React Best Practices optimized for agents/LLMs.

## Structure

- `rules/` - Rule files (one per rule)
  - `_sections.md` - Section metadata (titles, impacts, descriptions)
  - `_template.md` - Template for new rules
  - `area-description.md` - Rule files
- `src/` - Build scripts
- `metadata.json` - Doc metadata
- __`AGENTS.md`__ - Compiled output (generated)
- __`test-cases.json`__ - LLM eval test cases (generated)

## Getting Started

1. Install deps:
   ```bash
   pnpm install
   ```

2. Build AGENTS.md from rules:
   ```bash
   pnpm build
   ```

3. Validate rule files:
   ```bash
   pnpm validate
   ```

4. Extract test cases:
   ```bash
   pnpm extract-tests
   ```

## Creating a New Rule

1. Copy `rules/_template.md` to `rules/area-description.md`
2. Pick area prefix:
   - `async-` Eliminating Waterfalls (Section 1)
   - `bundle-` Bundle Size Optimization (Section 2)
   - `server-` Server-Side Performance (Section 3)
   - `client-` Client-Side Data Fetching (Section 4)
   - `rerender-` Re-render Optimization (Section 5)
   - `rendering-` Rendering Performance (Section 6)
   - `js-` JavaScript Performance (Section 7)
   - `advanced-` Advanced Patterns (Section 8)
3. Fill frontmatter + content
4. Clear examples with explanations
5. Run `pnpm build` to regen AGENTS.md + test-cases.json

## Rule File Structure

```markdown
---
title: Rule Title Here
impact: MEDIUM
impactDescription: Optional description
tags: tag1, tag2, tag3
---

## Rule Title Here

Brief explanation + why it matters.

**Incorrect (what's wrong):**

```typescript
// Bad code
```

**Correct (what's right):**

```typescript
// Good code
```

Optional explanation after.

Reference: [Link](https://example.com)

## File Naming

- `_`-prefixed files: special (build-excluded)
- Rule files: `area-description.md` (e.g., `async-parallel.md`)
- Section auto-inferred from prefix
- Rules sort alphabetically by title within section
- IDs (1.1, 1.2) auto-generated at build

## Impact Levels

- `CRITICAL` - Highest priority, major perf gains
- `HIGH` - Significant perf gains
- `MEDIUM-HIGH` - Moderate-high gains
- `MEDIUM` - Moderate perf gains
- `LOW-MEDIUM` - Low-medium gains
- `LOW` - Incremental gains

## Scripts

- `pnpm build` - Compile rules → AGENTS.md
- `pnpm validate` - Validate rule files
- `pnpm extract-tests` - Extract LLM eval test cases
- `pnpm dev` - Build + validate

## Contributing

Adding/modifying rules:

1. Correct filename prefix
2. Follow `_template.md` structure
3. Clear bad/good examples
4. Tags
5. `pnpm build` to regen
6. Auto-sorted by title — no manual numbering

## Acknowledgments

Originally by [@shuding](https://x.com/shuding) at [Vercel](https://vercel.com).
