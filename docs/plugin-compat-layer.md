# Plugin compatibility layer

*Internals doc. Plugin authors usually don't need this — it's how Desktop Mode adapts third-party plugins whose CSS / menu data was written assuming classic admin chrome.*

## Why this exists

Chromeless iframes (`?desktop_mode_chromeless=1`) hide the admin bar, sidebar menu, and wp-footer. Most admin pages render correctly without modification. **Some don't** — because the plugin authoring them hardcoded assumptions about classic admin geometry into their CSS or menu registration. We can't ship a fix upstream for every plugin in the directory; instead, we maintain a small, documented **compatibility layer** that adapts the chromeless render to common patterns.

This doc is the contract: what the layer does, why each piece is there, and how to add a new fix when a plugin surfaces a new shape we haven't handled.

## The three tiers

We try fixes in this order. Lower-numbered tiers cover broader plugin sets and have lower blast radius — only escalate when a tier above it can't reach the issue.

### Tier 1 — CSS variable rebinds

**File**: `assets/css/chromeless.css` (the rule near the top, scoped to `html.wp-toolbar:has( body.desktop-mode-chromeless )`).

Core defines exactly two layout-related CSS custom properties on `<html>`:

```css
--wp-admin--admin-bar--height            /* 32px / 46px on small screens */
--wp-admin--admin-bar--position-offset   /* derived from above */
```

Plugins that reference these via `var()` (e.g., `top: var(--wp-admin--admin-bar--height)`) will resolve correctly inside chromeless because we rebind both to `0px`. **No JS, no runtime cost** — first-paint correct.

When this is enough: any plugin that uses `var(...)` instead of literal pixels.

When it isn't: plugins that compile literal pixel values into their CSS (SCSS interpolation, build-time constants).

### Tier 2 — Runtime offset neutralizer

**File**: `includes/render/chromeless-bridge.php` → `desktop_mode_chromeless_offset_neutralizer_script()`.

Inline script injected at `admin_head` priority 1. Runs one full walk at `DOMContentLoaded` over every positioned element (`fixed | sticky | absolute`), overriding any `top` value matching the admin-bar offset set (defaults: `32px`, `46px`) to `0px !important`; a `MutationObserver` then corrects late-added nodes (React-mounted components, etc.) as they appear. A second full walk at `load` only runs as a fallback on browsers without `MutationObserver`.

Match is exact-pixel — we don't catch `top: 33px`. False positives are possible but unlikely; a plugin would have to use `32px` for an unrelated reason AND need that exact value to remain inside chromeless.

Filter to extend or narrow:

```php
add_filter( 'desktop_mode_chromeless_admin_bar_top_values', function ( $values ) {
    $values[] = '50px'; // a11y theme that bumps admin-bar height
    return $values;
} );
```

When this is enough: plugins using literal pixel `top` values that match the admin-bar height set.

When it isn't: plugins whose offending value is on a different property (`width`, `left`, `padding-*`), uses an unusual literal (e.g., `top: 60px`), or whose layout breaks for a reason other than reserving admin-chrome space.

### Tier 3 — Targeted CSS overrides

**File**: `assets/css/chromeless.css` (the WC sections, search for `WooCommerce`).

When tiers 1 and 2 don't reach a specific layout bug, we ship a **scoped CSS override** that targets the offending plugin selector. Each override carries a docblock that:

1. Quotes the plugin's CSS rule we're countering, with the upstream filename.
2. Explains the geometry assumption that breaks under chromeless.
3. Justifies why this is the smallest fix possible.

Example shape (from the existing WC entry):

```css
/*
 * WooCommerce sidebar-reservation override.
 *
 * `.woocommerce-layout__header` is `position: fixed` with
 * `width: calc(100% - 160px)` (sidebar reservation, baked in
 * from SCSS). Inside chromeless we hide the sidebar, so the
 * header ends 160px short of the iframe right edge — and the
 * activity-panel wrapper, positioned relative to that fixed
 * header, leaks 160px of gray fill into the visible area.
 *
 * Reclaim the reservation: pin to full iframe width.
 */
.desktop-mode-chromeless .woocommerce-layout__header {
    width: 100% !important;
}
```

