---
name: nodejs-best-practices
description: "Node.js development principles and decision-making. Framework selection, async patterns, security, and architecture. Teaches thinking, not copying."
risk: unknown
source: community
date_added: "2026-02-27"
---

# Node.js Best Practices

> Principles + decision-making, Node.js 2025.
> **THINK, don't memorize.**

## When to Use
Node.js architecture decisions, framework choice, async design, security, deployment.

---

## How to Use

Teaches **decision-making**, not copy-paste code.

- ASK user prefs when unclear
- Pick framework/pattern by CONTEXT
- Don't default same solution every time

---

## 1. Framework Selection (2025)

### Decision Tree

```
What are you building?
│
├── Edge/Serverless (Cloudflare, Vercel)
│   └── Hono (zero-dependency, ultra-fast cold starts)
│
├── High Performance API
│   └── Fastify (2-3x faster than Express)
│
├── Enterprise/Team familiarity
│   └── NestJS (structured, DI, decorators)
│
├── Legacy/Stable/Maximum ecosystem
│   └── Express (mature, most middleware)
│
└── Full-stack with frontend
    └── Next.js API Routes or tRPC
```

### Comparison Principles

| Factor | Hono | Fastify | Express |
|--------|------|---------|---------|
| **Best for** | Edge, serverless | Performance | Legacy, learning |
| **Cold start** | Fastest | Fast | Moderate |
| **Ecosystem** | Growing | Good | Largest |
| **TypeScript** | Native | Excellent | Good |
| **Learning curve** | Low | Medium | Low |

**Why these matter:** Hono wins edge/serverless via zero deps + tiny runtime → fastest cold starts. Fastify wins perf via schema-based serialization → 2-3x Express throughput. Express wins on ecosystem maturity + middleware count. NestJS wins for teams needing DI/decorators/structure. Next.js/tRPC win when frontend colocated.

### Selection Questions:
1. Deployment target?
2. Cold start critical?
3. Team experience?
4. Legacy code to maintain?

---

## 2. Runtime (2025)

### Native TypeScript

```
Node.js 22+: --experimental-strip-types
├── Run .ts files directly
├── No build step needed for simple projects
└── Consider for: scripts, simple APIs
```

### Module System

```
ESM (import/export)
├── Modern standard
├── Better tree-shaking
├── Async module loading
└── Use for: new projects

CommonJS (require)
├── Legacy compatibility
├── More npm packages support
└── Use for: existing codebases, some edge cases
```

### Runtime Pick

| Runtime | Best For |
|---------|----------|
| **Node.js** | General purpose, largest ecosystem |
| **Bun** | Performance, built-in bundler |
| **Deno** | Security-first, built-in TypeScript |

**Why:** Node = mature/biggest ecosystem. Bun = speed + bundler builtin. Deno = secure-by-default permissions + TS native.

---

## 3. Architecture

### Layered Structure

```
Request Flow:
│
├── Controller/Route Layer
│   ├── Handles HTTP specifics
│   ├── Input validation at boundary
│   └── Calls service layer
│
├── Service Layer
│   ├── Business logic
│   ├── Framework-agnostic
│   └── Calls repository layer
│
└── Repository Layer
    ├── Data access only
    ├── Database queries
    └── ORM interactions
```

### Why:
- **Testability**: mock layers independently
- **Flexibility**: swap DB without touching logic
- **Clarity**: single responsibility per layer

### Simplify when:
- Small scripts → single file OK
- Prototypes → less structure OK
- Ask: "will this grow?"

---

## 4. Error Handling

### Centralized

```
Pattern:
├── Create custom error classes
├── Throw from any layer
├── Catch at top level (middleware)
└── Format consistent response
```

### Response Philosophy

Client response MUST include: HTTP status, error code (programmatic handling), user-friendly message. NEVER expose internal details, stack traces, DB errors, file paths, or library internals — these leak attack surface (security-critical).

Logs MUST capture: full stack trace, request context, user ID if available, timestamp.

### Status Codes

