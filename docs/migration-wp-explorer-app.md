# Migration — WP Explorer becomes the `my-wordpress` app

**Status:** shipped with the App Framework port. Affects plugins that opened, configured, or extended the legacy `desktop-mode-my-wordpress` native window or its bundle's `wp.os.myWordpress` API.

## What changed

WP Explorer was rebuilt as an App Framework app (`apps/my-wordpress/`, window id **`my-wordpress`**) and the legacy native window was **deleted outright** — its bundle, its registration, its pinned icon, and its window-only configuration surface. The app carries the original's name, its folder-mark icon, its pinned launcher slot, and every surface the window hosted: the section grids, the detail dossiers, the media "used in" scan, the Agents section, the WooCommerce sections, and — last to move — the full-body **activity footprint**.

What did *not* change: the `os.my-wordpress.*` JS hook seams (they fire from the app with the same payload shapes), the `openstation_my_wordpress_*` PHP helper functions and REST routes, the shared explorer stylesheet (`desktop-mode-my-wordpress` **style** handle, now a companion of the app window), the user-meta/query-flag surface, and the frozen ids elsewhere.

## Window & launcher

| Before | After |
|---|---|
| `wp.os.openWindow( 'desktop-mode-my-wordpress' )` | `wp.os.openWindow( 'my-wordpress' )` |
| `openstation_my_wordpress_window_args` (filter) | `openstation_app_window_args` with `$id === 'my-wordpress'` |
| `openstation_my_wordpress_icon_args` (filter) | `openstation_app_manifest` with `$id === 'my-wordpress'` (`title` / `icon` / `desktop_icon`) |
| `openstation_my_wordpress_template_html` (filter) | — (the app has no static template to filter) |

A stored desktop layout that placed the old pinned icon (`desktop-mode-my-wordpress`) simply stops resolving; the app registers its own pinned launcher in the same slot (`position: -1`).

## The `wp.os.myWordpress` API

| Before | After |
|---|---|
| `openDetail( { entityId, postId, postTitle } )` | The shared open target: `wp.os.createSharedStore( 'desktop-mode/my-wordpress/open-target', … )` + `wp.os.openWindow( 'my-wordpress' )`; in-bundle code imports `openExplorerDetail()` from `src/my-wordpress/explorer-open.ts` |
| `openMedia( { mediaId } )` | Same store, `kind: 'media'` — or `openExplorerMedia()` |
| `openUserFootprint( { userId, userName } )` | Unchanged call, new destination: `openUserFootprintWindow()` (`src/my-wordpress/footprint-target.ts`) opens the app; the `os-open-user-footprint` bridge message still lands here |
| `trashEntity( entityId, id )` | Shortcut drag payloads carry their section's `restPath`; the Recycle Bin DELETEs against it (`src/my-wordpress/rest-trash.ts`) and announces `os.<post-type>.changed` (`trashed`) |
| `registerEntityKind()` | — by design. Add a section via `openstation_my_wordpress_app_sections`; decorate every surface through the `os.my-wordpress.*` seams |

## Sections

`openstation_my_wordpress_entities` still runs but is **inert** — no window consumes it. Register sections with [`openstation_my_wordpress_app_sections`](./hooks-reference.md#openstation_my_wordpress_app_sections--experimental-filter); the app's descriptors carry `id` / `label` / `icon` / `kind` / `post_type` / `capability` / `thumbnails` / `restPath` / the `group*` folder fields, plus `flat` for sections whose rows are not posts. Row facts ride the rows themselves (the app sends REST-visible `meta`, per-taxonomy term ids, and integration fields like `openstation_woo`), so `listFields` / `listQuery` have no equivalent and need none.

## Events

`os-my-wordpress-entity-trashed` no longer fires. Trash flows broadcast the standard content-change (`os.<post-type>.changed`, action `trashed`) via `wp.os.announceContentChange()` — which is also what the app's `watch( '*' )` refreshes on, so list views everywhere stay reactive without a bespoke event.