When this is enough: any plugin with a self-contained layout breakage you can target by selector.

When it isn't: there is no when-it-isn't here. If a generic mechanism doesn't reach it, write a targeted override.

## The dock side: menu data adaptations

Some plugins register WordPress admin menu entries in shapes that our dock can't naively render. These adaptations live in `includes/core/payload.php` (`desktop_mode_build_dock_items()`, `desktop_mode_menu_item_url()`) and have PHPUnit coverage.

### Embedded query parameters in menu slugs

`add_submenu_page()` accepts a slug like `wc-admin&path=/customers` (slug + query string). Naive `rawurlencode()`-ing the whole string mangles the `&` to `%26` and breaks the consuming plugin's router.

**Fix**: `desktop_mode_menu_item_url()` splits the slug on the first `&`, encodes only the page portion, and rebuilds the URL via `add_query_arg()` so each value is encoded once and `&` separators stay literal.

**Plugins this addresses**: every wc-admin React route (Customers, Analytics, Marketing, …); also Yoast SEO and other plugins that pack paths into menu slugs.

### `esc_url_raw()` for JSON contexts

Dock URLs flow into the shell config as JSON, then end up assigned to `iframe.src` / `window.location.href`. Browsers do **not** decode `&#038;` HTML entities in those JS string contexts.

**Fix**: `desktop_mode_menu_item_url()` returns `esc_url_raw()`-sanitized URLs, not `esc_url()`-sanitized. Same XSS-safe sanitization, no entity encoding.

### Parent menu URL fallthrough

Some plugins register a top-level menu with a stub callback whose actual landing page is the first submenu (`add_menu_page( …, 'woocommerce', null, … )` then `add_submenu_page( 'woocommerce', …, 'wc-admin', … )`). Classic admin's `wp-admin/menu-header.php` rewrites the parent's clickable link to the first submenu's URL. Hitting `?page=woocommerce` directly invokes the stub and 500s.

**Fix**: `desktop_mode_build_dock_items()` mirrors this — if a parent menu has any visible submenu, the parent's effective URL is the first capability-passing submenu's URL.

**Plugins this addresses**: WooCommerce, historically Yoast SEO, several membership / LMS plugins.

### Empty submenu titles

