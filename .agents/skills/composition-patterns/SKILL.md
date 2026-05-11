---
name: vercel-composition-patterns
description:
  React composition patterns that scale. Use when refactoring components with
  boolean prop proliferation, building flexible component libraries, or
  designing reusable APIs. Triggers on tasks involving compound components,
  render props, context providers, or component architecture. Includes React 19
  API changes.
license: MIT
metadata:
  author: vercel
  version: '1.0.0'
---

# React Composition Patterns

Composition patterns. Flexible, maintainable components. Skip boolean prop bloat. Use compound components, lifted state, composed internals. Scales for humans + AI agents.

## When to Apply

Use when:

- Refactoring components with many boolean props
- Building reusable component libraries
- Designing flexible component APIs
- Reviewing component architecture
- Working with compound components or context providers

## Rule Categories by Priority

| Priority | Category                | Impact | Prefix          |
| -------- | ----------------------- | ------ | --------------- |
| 1        | Component Architecture  | HIGH   | `architecture-` |
| 2        | State Management        | MEDIUM | `state-`        |
| 3        | Implementation Patterns | MEDIUM | `patterns-`     |
| 4        | React 19 APIs           | MEDIUM | `react19-`      |

## Quick Reference

### 1. Component Architecture (HIGH)

- `architecture-avoid-boolean-props` — no boolean props for behavior; compose
- `architecture-compound-components` — complex components share context

### 2. State Management (MEDIUM)

- `state-decouple-implementation` — provider owns state mgmt
- `state-context-interface` — generic interface: state, actions, meta (DI)
- `state-lift-state` — state in provider, siblings access

### 3. Implementation Patterns (MEDIUM)

- `patterns-explicit-variants` — explicit variant components, no boolean modes
- `patterns-children-over-render-props` — children, not renderX props

### 4. React 19 APIs (MEDIUM)

> **⚠️ React 19+ only.** Skip if React 18 or earlier.

- `react19-no-forwardref` — no `forwardRef`; `use()` replaces `useContext()`

## How to Use

Read rule files for explanations + examples:

```
rules/architecture-avoid-boolean-props.md
rules/state-context-interface.md
```

Each rule file has:

- Why it matters
- Incorrect example + why
- Correct example + why
- Extra context, refs

## Full Compiled Document

Full guide, all rules expanded: `AGENTS.md`
