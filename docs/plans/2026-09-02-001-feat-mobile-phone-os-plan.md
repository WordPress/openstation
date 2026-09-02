---
title: "feat: Mobile — the phone layer"
type: feat
status: draft
date: 2026-09-02
---

# feat: Mobile — the phone layer

## Summary

Give the shell a phone experience. A new `src/mode/` primitive resolves `'desktop' | 'tablet' | 'mobile'` from the viewport and a user preference, stamps it on `<html data-os-mode>`, publishes it as `wp.os.mode` and fires `os.mode.changed`. When the mode is `mobile`, a lazy `mobile[.min].js` bundle mounts the phone layer over the same window manager: a home screen built from the navigation model, one full-screen app at a time with a slim top bar, an app switcher of swipeable cards, a five-slot bottom tab bar, and an edge-swipe back gesture. Nothing is forked: windows are the same `Window` objects, forced to `maximized` through the existing `os.window.geometry` filter, and "home" is `minimizeAll()`. The desktop session survives a phone visit untouched, because the phone restores only the focused window and folds the rest back into the snapshot through a new `os.session.snapshot` filter.

Performance is the frame for every decision: the always-on bundle gains ~3 KB (mode + constraints + loader), the phone layer ships in its own bundle fetched only on phones, wallpapers are suspended while the phone layer is up, widgets are not hydrated, and a phone boots one iframe rather than the whole saved session.

---

## Problem Frame

`README.md` lists mobile as the first thing still ahead. Today a phone visit to `/openstation/` gets the desktop layout compressed into 390 px: a dock rail the thumb cannot reach, a cascade of 80%-sized windows, drag handles a finger cannot grip. No file in `src/` branches on the viewport; `openstation_mode_type` has been "Planned" since Phase 0.

WordPress's own admin pages are already responsive below 782 px, so the content inside every iframe window is phone-ready. Only the shell around it is not.

---

## Requirements

- R1. `wp.os.mode.get()` answers `'desktop' | 'tablet' | 'mobile'` from the viewport and the `mobileLayout` preference (`'auto' | 'desktop' | 'mobile'`); transitions fire `os.mode.changed` and the `os-mode-changed` CustomEvent.
- R2. The first paint is already in the right mode: a PHP-printed head stamp writes `data-os-mode` before any stylesheet applies, from the same `resolveMode` rule the bundle uses.
- R3. In mobile mode every window opens full-screen and cannot be dragged, resized or cascaded; the window's own title bar is replaced by one shell-level top bar (back, title, ⋯).
- R4. Home is the state with no visible window: an app grid from `wp.os.getNav()` with badges and a search filter; opening a tile opens the same window the dock would.
- R5. A bottom tab bar with Home, up to three pinned apps (`mobileTabs` setting, default from the `openstation_mobile_tab_bar` filter), and the switcher.
- R6. An app switcher lists open windows as cards; swipe a card away to close it, tap to focus, "Close all" at the bottom. Recent windows the phone did not restore appear as cold cards that open on tap.
- R7. Gestures: left-edge swipe goes back (minimize); swipe up on the tab bar opens the switcher.
- R8. The desktop session is not degraded by a phone visit: a phone restores the focused window only, and the session snapshot still carries the rest with their desktop geometry.
- R9. Wallpaper is suspended while the phone layer is mounted; widgets are not hydrated in mobile mode; the phone layer is a lazy bundle.
- R10. Safe areas (`env(safe-area-inset-*)`), `viewport-fit=cover`, `prefers-reduced-motion`, ARIA roles and focus management on the switcher.
- R11. Preferences → Mobile: layout override and pinned tabs.
- R12. Hooks: `openstation_mode_preference`, `openstation_mode_breakpoints`, `openstation_mobile_tab_bar` (Experimental); docs, PHPUnit and Vitest in the same change.

---

## Scope Boundaries

**In scope:** the mode primitive, the head stamp, the window constraints, the phone layer bundle, the settings and Preferences page, the PHP filters, docs and tests.

**Out of scope:**

- **Tablet layout.** `'tablet'` is reported but renders the desktop experience. Split view and slide-over are Phase 6.
- **Pull-to-refresh.** Needs the chromeless bridge to report overscroll from inside the iframe; a follow-up once the layer has been used on real devices. The top bar's ⋯ menu offers Reload.
- **Eviction of open windows under memory pressure.** The switcher makes closing one gesture; the layer does not close windows on its own.
- **Web Push.** Separate plan.

---

## Key Decisions

- **KD1. Mode is stamped on `<html>`, not a body class.** The window-system bundle (`pointer.ts`) has to read it without importing the shell's state, and the PHP head stamp has to write it before `<body>` exists. `html[data-os-mode="mobile"]` is the one selector every mobile rule keys on.
- **KD2. Windows stay windows.** `os.window.geometry` forces `state: 'maximized'` on every open, restore and prewarm. `reflowStatefulWindows` already re-maximizes on rotation for free. The filter keeps the pre-filter geometry aside so the snapshot can hand the desktop its own numbers back.
- **KD3. Home is `minimizeAll()`.** The phone state machine is derived from the manager (home ⇔ no unminimized window on the active desktop), never stored in parallel. Minimized windows already hide their iframe and set `content-visibility: hidden`.
- **KD4. The layer is a lazy bundle** modelled on `window-system` (`window.openStationMobile.mount( deps )`), passed its dependencies from `init()` rather than importing shell singletons, so cross-bundle module state is never a question.
- **KD5. Session diet.** On a mobile boot only the focused session window is restored; the rest are held as *recents* and merged back into every snapshot through `os.session.snapshot` until they are opened.
- **KD6. No new components until the shape is generic.** Cards, grid tiles and the tab bar are feature-specific DOM; menus reuse `<os-context-menu>`, Preferences reuses `<os-segmented>` and `<os-checkbox-label>`.

---

## Files

| Path | Change |
|---|---|
| `src/mode/{index,stamp}.ts` | new — resolve, stamp, install, `wp.os.mode` |
| `src/mobile/{types,loader,entry,constraints,open-nav-item,layer,home,tab-bar,switcher,gestures,top-bar}.ts` | new — constraints + loader in the main bundle, the rest in `mobile[.min].js` |
| `src/hooks.ts` | `MODE_CHANGED`, `SESSION_SNAPSHOT` |
| `src/window-manager/index.ts` | `snapshot()` runs `os.session.snapshot` |
| `src/window/pointer.ts`, `src/window/index.ts` | drag and dblclick refuse in mobile mode |
| `src/native-windows.ts` | geometry writers ignore forced maximize |
| `src/desktop.ts`, `src/api/facade.ts`, `src/types.ts` | wiring, `wp.os.mode`, config types |
| `src/settings/{types,state,constants}.ts`, `includes/os-settings.php` | `mobileLayout`, `mobileTabs` |
| `includes/mobile.php`, `desktop-mode.php`, `includes/assets.php`, `includes/render/assets.php` | filters, head stamp, viewport meta, config, style + bundle URL |
| `assets/css/mobile.css` | the phone layer's stylesheet |
| `apps/os-settings/parts/{mobile,pages,nav-icons}.ts` | Preferences → Mobile |
| `vite.config.js`, `package.json` | `mobile` target |
| `tests/vitest/mode.test.ts`, `mobile-*.test.ts`; `tests/phpunit/tests/mobileMode.php` | coverage |
| `docs/mobile.md`, `docs/README.md`, `docs/hooks-reference.md`, `docs/javascript-reference.md`, `docs/api-index.md`, `docs/architecture.md`, `docs/examples/mobile-tab-bar.md`, `README.md` | public contract |
