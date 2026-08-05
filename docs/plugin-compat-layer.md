# Plugin compatibility layer

*Internals doc. Plugin authors usually don't need this — it's how OpenStation adapts third-party plugins whose CSS / menu data was written assuming classic admin chrome.*

## Why this exists

Chromeless iframes (`?openstation_chromeless=1`) hide the admin bar, sidebar menu, and wp-footer. Most admin pages render correctly without modification. **Some don't** — because the plugin authoring them hardcoded assumptions about classic admin geometry into their CSS or menu registration. We can't ship a fix upstream for every plugin in the directory; instead, we maintain a small, documented **compatibility layer** that adapts the chromeless render to common patterns.

This doc is the contract: what the layer does, why each piece is there, and how to add a new fix when a plugin surfaces a new shape we haven't handled.

## The three tiers

We try fixes in this order. Lower-numbered tiers cover broader plugin sets and have lower blast radius — only escalate when a tier above it can't reach the issue.

### Tier 1 — CSS variable rebinds

**File**: `assets/css/chromeless.css` (the rule near the top, scoped to `html.wp-toolbar:has( body.os-chromeless )`).

Core defines exactly two layout-related CSS custom properties on `<html>`:

```css
--wp-admin--admin-bar--height            /* 32px / 46px on small screens */
--wp-admin--admin-bar--position-offset   /* derived from above */
```

Plugins that reference these via `var()` (e.g., `top: var(--wp-admin--admin-bar--height)`) will resolve correctly inside chromeless because we rebind both to `0px`. **No JS, no runtime cost** — first-paint correct.

When this is enough: any plugin that uses `var(...)` instead of literal pixels.

When it isn't: plugins that compile literal pixel values into their CSS (SCSS interpolation, build-time constants).

### Tier 2 — Runtime offset neutralizer

**File**: `includes/render/chromeless-bridge.php` → `openstation_chromeless_offset_neutralizer_script()`.

Inline script injected at `admin_head` priority 1. Runs one full walk at `DOMContentLoaded` over every positioned element (`fixed | sticky | absolute`), overriding any `top` value matching the admin-bar offset set (defaults: `32px`, `46px`) to `0px !important`; a `MutationObserver` then corrects late-added nodes (React-mounted components, etc.) as they appear. A second full walk at `load` only runs as a fallback on browsers without `MutationObserver`.

Match is exact-pixel — we don't catch `top: 33px`. False positives are possible but unlikely; a plugin would have to use `32px` for an unrelated reason AND need that exact value to remain inside chromeless.

Filter to extend or narrow:

```php
add_filter( 'openstation_chromeless_admin_bar_top_values', function ( $values ) {
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
.os-chromeless .woocommerce-layout__header {
    width: 100% !important;
}
```

When this is enough: any plugin with a self-contained layout breakage you can target by selector.

When it isn't: there is no when-it-isn't here. If a generic mechanism doesn't reach it, write a targeted override.

## The dock side: menu data adaptations

Some plugins register WordPress admin menu entries in shapes that our dock can't naively render. These adaptations live in `includes/core/payload.php` (`openstation_build_dock_items()`, `openstation_menu_item_url()`) and have PHPUnit coverage.

### Embedded query parameters in menu slugs

`add_submenu_page()` accepts a slug like `wc-admin&path=/customers` (slug + query string). Naive `rawurlencode()`-ing the whole string mangles the `&` to `%26` and breaks the consuming plugin's router.

**Fix**: `openstation_menu_item_url()` splits the slug on the first `&`, encodes only the page portion, and rebuilds the URL via `add_query_arg()` so each value is encoded once and `&` separators stay literal.

**Plugins this addresses**: every wc-admin React route (Customers, Analytics, Marketing, …); also Yoast SEO and other plugins that pack paths into menu slugs.

### Legacy file-path menu slugs (`vendor/file.php`)

