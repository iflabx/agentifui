# Font Configuration Guide

## Scope

This document describes the font setup currently implemented in the codebase.

The authoritative implementation lives in:

- `app/layout.tsx`
- `app/fonts/`
- `tailwind.config.js`
- `app/globals.css`

## Loaded Font Families

The app currently loads these local font files with `next/font/local` in `app/layout.tsx`:

- `Inter`
- `Noto Sans SC`
- `Crimson Pro`
- `Noto Serif SC`
- `Playfair Display`

The actual font assets are committed under `app/fonts/`, so runtime does not depend on Google Fonts or other external font CDNs.

## Current Font Strategy

AgentifUI is intentionally serif-first.

### Default content stack

The default reading/UI stack is built around:

- `Crimson Pro`
- `Noto Serif SC`
- `Georgia`
- `serif`

This is exposed through:

- `font-serif`
- the global default text styling in `app/globals.css`

### Display stack

Decorative headings use:

- `Playfair Display`
- `Noto Serif SC`
- `serif`

This is exposed through:

- `font-display`

### Opt-in sans stack

Dense UI elements can opt into:

- `Inter`
- `Noto Sans SC`
- system sans fallbacks

This is exposed through the `.font-sans` utility in `app/globals.css`.

## Important Implementation Detail

`tailwind.config.js` keeps both Tailwind `sans` and `serif` families mapped to the serif-first stack. That means the repository default is intentionally not a normal sans-serif UI.

If you want a true sans-serif override, use the explicit `.font-sans` class from `app/globals.css`.

## Recommended Usage

- Use `font-serif` for most page text, forms, and long-form UI copy.
- Use `font-display` for hero headings or prominent titles.
- Use `font-sans` sparingly for dense controls, small badges, or places where sans text renders better at small sizes.

## Examples

```tsx
<h1 className="font-display text-4xl">Hero Title</h1>
<p className="font-serif">Default content copy</p>
<span className="font-sans text-xs">Compact badge label</span>
```

## Notes

- Latin fonts and CJK fonts are split intentionally:
  - Latin-first UI typography uses local Inter / Crimson Pro / Playfair files.
  - Simplified Chinese fallback uses local Noto Sans SC / Noto Serif SC files.
- The Noto CJK files are larger, so they are configured as local fallback fonts instead of eager preloaded fonts.
- Inputs, textareas, selects, and buttons are also normalized in `app/globals.css` so typography stays consistent.
- Mixed English and CJK rendering is a first-class concern in the current setup.
- If you change fonts, update all four places: `app/layout.tsx`, `app/fonts/`, `tailwind.config.js`, and `app/globals.css`.
