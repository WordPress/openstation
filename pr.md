# Refactor My WordPress to use `<wpd-tile>` + add post status ribbons

## Summary

Consolidates every tile renderer in the shell behind a single canonical
`<wpd-tile>` web component, lifts the desktop-files tile builder onto a
generic `TileSpec` adapter, and surfaces unpublished post status
(`Draft` / `Pending` / `Private` / `Scheduled`) as a diagonal corner
ribbon on My WordPress tiles. Also lands a server-side
post→attachment resolver so the Media drill-in view catches references
that the previous client-side regex missed.

## What changed

### New `<wpd-tile>` component (`src/ui/components/wpd-tile/`)
The canonical tile element used everywhere a tile shows up — desktop
wallpaper, folder windows, every My WordPress section (Posts, Pages,
Users, Media, drill-in usage), and any plugin surface that wants the
same chrome. Light-DOM by design so existing modifier classes
(`__media-tile`, `__tile--user`, `__tile--usage`) keep working from
external CSS. The host element IS the tile — `data-placement-id`,
`style.left/top`, and `document.querySelector('.desktop-mode-file-tile')`
all keep pointing at the same node.

The component owns icon-vs-thumbnail rendering, the status ribbon
(`<wpd-ribbon>` placement, gated by the per-user
`showPostStatusRibbons` OS setting), the lock badge for access-gated
items, drag-out wiring, and keyboard activation (Enter / Space).

### Generic `TileSpec` renderer (`src/desktop-files/tile-spec.ts`)
`buildTileFromSpec(spec)` instantiates a `<wpd-tile>` and reflects spec
fields onto attributes. `attachTileDragOut(tile, payload)` factors out
the standard pointerdown → DragManager dance so no builder duplicates
it any more.

`file-tile.ts` is now a thin placement → spec adapter on top of
`buildTileFromSpec`, plus the desktop-files-specific behavior
(double-click → `openFile`, access-gated toast, share-folder badge
hook). The placement-shaped `desktop-mode.files.tile-*` plugin hook
surface is preserved unchanged.

### My WordPress migrated to `<wpd-tile>`
`index.ts`, `media-list.ts`, `media-detail.ts` all drop their bespoke
`buildXxxTile()` DOM construction in favor of `buildTileFromSpec` +
`attachTileDragOut`. Net effect: same DOM contract, one tile renderer,
free status-ribbon + drag-out plumbing.

### Post status ribbons
- New per-user OS setting `showPostStatusRibbons` (default ON) with a
  checkbox in OS Settings → Features.
- `fetchEntityList` / `fetchEntityDetail` carry post `status` in the
  REST response; `EntityListItem` / `EntityDetail` gained the field.
- Non-`publish` posts surface a diagonal corner ribbon in the tile
  (tone varies by status: draft=warning, pending=info, private=danger,
  scheduled=primary). Rendered via the existing `<wpd-ribbon>`
  component — no hand-rolled corner CSS.

### Server-side attached-media resolver
New `includes/my-wordpress/attached-media.php` registers
`desktop_mode_attached_media` on every public post type. Resolves
attachment ids from the post in four passes — featured image +
`wp-image-N` block class + `[caption id="attachment_N"]` shortcodes +
`data-id` / `data-attachment-id` attributes + raw `<img src>` URLs via
`attachment_url_to_postid()` (with in-request caching and
`-scaled.jpg` ↔ original URL variants).

Filterable via `desktop_mode_my_wordpress_attached_media` so ACF /
page-builder / post-meta gallery plugins can append their own refs.

`media-usage.php` also gains the same `-scaled` variant handling so
the reverse lookup ("which posts use this attachment?") catches the
same cases.

### Hook surface
- **Preserved (Stable):** `desktop-mode.files.tile-class`,
  `desktop-mode.files.tile-element`, `desktop-mode.files.tile-rendered`,
  `desktop-mode.files.grid-rendered`.
- **New (Experimental, 0.21.0):** `desktop-mode.tile.class` +
  `desktop-mode.tile.rendered` — fire on every `<wpd-tile>` paint
  anywhere in the shell, so plugins can decorate tiles across all
  surfaces, not just desktop files.
- **New (Experimental, 0.21.0):** `desktop_mode_my_wordpress_attached_media`
  PHP filter + `desktop_mode_attached_media` REST field on all public
  post types.

### Docs
- `docs/files-on-desktop.md` — documents the new generic
  `desktop-mode.tile.*` pair alongside the preserved placement-shaped
  filters; calls out stability for each.
- `docs/hooks-reference.md` — full entry for
  `desktop_mode_my_wordpress_attached_media` with REST field shape
  and sanitization notes.

## Test plan

- [x] `npm run lint`
- [x] `./node_modules/.bin/tsc --noEmit`
- [x] `npm run test:js` (150 files / 1366 tests)
- [x] `npm run build` (deterministic — no bundle diffs after rebuild)
- [x] `php -l` on every changed PHP file
- [ ] Manual: toggle `showPostStatusRibbons` in OS Settings → Features,
      confirm ribbons appear/disappear on My WordPress Posts grid
- [ ] Manual: drag a tile from My WordPress Media to the desktop —
      verify it lands as a shortcut placement
- [ ] Manual: open Media drill-in for an attachment used via a raw
      `<img src>` (no `wp-image-N` class) — verify it shows in
      "Used in"
- [ ] Manual: smoke-test the desktop wallpaper and a folder window —
      verify tile selection, drag-rearrange, share-folder badge,
      access-gated lock all still work
- [ ] Regression: verify a plugin using `desktop-mode.files.tile-class`
      or `desktop-mode.files.tile-element` still receives the filter
