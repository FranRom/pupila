---
title: Use React DOM Resource Hints
impact: HIGH
impactDescription: reduces load time for critical resources
tags: rendering, preload, preconnect, prefetch, resource-hints
---

## Use React DOM Resource Hints

**Impact: HIGH (reduces load time for critical resources)**

React DOM has APIs to hint browser about needed resources. Useful in server components — start loading before client receives HTML.

- **`prefetchDNS(href)`**: resolve DNS for domain you'll connect to
- **`preconnect(href)`**: connection (DNS + TCP + TLS) to server
- **`preload(href, options)`**: fetch resource (stylesheet, font, script, image) you'll use soon
- **`preloadModule(href)`**: fetch ES module you'll use soon
- **`preinit(href, options)`**: fetch + eval stylesheet/script
- **`preinitModule(href)`**: fetch + eval ES module

**Example (preconnect to 3rd-party APIs):**

```tsx
import { preconnect, prefetchDNS } from 'react-dom'

export default function App() {
  prefetchDNS('https://analytics.example.com')
  preconnect('https://api.example.com')

  return <main>{/* content */}</main>
}
```

**Example (preload critical fonts + styles):**

```tsx
import { preload, preinit } from 'react-dom'

export default function RootLayout({ children }) {
  // Preload font file
  preload('/fonts/inter.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })

  // Fetch and apply critical stylesheet immediately
  preinit('/styles/critical.css', { as: 'style' })

  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

**Example (preload modules for code-split routes):**

```tsx
import { preloadModule, preinitModule } from 'react-dom'

function Navigation() {
  const preloadDashboard = () => {
    preloadModule('/dashboard.js', { as: 'script' })
  }

  return (
    <nav>
      <a href="/dashboard" onMouseEnter={preloadDashboard}>
        Dashboard
      </a>
    </nav>
  )
}
```

**When to use each:**

| API | Use case |
|-----|----------|
| `prefetchDNS` | 3rd-party domains for later connection |
| `preconnect` | APIs/CDNs you'll fetch immediately |
| `preload` | Critical resources for current page |
| `preloadModule` | JS modules for likely next nav |
| `preinit` | Stylesheets/scripts that must execute early |
| `preinitModule` | ES modules that must execute early |

Reference: [React DOM Resource Preloading APIs](https://react.dev/reference/react-dom#resource-preloading-apis)