Old-school plugins register their admin page with a file-path slug — `add_management_page( …, 'wp-sweep/admin.php' )` — instead of a plain slug. The slug contains `.php`, so a naive "does it look like an admin file?" test routes it to `admin_url( 'wp-sweep/admin.php' )`, a 404. WordPress actually serves the page at `tools.php?page=wp-sweep/admin.php` (the slug is a key in the `$_parent_pages` global, exactly like a plain plugin-page slug).

**Fix**: both URL resolvers — `openstation_menu_item_url()` (dock / window tabs) and `openstation_build_command_menu_map()` (command palette) — check `$_parent_pages` for the raw slug **before** the direct-file test. A registered slug goes through the canonical `menu_page_url()`-style resolution regardless of what characters it contains; only unregistered `.php` slugs are treated as real files under `wp-admin/`.

**Refinement**: the registered-page check alone over-matched. URL-style slugs — ACF's `add_menu_page( …, 'edit.php?post_type=acf-field-group' )` — *also* land in `$_parent_pages`, yet reference a real `wp-admin/` file; routing them through `admin.php?page=…` makes core's dispatcher die with "Cannot load edit.php?post_type=acf-field-group." The resolvers now apply the same tiebreaker classic admin's `menu-header.php` uses: `openstation_is_admin_file_slug()` strips the query portion and checks whether the remaining path exists under `wp-admin/`. A real admin file stays a direct link even when registered; a registered non-file slug (WP-Sweep) still resolves through its parent.

**Plugins this addresses**: WP-Sweep; any plugin still using the pre-3.0-era file-path registration style; ACF and any plugin registering URL-style menu slugs (`edit.php?post_type=…`).

### `esc_url_raw()` for JSON contexts

Dock URLs flow into the shell config as JSON, then end up assigned to `iframe.src` / `window.location.href`. Browsers do **not** decode `&#038;` HTML entities in those JS string contexts.

**Fix**: `openstation_menu_item_url()` returns `esc_url_raw()`-sanitized URLs, not `esc_url()`-sanitized. Same XSS-safe sanitization, no entity encoding.

### Parent menu URL fallthrough

Some plugins register a top-level menu with a stub callback whose actual landing page is the first submenu (`add_menu_page( …, 'woocommerce', null, … )` then `add_submenu_page( 'woocommerce', …, 'wc-admin', … )`). Classic admin's `wp-admin/menu-header.php` rewrites the parent's clickable link to the first submenu's URL. Hitting `?page=woocommerce` directly invokes the stub and 500s.

**Fix**: `openstation_build_dock_items()` mirrors this — if a parent menu has any visible submenu, the parent's effective URL is the first capability-passing submenu's URL.

**Plugins this addresses**: WooCommerce, historically Yoast SEO, several membership / LMS plugins.

### Empty submenu titles

