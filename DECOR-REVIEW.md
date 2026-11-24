# DECOR-REVIEW — Telegram Mini App Decorative Background

**Reviewed files:** `style.css`, `design-tokens.css`, `index.html`, `js/app.js`
**Status:** All described changes are present in the files.

## Bottom Line

Both decorative backgrounds (day floral, night stars) will be visible to the user. Theme switching via `data-twa-theme` works correctly. There is no meaningful FOUC risk. The only required change is adding a `prefers-reduced-motion` override for accessibility; performance is acceptable but worth verifying on low-end Telegram WebView devices due to the full-screen animated compositor layer.

---

## (a) Visibility — Will the decorative background be visible?

**Day theme (floral): YES.**
- `body::before` covers the full viewport: `position: fixed; inset: 0;` (style.css:26-27), `z-index: -1` (:29), behind all content.
- Light theme block (style.css:34-44) applies three radial-gradient color blooms using `--decor-floral-color-1/2/3` (:37-39).
- `background-size: 200% 200%` (design-tokens.css:90), `background-repeat: repeat` (style.css:41), `opacity: 0.45` (style.css:42, tokens:92).
- Animated by `floral-drift` (tokens:91).
- Over the light body background `#FFF8FB` (tokens:11), the pastel blooms (pink `#FFB6C1`, blue `#87CEEB`, lavender `#E6E6FA`) at 0.45 opacity produce soft, subtle but visible color blooms.

**Night theme (stars): YES.**
- Dark theme block (style.css:47-66) applies 12 small radial-gradient star dots in white/blue/purple (:50-61).
- `background-size: 150% 150%` (tokens:121), `background-repeat: repeat` (style.css:63), `opacity: 0.85` (style.css:64, tokens:123).
- Animated by `star-drift` (tokens:122).
- Over the dark body background `#1A0A1E` (tokens:97), these will be clearly visible.

---

## (b) Performance

**Good:**
- `will-change: background-position` (style.css:30) promotes `body::before` to its own compositor layer — appropriate because `background-position` is animated.
- `background-position` is a compositor-only property (triggers no layout or paint), so the drift animation itself is cheap.
- `background-repeat: repeat` with large `background-size` (200% / 150%) means few tiles are needed; no seam issues at these sizes.

**Concerns:**
- `body::before` is `position: fixed; inset: 0` — a full-screen layer. With `will-change`, it remains a full-screen compositor layer for the page's lifetime, re-compositing every frame of the 20s (floral) / 15s (star) drift. On low-end Android WebViews (typical for Telegram Mini Apps) this can cause jank and added GPU memory use.
- 12 radial-gradient star layers + 3 floral layers, combined with `opacity`, adds fill-rate cost each frame.
- `will-change` is unconditional — the layer is allocated even when the user isn't interacting.

**Recommendation:** Keep the implementation but verify on low-end devices. Consider removing `will-change` (relying on compositor-only `background-position`) or gating it behind `prefers-reduced-motion: no-preference`. No change strictly required.

---

## (c) Contrast / Accessibility (WCAG)

**No contrast problem.** All content is drawn on opaque surfaces:
- `--color-surface`: `#FFFFFF` (light, tokens:12) / `#25152A` (dark, tokens:98)
- Task items, header, inputs, buttons all use opaque `--color-surface` backgrounds.

Text sits on opaque surfaces, so the decorative background does not reduce text contrast ratios. WCAG 4.5:1 (normal) / 3:1 (large) is preserved as long as surfaces stay opaque.

The background is purely decorative (conveys no information), so it does not itself need to meet contrast requirements. Future risk: if any surface is made semi-transparent, the floral/star pattern could show through and reduce contrast.

**Missing:** `prefers-reduced-motion` override. The drift animations run unconditionally, which can trigger vestibular disorders. Add:

```css
@media (prefers-reduced-motion: reduce) {
  body::before {
    animation: none !important;
    will-change: auto;
  }
}
```

---

## (d) FOUC risk — html has data-twa-theme="light" by default?

**Minimal / low risk.**
- `index.html:2` sets `data-twa-theme="light"` by default, so the light theme (floral background) is the initial state.
- The inline script in the head (index.html:8-14) reads `localStorage` `tma_theme` and applies it synchronously before the body renders, so a previously-saved dark theme is applied before first paint.
- Stylesheets load immediately after (index.html:17-18). A theoretical micro-flash exists if `data-twa-theme="dark"` is set before `design-tokens.css` defines dark variables, but it's sub-frame and not visually meaningful for the background.
- After hydration, `Tg.applyTheme()` (js/app.js:36-71) may flip the theme based on Telegram's `color_scheme`, which could cause a floral→stars switch shortly after load if the user's Telegram theme is dark. This is intended Telegram behavior, not a FOUC bug.