Plugins (notably WooCommerce's `wc-addons` Extensions row) register `menu_title => null` to keep a page reachable while hiding the row from classic admin's left menu. Our dock would otherwise render an empty, label-less tab that visually duplicates a sibling entry.

**Fix**: `desktop_mode_build_dock_items()` skips submenu entries whose cleaned title is empty / null / whitespace.

### Synthetic "Add Theme" tab on the Appearance window

Core does not register `theme-install.php` as a submenu of `themes.php` — classic admin only surfaces it through the in-page "Add Theme" `.page-title-action` button at the top of `themes.php`. Inside chromeless that button scrolls out of view on first paint (the focus-target heuristic on the visible theme grid steals the scroll position), leaving no entry point to the install flow.

**Fix**: `desktop_mode_inject_appearance_tabs()` (in `includes/themes-tabs.php`) hooks `desktop_mode_dock_item` and prepends `{ title: 'Add Theme', url: theme-install.php }` to the Appearance dock item's submenu when the current user has `install_themes`. An explicit per-page rule in `assets/css/chromeless.css` (`.desktop-mode-chromeless.themes-php .wrap > .page-title-action { display: none; }`) hides the in-page button on `themes.php` — the tab is the canonical entry point, while the global rule keeping `.page-title-action` visible on other pages stays intact.

Resulting tab order: Appearance | Add Theme | Editor | Fonts | …

## The script side: dependency repairs

Some plugins / themes register block-editor scripts with incomplete `wp_enqueue_script()` dep arrays. When script load order accidentally resolves in their favor in classic admin, nobody notices; when our chromeless render shifts timing, the underlying bug surfaces and the plugin's React integration crashes before it can mount any UI.

We can't change the plugin's PHP, but `WP_Scripts::$registered` is a mutable in-memory map. Adding a missing dep onto an existing registration is idempotent, side-effect-free, and silently becomes a no-op the day the plugin ships a real fix upstream.

### Divi — `et-builder-gutenberg` dep order + cross-frame `et_gb` scope

**File**: `includes/compat/divi.php`.

Two problems sit on the same script registration. Both manifest as the same console error: `Uncaught TypeError: Cannot read properties of undefined (reading 'isCleanNewPost')` thrown from `gutenberg.js` at module-load time. Symptom for the user: no "Use Divi Builder" block on new posts, no Divi `PluginSidebar`, no toggle — Divi appears completely absent inside a desktop window.

**Problem 1 — missing deps.** Divi (both the Divi theme and the standalone Divi Builder plugin) registers `et-builder-gutenberg` with only `[ 'jquery', 'wp-hooks' ]` as deps. The bundle reads from `wp.data` at module-load time. Without `wp-data` and `wp-editor` declared as deps, WordPress doesn't guarantee `@wordpress/editor` (which registers the `core/editor` store) has run by the time Divi's bundle executes.

**Problem 2 — cross-frame `window.et_gb`.** Divi's bundle is webpack-built with `@wordpress/data` externalised to `window.et_gb.wp.data` — not `window.wp.data`. The inline script Divi adds (`before` the bundle) sets `window.et_gb` via this expression:

```js
window.et_gb = (window.top && window.top.Cypress && window.parent === window.top && window)
    || (window.top && window.top.Cypress && window.parent !== window.top && window.parent)
    || window.top   // ← falls through to here in our chromeless iframe
    || window;
```

In classic admin `window.top === window`, so `et_gb = window` and the bundle resolves `wp.data` against the page's own globals. Inside a chromeless iframe `window.top` is the desktop shell — a different document with no `wp.data` — so `et_gb.wp.data` is undefined and the bundle throws on first access.

**Fix**: `desktop_mode_compat_divi_fix_gutenberg_deps()` hooks `enqueue_block_editor_assets` at priority 999 (after Divi's priority 4) and does two things:

1. Push `wp-data` + `wp-editor` onto Divi's existing registration's `deps`. The script loader then orders the bundle after `core/editor` registers.
2. *Only inside chromeless requests*, append an inline `before` script that re-assigns `window.et_gb = window;`. Multiple `wp_add_inline_script( …, 'before' )` calls concatenate in registration order, so ours runs after Divi's and wins. We scope this to chromeless because Divi's original `et_gb = window.top` is legitimate for top-level page loads and for the Cypress-iframe case.

**Plugins this addresses**: Divi theme (4.x and 5.x as of 5.5.2), Divi Builder plugin (same `et-builder-gutenberg` handle).

**Test**: `tests/phpunit/tests/diviCompat.php` — pins dep injection (`test_injects_missing_wp_editor_and_wp_data_deps`), the no-op-when-absent case (`test_no_op_when_divi_not_registered`), idempotence (`test_does_not_duplicate_deps_when_already_present`), the chromeless `et_gb` override (`test_chromeless_request_appends_et_gb_window_override`), and the classic-admin guard (`test_classic_request_does_not_append_et_gb_override`).

### Divi — Visual Builder `top_window` resolves to the desktop shell

**File**: `includes/compat/divi.php` (`desktop_mode_compat_divi_vb_iframe_signal`).

A second class of cross-frame bug bites once Divi's Visual Builder launches inside our chromeless iframe (e.g., user clicks the "Use Divi Builder" block, the iframe navigates to `/?p=N&et_fb=1`, VB attempts to mount). The VB bundle imports a `top_window` helper from `frontend-builder/build/frame-helpers.js`. Its resolver, simplified:

```js
try { u = !!window.top.document && window.top; } catch ( _ ) { u = false; }
if ( u && u.__Cypress__ ) {                  // Cypress escape hatch
    top_window = ( window.parent === u ) ? window : window.parent;
    is_iframe  = ( window.parent !== u );
} else if ( u ) {
    top_window = u;                          // ← falls through here for us
    is_iframe  = ( u !== window.self );      // ← so is_iframe = true
}
window.ET_Builder = …({ Frames: { top: top_window } });
```

Inside our chromeless iframe `window.top` is the desktop shell — a same-origin document with no Divi globals, no `wp.data`, no REST nonce. VB then routes its REST roundtrips, state queries, and DOM ops through that shell window and waits forever. Symptom: the `et-fb-page-preloading` loader spins forever after clicking "Use Divi Builder".

**Fix part 1 — `__Cypress__` flag.** Hook `wp_head` priority 1 and, when the current request is front-end AND the current user has desktop mode enabled, emit a tiny inline script that sets `window.top.__Cypress__ = true`. That trips Divi's first branch; since `window.parent === window.top` for our single-level iframe, `top_window` resolves to `window` (the iframe itself) and `is_iframe` becomes `false`. The flag is idempotent (`OR`-with-existing) and reads nowhere else in the WP stack.

**Fix part 2 — preloader bridge (VB-top frame only).** Divi 5's VB architecture is 2 frames deep (`/?et_fb=1` hosts an inner `<iframe id="et-vb-app-frame" src="…&app_window=1">`). Inside Desktop Mode that becomes 3 frames: shell → chromeless iframe (VB-top) → inner app-frame. The cleanup in `visual-builder/build/root.js` runs inside the inner app-frame and does:

```js
e( document );
window.top && window.top !== window && window.top.document && e( window.top.document );
```

…where `e()` strips `et-fb-page-preloading` from `#et-fb-app` and `#et-fb-app-body-root`. In classic admin `window.top` IS the VB-top. In Desktop Mode `window.top` is the shell, which has no Divi elements — so the cleanup never reaches the visible preloader at the chromeless iframe level, and the loader spins forever.

We mirror the removal by watching the inner app-frame from the VB-top: a MutationObserver on the child iframe's document fires the local cleanup once the inner `#et-fb-app` loses the class. A 30s watchdog timeout strips the preloader even if the observer never fires. Detection is via the `app_window=1` query flag Divi sets on the inner iframe URL — present means we're the inner frame and skip the bridge; absent means we're the VB-top and emit it.

**Plugins this addresses**: Divi theme (frontend Visual Builder, `et_fb=1` activation flow) — applies to Divi 5.x with the two-frame VB architecture. Older 4.x Visual Builder uses a single frame; only Fix part 1 applies there.

**Tests**: `tests/phpunit/tests/diviCompat.php` — `test_vb_iframe_signal_emits_on_front_end_for_desktop_user`, `test_vb_iframe_signal_skips_admin_requests`, `test_vb_iframe_signal_skips_when_desktop_mode_disabled`, `test_vb_top_frame_emits_preloader_bridge`, `test_inner_app_frame_skips_preloader_bridge`.

### Divi — hand the VB session off to a standalone browser tab

**File**: `includes/compat/divi.php` (`desktop_mode_compat_divi_eject_iframe_patch` + `desktop_mode_compat_divi_eject_parent_listener` + `desktop_mode_compat_divi_is_active`).

Even with shims 1–3 above, Divi VB inside our three-level iframe nesting (shell → chromeless iframe → Divi's inner app-frame) is materially slower than running at top level — the browser de-prioritizes resource loading at each nesting depth, image-measurement scripts read 0 because `load` fires before `naturalWidth` settles, and the `et-fb-page-preloading` overlay sits up for many seconds while ~100 builder scripts parse on the throttled main thread. VB is a focus-mode editor that takes over the entire viewport anyway — the desktop metaphor doesn't add value while you're inside it.

**Strategy**: detect the user's *intent* to enter VB at the click layer, ask for explicit confirmation, then navigate the top tab to a classic-admin post-edit page so Divi can run in its native single-frame environment. Two clicks total to enter VB, but each is deliberate.

**Why click-by-text-content instead of patching navigation primitives**:

Earlier iterations tried to transparently intercept Divi's navigation — patching `Location.prototype.href`, intercepting `fetch` / `XHR`, watching iframe `load` events — and all of them failed in different ways. Divi captures `Location` references early in its bundle init, makes its REST save through a path our `fetch`/`XHR` wraps don't reach (it goes through `@wordpress/api-fetch` which bundles its own `fetch` reference), and the page-leave tears down our console before any diagnostic we add survives. The honest fix is to detect at a layer we *can* see — the click itself — and explicitly ask the user before doing anything irreversible.

Detection is by visible text content on the clicked element rather than by selector — Divi changes the button class across versions but the user-facing label has been stable for years. We match: `"Use Divi Builder"`, `"Use The Divi Builder"`, `"Edit With The Divi Builder"`, `"Edit With Divi"` (case-insensitive, trimmed). The "Use Default Editor" sibling button is not in the match set, so users can still keep editing in Gutenberg.

**Fix**:

1. **Iframe-side click handler** (`admin_head` priority 0, chromeless + Divi-active only). Installs a capture-phase `click` listener that walks up from `e.target` looking for a `BUTTON`, `A`, `INPUT`, or `SPAN` whose trimmed lowercase text matches the VB button set. On match: `preventDefault` + `stopPropagation` + `stopImmediatePropagation`, then `postMessage` to the parent shell with `{ type: 'desktop-mode-divi-vb-handoff', url: window.location.href }`. The handler is also installed inside every reachable same-origin nested iframe (Gutenberg's editor canvas, etc.) — a `MutationObserver` on `document.documentElement` walks new iframes as they're added.

2. **Parent-shell listener** (`admin_footer` priority 1, non-chromeless + Divi-active only). Listens for `desktop-mode-divi-vb-handoff` postMessages, checks `ev.origin === window.location.origin`, then reshapes the URL: strip `desktop_mode_chromeless` (the iframe-only flag would keep us in chromeless render at top level), add `desktop_mode_classic=1` (consumed by `desktop_mode_redirect_plain_admin_to_portal()` in `includes/portal.php:286-288` to skip the portal-redirect for this request). Then shows `wp.desktop.confirm()` with `hideCancel: true` + `dismissable: true` — a single "Open Divi in this tab" action plus an X to close. On confirm, sets `window.top.location.href` to the reshaped URL. On X-close or Escape, does nothing — the user stays where they were and can click the button again later to re-show the dialog.

3. **`desktop_mode_compat_divi_is_active()`** — small helper that returns true for the Divi theme or the Divi Builder plugin. Both halves of the fix are gated on it so non-Divi sites pay nothing.

**Plugins this addresses**: Divi theme + Divi Builder plugin, every editing flow whose "Use Divi Builder" / "Edit With Divi" button text matches one of the patterns above — Gutenberg block placeholder, Classic Editor row action, admin-bar Edit-With-Divi link.

**Tests**: `tests/phpunit/tests/diviCompat.php` — `test_iframe_patch_emits_in_chromeless_for_divi`, `test_iframe_patch_skips_when_not_chromeless`, `test_iframe_patch_skips_without_divi`, `test_parent_listener_emits_on_shell_for_divi`, `test_parent_listener_skips_in_chromeless_request`, `test_parent_listener_skips_when_desktop_mode_disabled`, `test_parent_listener_skips_without_divi`, `test_is_active_true_for_divi_theme`, `test_is_active_false_for_other_theme`. Vitest covers `wpd-confirm-dialog`'s `hideCancel` / `dismissable` props in `src/ui/components/wpd-confirm-dialog/wpd-confirm-dialog.test.ts`.

> **Note**: shims 1–3 remain in place. Shim 1 (deps fix) is needed so the Divi block actually *renders* with its "Use Divi Builder" button — that label is what the click handler matches on. Shims 2 (`__Cypress__`) and 3 (preloader bridge) remain as defense-in-depth for users who *don't* take the handoff and let VB load inside the iframe anyway (e.g., older Divi versions that don't show our match-text buttons, or third-party plugins that activate VB through an unintercepted path).

## Adding a new fix

Decision tree, in order:

1. **Does the plugin use `var(...)` to read an admin-chrome dimension?** → Tier 1 already covers it. Verify by inspecting the iframe's computed styles.
2. **Is the offending CSS rule a `top: <pixel>` on a positioned element, with an admin-bar-height pixel value?** → Tier 2 covers it. Verify the value is in the default set or extend via `desktop_mode_chromeless_admin_bar_top_values`.
3. **Is the offending CSS rule selector-targetable and self-contained?** → Tier 3 — write a scoped CSS override in `chromeless.css`. Follow the docblock template above.
4. **Is the breakage in menu data, not CSS?** → Add a dock-side adaptation in `includes/core/payload.php` and a PHPUnit test under `tests/phpunit/tests/desktopModeBuildDockItems.php` (or `desktopModeMenuItemUrl.php` if it's a URL-builder issue).
5. **Is a block-editor script crashing at module load because of a missing `wp_enqueue_script()` dep?** → Add a registration-mutation shim under `includes/compat/<plugin>.php` and a PHPUnit test that pins the shape. Follow `includes/compat/divi.php` as the template.
6. **Is it none of the above?** Open an issue. Don't escalate to broad fixes (`overflow: hidden` on body, JS-rewriting stylesheets, etc.) without a discussion — those tend to break more than they fix.

## Test discipline

Every menu-data adaptation gets a PHPUnit test that pins the plugin scenario it addresses. Look at:

- `tests/phpunit/tests/desktopModeBuildDockItems.php` — `test_parent_url_falls_through_to_first_submenu_when_different`, `test_skips_submenu_items_with_empty_title`, etc.
- `tests/phpunit/tests/desktopModeMenuItemUrl.php` — `test_routes_slug_with_embedded_query_params`, `test_routes_slug_with_multiple_embedded_query_params`, etc.

CSS-tier fixes don't have automated tests — they're verified by reloading the relevant plugin's window and inspecting the result. Document the verification steps in the docblock.

## What we deliberately don't do

- **No `overflow-x: hidden` or `overflow: clip` on the iframe `<html>` / `<body>`**. Tempting but breaks `position: sticky`, `position: fixed` containing-block resolution, and creates scroll containers that interfere with editor pages.
- **No JS-rewriting of stylesheets at runtime**. Cross-origin issues, fragile, performance.
- **No removing elements from the DOM.** A plugin author can rely on a hidden `<div>` being present for measurements; removing it can break things in subtler ways than visibility / overflow.
- **No global `* { ... }` rules**. Specificity wars with plugin CSS, hard to reason about.

## Related

- [Hooks Reference — `desktop_mode_chromeless_styles`](./hooks-reference.md#desktop_mode_chromeless_styles--stable) — escape hatch for **plugin authors** to add iframe-side overrides for their own plugin (or a dependency) without us shipping it in the layer.
- [Hooks Reference — `desktop_mode_chromeless_admin_bar_top_values`](./hooks-reference.md) — extend the runtime neutralizer's match set.
- [Architecture](./architecture.md) — how chromeless rendering fits into the bigger picture.
- [Examples — `chromeless-style-override`](./examples/chromeless-style-override.md) — plugin-author recipe for the same idea, scoped to the iframe of their own page.
