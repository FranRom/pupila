---
name: accessibility
description: Audit and improve web accessibility following WCAG 2.2 guidelines. Use when asked to "improve accessibility", "a11y audit", "WCAG compliance", "screen reader support", "keyboard navigation", or "make accessible".
license: MIT
metadata:
  author: web-quality-skills
  version: "1.1"
---

# Accessibility (a11y)

WCAG 2.2 + Lighthouse a11y audit guidelines. Goal: content usable by everyone, including disabled users.

## WCAG Principles: POUR

| Principle | Description |
|-----------|-------------|
| **P**erceivable | Perceive content via different senses |
| **O**perable | All users can operate interface |
| **U**nderstandable | Content + interface understandable |
| **R**obust | Works with assistive tech |

## Conformance levels

| Level | Requirement | Target |
|-------|-------------|--------|
| **A** | Minimum a11y | Must pass |
| **AA** | Standard | Should pass (legal req many jurisdictions) |
| **AAA** | Enhanced | Nice to have |

---

## Perceivable

### Text alternatives (1.1)

**Images need alt text:**
```html
<!-- ❌ Missing alt -->
<img src="chart.png">

<!-- ✅ Descriptive alt -->
<img src="chart.png" alt="Bar chart showing 40% increase in Q3 sales">

<!-- ✅ Decorative image (empty alt) -->
<img src="decorative-border.png" alt="" role="presentation">

<!-- ✅ Complex image with longer description -->
<figure>
  <img src="infographic.png" alt="2024 market trends infographic" 
       aria-describedby="infographic-desc">
  <figcaption id="infographic-desc">
    <!-- Detailed description -->
  </figcaption>
</figure>
```

**Icon buttons need accessible names:**
```html
<!-- ❌ No accessible name -->
<button><svg><!-- menu icon --></svg></button>

<!-- ✅ Using aria-label -->
<button aria-label="Open menu">
  <svg aria-hidden="true"><!-- menu icon --></svg>
</button>

<!-- ✅ Using visually hidden text -->
<button>
  <svg aria-hidden="true"><!-- menu icon --></svg>
  <span class="visually-hidden">Open menu</span>
</button>
```

**Visually hidden class:**
```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Color contrast (1.4.3, 1.4.6)

| Text Size | AA min | AAA enhanced |
|-----------|--------|--------------|
| Normal text (< 18px / < 14px bold) | 4.5:1 | 7:1 |
| Large text (≥ 18px / ≥ 14px bold) | 3:1 | 4.5:1 |
| UI components + graphics | 3:1 | 3:1 |

```css
/* ❌ Low contrast (2.5:1) */
.low-contrast {
  color: #999;
  background: #fff;
}

/* ✅ Sufficient contrast (7:1) */
.high-contrast {
  color: #333;
  background: #fff;
}

/* ✅ Focus states need contrast too */
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}
```

**No color alone:**
```html
<!-- ❌ Only color shows error -->
<input class="error-border">
<style>.error-border { border-color: red; }</style>

<!-- ✅ Color + icon + text -->
<div class="field-error">
  <input aria-invalid="true" aria-describedby="email-error">
  <span id="email-error" class="error-message">
    <svg aria-hidden="true"><!-- error icon --></svg>
    Please enter a valid email address
  </span>
</div>
```

### Media alternatives (1.2)

```html
<!-- Video with captions -->
<video controls>
  <source src="video.mp4" type="video/mp4">
  <track kind="captions" src="captions.vtt" srclang="en" label="English" default>
  <track kind="descriptions" src="descriptions.vtt" srclang="en" label="Descriptions">
</video>

<!-- Audio with transcript -->
<audio controls>
  <source src="podcast.mp3" type="audio/mp3">
</audio>
<details>
  <summary>Transcript</summary>
  <p>Full transcript text...</p>
</details>
```

---

## Operable

### Keyboard accessible (2.1)

**All functionality must be keyboard accessible:**
```javascript
// ❌ Only handles click
element.addEventListener('click', handleAction);

// ✅ Handles both click and keyboard
element.addEventListener('click', handleAction);
element.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleAction();
  }
});
```

**No keyboard traps.** Users must Tab in/out of every component. Use [modal focus trap pattern](references/A11Y-PATTERNS.md#modal-focus-trap) for dialogs — native `<dialog>` handles auto.

### Focus visible (2.4.7)

```css
/* ❌ Never remove focus outlines */
*:focus { outline: none; }

/* ✅ Use :focus-visible for keyboard-only focus */
:focus {
  outline: none;
}

:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}

/* ✅ Or custom focus styles */
button:focus-visible {
  box-shadow: 0 0 0 3px rgba(0, 95, 204, 0.5);
}
```

### Focus not obscured (2.4.11) — new in 2.2

Focused element must not be entirely hidden by author-created content (sticky headers, footers, overlapping panels). At AAA (2.4.12), no part of focused element may be hidden.

```css
/* ✅ Account for sticky headers when scrolling to focused elements */
:target {
  scroll-margin-top: 80px;
}

/* ✅ Ensure focused items clear fixed/sticky bars */
:focus {
  scroll-margin-top: 80px;
  scroll-margin-bottom: 60px;
}
```

### Skip links (2.4.1)

Skip link lets keyboard users bypass repetitive nav. See [skip link pattern](references/A11Y-PATTERNS.md#skip-link) for markup + styles.

### Target size (2.5.8) — new in 2.2

Interactive targets must be ≥ **24 × 24 CSS pixels** (AA). Exceptions: inline text links, browser-controlled sizes, targets where 24px circle centered on bounding box doesn't overlap another target.

```css
/* ✅ Minimum target size */
button,
[role="button"],
input[type="checkbox"] + label,
input[type="radio"] + label {
  min-width: 24px;
  min-height: 24px;
}