---

## (e) Theme switching via data-twa-theme — does it work correctly?

**Yes.** CSS maps themes to backgrounds:
- `[data-twa-theme="light"] body::before` → floral (style.css:34-44)
- `[data-twa-theme="dark"] body::before` → stars (style.css:47-66)

JS drives the attribute:
- `setTheme()` (js/app.js:670-686) sets `data-twa-theme` and calls `render()` (line 289 re-applies it).
- `Tg.applyTheme()` (js/app.js:65) sets the attribute from Telegram's `color_scheme`.
- `loadState()` (js/app.js:696-697) restores from localStorage.

Decor CSS variables (`--decor-floral-*`, `--decor-star-*`) are defined in both the light block (tokens:86-93) and dark block (tokens:117-123), so the correct variables are active under each theme. Switching themes swaps background-image, size, opacity, and animation cleanly.

**Minor animation mismatch:** `star-drift` defines 2 position pairs (`0% 0%` → `50% 50%`, style.css:74-77) but the night theme uses 12 star layers. With fewer positions than layers, browsers cycle the position list, so stars alternate between two drift patterns. This is acceptable visually but not intentional per-layer control.

---

## What's Good

1. `body::before` full-screen overlay behind content with `pointer-events: none` — correct layering (style.css:24-31).
2. Theme-specific background blocks keyed on `data-twa-theme` — clean separation (style.css:34-44, 47-66).
3. `background-repeat: repeat` with large `background-size` — tiles efficiently without visible seams.
4. `opacity` tokens keep the effect subtle in light mode (0.45) and present in dark mode (0.85).
5. `will-change: background-position` correctly isolates the animated layer to the compositor.
6. Theme switching via `data-twa-theme` is fully wired through JS (`setTheme`, `Tg.applyTheme`, `loadState`).
7. No hardcoded theme colors leaking into background logic — all via tokens.

---

## What Still Needs Fixing

| # | Issue | Location | Severity | Fix |
|---|-------|----------|----------|-----|
| 1 | No `prefers-reduced-motion` override — drift animations run unconditionally | style.css:69-77 | Medium | Add `@media (prefers-reduced-motion: reduce) { body::before { animation: none !important; will-change: auto; } }` |
| 2 | `star-drift` keyframes provide 2 position pairs for 12 star layers — positions cycle unintentionally | style.css:74-77 | Low | Expand keyframes to 12 position pairs, or reduce star layer count to match |
| 3 | Full-screen compositor layer is permanent (`will-change` always on) — GPU memory cost on low-end WebViews | style.css:30 | Low/Medium | Consider removing `will-change` (compositor-only `background-position` suffices) or gate on `prefers-reduced-motion: no-preference` |
| 4 | `clearThemeOverrides()` doesn't touch decor variables — not a bug now, but if decor vars are ever set inline they'd persist across theme switches | js/app.js:136-145 | Low | Add decor variables to the clear list for future-proofing |

---

## Line References

**style.css:**
- :24-31 — `body::before` base layer (fixed, inset 0, z-index -1, will-change)
- :30 — `will-change: background-position`
- :34-44 — Light theme floral background
- :35 — `background-color: transparent`
- :41 — `background-repeat: repeat`
- :42 — `opacity: var(--decor-floral-opacity)`
- :47-66 — Dark theme star background
- :48 — `background-color: transparent`
- :63 — `background-repeat: repeat`
- :64 — `opacity: var(--decor-star-opacity)`
- :69-72 — `@keyframes floral-drift`
- :74-77 — `@keyframes star-drift`

**design-tokens.css:**
- :90 — `--decor-floral-size: 200% 200%`
- :91 — `--decor-floral-motion: floral-drift 20s ease-in-out infinite alternate`
- :92 — `--decor-floral-opacity: 0.45`
- :121 — `--decor-star-size: 150% 150%`
- :122 — `--decor-star-motion: star-drift 15s linear infinite alternate`
- :123 — `--decor-star-opacity: 0.85`

**index.html:**
- :2 — `data-twa-theme="light"` default
- :8-14 — inline theme restore script
- :17-18 — stylesheet load order

**js/app.js:**
- :36-71 — `Tg.applyTheme()` sets `data-twa-theme`
- :65 — attribute set from `color_scheme`
- :136-145 — `clearThemeOverrides()`
- :289 — `render()` re-applies `data-twa-theme`
- :670-686 — `setTheme()`
- :696-697 — `loadState()` restores theme
