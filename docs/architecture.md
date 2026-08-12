# Architecture

A high-level tour, mostly so hook reference + examples make sense.

## Architecture 0.8.1 layout (in progress)

The plugin is mid-way through a structural refactor that splits the
historical god-modules (`src/desktop.ts`, `includes/render.php`,
`includes/components.php`, `includes/helpers.php`) into layered
folders with explicit boundaries. Foundations have landed; the
heavy splits ship in subsequent phases. Until they do, the legacy
locations remain authoritative.

| Layer | Location | Status |
|---|---|---|
| `tsconfig` path aliases (`@core/*`, `@api/*`, `@protocol/*`, `@ui/*`, `@layout/*`, `@boot/*`, `@features/*`, `@window-system/*`) | `tsconfig.json` + `vite.config.js` + `vitest.config.ts` | Stable |
| Generic reactive registry + server-sync + REST client primitives | `src/core/{reactive-registry,server-sync,api-client}.ts` | Stable |
| PHP registry factory | `includes/core/registry-factory.php` | Stable |
| Bridge protocol (typed messages + guards + version) | `src/protocol/{window-messages,guards,version}.ts` | Stable |
| Public API barrel + deprecation alias helper | `src/api/{index,deprecated}.ts` | Stable |
| Boot decomposition — `origin.ts`, `geometry.ts`, `session.ts`, `session-saver.ts`, `tracked-fetch.ts`, `link-interceptor.ts`, `menu-refresh.ts`, `shell-lifecycle.ts`, plus `src/api/facade.ts` (`buildPublicApi` + `installPublicApi`) | `src/boot/*` + `src/api/facade.ts` | Stable — desktop.ts 3,695 → 2,667 LOC; init() body still owns its own setup but the facade and 9 boot helpers are extracted |
| `src/window-system/` umbrella barrel re-exporting window/ + window-manager/ + window-chrome/ | `src/window-system/index.ts` | Stable — additive; legacy paths still resolve |
| `src/ui/core/tokens.ts` — typed `--os-ui-*` design-token namespace + `readToken` / `setToken` helpers | `src/ui/core/tokens.ts` | Stable |
| Window-system rename (`src/window/`, `src/window-manager/`, `src/window-chrome/` → `src/window-system/*`) | planned | Planned |
| `helpers.php` slicing — `core/{routing,payload,registry-factory}.php` | `includes/core/*.php` | Stable — helpers.php 1,609 → 153 LOC |
| `components.php` slicing — 5 registries under `includes/registries/` (native-windows, window-tabs, icons, wallpapers, widgets) | `includes/registries/*.php` | Stable — components.php 2,101 → 376 LOC |
| `render.php` slicing — 5 files under `includes/render/` (body-classes, assets, shell, chromeless-bridge, classic-link-interceptor) | `includes/render/*.php` | Stable — render.php 2,525 → 29-LOC umbrella |
| REST-route centralization under `includes/rest/`, `ai-copilot/search.php` split | planned | Planned |
| Heavy native-window decomposition (posts-window / my-wordpress / recycle-bin into `model.ts` / `ui.ts` / `commands.ts`) | planned `src/features/<name>/` | Planned |
| Web-component base class (`Component`) + design-token catalogue | `src/ui/core/component.ts` (pre-existing) + `src/ui/core/tokens.ts` | Stable |
| Extension base library — `OpenStation_Extension_Window` / `OpenStation_Extension_Rest` PHP bases + `createExtensionWindow` TS helper | `extensions/base/` | Stable |
| Cross-bundle layout single-source-of-truth (`getCurrentLayout` / `subscribeLayout`) | `src/layout/` | Stable |
| Types package (`@openstation/types`) for plugin authors | `packages/openstation-types/` | Stable (in-tree; npm publish later) |
| REST route discoverability index | `includes/rest/README.md` | Stable |

Plugin authors should prefer the new locations when they exist;
re-exports keep old import paths working for the duration of the
0.8.x line. Renames that have nowhere to forward to ship with
deprecation shims (PHP via `_doing_it_wrong`, JS via
`installDeprecatedAlias` from `@api/deprecated`) — no name in the
public surface disappears silently.

## The big picture

```
Browser tab
├── Parent shell  (wp-admin, desktop class on body)
│   ├── Admin bar            — classic WP toolbar + OpenStation toggle
│   ├── Dock                 — unified rail (core + plugin menus from $menu)
│   │                           placement (left / right / bottom) = desktop layout
│   ├── Desktop area         — wallpaper; hosts windows + desktop icons
│   │   ├── Window A         — <iframe src="edit.php?openstation_chromeless=1">
│   │   ├── Window B         — <iframe src="upload.php?openstation_chromeless=1">
│   │   └── Window C (native)— <div> with plugin-rendered content
│   └── Mio layer         — optional soft-body companion, above windows,
│                              below the dock (see docs/mio.md)
│
└── Each iframe renders a chromeless admin page
    — real WordPress request, stripped of wp-admin chrome
```

## PHP flow (per request)

1. `admin_init` — portal redirect logic decides whether to keep the request where it is or send the user to `/openstation/`.
2. `admin_body_class` — the `os-active` or `os-chromeless` class is appended so CSS and JS can key off it.
3. `admin_enqueue_scripts` — CSS and JS are registered on a per-mode basis (shell assets in OpenStation, chromeless overrides in iframes).
4. `in_admin_header @ 5` — the shell markup is injected right after the admin bar (`<div id="os-shell">`).
5. `admin_footer` — the chromeless bridge script is injected inside iframes so they can `postMessage` back to the shell.

Key server-side entry points:

| File | Purpose |
|---|---|
| `desktop-mode.php` | Plugin bootstrap — loads the `includes/` files. |
| `includes/helpers.php` | `openstation_is_enabled()`, the `openstation_rest_require_enabled()` REST gate, misc shared helpers (default wallpaper, registration errors). |
| `includes/core/routing.php` | Chromeless / classic request detection (`openstation_is_chromeless_request()`), admin-target allowlist, chromeless admin-bar suppression, redirect preservation. |
| `includes/core/payload.php` | Dock builder (`openstation_build_dock_items()`) plus menu / native-window payload assembly. |
| `includes/ajax.php` | `openstation_ajax_save()` — the `wp_ajax_save-openstation` endpoint. |
| `includes/admin-bar.php` | Toggle node + inline JS click handler. |
| `includes/assets.php` | Registers CSS/JS handles on `init`. |
| `includes/render.php` | Umbrella loader for `includes/render/` — body classes, asset enqueueing, shell markup, chromeless bridge, classic link interceptor, Media Library grid query cleanup. |
| `includes/portal.php` | Portal URL (`/openstation/`, with the pre-rebrand `/desktop-mode/` still accepted) and redirect rules. |
| `includes/session.php` | REST endpoints for saving/restoring the per-user window session. |

## Browser flow