/* ✅ Comfortable target size (recommended 44×44) */
.touch-target {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

### Dragging movements (2.5.7) — new in 2.2

Drag actions need single-pointer alternative (buttons, inputs). See [dragging movements pattern](references/A11Y-PATTERNS.md#dragging-movements) for sortable-list example.

### Timing (2.2)

```javascript
// Allow users to extend time limits
function showSessionWarning() {
  const modal = createModal({
    title: 'Session Expiring',
    content: 'Your session will expire in 2 minutes.',
    actions: [
      { label: 'Extend session', action: extendSession },
      { label: 'Log out', action: logout }
    ],
    timeout: 120000
  });
}
```

### Motion (2.3)

```css
/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Understandable

### Page language (3.1.1)

```html
<!-- ❌ No language specified -->
<html>

<!-- ✅ Language specified -->
<html lang="en">

<!-- ✅ Language changes within page -->
<p>The French word for hello is <span lang="fr">bonjour</span>.</p>
```

### Consistent navigation (3.2.3)

```html
<!-- Navigation should be consistent across pages -->
<nav aria-label="Main">
  <ul>
    <li><a href="/" aria-current="page">Home</a></li>
    <li><a href="/products">Products</a></li>
    <li><a href="/about">About</a></li>
  </ul>
</nav>
```

### Consistent help (3.2.6) — new in 2.2

If help mechanism (contact info, chat widget, FAQ link, self-help) repeats across pages, must appear in **same relative order** each time. Users relying on consistent placement shouldn't hunt for help per page.

### Form labels (3.3.2)

Every input needs programmatically associated label. See [form labels pattern](references/A11Y-PATTERNS.md#form-labels) for explicit, implicit, instructional examples.

### Error handling (3.3.1, 3.3.3)

Announce errors to screen readers via `role="alert"` or `aria-live`. Set `aria-invalid="true"` on invalid fields. Focus first error on submit. See [error handling pattern](references/A11Y-PATTERNS.md#error-handling) for markup + JS.

### Redundant entry (3.3.7) — new in 2.2

Don't force re-entry of info already provided same session. Auto-populate from earlier steps, or let users pick previously entered values. Exceptions: security re-confirmation, expired content.

```html
<!-- ✅ Auto-fill shipping address from billing -->
<fieldset>
  <legend>Shipping address</legend>
  <label>
    <input type="checkbox" id="same-as-billing" checked>
    Same as billing address
  </label>
  <!-- Fields auto-populated when checked -->
</fieldset>
```

### Accessible authentication (3.3.8) — new in 2.2

Login must not rely on cognitive function tests (remembering password, solving puzzle) unless ≥ one of:
- Copy-paste or autofill available
- Alternative method exists (passkey, SSO, email link)
- Test uses object recognition or personal content (AA only; AAA removes this exception)

```html
<!-- ✅ Allow paste in password fields -->
<input type="password" id="password" autocomplete="current-password">

<!-- ✅ Offer passwordless alternatives -->
<button type="button">Sign in with passkey</button>
<button type="button">Email me a login link</button>
```

---

## Robust

### ARIA usage (4.1.2)

**Prefer native elements:**
```html
<!-- ❌ ARIA role on div -->
<div role="button" tabindex="0">Click me</div>

<!-- ✅ Native button -->
<button>Click me</button>

<!-- ❌ ARIA checkbox -->
<div role="checkbox" aria-checked="false">Option</div>

<!-- ✅ Native checkbox -->
<label><input type="checkbox"> Option</label>
```

**When ARIA needed,** use correct roles + states. See [ARIA tabs pattern](references/A11Y-PATTERNS.md#aria-tabs) for complete tablist example.

### Live regions (4.1.3)

Use `aria-live` regions to announce dynamic content changes without moving focus. See [live regions pattern](references/A11Y-PATTERNS.md#live-regions-and-notifications) for markup + `showNotification()` helper.

---

## Testing checklist

### Automated testing
```bash
# Lighthouse accessibility audit
npx lighthouse https://example.com --only-categories=accessibility

# axe-core
npm install @axe-core/cli -g
axe https://example.com
```

### Manual testing

- [ ] **Keyboard nav:** Tab through page, Enter/Space to activate
- [ ] **Screen reader:** Test VoiceOver (Mac), NVDA (Windows), TalkBack (Android)
- [ ] **Zoom:** Usable at 200% zoom
- [ ] **High contrast:** Test Windows High Contrast Mode
- [ ] **Reduced motion:** Test `prefers-reduced-motion: reduce`
- [ ] **Focus order:** Logical, follows visual order
- [ ] **Target size:** Interactive elements meet 24×24px min

See [screen reader commands reference](references/A11Y-PATTERNS.md#screen-reader-commands) for VoiceOver + NVDA shortcuts.

---

## Common issues by impact

### Critical (fix now)
1. Missing form labels
2. Missing image alt text
3. Insufficient color contrast
4. Keyboard traps
5. No focus indicators

### Serious (fix before launch)
1. Missing page language
2. Missing heading structure
3. Non-descriptive link text
4. Auto-playing media
5. Missing skip links

### Moderate (fix soon)
1. Missing ARIA labels on icons
2. Inconsistent navigation
3. Missing error identification
4. Timing without controls
5. Missing landmark regions

## References

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Deque axe Rules](https://dequeuniversity.com/rules/axe/)
- [Web Quality Audit](../web-quality-audit/SKILL.md)
- [WCAG criteria reference](references/WCAG.md)
- [Accessibility code patterns](references/A11Y-PATTERNS.md)
