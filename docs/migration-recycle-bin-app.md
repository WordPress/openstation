# Migration — the Recycle Bin becomes an App Framework app

The Trash window is now an `.os.php` app (`apps/trash/`) driven by the [App Framework](./app-framework.md) instead of a PHP module plus a TypeScript bundle. The window keeps the **frozen id `desktop-mode-recycle-bin`**, so everything bound to it carries over untouched: desktop shortcuts, dock placements and the Apps & Plugins row, the drag-to-trash drop targets (window body and closed dock tile alike), the desktop-theme icon slots, and the closed-window tile art swap (`icon-state.ts`). The store, the capture hooks, the realtime channels and the REST routes are unchanged — same trash, new window.

## Removed

| Surface | Replacement |
|---|---|
| Filter `openstation_recycle_bin_window_args` | [`openstation_app_manifest`](./hooks-reference.md#openstation_app_manifest--experimental-filter) — `$manifest['width']`, `['icon']`, `['placement']`, `['dock_order']`, … for `$id === 'desktop-mode-recycle-bin'`. |
| Filter `openstation_recycle_bin_template_html` | There is no server template. The body is a client view; the JS `openstation.recycleBin.columns` filter still shapes the table, and the `data-os-recycle-bin-root` hook still marks the window root for drop targets. |
| PHP functions `openstation_recycle_bin_render_template()`, `_register_window()`, `_localize_config()` | The app registers itself; its config rides the window config blob (`wp.os.getWindowConfig( 'desktop-mode-recycle-bin' )`), not `wp_localize_script`. |
| Script handle `desktop-mode-recycle-bin`, bundle `assets/js/recycle-bin[.min].js`, `window.openStationRecycleBinConfig` | The shared `openstation-app-runtime` bundle plus the app's companion client view (`assets/js/apps/trash[.min].js`). Nothing to enqueue, no config global. |
| The whole `src/recycle-bin/` directory | The app owns its code: `apps/trash/trash.os.ts` (the client view over the dispatch wire and `ctx.fetch`) and `apps/trash/parts/` — `table-visuals.ts` (cell renderers + the columns filter), `empty-loop.ts`, `realtime.ts`, and the wire types in `types.ts`. The one shell-side piece, the closed tile's empty/full art, is `src/desktop-files/recycle-bin-icon-state.ts`, beside the drop targets that share its frozen id. |

## Unchanged

- Every store/capture/realtime surface: `openstation_recycle_bin_capture_post_types`, `_query_args`, `_items` / `_item`, `_user_can_view|restore|purge|use`, `_count`, `_empty_chunk_size` (filters); `_item_captured`, `_before/after_restore`, `_before/after_purge`, `_emptied` (actions).
- The REST routes under `/desktop-mode/v1/recycle-bin` (`GET /`, `POST /restore`, `POST /purge`, `POST /empty`, `GET /count`) — the badge poller, the app's chunked Empty loop and third-party integrations keep using them.
- The JS `openstation.recycleBin.columns` filter, the `os-recycle-bin-changed` document event, the `openstation.recycleBin.changed` hook, and the per-type `os.<type>.changed` broadcasts.
- The stylesheet handle `desktop-mode-recycle-bin` (`assets/css/recycle-bin.css`) stays on the boot path — it paints the drag-to-trash highlight on the closed bin's dock tile.
- The window id, title, size, dock position (`dock_order` 40), `placeable` row, gate, and everything the user sees.

## Why

The bin window was 2,155 lines — a 1,305-line imperative bundle, a 198-line REST client, a 366-line registration/template module and 286 lines of routes it used for itself. As an app it is ~640: two declared actions (`restore`, `purge`), a `data()` over the same store, and a client view whose filter, search and Refresh all ride the built-in `refresh`. The port also drove two framework additions every app now has: `$os->icon()` / `ctx.host.setIcon()` (state-driven tile art — the empty/full bin swap) and `ctx.extra` (`App::config()` values, which is how both drawings reach the client once instead of riding every response).