1. `/wp-admin/...` loads → the portal redirect on `admin_init` bounces the request through `/openstation/?target=<original-url>`.
2. `/openstation/` (with or without `target`) forwards back into wp-admin tagged with `desktop_mode_portal=1`. The portal answered to `/desktop-mode/` before the rebrand and still does, so bookmarks of that address keep working — it is an alias, not a second canonical URL: `openstation_portal_url()` always emits `/openstation/`, and the address bar self-corrects on the forward. When the redirect resolved from a `target` (user-supplied intent — admin-bar link, bookmark, etc.) the URL also carries `desktop_mode_portal_intent=1`. Both flags are stripped from `currentPage` before the shell sees it; the booleans `fromPortal` / `fromPortalIntent` ride along in the shell config so the boot flow can distinguish "portal stamped this URL" from "user actually asked for it."
3. The landing page renders with the shell wrapped around it (Dashboard by default; the user's saved focused window, the default-window preference, or the `target` URL otherwise).
4. The shell's Vite-built TypeScript bundle (`desktop.js` in dev, `desktop.min.js` in prod) initializes:
   - Creates the `WindowManager`.
   - Creates the **layout dispatcher** which owns the dock(s) for the active `desktopLayout` (see [Desktop layout modes](#desktop-layout-modes)).
   - Restores the saved session (if one exists). Then `shouldAutoOpenCurrentPage()` (see `src/boot/auto-open.ts`) decides whether to ALSO open `currentPage`. The decision: open when `fromPortal=false` (direct nav) **or** `fromPortalIntent=true` (portal redirected here from a user-clicked link). Suppress on bare portal entries that landed via the default-window / session-focused fallback so a restored stack isn't disturbed.
   - Wires persistence — debounced `POST /wp-json/desktop-mode/v1/session`.
5. When a dock icon is clicked, the manager opens a window whose iframe `src` is the admin URL with `?openstation_chromeless=1` appended.
6. The iframe renders WordPress normally, but the chromeless stylesheet hides the admin bar, side menu, and wp-footer.
7. The iframe `postMessage`s its title, navigation, and screen-meta state up to the parent.

### When OpenStation stops being active underneath the shell

The server cannot announce this, because the next request no longer loads OpenStation. `src/plugin-presence.ts` detects it client side instead, in two halves.

Triggers are cheap and allowed to be wrong: an iframe loading on an admin path whose `<body>` lacks `os-chromeless` (catches deactivate and delete from the classic `plugins.php`, row and bulk), or a Heartbeat tick without the `desktop_mode_nonces` field (catches another tab or WP-CLI). Neither is conclusive, since `wp_die()` screens carry no `admin_body_class` and core skips `heartbeat_received` on a tick with no client data.

Confirmation is a `GET` of the `desktop-mode/v1` REST namespace index, needing neither nonce nor capability. Only a `404` carrying WordPress's own `rest_no_route` body evicts, because a bare 404 is also what a REST-hardening plugin or a firewall rule on `/wp-json` returns while OpenStation is perfectly healthy. A network error, a non-JSON body, or a shell config with no `restUrl` all leave the shell up. On a confirmed absence the shell toasts and navigates the top frame to `adminUrl` via `leaveForClassicAdmin()`, the same helper the native Plugins window's `reloadOutOfOpenStation()` uses.

The watcher stops pinging after three consecutive "still here" answers, and any proof the plugin is alive (a chromeless page, a tick carrying the field) resets that. The Heartbeat field is gated on `openstation_is_enabled()`, not on the plugin being loaded, so a user who turns OpenStation off in another tab would otherwise make every later tick a trigger forever.

State lives in a `createSharedStore` because this module compiles into both the main bundle and the lazy `window-system` one.

The native Plugins window keeps its own faster path (`isOpenStationSelf()` / `reloadOutOfOpenStation()` in `src/plugins-window/rest.ts`), since it knows which plugin the user just acted on.

## Desktop layout modes

OpenStation Preferences → Appearance lets the user pick one of four top-level layouts. The shell root reflects the choice in `data-os-layout`; the layout dispatcher (`src/desktop-layout.ts`) owns every dock instance and the synthesized desktop-icon list, tearing down and rebuilding when the user switches.

| Mode | Default? | Primary dock (`wp.os.dock`) | Left side dock (`wp.os.sideDock`) | Wallpaper icons |
|---|---|---|---|---|
| **Unified** ("One dock") | ✅ | Every menu sharing one rail, core cluster first | — *(no side dock)* | Plugin-registered icons only |
| **Classic** ("Side bar") | — | Plugin-contributed top-level menus (`isCore: false`) | Core admin menus (Dashboard, Posts, Media, Settings, …) | Plugin-registered icons only |
| **Spatial** | — | Plugin menus only | — *(no side dock)* | Plugin-registered icons + **synthesized core icons** (one per core menu, prefixed `dock-core:`) |
| **OpenStation** | — | Every menu, **re-sorted core-first** with one divider on the boundary | — *(no side dock)* | Plugin-registered icons only |

**OpenStation** is Unified plus two commitments. First, the dispatcher re-sorts the rail so every `isCore` tile precedes every plugin tile: `Dock.render()` drops its `.os-dock__separator--group` divider at the first non-core tile, so grouping the list is what makes that one divider land — reliably — on the "WordPress ends here, your plugins begin here" boundary. `partition()` preserves relative order inside each cluster, so drag-to-reorder still holds within a group. Second, it is the only layout that surfaces a menu's **submenu** at the rail: hovering a menu tile fans out the *constellation* (`src/dock-constellation/`), a flyout carrying the menu's own page, its live windows, one row per submenu entry, and a new-window row. `dock-peek` stands down for menu tiles while that layout is active (the shared predicate lives in `src/dock-constellation/active.ts`) so the two hover surfaces never stack; system tiles keep the peek everywhere. Styling for both surfaces is in `assets/css/openstation-layout.css` behind `--os-cn-*` tokens; the JS hooks are `os.constellation.panel` / `.opened` / `.closed`.

Inside a rail, tiles are grouped by what they do rather than by where they came from: the admin menus first, then a divider, then OpenStation's own controls (Preferences, the bin, the way out) — the cohort the dock calls *system tiles*. That divider is the rail's one structural line, because it is the only boundary where behaviour changes: before it a tile opens an admin screen, after it a tile acts on the desktop. A softer hairline also separates core menus from plugin apps, mirroring wp-admin's own menu, but that boundary is provenance rather than behaviour and is drawn quietly. The two read through `--os-dock-divider` and `--os-dock-divider-soft`; the OpenStation layout replaces the *first* with its own luminous seam.

**On a bottom rail those three groups can become decks** (`src/dock-decks/`). A pill has a width, and a site with a dozen plugins overran it; the rail's answer used to be a hidden horizontal scroll, which meant tiles that existed only for people who knew to swipe. Turn `dockDecksEnabled` on and exactly one group is on screen at a time — Favorites, WordPress, Plugins, OpenStation — with a tab strip at the leading edge naming it and offering the others. The selected tab is painted last on that strip, hard against the divider, so its label heads the icons that follow it; the mesh fill is anchored there and the tabs slide through it rather than the fill chasing the selection. The rearrangement is a flex `order` swap, so the DOM sequence — and with it `aria-selected`, the roving tabindex and the arrow keys — stays as registered. It is opt-in because decking trades "every tile is on screen" for "the rail fits": a good trade once there are enough tiles to feel the crowding, a bad one before then, and not the shell's call either way. **Favorites** is the one deck the user composes rather than inherits — starring a tile from its right-click menu appends its id to `dockFavorites`, and because that deck sorts first it takes the tile out of its provenance group entirely. The dividers stand down while it is on: they exist to say "these tiles are a different group from those", which is now the strip's whole job. The rail keeps its old shape wherever decking would be a loss: never on a vertical placement (a column has the shell's full height to spend and scrolls honestly), and not on a bottom rail whose tiles all land in one deck. Which tiles are hidden is decided in JS rather than in a stylesheet, because CSS cannot compare `data-os-deck` on a tile against `data-os-deck-active` on the rail without one rule per deck id — and the deck list is a filter (`os.dock.decks`), so plugin-registered decks would be the ones to silently break. A tab carries what its hidden tiles were saying: an indicator dot when the deck holds an open window, and the sum of their badges as a number. Whether focusing a window pulls the rail to its deck is a second call, next to the first in OpenStation Preferences → Appearance → Dock groups; the default is no, on the [event-driven framework](event-driven-framework.md)'s rule that the shell is a transport rather than a UX policy maker.

**Both one-rail layouts group before they draw.** `Dock.replaceItems()` inserts the `--group` divider at the first tile whose `isCore` is `false`, so it only produces one clean boundary when the list is already grouped — and the admin menu is not: a plugin that registers high up (Yoast, Jetpack) would otherwise put the line two tiles in and strand the rest of WordPress on the plugin side of it. `coreFirstRailItems()` in the dispatcher sorts core ahead of plugins for `unified` and `openstation` alike, preserving relative order inside each cluster so drag-to-reorder still holds within a group. One consequence to know about: a tile cannot be dragged from one cluster into the middle of the other.

**The way out is drawn differently.** The `os-exit` tile leaves the desktop rather than opening something closeable, and with the admin bar hidden by default it is the only route back to classic admin. `dock.css` gives it `order: 1` (always last, whatever order plugin-owned native-window tiles sync in), its own wider gap, a ring instead of a filled plate, and a hover that leans toward the edge it leads to instead of lifting toward the pointer. The rules key on `[data-system-id="os-exit"]`, the same idiom the Recycle Bin badge uses; `tests/vitest/dock-exit-tile.test.ts` pins that attribute.

**Dock placement.** Unified and Spatial sit on the edge named by the `dockPlacement` preference (`bottom` — the default — `left`, or `right`), reflected on each rail as `data-os-dock-placement`. Two layouts ignore it, and `primaryOrientation()` in the dispatcher is the one place that decides so: Classic, whose side bar already owns the left edge (honouring the pick would stack both rails on one side), and OpenStation, which is drawn for a horizontal rail — its stylesheet is scoped to the bottom placement and its constellation fans upward out of a tile. OpenStation Preferences paints the Dock position control only for the layouts that read it. The pick is remembered while either of the other two is worn, and applies again the moment the user returns to Unified or Spatial. Moving the dock is a full rebuild (placement reaches a renderer through `mount()`), and fires `os-layout-changed` for the same reason a layout switch does.

Both values are user meta (`desktopLayout` and `dockPlacement` inside the OpenStation Preferences JSON blob, REST-synced via the existing `/wp-json/desktop-mode/v1/os-settings` endpoint). The dispatcher partitions the live dock-items list by the `isCore` flag the menu builder already stamps on every entry; no PHP API additions were needed for the layout modes.

**Where Spatial's core icons actually render:** the layout dispatcher's `dock-core:*` synthesis (`src/desktop-layout.ts`) targets the legacy `.os-icons` grid via `deps.renderIcons()`. On shells where the files layer is mounted (`config.filesUrl` set — the modern default), that grid is hidden by CSS (`assets/css/desktop-files.css`'s `#os-area:has( > .os-files-layer )` rule), because the files layer is the actual visible wallpaper surface. The user-visible equivalent lives in `syncShortcutsWithVisibility()` (`src/settings/desktop-shortcuts-sync.ts`): while `desktopLayout === 'spatial'`, every core dock item without an explicit `'hidden'` override gets a synthetic `dock-promoted:<id>` shortcut placement pushed into the files store — the same mechanism used for user-promoted dock items, so drag persistence, positions (`dockPromotedPositions`), and grid collision handling come for free. Leaving Spatial removes these placements but does *not* prune their saved positions, so a rearranged layout survives switching away and back. The legacy `dock-core:*` grid synthesis remains for shells without a files layer.

Listen for `os-layout-changed` on `document` to react to a switch in plugin code — the event detail carries the new `layout` and `placement` strings plus current `primary`/`side` `Dock` references.

## Dock customization — two registries

Layered on top of the layout dispatcher: two orthogonal extensibility registries plugin authors can use to customize the dock without forking the renderer. Each registry is opt-in; the shipped baseline works unchanged when no plugins register.

| Registry | Surface | When to reach for it |
|---|---|---|
| **Decoration hooks** | Render-pipeline filters and actions fired by the default rail renderer — `tile-class`, `tile-element`, `tile-rendered`, `tile-tooltip`, `before-render`, `after-render`. | Animations, classNames, wrappers, custom tooltips. Composable across plugins; plugin authors don't have to replace the rail. |
| **Dock rail renderer** | `wp.os.registerDockRailRenderer( { id, label, mount } )` — owns the entire rail. | Circular ring, Stage-Manager stack, floating cluster. The default ships the icon-strip backed by the `Dock` class. |

How they plug in:

- **Default rail renderer** wraps the existing `Dock` class. The layout dispatcher calls `renderer.mount({ container, items, openItem, openSubmenuPick, openSystemItem, ... })` which constructs a `Dock` and returns a controller. The dispatcher's downstream calls (live menu refresh, system tile add/remove, badge updates) all go through the controller.
- **Custom rail renderers** receive the same `mount-deps` shape and return their own controller. The `openItem` / `openSubmenuPick` / `openSystemItem` callbacks are the routing surface — renderers SHOULD use them rather than reaching for `windowManager` directly so they stay compatible with future shell features (multi-instance, session restore, per-window theming).
- **Decoration hooks** are emitted from inside the default rail renderer. Custom rail renderers SHOULD emit equivalent hooks at equivalent points so plugins that decorate through the hook surface keep working when the user picks a different renderer. The shell can't enforce this — the hook calls are `applyFilters` / `doAction` calls a renderer chooses to make. Helpers (`wp.os.applyTileClasses` / `applyTileElement` / `applyTileTooltip` / `dispatchTileRendered`) make it a one-liner per phase.

Robustness guarantees:

- Every rail-renderer `mount()` runs inside try/catch. A throwing renderer logs via `HOOKS.SHELL_ERROR` and the dispatcher falls back to the built-in `'default'` for that rail.
- `apiVersion: 1` is enforced at registration so an out-of-date plugin can't stand on a load-bearing bug; an unsupported version throws.
- Owner-tagged registrations sweep on plugin deactivation: `unregisterDockRailRenderersByOwner( 'plugin-script-handle' )` removes every renderer the plugin contributed; if the user had one of them active, the dispatcher rebuilds with the shipped baseline. No reload required.
- `wp.os.dock` and `wp.os.sideDock` continue to return the underlying `Dock` instance when the default renderer is active (Symbol-keyed escape hatch). With a custom renderer active, both return `null` — plugin authors who need renderer-agnostic access reach for `windowManager` / `activity` / hooks instead.

Persistence:

- `dockRailRenderer` lives on `OsSettingsState` (REST-synced to user meta via `/wp-json/desktop-mode/v1/os-settings`). The field takes any `sanitize_key()`-clean string; the JS-side registry resolves at use time and falls back to `'default'` when the named renderer is missing (plugin deactivated, typo). No server-side allow-list — renderers register from JS at runtime.
- `unfocusEffect` lives on `OsSettingsState` the same way (default `'darken'`, `'none'` disables). The value is an unfocus-effect registry id or `'none'`; it is lower-cased and stripped to `[a-z0-9_/-]` server-side (slashes preserved so `vendor/sub-id` round-trips — unlike `sanitize_key()`). The engine resolves it at use time and treats an unknown id as "no effect". Plugin effects register from JS at runtime; PHP opt-in via `openstation_register_unfocus_effect_script()` adds the `serverUnfocusEffectScripts` payload entry so a plugin's effect surfaces in OpenStation Preferences → Effects without an F5.
- `windowReveal` follows the same pattern (default `'none'` — reveals are opt-in), and drives the transition that uncovers a window's content once it finishes loading. The shell paints an opaque surface (`.os-window__reveal`) into the window body at construction and on every subsequent loading edge, then animates its `clip-path` away on `WINDOW_CONTENT_LOADED`. The surface is a sibling of the `<iframe>`, so clipping never touches the framed document, the content's compositing layer, or its hit-testing; native windows take the identical path. Shapes come from `src/reveals/shapes.ts`, which guarantees interpolable `from`/`to` pairs (same shape function, constant vertex count, holes made by reverse winding rather than `evenodd`). Two layers are painted: the surface (`--os-window-reveal-surface`) and, behind it, a leading edge (`--os-window-reveal-edge`) running the same keyframes over a longer span so it trails as a band along the clip boundary — which is how every reveal gets an edge matching its own geometry without describing one. The surface token is white (it must be opaque or there is nothing to reveal from) and the edge token `transparent`; either layer that resolves to no paint is dropped rather than animated, which both makes `transparent` a working per-layer off switch and keeps the opt-in edge free until a theme colours it. A def may override either colour via `surfaceColor` / `edgeColor`, or per layer via `layers[].color` — `obturator` is the only built-in that does, shading each of its six leaves differently. That per-layer tone is what renders an overlap at all: same-coloured layers composite into one silhouette, and no trailing edge can substitute, because an edge only ever shows `union( edges ) − union( surfaces )` — one band around the uncovered area, never per-part seams. Multi-layer reveals therefore normally set `edgeLag: 0`. A def may also ship `layers` (several matched pairs) instead of one `from`/`to`, which is what lets a reveal be a mechanism whose parts overlap rather than a single shape: A def may instead ship `render()`, taking over the covering DOM entirely while keeping the shell's timing — `obturator` uses it, because a lens iris has a cyclic overlap (every leaf over the next, the last back under the first) that a linear paint order cannot represent; as SVG it becomes six equilateral `<path>` wedges sliding tangentially under a shared `<mask>`, with no restacking at all (`src/reveals/obturator.ts`). `--os-window-reveal-edge-thickness` (a `%`/unitless fraction of travel, or an absolute time) overrides the def's `edgeLag`. Duration resolves user setting (`windowRevealDuration`, `0` = per reveal) → `--os-window-reveal-duration` theme token → the def's own `duration`, with the edge lag scaled by the same ratio so the band keeps its apparent width. Themes may also recommend `windowReveal` / `windowRevealDuration` through `recommendedOsSettings`; the latter is the first user of the schema's `int` grammar. Registration is JS-only for now — there is no `serverWindowRevealScripts` payload entry, so a reveal from a plugin activated mid-session needs an F5 to appear in OpenStation Preferences → Effects (the same known gap as palettes).
- `windowLinkRenderer` / `windowLinkVisibility` follow the `unfocusEffect` pattern for the window-links feature — visual ties between windows showing related content (`src/window-links/`). The renderer id uses the same `[a-z0-9_/-]` charset (default `'svg-splines'`, `'none'` disables; the render host falls back to the built-in for unknown ids); visibility is the closed set `'always' | 'focus' | 'off'` (default `'always'`). Three boolean feature switches (`windowLinksEnabled`, `windowLinkRaiseOnFocus`, `windowLinkHighlight`, all default `true`) live in OpenStation Preferences → Features and gate the whole feature / the group-raise / the related-window outline respectively. PHP opt-in via `openstation_register_window_link_renderer_script()` adds the `serverWindowLinkRendererScripts` payload entry. The active renderer mounts into a dedicated overlay layer (`#os-window-links`, `z-index: var(--os-z-window-links, 50)` — above the widget layer, behind the windows, `pointer-events: none`) that exists only while a relation group is renderable. Per-window content identity arrives from the chromeless bridge's `os-content-identity` postMessage, built by `openstation_build_content_identity()` in `includes/window-links.php` and filterable via `openstation_window_content_identity`. The identity also carries `related` navigation items (the title bar's Related menu; filter `openstation_window_related_entities`), and `GET /wp-json/desktop-mode/v1/content-identity?post=N` (`edit_post`-gated) recomputes a post's identity outside a page render — the bridge's block-editor save-watcher hits it after every real save and re-announces, so the menu and the window ties stay fresh without a reload.

See [`docs/dock-customization.md`](./dock-customization.md) for the plugin-author overview and [`docs/examples/`](./examples/README.md) for full walk-throughs.

## Two window types

### Iframe windows (default)

Used for **every existing admin page**. Zero plugin changes required — the chromeless request strips chrome and the iframe does the rest. Trade-off: no direct DOM access between parent and iframe (so cross-frame communication is `postMessage`-only).

### Native windows (shipped)

Registered via `openstation_register_window()` (PHP) or `wp.os.registerWindow()` (JS). Content renders **directly in the parent DOM** — no iframe, direct shell access, lower overhead. Good for lightweight tools (color picker, settings panels, quick notes) and for anything that wants to participate in cross-window interactions directly.

Additional tabs can be attached to any native window with `openstation_register_window_tab()` — the first tab is the window's own template, and subsequent registrations (from any plugin) append after it. When two or more tabs exist the shell auto-wraps the render tree in `<os-stack>` + `<os-tabs>` so plugin authors don't hand-write tabstrip markup.

The shell's own **OpenStation Preferences** native window (wallpaper / accent / dock-size / AI config / default-window) is both a shipped feature and the reference implementation. Lifecycle hooks — `os.native-window.before-render` (filter), `after-render`, `before-close` — let a plugin decorate or wrap another plugin's render output.

#### Eager vs lazy script load — and what gets injected

The script handle declared in `openstation_register_window( …, [ 'script' => $handle ] )` reaches the shell page through one of two paths:

- **Eager** — `openstation_enqueue_native_window_scripts()` calls `wp_enqueue_script( $handle )` on `admin_enqueue_scripts:20`, so WordPress prints the tag normally through `wp_print_scripts()` along with all `extra` data (localize, inline, translations).
- **Lazy** — when the shell receives the `nativeWindows` payload mid-session (e.g. after a `os-plugins-changed` postMessage from the chromeless `plugins.php` iframe), it appends `<script src="…">` directly via `loadVendorScript( url, extras )`. **This path bypasses `wp_print_scripts()` entirely.**

The payload builders harvest each registered handle's `extra['data']` (localize), `extra['before']` / `extra['after']` (inline), and `wp_set_script_translations()` snippet into the `nativeWindows[]` entry as `scriptL10n` / `scriptBefore` / `scriptAfter` / `scriptTranslations`. The shell injects them as inline `<script>` tags around the lazy `<script src>` in `wp_print_scripts` order — translations → l10n → before → src → after. So `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations` work transparently on both paths.

The `'config'` arg on `openstation_register_window()` ships through the same delivery path and is the recommended way to pass session-bound data to a bundle. See [`docs/examples/window-with-config.md`](./examples/window-with-config.md).

## A third rendering path: solo mode, and the native desktop host

*Experimental. Full narrative: [`docs/desktop-host.md`](./desktop-host.md).*

OpenStation can be hosted by a small Electron app that loads the same site and
adds real OS windows. **Core knows nothing about it.** The app and everything
that talks to it ship as an extension
(`extensions/openstation-electron-adapter/`), a separate WordPress plugin;
deactivate it and OpenStation is exactly the browser experience it was.

```
OpenStation core
├── Window Manager          ← untouched
├── App Registry            ← untouched
│
└── extensions
      └── Electron Adapter
            ├── IPC / native windows / OS integration   (app/)
            ├── Host contract, REST + liveness pulse    (includes/)
            └── Shell adapter, ⋯ menu row               (src/)
```

Two generic capabilities were added to core to make it possible, and both
stand on their own:

- **`wp.os.registerWindowAction()`** (`src/window-actions/registry.ts`) — a
  registry for rows in every window's ⋯ menu. The menu was the one title-bar
  surface with no extension point; "Send to your Mac" is the case that made
  the gap obvious, not the only one that fills it. `label`, `icon` and
  `isVisible` may each be functions of the window, re-read on every menu open,
  which is what lets a single row express a state-dependent toggle.
- **Solo mode** (`includes/solo-window.php`, `assets/css/solo.css`) —
  `?openstation_solo=<id>` boots the whole shell and paints exactly one
  window, with no dock, taskbar, wallpaper, desk, or session restore.

Solo mode exists because of the two window types above. An **iframe window**
can be shown anywhere by loading its chromeless URL. A **native window** has
no URL at all — it is a render callback painting into the shell's DOM — so the
only way for it to *be* the same window elsewhere is to bring the framework
along. Solo mode is that: same registries, same render callback, same theme
and title-bar buttons, desk removed.

Which shape a freed window gets is decided in the adapter, never in the app;
the app takes a URL and opens a window on it.

Server-side, the adapter records the attached host on one user-meta row,
refreshed by a deliberately slow liveness pulse whose interval the *server*
dictates. The server never claims a host is attached *now* — the same user can
have a browser tab open at the same moment, so only the client's probe (a
global the Electron preload injects) can answer that.

## Session persistence

Every window lifecycle event — open, close, focus, move, resize, state change — plus virtual-desktop create / switch / close is pushed into a debounced writer that `POST`s the full stack to a REST endpoint. On next load, the shell reads the session and rebuilds the stack before the user sees anything (no "flash of default layout"). Clamping logic adapts window coordinates when the viewport shrinks. Desktop-only state still counts: if the user has multiple Spaces but no open windows, the desktop registry and active desktop are restored.

REST surface:

- `GET  /wp-json/desktop-mode/v1/session` — current user's saved session.
- `POST /wp-json/desktop-mode/v1/session` — overwrite the session. Body: `{ session: { windows: [...], desktops: [...], activeDesktop, focused, updated } }`.
- `DELETE /wp-json/desktop-mode/v1/session` — clear it.

Each entry in `windows[]` carries the window's id, geometry, state, desktop assignment — and, for **native** windows, an optional `params` bag: the open-time arguments saying *what* the window was showing (`{ userId: 12 }`, `{ customerId: 7 }`). A native window is addressed by id, and its id is its identity, so a singleton that retargets has nowhere else to record its subject; without `params` such a window restored onto its default and read as having silently changed subject. Values are limited to strings, finite numbers and booleans — anything else is dropped on save rather than taking the whole write down. Iframe windows carry none: their URL already says what they show. See [`wp.os.openWindow`](./javascript-reference.md#wposopenwindow-id-opts---stable).

Param **keys** are filtered to `[A-Za-z0-9_-]` and capped, deliberately *not* passed through `sanitize_key()` — that lowercases, and every param name in the shell is camelCase, so `customerId` would be stored as `customerid` and the client's read would come back `undefined`. A window that restores blank with the data sitting right there under a name nobody looks up is worse than one that doesn't restore at all.

`updated` is the write-ordering key, in **epoch milliseconds** (`Date.now()`). The server rejects a POST whose `updated` is lower than the stored one, so a slow request that was snapshotted earlier cannot clobber newer state — the case that matters is a `keepalive` fetch still in flight when the `pagehide` beacon fires. Equal values tie and the first processed wins. Omit the field and the server stamps it for you; sessions written before the field moved to milliseconds carry a seconds value, which any current write outranks.

### What comes back, and how

Two kinds of window are persisted, restored by two different routes.

**Iframe windows** are rebuilt from their saved URL. The server only
stores URLs that resolve inside this site's own `wp-admin` — a URL that
fails `openstation_url_is_same_admin()` is dropped from the session
rather than sanitized, so the restore path can never be pointed at a
foreign origin.

**Native windows** (OpenStation Preferences, Bug Report, anything registered via
`openstation_register_window()` / `wp.os.registerWindow`) carry
`native: true` and a `#<id>` marker in place of a URL. A native
window's `render` callback is a JS closure and can't be serialized, but
it doesn't need to be: every native window is addressable by id, so the
shell reopens it by asking its owner — built-ins have their own
openers, everything else goes to `nativeWindows.openById( id )`. The
marker is rebuilt server-side from the sanitized id; the client's `url`
is never stored for a native window. Ids that nothing answers to at
restore time — a plugin deactivated since the session was saved — are
skipped silently.

Because the openers construct their own `manager.open()` config from
the registry, they have no argument to carry restore-time values.
`restoreSession` therefore stages the saved geometry, desktop
assignment, and window state through
`WindowManager.seedWindowRestoreState()` before triggering the opens;
the manager merges each entry into the first window that claims that
id, then forgets it, so a later user-initiated open is unaffected.

**Ephemeral windows** (`ephemeral: true` — editor previews, whose URLs
carry single-use nonces) are the one category that is never persisted,
and never counts as the focused window.

### Desktop themes

A **desktop theme** reskins the whole shell from a ZIP of a
`theme.json` manifest plus images — every `--os-*` token, the
title-bar / dock / desktop textures, the window frame and corners, and
a complete iconset including the window control glyphs. (Distinct from
the per-window **window themes** in `includes/window-chrome.php`; the
`desktop_theme` / `desktopTheme` naming keeps them apart everywhere.)

The load-bearing decision is that **no author-supplied CSS or JS ever
executes**. PHP validates the manifest field by field and *compiles* a
stylesheet of custom-property declarations from it, generating every
`url()` itself from a `rawurlencode`d path. Texturing is therefore
expressed as manifest properties (`repeat`, `size`, `slice`, …) with a
closed grammar, not as CSS.

- **Storage** — `uploads/desktop-mode-themes/<slug>/` holds the
  author's `theme.json`, the compiled `theme.css`, and only the assets
  the sanitized manifest actually references. The directory drops an
  `index.php` and an **exec-off** `.htaccess` — deliberately not the
  deny-all one the stored-files module uses, because theme assets have
  to be servable. The sanitized manifest is indexed in the
  `desktop_mode_desktop_themes` site option (autoload **no** — it
  carries whole manifests).
- **Install pipeline** (`includes/desktop-themes/install.php`) —
  validate the archive entry-by-entry before writing anything → extract
  to `.staging-<uuid>/` → sanitize the manifest (resolving every asset
  reference inside the staging dir) → sanitize referenced SVGs with
  DOMDocument → delete + recreate the final dir (**re-upload = update**)
  → move only referenced assets → compile + write `theme.css` → update
  the index. Staging is cleaned on every exit path.
- **REST** — `POST /wp-json/desktop-mode/v1/desktop-themes`
  (multipart `file`) and
  `DELETE /wp-json/desktop-mode/v1/desktop-themes/<slug>`, both gated on
  `openstation_rest_require_enabled()` plus the
  `openstation_desktop_theme_upload_capability` capability
  (`manage_options` by default). There is no GET — the library rides
  the boot / live-refresh payload as `serverDesktopThemes`.
- **Selection** — per-user, stored as `desktopTheme` in the existing
  `desktop_mode_os_settings` user meta and synced through the existing
  `/os-settings` route. The sanitizer is a pattern check, not an
  allow-list, so a settings write never has to load the themes option;
  the enqueue path existence-checks instead, which is also what makes
  an orphaned selection degrade silently to the system default.
- **Zero cost when unused** — no active theme means no stylesheet, no
  shell attribute, no body class, and icon resolution is a single null
  check. Every core CSS rule that consumes a texture token reads it as
  `var( --name, <initial> )`.

Client side: `src/desktop-themes/` (a `createSharedStore`-backed
registry, the icon resolver, the activation module, and a synchronous
server-sync) sits in the always-on shell bundle and stays free of
`lit` / `<os-*>` imports; the picker UI lives in the lazy OpenStation Preferences
panel bundle. Full authoring reference:
[`desktop-themes.md`](./desktop-themes.md).

All session routes require a valid `X-WP-Nonce` (the standard REST nonce) and the current user to be logged in **with OpenStation enabled** (`openstation_is_enabled()`, via the shared `openstation_rest_require_enabled()` gate). The `read` capability alone is intentionally insufficient: every authenticated role (including Subscriber) carries `read`, so a `read`-only gate would admit users who never opted into the desktop. Logged-out callers get `401`; logged-in callers without OpenStation get `403`.

We also extend Core's `/wp/v2/media` endpoint with two opt-in query parameters so the OpenStation Preferences wallpaper picker (and any plugin that wants the same capability) can ask the server to filter out images that are too small to look good stretched across the desktop:

- `openstation_min_width=<int>`  — only return images at least this many pixels wide.
- `openstation_min_height=<int>` — only return images at least this many pixels tall.

Both params are purely additive — omitting them keeps the endpoint's default behavior untouched. Implementation lives in `includes/media-query.php`: every new upload gets stamped with two flat numeric post-meta keys (`_desktop_mode_width`, `_desktop_mode_height`) via `wp_generate_attachment_metadata` / `wp_update_attachment_metadata`, and the params translate into a `WP_Meta_Query` NUMERIC `>=` clause. Pre-existing attachments are backfilled opportunistically — each filtered REST request from a **logged-in** user stamps up to 50 unstamped images (anonymous requests can still use the dimension filters, but never trigger the backfill writes) — so a site upgrading into this feature starts seeing real filtered results within a few picker opens rather than requiring a CLI run. Once every image has been stamped, the `desktop_mode_media_dims_backfilled` site option flips to `1` and the sweep query is skipped from then on.

## Command palette bridge (Cmd+K, hijacked)

WordPress 6.4+ ships a command palette via `@wordpress/commands` — the one that opens on Cmd+K in Gutenberg / site editor. Inside a OpenStation iframe we **suppress it** and reroute the keystroke to the shell's own palette, then **harvest** the iframe's `core/commands` registry and re-publish every command as a slash-command in the shell. The user sees one palette; it's ours; it contains whatever the focused window contributes.

This is a deliberate hack — there is no public API on `@wordpress/commands` for a parent frame to read and invoke commands from a child iframe. The implementation lives in two places:

- **Iframe side** (`includes/render/chromeless-bridge.php`):
  1. A capture-phase `keydown` handler `preventDefault`s Cmd/Ctrl+K and posts `os-palette-cycle` to the parent. No more "native palette flashes before ours wins the race."
  2. A React component is mounted into a hidden div (via `wp.element.createRoot`). It `useSelect`s `getCommandLoaders(true)` and `getCommands(true)` from `core/commands`; one child component per loader invokes the loader's hook under a legal render context. Results are collected into a ref-based bucket (state would setState-loop — every hook call returns a fresh array reference).
  3. Callbacks are NOT executed to classify navigation commands. `Location.prototype.href` is non-configurable so a sandbox can't intercept `location.href = X` without real navigation — an earlier attempt cascaded into infinite window spawning. We now match `Function.prototype.toString()` against a string-literal regex instead. Computed URLs fall back to `action`.
  4. React icons (`@wordpress/icons` elements) are flattened to SVG markup via `wp.element.renderToString` so they can cross `postMessage`'s structured clone.
  5. A private `__wpdCommandCallbacks` cache, rebuilt every harvest, keeps live references to the loader commands' callbacks. Loader results aren't in `getCommands()` so the invoke path needs its own lookup.

- **Parent side** (`src/commands/iframe-bridge.ts`):
  1. On `os-window-focused`, send `os-commands-subscribe` to that window's iframe; evict the previous window's commands tagged with owner `iframe:<windowId>`.
  2. On `os-commands-list`, re-register everything under the new owner. Navigation-kind commands become "open a new desktop window" via `manager.open`; action-kind commands post `os-commands-invoke` back to the iframe.
  3. On `os-window-changed` with `state: 'minimized'` for the subscribed window, evict its commands — minimized windows shouldn't contribute to a palette that's supposed to reflect what's actionable right now. The next focus event rehydrates.
  4. On `os-bridge-ready` (handshake posted by the iframe once its listener is attached), re-send subscribe if the iframe matches the currently focused window. Fixes the race where the parent sends subscribe before the iframe script has run.

Each harvested command is tagged `eager: true` so it surfaces in the palette without requiring the user to type `/`. The palette renders eager commands on empty input; typing `/` switches to the slash-only surface (disjoint from eager — see [JavaScript Reference](./javascript-reference.md#commands)).

**Caveats.** Gutenberg block-level loader hooks are tightly coupled to current editor state; invoking a stale closure after the editor re-renders can no-op. The harvester re-runs on every React re-render, so in practice the cache is fresh, but don't expect the bridge to work if the iframe page hasn't booted its editor yet. Non-Gutenberg admin screens generally expose no contextual commands, so the palette falls back to its AI suggestions view when the focused window's registry is empty.

### The AI assistant as the shell's ⌘K palette

WordPress 7.0 adds its own command-palette admin-bar icon (`#wp-admin-bar-command-palette`) and a global ⌘K keybinding. In the desktop shell Core's palette is never the right UI — its commands are harvested (above) and its own callbacks hard-navigate via `document.location`, unloading the shell out of the window model — so the shell **suppresses it unconditionally** (both the in-iframe keydown in the chromeless bridge and `installPaletteShortcut()` at the shell level). The shell's ⌘K surface is instead the assistant, which is **always registered** (`registerPalette('desktop-mode-ai-assistant')`), so ⌘K always opens it and Core's admin-bar icon (intercepted with a capture-phase `click` listener in `src/desktop.ts`) routes to it too.

**Two modes.** The overlay (`src/ai-assistant/impl.ts`, titled "Site Assistant") is a superset of the command palette:

- **Commands** — a command palette over the shared registry (`src/commands.ts`): typing filters live, empty input lists *every* command (contextual iframe commands pinned first), and picking one runs it. Always available — pure client, no AI, no server call.
- **Ask AI** — natural-language questions routed through `/ai/search` (read-only [Abilities](hooks-reference.md) + content search). It **suggests** (answers, entity cards, `admin_links` the user clicks) and never auto-runs a command. Offered only when a provider is configured *and* the toggle is on.

A **mode switch** in the header flips between them (replacing the `/` shortcut); it appears only when Ask AI is available. Each mode keeps its own input draft, and the last AI answer is re-shown when returning to Ask AI. The **OpenStation Preferences → Features → "AI assistant"** toggle (`ai.enabled`, off by default, provider-gated) enables Ask AI and makes it the default mode on open (off → Commands). The overlay reads provider status + the toggle live via `AiAssistantConfig.isAiAvailable()` / `isOverrideEnabled()`, so connecting a provider or flipping the toggle takes effect on the next open without a reload.

### AI Agents (opt-in)

Behind the `agents` extended option (default off; while off,
`includes/agents/bootstrap.php` loads nothing). An agent is split
across exactly two layers:

- **Identity — a synthetic `wp_users` row.** Real role, real
  capabilities, real attribution in revisions/comments/audit trails.
  Every login path is blocked (`authenticate` filter, password reset,
  application passwords), the address is a never-delivered synthetic
  email, and the wp-admin Users list labels the row "Agent".
- **Definition — user meta on that row.** Description, instructions
  (system prompt), ability allowlist, triggers, model override, and
  rate limit live in the `_openstation_agent_*` key family
  (`includes/agents/store.php` owns every key). User meta has no
  revisions, so the `openstation_agent_{created,updated,deleted}`
  actions carry before/after values and ARE the audit trail.

**Tools are the WordPress Abilities API.** The Tools picker is a view
over `wp_get_abilities()` (with honest read-only vs mutating badges
from `meta.annotations.readonly`); the picks are the allowlist meta;
each call dispatches through `WP_Ability::execute()` so the ability's
own `permission_callback` gates it. Unlike the AI Copilot (read-only
abilities only), agents may be granted mutating abilities — the
compensating controls are the explicit allowlist set by an
`edit_users` human plus the agent's role.

**The runner** (`includes/agents/runner.php`) generates through the
same Core AI Client adapter the Copilot uses
(`openstation_ai_client_generate()` over `wp_ai_client_prompt()`),
loops tool calls to a hard 8-turn cap, and runs the whole loop with
`wp_set_current_user()` switched to the agent (restored in `finally`)
so permission callbacks see the agent's role, not the human caller.
Per-agent hourly rate limits ride a transient counter.

**Surfaces:** `/desktop-mode/v1/agents` REST CRUD + `/invoke`
(`includes/rest/README.md`), the Agents section inside WP Explorer
(server: `openstation_my_wordpress_entities` filter; client: the
`agent` entity kind via `registerEntityKind()`), and the lazy
`desktop-mode-agent-run` chat window fed through the cross-bundle
`desktop-mode/agents-chat` shared store. Phase A ships the chat
trigger; send-to/drag, hook, endpoint, and agent-to-agent intakes are
declared in the trigger-kind catalogue and land in later phases.

## WP Explorer — custom post types

The site window's root grid is built from the entity list
(`openstation_my_wordpress_entities`). Beyond the four built-ins it
now carries one section per **eligible custom post type**: non-builtin,
`show_ui => true`, and editable by the current user
(`includes/my-wordpress/post-types.php`). Sections registered by the
same extension collapse into a single root folder that drills into its
members — `Site › WooCommerce › Products` — via the bundle's `group`
route.

**Query scoping.** The band ordering is pushed into `wp/v2/product` and
the coupon bridge through `rest_product_query` /
`rest_shop_coupon_query`, which fire for *every* consumer of those
collections — WooCommerce Blocks' Product Collection renders through
the same filter. The site window's list requests therefore carry a
`desktop_mode_bands=1` marker (declared as `listQuery` on the section
descriptor) and the filters no-op without it, so a storefront's chosen
sort is never silently replaced. Two filters at the same priority
fighting over `orderby` is exactly how this went wrong once already:
WooCommerce Blocks hooks `rest_product_query` at 10 and ends with
`array_merge( $args, …, $orderby_query )`, which is why ours runs at 99.

**Ownership attribution.** `registered_post_type` / `registered_taxonomy`
fire during `init`, where `get_plugins()` does not yet exist — Core
loads `wp-admin/includes/plugin.php` at `wp-admin/admin.php:102`, after
`wp-load.php` has already run `init`. The tracker in
`includes/core/payload.php` therefore records the **registering file
path** (walking the backtrace to the first frame inside an extension
directory, skipping OpenStation's own frames) and resolves it lazily:
to a plugin file for the dock's attribution, and to a
plugin / mu-plugin / theme group for the site window
(`includes/my-wordpress/owner.php`). Recording is gated to admin
requests (`openstation_should_track_type_registrants`, filterable):
only admin surfaces read the map, and a front-end page view registers
the same types — paying a bounded `debug_backtrace()` per registration
there would buy nothing. The predecessor of this code got the same
effect by accident, bailing whenever `get_plugins()` was undefined. Group display names come from
`get_file_data()` on the plugin header and `wp_get_theme()`, never from
`get_plugins()` — both live in `wp-includes` and neither scans the
plugins directory.

Because the entity list is frozen into the window config at
registration time and only emitted later on `admin_enqueue_scripts`,
the window registers on `init` priority **99** — late enough that every
plugin's `register_post_type()` call has run.

**The non-REST bridge.** Post types registered with
`show_in_rest => false` have no `wp/v2` collection, so
`includes/my-wordpress/rest-post-type.php` re-exposes them at
`desktop-mode/v1/post-type/<slug>` by subclassing Core's
`WP_REST_Posts_Controller`. Inheriting the controller means `_fields`,
`_embed`, `search`, `status`, and the `X-WP-Total` /
`X-WP-TotalPages` headers behave exactly as on `wp/v2` — the bundle
needs no special-casing, only a different `restPath`.

The subclass is deliberately narrower than its parent, because these
types opted out of REST on purpose:

- Core's `get_items_permissions_check()` permits **public reads** in
  `view` context. Both read checks and the delete check are overridden
  to require the type's `edit_posts` capability in every context.
- Only `GET` collection, `GET` item, and `DELETE` item (trash, for
  recycle-bin parity) are registered — no create or update.
- `openstation_my_wordpress_post_type_rest_enabled` vetoes the bridge
  per type; a vetoed type disappears from the window rather than
  rendering a folder that cannot open.

Two Core seams need overriding for a non-REST type to work at all, and
neither is reachable by filter: `check_is_post_type_allowed()` reads
`show_in_rest` (left inherited, every row is filtered out and the
collection returns empty), and `rest_get_route_for_post()` /
`rest_get_route_for_post_type_items()` both return `''` and bail
*before* applying their own filters, so `self` / `collection` links are
fixed in `prepare_links()` instead. `wp:featuredmedia` needs no fixing —
it is built from the attachment's route, and `attachment` is
REST-exposed.

## CSS layering

Core layering only — feature windows ship their own per-feature sheets
(`os-settings.css`, `posts-window.css`, `recycle-bin.css`, `ai-assistant.css`,
`desktop-files.css`, `effects.css`, …), all registered in `includes/assets.php`.

```
assets/css/
├── variables.css    — Custom properties, color-scheme aware.
├── desktop.css      — Shell layout; hides classic chrome via body.os-active.
├── windows.css      — Window chrome, animations, states (with the window-chrome.css,
│                      window-states.css, and window-overview.css companions).
├── dock.css         — Dock rail; keyed by data-os-dock-placement
│                      (left / right / bottom). Placement derives from the desktop
│                      layout chosen in OpenStation Preferences (default "classic" = left side
│                      dock + bottom dock). dock-peek.css covers auto-hide peeking.
└── chromeless.css   — Loaded INSIDE iframes; scoped to body.os-chromeless.
```

Never edit Core's `common.css` or color scheme files. Everything we need is exposed as a CSS Custom Property in `variables.css`.

## What's shipped vs. what comes next

**Shipped** — unified dock with left / right / bottom placement (derived from the desktop layout chosen in OpenStation Preferences; the default "classic" layout pairs a left side dock with a bottom dock), multi-window orchestration + session restore, virtual desktops / Spaces, wallpaper registry, widget registry, overview + arrange + snap, native windows and tabs, AI assistant + slash commands + palette registry, cross-frame drag bridge for Media Library, OpenStation Preferences native window, accent + custom-gradient editor, toast notifications, iframe observability (`iframe-ready` / `iframe-error` / `iframe-network-completed`), letter-badge icon fallback, batch `closeAll()` with protection filter, primary-desktop filter, iframe command-palette bridge (harvests `@wordpress/commands` from the focused window into the shell palette; see "Command palette bridge" above).

**Pinned notes** — the notes surface. Notes are `wpd_note` posts (non-public CPT: not queryable, excluded from search, absent from core REST; `includes/notes/cpt.php`) with position (`_wpd_note_x`/`_wpd_note_y`, normalized 0–1), paper color (`_wpd_note_color`, whitelist via the `openstation_notes_colors` filter), z-order (`_wpd_note_z`), and a creation-time jitter seed (`_wpd_note_seed`, hashed from the initial text and never rewritten — it drives each note's subtle paper tilt) in postmeta — the owner's placement is the canonical placement every viewer sees. The "public" checkbox maps to post status: `private` (default) ↔ `publish` (visible read-only, with author attribution, on every OpenStation user's wallpaper). A custom REST controller at `/desktop-mode/v1/notes` (`includes/notes/rest.php`) enforces owner-only mutation (admins included) and optimistic concurrency (`updatedAtMs` token → 409 with the server copy); `includes/notes/heartbeat.php` streams cross-user deltas over the Heartbeat bus. Client-side, the **Note Pad widget** (`src/plugins/notes-widget/`, its own bundle) composes drafts that are torn off and dropped on the wallpaper as `'note-draft'` DragManager payloads; the wallpaper's right-click **New note** entry (`src/notes/wallpaper-menu.ts`) pins an empty one straight where the click landed; the notes layer (`src/notes/`, main bundle) renders the wall, the pushpin physics, and the trash flow. Trashed notes surface in the Trash via its filter pipeline (`includes/notes/recycle-bin.php`): owner-only view/restore/purge (replacing the bin's default `edit_post` gates, which would both expose private note text to admins and lock out subscriber owners), an owner-scoped badge count, and restore returning the note to its prior private/publish status. The bin's capture list includes every non-builtin `show_ui` post type, so third-party CPT trash appears alongside posts and pages by default. Because the drop-target registry allows one target per element, note payloads route through two seams consulted by the existing targets: `src/desktop-files/canvas-payloads.ts` (wallpaper create/reposition) and `src/desktop-files/recycle-bin-payloads.ts` (drag-to-bin soft-trash with Undo) — still internal; promote via `wp.os.files.*` if third-party bundles need them. The sibling seam for accepting a drop on a *specific desktop icon*, `src/desktop-files/tile-payloads.ts`, **is** public as `wp.os.files.registerTilePayloadHandler( type, handler )` — the supported answer to "my plugin's icon rejects everything dropped on it", since a competing `DropTarget` on the tile element is always displaced by the layer's reject claimant. Handlers may share a payload type; resolution is first-registered whose `appliesTo` matches, so they only compete when claiming the same tile.

**Games** — opt-in site-wide, **off by default**: the `games` extended option (OpenStation Preferences → Features → Extended options; filter `openstation_games_enabled`) gates the whole module in `includes/games/bootstrap.php` on `plugins_loaded` — while off, none of the games PHP loads (no schema check, REST routes, Heartbeat channel, window/icon) and `config.gamesEnabled: false` tells the shell to skip the challenges client; the two custom tables and play-time meta persist across disable/re-enable. A game system with a fixed **Games** hub window (Recycle-Bin-pattern native window + gamepad desktop icon; `includes/games/window.php`) laid out Steam-library style: a compact game grid across the top, and — for the selected game — a detail panel with description, **Play** / **Challenge** actions, the game's **unified scoreboard** (columns derived from its `score_columns`), and its challenges. Games register server-side via `openstation_register_game( $id, $args )` (`includes/games/registry.php`) — metadata + a `script` handle + a `config` blob — shipped in the boot/live-refresh payload as the **`serverGames`** key; the shell registers metadata-only stubs and loads the game bundle **lazily on first launch** (`src/games/{registry,server-sync,launch}.ts`, exposed as `wp.os.games`). Two custom tables back persistence (`includes/games/schema.php`): `{$prefix}desktop_mode_game_scores` (`game`, `user_id`, `score` sort key, flexible `meta` JSON, epoch-ms timestamps) and `{$prefix}desktop_mode_game_challenges` (score-to-beat rows with a `pending → accepted|declined`, `accepted → completed` state machine and an `updated_at_ms` Heartbeat high-water mark). REST lives under `/desktop-mode/v1/games/*` (`includes/games/rest.php`): leaderboard GET/POST per game, challenge create/accept/decline/complete, and a games-scoped `/games/users/search` opponent picker gated on `read` (subscribers play too), plus **play-time tracking**: the launcher measures each game window's active time client-side (the clock pauses while minimized) and flushes increments to `POST /games/{game}/playtime`; per-user lifetime totals accumulate in the `desktop_mode_game_playtime` user-meta map, with per-day buckets in `desktop_mode_game_playtime_days` (site-timezone days, rolling window) backing the hub's Steam-style "last two weeks" figure (`includes/games/playtime.php`, `src/games/playtime.ts`), readable via `GET /games/playtime` / `wp.os.games.getPlaytime()`. Challenge delivery rides the Heartbeat bus (`includes/games/heartbeat.php` ↔ `src/games/challenges-client.ts` in the main bundle, so notifications arrive with the hub closed); scores are client-asserted (arcade trust model) with the `openstation_game_score_pre_save` veto filter as the anti-cheat extension point. Playing a game suspends the wallpaper via the refcounted `wp.os.wallpaper.suspend()/resume()` API (`src/wallpapers/layer.ts` — frozen-bitmap overlay + effective-visibility re-emission, so existing wallpapers pause with zero changes). The built-in **Inkfall** typing game (`src/games/inkfall/`, `includes/games/inkfall.php`) is the reference implementation: PixiJS v8 in a native window, and deliberately friendly vocabulary (musical notes, tearing words — no war terms anywhere). **Framework assets**: the 20k-word dictionary is a games-framework asset (`assets/games/words.txt`, regenerated by `bin/build-game-words.mjs`, loader `src/games/dictionary.ts`) whose URL is merged into every game's payload `config` as `wordsUrl` (`includes/games/config.php`, filter `openstation_games_words_url`) — one identical word list for every player. That shared list powers the second built-in game, **Alphabet Soup** (`src/games/alphabet-soup/`, `includes/games/alphabet-soup.php`): a daily word search seeded by the current date (`dd-mm-yyyy`, so the puzzle is the same worldwide), with three board sizes (8×8 / 12×12 / 16×16 — bigger pots hide more words; each (mode, size) pair is its own seeded puzzle), a three-wave Daily mode and a countdown **Time Attack** mode seeded from a different stream of the same date, a played-once-per-day ledger (replays are allowed after an upfront notice but never earn the card — word positions can be memorized), and a game-over **share card** — a generated 1200×630 PNG (canvas 2D, `src/games/share-card.ts`) shared via the native share sheet / clipboard / download, deliberately image-only (no URL: the admin is a private space).

**Real file storage** — the desktop stops being reference-only: users upload arbitrary files (and whole folder trees, via `webkitGetAsEntry` traversal or the `webkitdirectory` picker) into per-user server storage, download them back unmodified, and download folders as on-demand `.zip`s. Bytes live flat under `uploads/os-files/<user_id>/` with extensionless UUID disk names (`.htaccess` + `index.php` protection, PHP-gated serving with forced `attachment` disposition; a documented nginx `deny all` snippet covers the `.htaccess` gap); hierarchy/naming/sharing stay in the existing folders + placements + shares tables, with metadata in the new `{$prefix}desktop_mode_stored_files` table (schema v13, `includes/desktop-files/{stored-files-store,rest-uploads,downloads,file-shares}.php`). The intake is `POST /desktop-mode/v1/files/uploads` (one file per request, `relativePath` folder resolution mkdir-p style, `wp_handle_upload` + scoped `upload_dir` redirect, WP MIME policy + executable denylist, receive/register split kept as the future resumable-upload seam); downloads are `_wpnonce`-in-query GETs streamed through a `rest_pre_serve_request` short-circuit; folder zips build via ZipArchive into a swept temp file (feature-gated on `class_exists`). Uploads are owner-locked (folder write-collaborators cannot move/rename/trash them) and shareable read-only per user through the shares table's `target_type='file'` seam, invites riding the existing heartbeat `shares.pending` channel. Client-side, the OS-file-drop dialog gained a destination selector (Desktop storage default on wallpaper/folder surfaces; Media Library one click away) backed by `src/os-file-drop/{traversal,desktop-upload}.ts` and `src/desktop-files/upload-menu-items.ts`. Deletion is the documented exception to "references, not copies": purging the owner's last placement deletes the bytes, the row, the shares, and every recipient placement; a daily two-direction sweep reconciles disk/DB drift.

**Mio** — an optional desk companion: a PixiJS soft-body blob with a chroma neon outline that drifts over the wallpaper (breathing continuously via three drifting spatial harmonics on the shape springs), is drawn to nearby windows like a magnet rather than falling under gravity — there is no global "down", so it sticks to a window's side or underside as readily as its top — watches the cursor, and can be dragged and thrown anywhere. A window opening on top of it ejects it to the nearest free edge of the whole window *cluster*, so a tiled group doesn't pinball it across the desk. Off by default, toggled from a dock system tile that the user can hide from OpenStation Preferences → Apps & Icons (`mioEnabled` per-user OS setting). It is a **shell layer**, not a widget — `#os-mio` is a sibling of the wallpaper at z-index 190, above every window and below the dock. The split follows the established lazy-bundle pattern: the main bundle carries only `src/mio/controller.ts` (layer + preference + loader), while the simulation, renderer, and PixiJS dependency live in `assets/js/mio[.min].js` and are fetched on first activation, so a user who never switches it on downloads nothing. Configuration comes from PHP (`openstation_mio_config()` → `openStationConfig.mio`) and is re-clamped client-side; `wp.os.mio` is the JS surface. Environment awareness reuses `wp.os.getWallpaperSurfaces()` — the same collision set the snow wallpaper piles on. The one new piece of protocol is the opt-in pointer forwarder (`os-pointer-track` / `os-pointer-move`), which lets the shell keep seeing the cursor while it is over a window iframe. See [mio.md](./mio.md).

**Drafts AI writing assistant** — an opt-in per-row assistant inside the Drafts widget (`includes/widgets/widget-drafts.php`, `src/plugins/drafts-widget/`). Two routes back it: `POST /desktop-mode/v1/draft-suggestions` reads the draft and returns `{ titles, excerpt, tags, categories, readiness }` through the Core AI Client (`wp_ai_client_prompt()` + a JSON-schema response, the same call shape the comment scorer uses); `POST /desktop-mode/v1/draft-apply` writes one accepted suggestion onto the post. The split is deliberate — suggesting is read-only and provider-gated, applying is a plain capability-gated edit that keeps working if AI is later switched off, and tag/category writes always *append*. Availability is the baseline `openStationConfig.aiAssistant.providerConfigured` gate (text generation, no function calling), mirrored server-side so the route 503s without a provider; with none configured the 💡 button never renders and the widget behaves exactly as it did before. New categories are only created for users who can `manage_categories`, mirroring Core's Author-can-assign-but-not-create rule. Prompt, schema, content limit and the normalized result are all filterable — see [Hooks Reference](./hooks-reference.md#drafts-widget--ai-writing-assistant-experimental).

**Coming up**

- **Polish** — color-scheme-aware variables across every shell surface, View Transitions API animations, full accessibility audit (ARIA, focus traps, keyboard navigation).
- **Mobile (phone OS)** — `responsive.ts` + `mobile.ts`: home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar. `wp.os.mode` returns `'desktop' | 'tablet' | 'mobile'`.
- **Tablet hybrid** — split view, slide-over overlay, horizontal bottom dock, optional OpenStation toggle for large tablets.
- **The North Star — cross-window drag & drop** — extend the existing cross-frame drag bridge beyond Media Library attachments: pluggable mime-type negotiation (`openstation_drag_mime_types` / `openstation_drag_payload` / `openstation_drop_accepts`), Gutenberg block-insertion target, visual lift-and-drop feedback.

See [Hooks Reference](./hooks-reference.md) for the filter/action names each phase will introduce.
