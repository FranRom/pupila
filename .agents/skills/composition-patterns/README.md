# React Composition Patterns

Repo of React composition patterns. Skip boolean prop bloat via compound components, lifted state, composed internals.

## Structure

- `rules/` — one file per rule
  - `_sections.md` — section metadata (titles, impacts, descriptions)
  - `_template.md` — template for new rules
  - `area-description.md` — rule files
- `metadata.json` — doc metadata (version, org, abstract)
- **`AGENTS.md`** — compiled output (generated)

## Rules

### Component Architecture (CRITICAL)

- `architecture-avoid-boolean-props.md` — no boolean props for behavior
- `architecture-compound-components.md` — compound components, shared context

### State Management (HIGH)

- `state-lift-state.md` — lift state to providers
- `state-context-interface.md` — clear context interfaces (state/actions/meta)
- `state-decouple-implementation.md` — decouple state from UI

### Implementation Patterns (MEDIUM)

- `patterns-children-over-render-props.md` — children > renderX
- `patterns-explicit-variants.md` — explicit variants

## Core Principles

1. **Composition over configuration** — consumers compose, don't add props
2. **Lift your state** — state in providers, not stuck in components
3. **Compose your internals** — subcomponents read context, not props
4. **Explicit variants** — ThreadComposer, EditComposer; not Composer with isThread

## Creating a New Rule

1. Copy `rules/_template.md` to `rules/area-description.md`
2. Pick area prefix:
   - `architecture-` — Component Architecture
   - `state-` — State Management
   - `patterns-` — Implementation Patterns
3. Fill frontmatter + content
4. Clear examples + explanations

## Impact Levels

- `CRITICAL` — foundational, blocks unmaintainable code
- `HIGH` — big maintainability win
- `MEDIUM` — cleaner code
