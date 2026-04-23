# Roadmap

What's coming next. Not a hard commitment — priorities shift — but this is the current thinking.

- **Mobile (phone OS)** — purpose-built home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar.
- **Tablet hybrid** — split view, slide-over, horizontal dock. `wp.desktop.mode = 'desktop' | 'tablet' | 'mobile'` surface.
- **Cross-window drag & drop (the North Star)** — extend the current drag bridge to Media → Gutenberg block insertion, with pluggable mime-type negotiation.
- **Polish** — color-scheme-aware variables across all shell surfaces, View Transitions API animations, full a11y audit (ARIA, focus traps, keyboard nav).
- **…and a whole lot more hooks, filters, and actions** — every new surface lands with its own extension points, so this list keeps growing.

For how the existing pieces fit together, see [docs/architecture.md](https://github.com/WordPress/desktop-mode/blob/trunk/docs/architecture.md); for the hook surface (current and planned), see [docs/hooks-reference.md](https://github.com/WordPress/desktop-mode/blob/trunk/docs/hooks-reference.md).