Plugins (notably WooCommerce's `wc-addons` Extensions row) register `menu_title => null` to keep a page reachable while hiding the row from classic admin's left menu. Our dock would otherwise render an empty, label-less tab that visually duplicates a sibling entry.

**Fix**: `openstation_build_dock_items()` skips submenu entries whose cleaned title is empty / null / whitespace.

### Synthetic "Add Theme" tab on the Appearance window

Core does not register `theme-install.php` as a submenu of `themes.php` — classic admin only surfaces it through the in-page "Add Theme" `.page-title-action` button at the top of `themes.php`. Inside chromeless that button scrolls out of view on first paint (the focus-target heuristic on the visible theme grid steals the scroll position), leaving no entry point to the install flow.

**Fix**: `openstation_inject_appearance_tabs()` (in `includes/themes-tabs.php`) hooks `openstation_dock_item` and prepends `{ title: 'Add Theme', url: theme-install.php }` to the Appearance dock item's submenu when the current user has `install_themes`. An explicit per-page rule in `assets/css/chromeless.css` (`.os-chromeless.themes-php .wrap > .page-title-action { display: none; }`) hides the in-page button on `themes.php` — the tab is the canonical entry point, while the global rule keeping `.page-title-action` visible on other pages stays intact.

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

**Fix**: `openstation_compat_divi_fix_gutenberg_deps()` hooks `enqueue_block_editor_assets` at priority 999 (after Divi's priority 4) and does two things:

1. Push `wp-data` + `wp-editor` onto Divi's existing registration's `deps`. The script loader then orders the bundle after `core/editor` registers.
2. *Only inside chromeless requests*, append an inline `before` script that re-assigns `window.et_gb = window;`. Multiple `wp_add_inline_script( …, 'before' )` calls concatenate in registration order, so ours runs after Divi's and wins. We scope this to chromeless because Divi's original `et_gb = window.top` is legitimate for top-level page loads and for the Cypress-iframe case.

**Plugins this addresses**: Divi theme (4.x and 5.x as of 5.5.2), Divi Builder plugin (same `et-builder-gutenberg` handle).

**Test**: `tests/phpunit/tests/diviCompat.php` — pins dep injection (`test_injects_missing_wp_editor_and_wp_data_deps`), the no-op-when-absent case (`test_no_op_when_divi_not_registered`), idempotence (`test_does_not_duplicate_deps_when_already_present`), the chromeless `et_gb` override (`test_chromeless_request_appends_et_gb_window_override`), and the classic-admin guard (`test_classic_request_does_not_append_et_gb_override`).

### Divi — Visual Builder `top_window` resolves to the desktop shell

**File**: `includes/compat/divi.php` (`openstation_compat_divi_vb_iframe_signal`).

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

**Fix part 1 — `__Cypress__` flag.** Hook `wp_head` priority 1 and, when the current request is front-end AND the current user has OpenStation enabled, emit a tiny inline script that sets `window.top.__Cypress__ = true`. That trips Divi's first branch; since `window.parent === window.top` for our single-level iframe, `top_window` resolves to `window` (the iframe itself) and `is_iframe` becomes `false`. The flag is idempotent (`OR`-with-existing) and reads nowhere else in the WP stack.

**Fix part 2 — preloader bridge (VB-top frame only).** Divi 5's VB architecture is 2 frames deep (`/?et_fb=1` hosts an inner `<iframe id="et-vb-app-frame" src="…&app_window=1">`). Inside OpenStation that becomes 3 frames: shell → chromeless iframe (VB-top) → inner app-frame. The cleanup in `visual-builder/build/root.js` runs inside the inner app-frame and does:

```js
e( document );
window.top && window.top !== window && window.top.document && e( window.top.document );
```

…where `e()` strips `et-fb-page-preloading` from `#et-fb-app` and `#et-fb-app-body-root`. In classic admin `window.top` IS the VB-top. In OpenStation `window.top` is the shell, which has no Divi elements — so the cleanup never reaches the visible preloader at the chromeless iframe level, and the loader spins forever.

We mirror the removal by watching the inner app-frame from the VB-top: a MutationObserver on the child iframe's document fires the local cleanup once the inner `#et-fb-app` loses the class. A 30s watchdog timeout strips the preloader even if the observer never fires. Detection is via the `app_window=1` query flag Divi sets on the inner iframe URL — present means we're the inner frame and skip the bridge; absent means we're the VB-top and emit it.

**Plugins this addresses**: Divi theme (frontend Visual Builder, `et_fb=1` activation flow) — applies to Divi 5.x with the two-frame VB architecture. Older 4.x Visual Builder uses a single frame; only Fix part 1 applies there.

**Tests**: `tests/phpunit/tests/diviCompat.php` — `test_vb_iframe_signal_emits_on_front_end_for_desktop_user`, `test_vb_iframe_signal_skips_admin_requests`, `test_vb_iframe_signal_skips_when_openstation_disabled`, `test_vb_top_frame_emits_preloader_bridge`, `test_inner_app_frame_skips_preloader_bridge`.

### Divi — hand the VB session off to a standalone browser tab

**File**: `includes/compat/divi.php` (`openstation_compat_divi_eject_iframe_patch` + `openstation_compat_divi_eject_parent_listener` + `openstation_compat_divi_is_active`).

Even with shims 1–3 above, Divi VB inside our three-level iframe nesting (shell → chromeless iframe → Divi's inner app-frame) is materially slower than running at top level — the browser de-prioritizes resource loading at each nesting depth, image-measurement scripts read 0 because `load` fires before `naturalWidth` settles, and the `et-fb-page-preloading` overlay sits up for many seconds while ~100 builder scripts parse on the throttled main thread. VB is a focus-mode editor that takes over the entire viewport anyway — the desktop metaphor doesn't add value while you're inside it.

**Strategy**: detect the user's *intent* to enter VB at the click layer, ask for explicit confirmation, then navigate the top tab to a classic-admin post-edit page so Divi can run in its native single-frame environment. Two clicks total to enter VB, but each is deliberate.

**Why click-by-text-content instead of patching navigation primitives**:

Earlier iterations tried to transparently intercept Divi's navigation — patching `Location.prototype.href`, intercepting `fetch` / `XHR`, watching iframe `load` events — and all of them failed in different ways. Divi captures `Location` references early in its bundle init, makes its REST save through a path our `fetch`/`XHR` wraps don't reach (it goes through `@wordpress/api-fetch` which bundles its own `fetch` reference), and the page-leave tears down our console before any diagnostic we add survives. The honest fix is to detect at a layer we *can* see — the click itself — and explicitly ask the user before doing anything irreversible.

Detection is by visible text content on the clicked element rather than by selector — Divi changes the button class across versions but the user-facing label has been stable for years. We match: `"Use Divi Builder"`, `"Use The Divi Builder"`, `"Edit With The Divi Builder"`, `"Edit With Divi"` (case-insensitive, trimmed). The "Use Default Editor" sibling button is not in the match set, so users can still keep editing in Gutenberg.

**Fix**:

1. **Iframe-side click handler** (`admin_head` priority 0, chromeless + Divi-active only). Installs a capture-phase `click` listener that walks up from `e.target` looking for a `BUTTON`, `A`, `INPUT`, or `SPAN` whose trimmed lowercase text matches the VB button set. On match: `preventDefault` + `stopPropagation` + `stopImmediatePropagation`, then `postMessage` to the parent shell with `{ type: 'os-divi-vb-handoff', url: window.location.href }`. The handler is also installed inside every reachable same-origin nested iframe (Gutenberg's editor canvas, etc.) — a `MutationObserver` on `document.documentElement` walks new iframes as they're added.

2. **Parent-shell listener** (`admin_footer` priority 1, non-chromeless + Divi-active only). Listens for `os-divi-vb-handoff` postMessages, checks `ev.origin === window.location.origin`, then reshapes the URL: strip `openstation_chromeless` (the iframe-only flag would keep us in chromeless render at top level), add `desktop_mode_classic=1` (consumed by `openstation_redirect_plain_admin_to_portal()` in `includes/portal.php:286-288` to skip the portal-redirect for this request). Then shows `wp.os.confirm()` with `hideCancel: true` + `dismissable: true` — a single "Open Divi in this tab" action plus an X to close. On confirm, sets `window.top.location.href` to the reshaped URL. On X-close or Escape, does nothing — the user stays where they were and can click the button again later to re-show the dialog.

3. **`openstation_compat_divi_is_active()`** — small helper that returns true for the Divi theme or the Divi Builder plugin. Both halves of the fix are gated on it so non-Divi sites pay nothing.

**Plugins this addresses**: Divi theme + Divi Builder plugin, every editing flow whose "Use Divi Builder" / "Edit With Divi" button text matches one of the patterns above — Gutenberg block placeholder, Classic Editor row action, admin-bar Edit-With-Divi link.

**Tests**: `tests/phpunit/tests/diviCompat.php` — `test_iframe_patch_emits_in_chromeless_for_divi`, `test_iframe_patch_skips_when_not_chromeless`, `test_iframe_patch_skips_without_divi`, `test_parent_listener_emits_on_shell_for_divi`, `test_parent_listener_skips_in_chromeless_request`, `test_parent_listener_skips_when_openstation_disabled`, `test_parent_listener_skips_without_divi`, `test_is_active_true_for_divi_theme`, `test_is_active_false_for_other_theme`. Vitest covers `os-confirm-dialog`'s `hideCancel` / `dismissable` props in `src/ui/components/os-confirm-dialog/os-confirm-dialog.test.ts`.

> **Note**: shims 1–3 remain in place. Shim 1 (deps fix) is needed so the Divi block actually *renders* with its "Use Divi Builder" button — that label is what the click handler matches on. Shims 2 (`__Cypress__`) and 3 (preloader bridge) remain as defense-in-depth for users who *don't* take the handoff and let VB load inside the iframe anyway (e.g., older Divi versions that don't show our match-text buttons, or third-party plugins that activate VB through an unintercepted path).

## The site-window side: WooCommerce

`includes/my-wordpress/integrations/woocommerce.php` plus the
`my-wordpress-woocommerce` bundle. Everything in both is inert unless
`class_exists( 'WooCommerce' )`, and the bundle is enqueued only for
users who can open the site window on a store — a site without
WooCommerce ships and runs none of it.

Three problems, each one a general shape worth recognising:

**The folder name didn't fit.** Group labels come from the plugin's
`Plugin Name` header, and "WooCommerce" wraps onto two lines in an
88px tile. The `openstation_my_wordpress_post_type_group` filter
relabels the folder to **Woo** and swaps the generic plugin dashicon
for WooCommerce's own mark. The mark is re-emitted with
`fill="currentColor"` rather than WooCommerce's hard-coded grey, so
`renderIcon()` masks it and the icon follows the desktop theme.
WooCommerce builds the same glyph inline in
`WC_Admin_Menus::admin_menu()` as a local variable, so there is nothing
to read at runtime.

**Orders were an empty folder.** `shop_order` is a registered
`show_ui` post type, so the generic pass gave it a section — but
WooCommerce's High-Performance Order Storage keeps orders in its own
tables, not `wp_posts`, so the `WP_Query` behind that section returns
nothing on any modern store. The integration registers its own Orders
section at filter priority 5, claiming `post_type => 'shop_order'` so
the generic pass skips it, pointed at
`desktop-mode/v1/woocommerce/orders`. That route reads through
`wc_get_orders()`, which is storage-agnostic — one code path serves
HPOS and legacy stores alike. Rows are shaped like posts
(`title.rendered`, `date`, `status`, `link`), so the window's existing
list, detail, and pagination fetchers consume them unchanged.

Order rows deliberately report `status: 'publish'`. The tile's status
ribbon only speaks `draft` / `pending` / `private` / `future`, and a
`wc-processing` value would paint a meaningless ribbon on every single
order. The real status is in the right pane.

**The right pane said nothing useful.** Products, orders and coupons
got the generic post preview — a title and some prose. The bundle
subscribes to
[`os.my-wordpress.preview-extras`](./javascript-reference.md#action--openstationmy-wordpresspreview-extras)
and paints merchant facts into the `header` slot: price / stock /
units sold for a product, total / customer / line items for an order,
validity / discount / usage for a coupon. It also subscribes to
[`os.my-wordpress.group-extras`](./javascript-reference.md#action--openstationmy-wordpressgroup-extras)
to show revenue this month, orders awaiting action, and out-of-stock
count on the Woo folder itself. Data comes from
`desktop-mode/v1/woocommerce/summary/<type>/<id>` and
`/woocommerce/store`, both read-only and capability-gated (`edit_post`
for products and coupons, the `shop_order` edit capability for orders
and store totals).

**Customers were a report, not a place.** WooCommerce ships two views
of the people who buy from a store and neither is somewhere you can
work: `users.php` is a role list that knows nothing about money, and
Analytics → Customers is a report you read and then leave. Neither one
opens next to the order it explains.

`includes/my-wordpress/integrations/woocommerce-customers.php` adds a
**Customers** section rendering through the built-in `user` entity kind
— avatar tiles, the dossier pane, the footprint route, the drag-out
seam — so a customer is a first-class desktop object. Rows carry an
`openstation_woo_customer` payload (lifetime spend, order count,
average order, first and last order, days since) that the bundle turns
into a money sub-line on the tile, a VIP / Lapsed corner ribbon, and a
Customer panel in the preview pane.

The whole section costs **one grouped query** over the order store,
cached for five minutes and flushed on any order change. Band
ordering, per-row facts and folder counts all read that one map, so a
page of customers fires no per-row order queries. See the
[Customers hooks](./hooks-reference.md#woocommerce-integration--experimental-filters)
for the bands and the thresholds behind them.

Because the field is registered on the core `user` REST resource
rather than only on our collection, the built-in **Users** section
gets the same decoration for free. That is the point: on a store,
"who is this person" and "what have they spent" are the same question.

Two seams had to exist for the pane to read right, and both are
generic. The built-in user dossier answers *"what has this person
written"* — post and page counts, a publishing sparkline, recent
posts — which for someone who came to buy a hat is four zeroes above
the figure you actually wanted;
[`os.my-wordpress.user-dossier-sections`](./javascript-reference.md#filter--osmy-wordpressuser-dossier-sections)
drops them. And "View activity footprint" opens a publishing-history
surface that for a customer is an empty screen;
[`os.my-wordpress.user-preview-actions`](./javascript-reference.md#filter--osmy-wordpressuser-preview-actions)
swaps it for **View their orders**, which opens the filtered orders
screen as its own window — beside the customer, not instead of them.

The panel paints into the `meta` slot rather than `header`: money
above an avatar reads as a label on the person, and you cannot tell
whose figure it is until you have scrolled past it to the name. Name
and face first, then the summary.

The tile marker is a small badge on the bottom edge of the avatar, the
way a status dot sits on a contact photo — not the `<os-ribbon>`
corner banner the Products grid uses, and not a line of text under the
name. A 45° banner across the artwork works on a product photo and is
vandalism on a face; a line of text crowds an 88px icon and pushes the
name down the grid. An icon is a face, a name, and at most one mark.
Everything else is one click away, where there is room to say it
properly.

**Double-clicking a customer opens the Customer window**
(`desktop-mode-woo-customer`, registered in
`woocommerce-customer-window.php`, rendered from the same integration
bundle): identity, the four numbers a merchant reads first, what they
buy most, their recent orders, and their addresses — each order
opening in its own window. It exists because both screens WordPress
offers instead are the wrong one: the activity footprint answers "what
has this person published", which for someone who came to buy a hat is
an empty page, and `user-edit.php` is a settings form.

The window is a retargeting singleton — its id is "the customer
window", and *which* customer is an open-time
[`params`](./javascript-reference.md#wposopenwindow-id-opts---stable)
value. Sections claim the double-click through
[`os.my-wordpress.user-activate`](./javascript-reference.md#filter--osmy-wordpressuser-activate);
only the Customers section does, so a person in the Users folder still
opens their footprint.

One trap worth naming, because it cost a real bug report: the panel's
links used to carry `target="_blank"`. In a browser tab that threw the
admin screen out of the shell entirely — and once OpenStation is
installed as a PWA, a `_blank` navigation to a same-origin admin URL
is inside the app's scope, so **clicking a product name relaunched the
whole app**. Panel links now keep a real `href` (middle-click and
"copy link" still work) and claim the plain click to open a desktop
window instead.

**An order was the most connected object in WordPress and the least
connected screen.** It names a customer, some products, maybe a coupon
— and every one of those is text. To go from an order to the product
it sold you go back to the catalogue and search for it.

`includes/my-wordpress/integrations/woocommerce-relations.php` wires
WooCommerce into the two relation surfaces the shell already has.
[`openstation_window_content_identity`](./hooks-reference.md#openstation_window_content_identity--experimental)
gives an order window an identity plus `links` refs to its customer
(`user`), its products (`product`) and its coupons (`shop_coupon`), so
opening any of those beside it draws a tie on the desktop.
[`openstation_window_related_entities`](./hooks-reference.md#openstation_window_related_entities--experimental)
fills the title bar's Related menu: the customer's profile, all their
orders, every line item, every coupon — each opening as its own window
rather than navigating away from what you were reading.

The menu runs **both directions**, which is the half WooCommerce never
had. An order names its products, so order → product was always
possible; the reverse — *is this selling, and to whom?* — is the
question a merchant actually asks, and the catalogue screen has no
answer at all. A **product** now lists its categories, tags, reviews,
variations, the recent orders containing it, the customers on those
orders, and the coupons that discount it. A **coupon** lists what it
is restricted to plus the orders that redeemed it and who redeemed
them — its usage count was a bare number with nothing behind it.

Those reverse lookups read `{$prefix}woocommerce_order_items` +
`woocommerce_order_itemmeta` directly, because no WooCommerce API
answers "orders containing product X" and walking orders to find one
would mean loading every order on the store. Those two tables are the
right index and are populated under **both** storages — HPOS moves
the order rows, not the line items. Coupon restrictions are a
comma-joined id string in postmeta, which no meta query can search
safely (`LIKE '%12%'` matches 112 and 121), so those rows are read and
split in PHP under a bounded scan.

Every group carries an explicit budget. The relations engine hard-caps
a window's `related` list at 64 items, and an unbudgeted group pushes
the trailing ones silently over — you'd lose the orders because a
product happened to carry thirty tags. Product worst case is 48,
coupon 58.

The **Reviews** item needed its own identity, and the reason is worth
remembering because it generalises: a tie needs **both** windows to
have one. Every other item in a product's Related menu drew a line
because its target already announces an identity (a term screen, a
post editor, a profile, an order). WooCommerce moved reviews off
`edit-comments.php` onto its own admin page
(`edit.php?post_type=product&page=product-reviews&product_id=N`), which
the built-in detection has no reason to know about — so the window
opened and sat there unconnected. It now announces
`{ type: 'reviews', id, root: { type: 'product', id } }`, rooted at
the product exactly as core's comments identity is rooted at its post.
The unfiltered all-reviews list stays identity-less, for the same
reason core leaves the unfiltered comments list alone: a window
showing everything belongs to nothing in particular.

**If you add a Related item and it opens but draws no line, that is
the thing to check first** — not the menu, the destination.

The Customer window hit the same wall from the other side, and it is
worth stating plainly because it catches every native window: **an
iframe window announces its identity for free, a native window never
does.** The chromeless bridge builds one from the real admin screen
and posts it up; a native window has no such screen, so nothing speaks
on its behalf and the engine simply doesn't know it exists. It calls
[`wp.os.relations.set()`](./javascript-reference.md#wposrelations) in
its render callback — before the summary fetch, since the identity is
already in the window's `params` and waiting a round trip would leave
it unconnected exactly while the user is looking at it next to the
order they came from.

It announces `type: 'user'` rather than a private `wc-customer` type,
which is the whole trick: that is what `user-edit.php` announces too,
so the Customer window and a profile window on the same person join
one group — and an order, whose identity links `user:<id>`, ties to
either.

**Following "Customer" from an order** used to land on the profile
editor, which is the wrong answer to the question being asked: from an
order, *customer* means "this is who bought it", not "change their
role". The Related menu can only express a destination as a URL, and
the only URL WordPress has for a person is `user-edit.php?user_id=N`
— so the item and the profile editor were competing for one address.
The `os_person_view=wc-customer` flag settles it: the shell's built-in
profile remap stands down on any person-URL carrying the marker, and
the WooCommerce remap claims it and opens the Customer window with
`params: { customerId }`. No registration-order race, and the profile
editor is still one item away in the same menu, unmarked. Buyer
entries on a product or a coupon carry the marker too. With the
integration bundle absent the marker is just an unused query arg and
the profile opens, which is the right fallback.

HPOS matters here twice over. It moves the order editor to
`admin.php?page=wc-orders&action=edit&id=N`, where the built-in
`post.php` detection can never see it — so under HPOS this file is the
only source of an order identity at all. Under legacy storage the
built-in detection does fire, but the identity arrives with no links:
an order has no `post_content`, so the hyperlink / media / term
extractor finds nothing.

The `user` half of that needed one built-in: `user-edit.php` and
`profile.php` now announce a `user` identity (see
`includes/window-links.php`), gated on `edit_user`. It is generic —
a post's author and a comment's writer point at the same root — and it
is what lets an order tie to a profile window opened from anywhere.

The integration talks to the site window only through the public
action contract — nothing in `src/my-wordpress/index.ts` knows
WooCommerce exists. A third-party plugin would write exactly the same
code.

**Known gap:** the Customers grid is band-*ordered* (VIP first, then
lapsed, repeat, new, no-orders) but not band-*headed*. Banding chrome
lives in the post-kind list renderer; the user-kind renderer doesn't
have it yet. The order is right, the headings aren't there — the band
shows on the tile as a ribbon instead.

## Adding a new fix

Decision tree, in order:

1. **Does the plugin use `var(...)` to read an admin-chrome dimension?** → Tier 1 already covers it. Verify by inspecting the iframe's computed styles.
2. **Is the offending CSS rule a `top: <pixel>` on a positioned element, with an admin-bar-height pixel value?** → Tier 2 covers it. Verify the value is in the default set or extend via `openstation_chromeless_admin_bar_top_values`.
3. **Is the offending CSS rule selector-targetable and self-contained?** → Tier 3 — write a scoped CSS override in `chromeless.css`. Follow the docblock template above.
4. **Is the breakage in menu data, not CSS?** → Add a dock-side adaptation in `includes/core/payload.php` and a PHPUnit test under `tests/phpunit/tests/openStationBuildDockItems.php` (or `openStationMenuItemUrl.php` if it's a URL-builder issue).
5. **Is a block-editor script crashing at module load because of a missing `wp_enqueue_script()` dep?** → Add a registration-mutation shim under `includes/compat/<plugin>.php` and a PHPUnit test that pins the shape. Follow `includes/compat/divi.php` as the template.
6. **Is a plugin's content shaped wrong in the site window** — an empty folder, a useless preview, a label that doesn't fit? → Add an integration under `includes/my-wordpress/integrations/<plugin>.php`, gated on the plugin being active, and drive the UI through the site window's public filters and actions rather than special-casing the window's own code. `woocommerce.php` is the template.
7. **Is it none of the above?** Open an issue. Don't escalate to broad fixes (`overflow: hidden` on body, JS-rewriting stylesheets, etc.) without a discussion — those tend to break more than they fix.

## Test discipline

Every menu-data adaptation gets a PHPUnit test that pins the plugin scenario it addresses. Look at:

- `tests/phpunit/tests/openStationBuildDockItems.php` — `test_parent_url_falls_through_to_first_submenu_when_different`, `test_skips_submenu_items_with_empty_title`, etc.
- `tests/phpunit/tests/openStationMenuItemUrl.php` — `test_routes_slug_with_embedded_query_params`, `test_routes_slug_with_multiple_embedded_query_params`, etc.

CSS-tier fixes don't have automated tests — they're verified by reloading the relevant plugin's window and inspecting the result. Document the verification steps in the docblock.

## What we deliberately don't do

- **No `overflow-x: hidden` or `overflow: clip` on the iframe `<html>` / `<body>`**. Tempting but breaks `position: sticky`, `position: fixed` containing-block resolution, and creates scroll containers that interfere with editor pages.
- **No JS-rewriting of stylesheets at runtime**. Cross-origin issues, fragile, performance.
- **No removing elements from the DOM.** A plugin author can rely on a hidden `<div>` being present for measurements; removing it can break things in subtler ways than visibility / overflow.
- **No global `* { ... }` rules**. Specificity wars with plugin CSS, hard to reason about.

## Related

- [Hooks Reference — `openstation_chromeless_styles`](./hooks-reference.md#openstation_chromeless_styles--stable) — escape hatch for **plugin authors** to add iframe-side overrides for their own plugin (or a dependency) without us shipping it in the layer.
- [Hooks Reference — `openstation_chromeless_admin_bar_top_values`](./hooks-reference.md) — extend the runtime neutralizer's match set.
- [Architecture](./architecture.md) — how chromeless rendering fits into the bigger picture.
- [Examples — `chromeless-style-override`](./examples/chromeless-style-override.md) — plugin-author recipe for the same idea, scoped to the iframe of their own page.
