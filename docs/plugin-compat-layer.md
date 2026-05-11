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

**File**: `includes/render.php` → `desktop_mode_chromeless_offset_neutralizer_script()`.

Inline script injected at `admin_head` priority 1. On `DOMContentLoaded` and again at `load`, walks every positioned element (`fixed | sticky | absolute`) and overrides any `top` value matching the admin-bar offset set (defaults: `32px`, `46px`) to `0px !important`.

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

Some plugins register WordPress admin menu entries in shapes that our dock can't naively render. These adaptations live in `includes/helpers.php` (`desktop_mode_build_dock_items()`, `desktop_mode_menu_item_url()`) and have PHPUnit coverage.

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

**Fix**: `desktop_mode_inject_appearance_tabs()` (in `includes/themes-tabs.php`) hooks `desktop_mode_dock_item` and prepends `{ title: 'Add Theme', url: theme-install.php }` to the Appearance dock item's submenu when the current user has `install_themes`. The chromeless CSS rule that previously kept the page-title-action visible on `themes.php` has been removed (`assets/css/chromeless.css`) so the in-page button stays hidden — the tab is the canonical entry point.

Resulting tab order: Appearance | Add Theme | Editor | Fonts | …

## Adding a new fix

Decision tree, in order:

1. **Does the plugin use `var(...)` to read an admin-chrome dimension?** → Tier 1 already covers it. Verify by inspecting the iframe's computed styles.
2. **Is the offending CSS rule a `top: <pixel>` on a positioned element, with an admin-bar-height pixel value?** → Tier 2 covers it. Verify the value is in the default set or extend via `desktop_mode_chromeless_admin_bar_top_values`.
3. **Is the offending CSS rule selector-targetable and self-contained?** → Tier 3 — write a scoped CSS override in `chromeless.css`. Follow the docblock template above.
4. **Is the breakage in menu data, not CSS?** → Add a dock-side adaptation in `includes/helpers.php` and a PHPUnit test under `tests/phpunit/tests/desktopModeBuildDockItems.php` (or `desktopModeMenuItemUrl.php` if it's a URL-builder issue).
5. **Is it none of the above?** Open an issue. Don't escalate to broad fixes (`overflow: hidden` on body, JS-rewriting stylesheets, etc.) without a discussion — those tend to break more than they fix.

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