| Situation | Status | When |
|-----------|--------|------|
| Bad input | 400 | Client sent invalid data |
| No auth | 401 | Missing or invalid credentials |
| No permission | 403 | Valid auth, but not allowed |
| Not found | 404 | Resource doesn't exist |
| Conflict | 409 | Duplicate or state conflict |
| Validation | 422 | Schema valid but business rules fail |
| Server error | 500 | Our fault, log everything |

---

## 5. Async Patterns

### Pick

| Pattern | Use When |
|---------|----------|
| `async/await` | Sequential async operations |
| `Promise.all` | Parallel independent operations |
| `Promise.allSettled` | Parallel where some can fail |
| `Promise.race` | Timeout or first response wins |

### Event Loop

```
I/O-bound (async helps):
├── Database queries
├── HTTP requests
├── File system
└── Network operations

CPU-bound (async doesn't help):
├── Crypto operations
├── Image processing
├── Complex calculations
└── → Use worker threads or offload
```

### Don't Block Loop

- Never sync methods in prod (`fs.readFileSync` etc.)
- Offload CPU work
- Stream large data

---

## 6. Validation

### Validate at Boundaries

```
Where to validate:
├── API entry point (request body/params)
├── Before database operations
├── External data (API responses, file uploads)
└── Environment variables (startup)
```

### Library Pick

| Library | Best For |
|---------|----------|
| **Zod** | TypeScript first, inference |
| **Valibot** | Smaller bundle (tree-shakeable) |
| **ArkType** | Performance critical |
| **Yup** | Existing React Form usage |

### Philosophy

- Fail fast: validate early
- Specific: clear error messages
- Trust nothing: even "internal" data

---

## 7. Security

### Checklist

- [ ] **Input validation**: all inputs validated
- [ ] **Parameterized queries**: no string concatenation for SQL
- [ ] **Password hashing**: bcrypt or argon2
- [ ] **JWT verification**: always verify signature AND expiry
- [ ] **Rate limiting**: protect from abuse
- [ ] **Security headers**: Helmet.js or equivalent
- [ ] **HTTPS**: everywhere in production
- [ ] **CORS**: properly configured (explicit origin allowlist, never `*` with credentials)
- [ ] **Secrets**: environment variables ONLY — never hardcode API keys, DB creds, JWT secrets, tokens; never commit `.env`; rotate any exposed secret immediately
- [ ] **Dependencies**: regularly audited (`npm audit`, Dependabot)

### Mindset

```
Trust nothing:
├── Query params → validate
├── Request body → validate
├── Headers → verify
├── Cookies → validate
├── File uploads → scan
└── External APIs → validate response
```

---

## 8. Testing

### Strategy

| Type | Purpose | Tools |
|------|---------|-------|
| **Unit** | Business logic | node:test, Vitest |
| **Integration** | API endpoints | Supertest |
| **E2E** | Full flows | Playwright |

### Priorities

1. **Critical paths**: auth, payments, core business
2. **Edge cases**: empty inputs, boundaries
3. **Error handling**: failure modes
4. **Skip**: framework code, trivial getters

### Built-in Runner (Node.js 22+)

```
node --test src/**/*.test.ts
├── No external dependency
├── Good coverage reporting
└── Watch mode available
```

---

## 9. Anti-Patterns

### DON'T:
- Express for new edge projects (use Hono)
- Sync methods in prod code
- Business logic in controllers
- Skip input validation
- Hardcode secrets
- Trust external data unvalidated
- Block event loop w/ CPU work

### DO:
- Pick framework by context
- Ask user prefs when unclear
- Layered architecture for growing projects
- Validate all inputs
- Env vars for secrets
- Profile before optimizing

---

## 10. Decision Checklist

Before implementing:

- [ ] Asked user about stack pref?
- [ ] Picked framework for THIS context? (not default)
- [ ] Considered deploy target?
- [ ] Planned error handling?
- [ ] Identified validation points?
- [ ] Considered security?

---

> **Remember**: best practices = decision-making, not memorizing. Every project deserves fresh consideration.

## Limitations
- Use only when task matches scope.
- Not substitute for env-specific validation, testing, or expert review.
- Stop + ask if inputs, permissions, safety boundaries, or success criteria missing.
