---
title: "feat: Add multi-lens architecture and Galaxy lens to Content Graph"
type: feat
status: active
date: 2026-05-10
origin: docs/brainstorms/content-graph-multi-lens-galaxy-requirements.md
---

# feat: Add multi-lens architecture and Galaxy lens to Content Graph

## Summary

Extend the Content Graph window with a lens architecture (`Constellation` + new `Galaxy`) and four new edge types (co-tag, co-author, hierarchy, menu). PHP work extends `graph-builder.php` in place with new edge extractors and a `kind` field on edges, plus a new `preferences.php` per-user state endpoint following the `os-settings.php` pattern. Frontend work adds a cluster-attractor force loop to `ForceSim`, a `setLens()` method on `GraphScene`, edge-kind-aware draw with bridge highlighting, and a refactored toolbar that migrates the existing raw-DOM controls to `<wpd-*>` components while adding the new lens segmented control, taxonomy dropdown, and edges multi-toggle.

---

## Problem Frame

Content Graph today is a single-geometry tool: one force-directed layout, one edge type. Editors and content strategists have no surface where they can see "the constellations of my topical coverage" at a glance. The brainstorm settled on Multi-Lens Views with Galaxy as the first new lens, plus four cheap new edge types alongside hyperlinks. This plan defines how that ships. (See origin: `docs/brainstorms/content-graph-multi-lens-galaxy-requirements.md`)

---

## Requirements

- R1. Two lenses on first ship: Constellation (current) and Galaxy (new), exposed via a toolbar segmented control.
- R2. Lens architecture supports adding future lenses by registering a new lens ID without refactoring the existing two.
- R3. Switching lenses re-equilibrates the existing scene (no remount). Camera and focused-node state survive lens switches.
- R4. The user picks any registered public taxonomy from a toolbar dropdown to drive Galaxy clustering. Default selection is `category` if present.
- R5. Each term in the selected taxonomy becomes a cluster centroid; centroids drift with their cluster's center of mass.
- R6. Posts holding multiple terms are pulled toward each term cluster proportionally and settle between them by force balance.
- R7. Posts and pages with no terms in the selected taxonomy form a single "Uncategorized" cluster.
- R8. Each cluster carries a label with term name and post count, scale-aware.
- R9. Empty terms (zero nodes) are hidden by default in Galaxy.
- R10. Four new edge types: co-tag, co-author, hierarchy (`post_parent`), menu (nav menu items).
- R11. Toolbar exposes an edges multi-toggle; each edge type renders in a distinct color and weight.
- R12. Per-lens default edge visibility: Constellation = links only; Galaxy = links + co-tag.
- R13. Bridge highlighting in Galaxy: intra-cluster edges fade, cross-cluster edges pop in their type's color.
- R14. Per-user persistence: last-selected lens, last-selected taxonomy, per-lens edge-toggle state, per-lens post-type chip state.
- R15. Existing satellite fan-out, side panel, search, fit-to-view, and pan/zoom unchanged across both lenses.
- R16. Post-type filter chips remain a secondary filter on top of the chosen taxonomy and lens. Post-type selections are per-lens (covered by R14): switching lenses preserves the post-type filter for each lens independently rather than resetting it.

**Origin actors:** A1 (site editor), A2 (content strategist), A3 (plugin developer extending Desktop Mode)
**Origin flows:** F1 (switch lens), F2 (pick taxonomy), F3 (reveal hidden edge type), F4 (focus a node)
**Origin acceptance examples:** AE1 (covers R6), AE2 (covers R7), AE3 (covers R12, R13), AE4 (covers R3), AE5 (covers R14), AE6 (covers R9)

---

## Scope Boundaries

- Block reference edges (featured images, cover blocks, image refs, post-loop queries, reusable blocks, embeds): deferred from origin; out of this plan.
- AI-augmented features (semantic edges, prompt-driven views, AI cluster captions): origin out-of-scope.
- Editor-mode interactions (drag-to-link, bulk edit, in-graph rename): origin out-of-scope.
- Sitemap and Timeline lens implementations: architecture supports them; they ship as separate work.
- Multi-taxonomy overlay; auto-detect-by-post-type clustering: origin discarded options.
- Site Audit overlays (orphans, broken links, stale content): origin out-of-scope.
- Scale work above the existing `ForceSim` ~500-node ceiling (Barnes-Hut, level-of-detail, mini-map): out of this plan; Galaxy must not regress on sites Constellation handles today.
- New `wp.desktop.*` public API for lens or edge-type registration: plan-local non-goal. Internal-only in v1; promote to public hooks if extension demand surfaces in a follow-up.
- New `docs/examples/` example: plan-local non-goal. Lens and edge-type registration are not public extension surfaces in v1.

---

## Context & Research

### Relevant Code and Patterns

- `src/content-graph/index.ts`: render entry; wires toolbar + panel + scene + REST. Owns `activeTypes` state and `loadGraph()` orchestration. No persistence wired today.
- `src/content-graph/scene.ts`: `GraphScene` class. Pixi v8 `Application` + world `Container` with three layers. Camera target-then-ease. `draw()` repaints all `EdgeView`s and `NodeView`s every tick. Adding edge kinds requires extending `EdgeView` and the `draw()` color/width branching.
- `src/content-graph/sim.ts`: hand-rolled spring sim. `step(dt)` runs (1) O(n²) repulsion, (2) per-edge spring, (3) gravity + Euler integrate with damping + velocity clamp + drag-influence smoothstep, (4) `alpha *= ALPHA_DECAY`. Adding cluster centroid attractors is a clean fourth force loop between gravity and integrate.
- `src/content-graph/toolbar.ts`: vanilla DOM today (raw `document.createElement('button')`). `AGENTS.md` flags this as a violation; this plan migrates it to `<wpd-*>`.
- `src/content-graph/rest.ts`: `getConfig()` reads `window.desktopModeWindowConfig['desktop-mode-content-graph']`. `trackedFetch` wrappers tagged `source: 'desktop-mode/content-graph'`.
- `src/content-graph/types.ts`: wire-payload + in-memory shapes. REST is the source of truth.
- `includes/content-graph/window.php`: `desktop_mode_register_window` registration. `config` array hydrates `window.desktopModeWindowConfig` in JS. The place to inject initial preferences and taxonomy catalog.
- `includes/content-graph/rest.php`: three routes (`/post-types`, `/nodes`, `/post/<id>`). Capability check `desktop_mode_content_graph_user_can_use()`.
- `includes/content-graph/graph-builder.php`: full graph builder + transient cache. Cache key = `MD5(GROUP_CONCAT(ID, post_modified_gmt))` over participating rows. Extend in place for the new edge types.
- `includes/os-settings.php`: canonical pattern for per-user preference endpoint. Meta key `desktop_mode_os_settings`, REST `GET/POST`, sanitizer/defaults.
- `includes/session.php`: alternate per-user state pattern; useful as cross-reference.
- `src/boot/session-saver.ts`: trailing-edge debounced (500ms) saver with `sendBeacon` flush on unload. The pattern preferences-saver should mirror, but with a shorter debounce.
- `src/ui/components/wpd-segmented/wpd-segmented.ts`: segmented control. Stable since 0.9.0. `value` + `wpd-pick` event.
- `src/ui/components/wpd-select/wpd-select.ts`: dropdown wrapping native `<select>`. Same `value` + `wpd-pick` contract. Stable since 0.11.0.
- `src/ui/components/wpd-multiselect/wpd-multiselect.ts`: popover with checkboxes. Experimental.
- `src/ui/components/wpd-chip/wpd-chip.ts`: chip primitive with optional dismiss. Replaces hand-rolled chip buttons.

### Institutional Learnings

- No `docs/solutions/` tree exists in this repo. The de-facto institutional knowledge lives in `AGENTS.md`. Four notes apply directly:
  - **`<wpd-*>` over raw HTML controls**: today's vanilla-DOM toolbar in `src/content-graph/toolbar.ts` violates this; the plan migrates it.
  - **`wp.desktop.fetch` / `trackedFetch` over raw `fetch`**: already followed in `src/content-graph/rest.ts`; new REST helpers must keep this convention.
  - **`createSharedStore` for cross-bundle state**: NOT applicable here. Content Graph is a single bundle (`content-graph.min.js`), so plain module-level state is fine.
  - **Live-refresh payload pattern**: NOT triggered. Lenses and edge types are TS-side constants in v1, not server-driven registries.
- The Pixi.js skill pack at `.agents/skills/pixijs/` is reference material, not learnings. Useful for Pixi v8 specifics but does not encode prior incidents.

### External References

- None. Local patterns cover all four design dimensions (force sim, persistence, REST cache, `<wpd-*>` kit). External research skipped per Phase 1.2.

---

## Key Technical Decisions

- **Edges carry a discriminated `kind` field on the wire**: `'link' | 'co_tag' | 'co_author' | 'hierarchy' | 'menu'`. Existing hyperlink edges become `kind: 'link'`. The single `EdgeView` shape branches on kind for color and weight at draw time. Rationale: keeping all edges in one collection simplifies bridge-highlighting logic (which is kind-agnostic) and avoids parallel render paths.
- **Cluster centroids are emergent, not pre-computed**: each tick, the new attractor force computes a centroid per term as the running average of its members' positions, then attracts each non-pinned member toward its term centroid (or weighted average of term centroids for multi-term posts). No fixed lattice. Rationale: integrates with the existing alpha-decay cooling; multi-term posts settle between clusters via emergent balance (R6, AE1).
- **Lens switch is a live config swap on the existing `GraphScene`**: `setLens(id)` mutates which forces are active, which edge kinds are visible by default, and which toolbar extras render. Then `reheat(0.3, false)` to re-equilibrate. No teardown of the Pixi `Application` or `world` container. Rationale: AE4 requires camera + focus state to survive lens switch; the cheapest implementation that satisfies this is in-place mutation.
- **`GraphScene.setData()` preserves focus and camera state across rebuilds**: when a `loadGraph()` runs because the lens switch changed the requested edge kinds or taxonomies, `setData()` carries forward `focusedId` (when the focused node still exists in the new payload) and leaves `targetX/Y/Scale` untouched. `loadGraph()` itself takes a `reason` flag so it only calls `fitToView()` and `clearFocus()` on initial mount or post-type filter change, not on lens-switch loads. Rationale: AE4 plus realistic data flow (Constellation and Galaxy default to different edge kinds, so most lens switches DO refetch) require the rebuild path to preserve state, not just the cache-hit path.
- **Per-node term membership ships on the `/nodes` payload**: every node carries a `terms: Record<taxonomy, termId[]>` map scoped to taxonomies the request asked about. The scope is computed server-side from the active Galaxy taxonomy plus any taxonomies referenced by the requested edge kinds (co-tag pulls in all non-clustering public taxonomies). Rationale: U5's `setClusterTaxonomy()` needs membership data to derive centroids; emitting it inline saves a second round-trip on every taxonomy switch and shares the query cost with the co-tag extractor (which already JOINs `wp_term_relationships`). Bounded by a per-node-per-taxonomy 50-term truncation cap with an observability hook.
- **Backend extends `graph-builder.php` in place, not a parallel module**: new per-edge-type extractors run alongside the existing link extractor. Cache-key hash domain expands to cover the new data sources (term-relationships state, nav-menu state). Rationale: one cache, one invalidation contract; parallel modules would require per-source cache coordination.
- **Cache invalidation hooks expand**: existing `save_post` and `deleted_post` stay; add `set_object_terms` (taxonomy changes), `wp_update_nav_menu` and `wp_update_nav_menu_item` (menu changes). Rationale: any of these can change an edge derived in this plan.
- **Per-user preferences follow `os-settings.php` shape**: new `includes/content-graph/preferences.php`, meta key `desktop_mode_content_graph_prefs` (autoload-false, no leading underscore per convention), REST `GET/POST /desktop-mode/v1/content-graph/preferences`. Initial state injected through `desktopModeWindowConfig` to avoid first-paint round-trip. Debounced writes mirror `src/boot/session-saver.ts` at 250ms (UI-pref writes are higher-frequency, lower-criticality than session writes).
- **Toolbar `<wpd-*>` migration is bundled into this effort, not split off**: `src/content-graph/toolbar.ts` is raw DOM today. Extending it without migrating would entrench the `AGENTS.md` violation. Migration is small per-control surgery, not a rewrite.
- **No new public `wp.desktop.*` API in v1**: lens registry and edge-type registry stay as TS-side constants. Promote to public hooks if real plugin demand surfaces. Rationale: API surfaces are easier to add later than to remove; v1 has no validated extension demand from plugin authors.

---

## Open Questions

### Resolved During Planning

- **How are co-tag, co-author, hierarchy, menu edge sets queried efficiently?**
  - Co-tag: single bulk `wp_term_relationships` JOIN keyed on the in-scope post IDs already fetched, filtered to non-clustering taxonomies. Stay on raw `$wpdb->get_results` with prepared `IN (...)` placeholders, matching the existing `desktop_mode_content_graph_fetch_rows()` style.
  - Co-author: derive in PHP from `post_author` (added to existing fetch SELECT). No extra query.
  - Hierarchy: derive in PHP from `post_parent` (added to existing fetch SELECT). No extra query.
  - Menu: `wp_get_nav_menus()` + `wp_get_nav_menu_items($menu)` per menu, filter to `_menu_item_type='post_type'`, emit edges from menu (or parent menu item) to referenced post id. Skip non-post targets.
- **Cleanest way to swap force config on a live `ForceSim`?** Add a `setForceConfig({ clustersEnabled, attractorStrength })` method that mutates internal flags. Tick loop reads flags and runs the cluster-attractor force loop only when enabled. No re-creation. `reheat(0.3, false)` after the swap.
- **Multi-toggle component**: `<wpd-multiselect>` for the edges control (popover with checkboxes saves toolbar real estate). Post-type chips become `<wpd-chip>` rows with a thin parent owning the active `Set` (the existing toolbar already does this; just swap the `<button>` for `<wpd-chip>`).
- **User-meta key naming**: `desktop_mode_content_graph_prefs` (per the `desktop_mode_<feature>` convention from `os-settings.php`).
- **Menu-edge filter precision**: `_menu_item_type='post_type'` AND `_menu_item_object_id` resolves to a post in scope. Skip terms (`taxonomy`) and custom URLs (`custom`).

### Deferred to Implementation

- **Empirical force-sim tuning**: attractor strength and cluster spacing for sparse (~30-node), typical (~200-node), and dense (~500-node) sites. Solve by running the dev server with seeded fixtures during U4 and U5; do not block the plan on this.
- **Exact cache-key digest shape for term-relationships and nav-menu state**: a `MAX(term_taxonomy_id) + COUNT(*)` over `wp_term_relationships` filtered to in-scope post IDs is likely sufficient, but the precise SQL and whether to hash menu-item `post_modified_gmt` separately are implementation-time choices.
- **Whether to extract a `src/content-graph/lenses.ts` registry module or keep lens definitions as a constant in `scene.ts`**: settle once the lens-config object's shape stabilizes during U5.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
        ┌─────────────────────────────────────────────────────────────────┐
        │  GraphScene (extended)                                          │
        │                                                                 │
        │   tick(dt):                                                     │
        │     sim.step(dt)        ◄── ForceSim with optional cluster      │
        │     cameraEase()             attractor force (gated by lens)    │
        │     draw()              ◄── edge-kind-aware color/weight        │
        │     drawClusterLabels() ◄── new layer, scale-aware              │
        │     satellites.drawLinks()                                      │
        │                                                                 │
        │   setLens(id):                                                  │
        │     this.activeLens = lensRegistry[id]                          │
        │     sim.setForceConfig(lens.forces)                             │
        │     this.visibleEdgeKinds = lens.defaultEdgeKinds               │
        │     sim.reheat(0.3, false)                                      │
        │     // camera, focus, satellites unchanged                      │
        └─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ wired by index.ts orchestration
                              │
        ┌─────────────────────┴───────────────────────────────────────────┐
        │  Toolbar (refactored to <wpd-*>)                                │
        │                                                                 │
        │   <wpd-segmented> Lens     :  Constellation | Galaxy            │
        │   <wpd-select>    Taxonomy :  (visible only in Galaxy)          │
        │   <wpd-chip> row  Types    :  per post-type (existing concept)  │
        │   <wpd-multiselect> Edges  :  links | co-tag | co-author |     │
        │                              hierarchy | menu                   │
        │   Search input + Fit button (preserved)                         │
        └─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ wired by index.ts orchestration
                              │
        ┌─────────────────────┴───────────────────────────────────────────┐
        │  REST                                                           │
        │                                                                 │
        │   GET  /content-graph/post-types        (existing)              │
        │   GET  /content-graph/nodes?types=&edges=   ◄── edges param NEW │
        │                                              returns edges with │
        │                                              `kind` field       │
        │   GET  /content-graph/post/<id>         (existing)              │
        │   GET  /content-graph/preferences       (NEW)                   │
        │   POST /content-graph/preferences       (NEW)                   │
        └─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ caches via transient with expanded hash
                              │
        ┌─────────────────────┴───────────────────────────────────────────┐
        │  graph-builder.php (extended in place)                          │
        │                                                                 │
        │   build($types, $edge_kinds):                                   │
        │     cache_key = hash(types + edge_kinds + rows_mtime            │
        │                      + term_relationships_state                 │
        │                      + nav_menu_state)                          │
        │     if cached: return                                           │
        │     rows = fetch_rows($types)  // adds post_parent, post_author │
        │     edges = []                                                  │
        │     edges += extract_link_edges(rows)        // existing        │
        │     if 'co_tag'   in $edge_kinds: extract_co_tag_edges(rows)    │
        │     if 'co_author' in $edge_kinds: extract_co_author_edges(...) │
        │     if 'hierarchy' in $edge_kinds: extract_hierarchy_edges(...) │
        │     if 'menu'     in $edge_kinds: extract_menu_edges(rows)      │
        │     set_transient                                               │
        └─────────────────────────────────────────────────────────────────┘
```

The lens system is two TS-side constants (one per lens) keyed by id. Each constant declares: `id`, `label`, `forces` (which force loops the sim runs), `defaultEdgeKinds` (which edge kinds visible on first paint), `toolbarExtras` (which extra controls render). Future lenses (Sitemap, Timeline) drop in by adding a third constant and wiring its toolbar extras; `setLens()` and `draw()` need no further change.

---

## Implementation Units

### U1. PHP: edge-type extractors and graph-builder cache extension

**Goal:** Add four new edge-type extractors (co-tag, co-author, hierarchy, menu) to the existing graph builder. Extend the transient cache key to invalidate on the new data sources. Update REST `/nodes` to accept an `edges` query parameter and return edges with a `kind` field. Emit per-node term membership for public taxonomies so the client (U5) can derive cluster membership without a second round-trip.

**Requirements:** R5, R7, R10, R12

**Dependencies:** None.

**Files:**
- Modify: `includes/content-graph/graph-builder.php`
- Modify: `includes/content-graph/rest.php`
- Test: `tests/phpunit/tests/contentGraphEdgeBuilders.php`

**Approach:**
- Add `post_parent` and `post_author` to the SELECT in `desktop_mode_content_graph_fetch_rows()`. Hierarchy and co-author edges derive in pure PHP from the same fetched rows (no extra query).
- Co-tag: one bulk `wp_term_relationships` JOIN keyed on in-scope post IDs, filtered to taxonomies other than the currently-clustering taxonomy. Co-tag is symmetric, dedupe on ordered `(min, max)` pair.
- Menu: `wp_get_nav_menus()` to enumerate menus, then `wp_get_nav_menu_items($menu)` per menu, filter to `_menu_item_type='post_type'` AND `_menu_item_object_id` is in scope. Emit one edge per (menu_item -> target_post_id) where source is either the menu's representative post or the menu item's parent post if any.
- Extend `desktop_mode_content_graph_cache_key()`'s hash domain to include term-relationships state digest and nav-menu state digest, both keyed on the in-scope post IDs.
- Add cache-flush hooks: `set_object_terms`, `wp_update_nav_menu`, `wp_update_nav_menu_item`.
- REST `/nodes` accepts an `edges` query parameter (CSV list of edge kinds to include). Default = all kinds the requesting client wants (carried via the toolbar's edge-toggle state). Build returns edges with a `kind` field on each.
- Edges come back as `array{ from: int, to: int, kind: string }`. Existing hyperlink edges become `kind: 'link'`.
- **Per-node term membership emission** (consumed by U5's Galaxy clustering): each node in the `/nodes` response carries a `terms` field shaped as `array<taxonomy_slug, int[]>` mapping taxonomy slug to the term ids that node belongs to. Scope: only taxonomies the build is asked about (a new `taxonomies` query parameter, defaulting to the user's saved Galaxy taxonomy plus any other taxonomies referenced by the requested edge kinds, e.g., co-tag implies all non-clustering public taxonomies). Same bulk `wp_term_relationships` JOIN as the co-tag extractor; the membership map is a side-output of the same query, so the cost is one query (not N), shared.
- **Payload-size bound:** the per-node `terms` map sizes proportionally to (number of taxonomies in scope) × (average terms per node). Practical bound on a 500-node site with 3 in-scope taxonomies and an average of 4 terms per taxonomy per node is roughly 500 × 3 × 4 = 6000 small int values, on the order of tens of kilobytes pre-gzip. The build truncates `terms[<taxonomy>]` for any single node above 50 entries (a defensive cap; users with more terms per post on one taxonomy hit a documented limit, and the truncation is logged via `do_action('desktop_mode_content_graph_terms_truncated', $post_id, $taxonomy, $count)` for observability). The same query is required for co-tag edge generation regardless, so this adds no new query cost on top of edges; it just keeps the data product instead of discarding it.

**Patterns to follow:**
- `desktop_mode_content_graph_fetch_rows()` in `includes/content-graph/graph-builder.php` (raw `$wpdb` with prepared `IN(...)` placeholders).
- Existing cache-key construction in `desktop_mode_content_graph_cache_key()`.

**Test scenarios:**
- Happy path: a fixture with three posts, two share a tag, two share an author, one has `post_parent` set to another. Calling build with all four new edge kinds returns the expected set of typed edges, no duplicates, no self-edges.
- Happy path (edges parameter contract): requesting `edges=link,co_tag` returns only hyperlink and co-tag edges, with no co-author, hierarchy, or menu edges in the response. Requesting `edges=link` returns only hyperlink edges. Confirms the parameter U3's `fetchGraph(cfg, types, edgeKinds)` contract depends on.
- Happy path (Covers AE1): a post tagged with two categories produces co-tag edges to other posts in either category when clustering by a different taxonomy.
- Happy path (per-node terms emission): with a fixture of three posts where post A has terms `[1, 2]` in `category` and `[10]` in `post_tag`, the response node for A carries `terms: { category: [1, 2], post_tag: [10] }`. Posts with no terms in any in-scope taxonomy carry an empty `terms: {}` object (not omitted, so the field is reliably present on every node).
- Edge case (terms truncation cap): a single post with more than 50 terms in a single taxonomy has its `terms[<taxonomy>]` truncated to 50 entries, and `do_action('desktop_mode_content_graph_terms_truncated', $post_id, $taxonomy, $count)` fires once with the original count.
- Edge case: post with no terms in any taxonomy produces no co-tag edges.
- Edge case: posts in different post types are still candidates for co-author edges if they share `post_author`.
- Edge case: nav menu containing a custom-URL item plus a post-type item produces only the post-type edge (custom URL skipped).
- Edge case: nav menu containing a term link is skipped entirely.
- Error path: requesting an unknown edge kind in the `edges` parameter returns 400 (or silently filters; pick one and document).
- Integration: after `wp_set_object_terms()` adds a tag to a post, the next `/nodes` call returns updated co-tag edges (cache invalidated by `set_object_terms` hook).
- Integration: after `wp_update_nav_menu_item()` changes a menu item's target, the next `/nodes` call reflects the new menu edge.

**Verification:**
- `npm run lint`, `npm run typecheck`, `npm run test:js` all green.
- PHPUnit `test-content-graph-edge-builders.php` passes.
- Manual: hit `/wp-json/desktop-mode/v1/content-graph/nodes?types=post,page&edges=link,co_tag,co_author,hierarchy,menu` on a seeded site and verify all five edge kinds appear with correct `kind` values.

---

### U2. PHP: preferences endpoint and config injection

**Goal:** New per-user preferences endpoint following the `os-settings.php` pattern. Inject initial preferences and the public-taxonomy catalog into `desktopModeWindowConfig` so first paint avoids a REST round-trip.

**Requirements:** R4, R14

**Dependencies:** None.

**Files:**
- Create: `includes/content-graph/preferences.php`
- Modify: `includes/content-graph/bootstrap.php`
- Modify: `includes/content-graph/window.php`
- Test: `tests/phpunit/tests/contentGraphPreferences.php`

**Approach:**
- New file `preferences.php` with constant `DESKTOP_MODE_CONTENT_GRAPH_PREFS_META_KEY = 'desktop_mode_content_graph_prefs'`.
- Two REST routes under `desktop-mode/v1/content-graph/preferences`: `GET` (returns merged-with-defaults) and `POST` (sanitizes + stores). Permission callback shared with existing `desktop_mode_content_graph_rest_permission()`.
- Schema (illustrative, fields that exist v1):
  - `lens`: enum `'constellation' | 'galaxy'`, default `'constellation'`.
  - `byLens.constellation.types`: string[] of post-type slugs (defaults to all public).
  - `byLens.constellation.edges`: string[] of edge kinds (default `['link']`).
  - `byLens.galaxy.taxonomy`: string (default `'category'` or first available public taxonomy alphabetically).
  - `byLens.galaxy.types`: string[] of post-type slugs.
  - `byLens.galaxy.edges`: string[] of edge kinds (default `['link', 'co_tag']`).
- Sanitizer rejects unknown lens ids, unknown edge kinds, post-type slugs that fail `post_type_exists`, taxonomy slugs that fail `taxonomy_exists` and the `public => true` filter.
- `bootstrap.php` includes the new file.
- `window.php` extends the `config` array to include: `prefs` (the merged-with-defaults preferences for the requesting user), `taxonomies` (the public-taxonomy catalog: `[{slug, label, hierarchical, post_types}]`), and `edgeKinds` (the static catalog of edge kinds with `[{slug, label, color, weight}]`).

**Patterns to follow:**
- `includes/os-settings.php` end-to-end (meta key naming, sanitizer/defaults, REST route registration, schema-driven validation).
- Existing `config` array injection in `desktop_mode_register_window` call inside `includes/content-graph/window.php`.

**Test scenarios:**
- Happy path: GET returns defaults for a user with no stored prefs.
- Happy path: POST with a valid full prefs body persists; subsequent GET returns the same payload.
- Happy path: POST with a partial body (only `lens`) merges with existing stored prefs without losing other fields.
- Edge case: POST with `lens: 'sitemap'` (unknown) is rejected; existing stored prefs unchanged.
- Edge case: POST with an unknown edge kind is dropped from the array but other valid kinds persist.
- Edge case: POST with a private taxonomy slug is rejected.
- Error path: unauthenticated request returns 401/403 per existing permission callback.
- Integration: window-render injects the same payload that GET would return for the current user.

**Verification:**
- PHPUnit `test-content-graph-preferences.php` passes.
- Manual: open Content Graph as a logged-in user; check `window.desktopModeWindowConfig['desktop-mode-content-graph']` contains `prefs`, `taxonomies`, `edgeKinds`.
- `npm run lint`, `npm run typecheck`, `npm run test:js` green.

---

### U3. Frontend: types and REST client extensions

**Goal:** Type the new wire shapes (edge `kind`, preferences, taxonomy catalog, edge-kind catalog). Add REST helpers for the preferences endpoint. Extend `getConfig()` typing and the `fetchGraph()` helper to pass the `edges` parameter.

**Requirements:** R10, R14

**Dependencies:** U1, U2.

**Files:**
- Modify: `src/content-graph/types.ts`
- Modify: `src/content-graph/rest.ts`
- Test: `tests/vitest/content-graph-rest.test.ts`

**Approach:**
- Add `EdgeKind` discriminated union: `'link' | 'co_tag' | 'co_author' | 'hierarchy' | 'menu'`.
- Extend `GraphEdgePayload` with `kind: EdgeKind`. Existing-data compatibility: server always emits `kind`, including `'link'` for the existing extractor.
- Extend `GraphNodePayload` with `terms: Record<string, number[]>` where the key is a taxonomy slug and the value is the array of term ids that node belongs to in that taxonomy. The map is bounded to taxonomies the request asked about (see U1 Approach for the scoping rule). The field is always present on every node, including the empty-object case `terms: {}` for nodes with no in-scope memberships, so consumers do not have to handle a `terms-may-be-undefined` branch.
- Add `LensId` union: `'constellation' | 'galaxy'`.
- Add `ContentGraphPrefs` shape mirroring U2's schema.
- Add `TaxonomyDescriptor` and `EdgeKindDescriptor` types.
- Extend `ContentGraphConfig` with `prefs: ContentGraphPrefs`, `taxonomies: TaxonomyDescriptor[]`, `edgeKinds: EdgeKindDescriptor[]`.
- Add `fetchPrefs(cfg): Promise<ContentGraphPrefs>` and `savePrefs(cfg, partial): Promise<ContentGraphPrefs>` in `rest.ts`.
- Extend `fetchGraph(cfg, types)` to `fetchGraph(cfg, types, edgeKinds, taxonomies)` so the server can early-out on unrequested edge kinds and scope per-node `terms` emission to taxonomies the client actually needs (the active Galaxy clustering taxonomy plus any others required by the requested edge kinds).

**Patterns to follow:**
- Existing `fetchPostTypes` / `fetchPostDetail` shape in `src/content-graph/rest.ts`.
- `trackedFetch` with `source: 'desktop-mode/content-graph'`.

**Test scenarios:**
- Happy path: `fetchPrefs` returns the typed shape, `savePrefs` round-trips.
- Happy path: `fetchGraph(cfg, types, ['link', 'co_tag'], ['category'])` parses node-level `terms` into the typed `Record<string, number[]>` and exposes it on the in-memory `GraphNode` for the simulator to consume.
- Edge case: a node with `terms: {}` in the wire payload is parsed into a node whose `terms` is the empty object (not `undefined`), so U5's clustering code never has to null-check the field.
- Edge case: malformed server response is surfaced as an error, not silently coerced.
- Error path: 401 from the prefs endpoint propagates.

**Verification:**
- `npm run typecheck` green.
- `tests/vitest/content-graph-rest.test.ts` green.
- All consumers of `GraphEdgePayload` continue to compile (TS will flag any unhandled `kind`).

---

### U4. ForceSim: cluster attractor force

**Goal:** Add an optional cluster-attractor force loop to `ForceSim`. Each non-pinned node is attracted toward the weighted average of the centroids of the term clusters it belongs to. Centroids are computed each tick from current member positions.

**Requirements:** R5, R6, R7

**Dependencies:** None.

**Files:**
- Modify: `src/content-graph/sim.ts`
- Test: `tests/vitest/content-graph-sim-clusters.test.ts`

**Approach:**
- Add a new public field `clusterMembership: Map<nodeId, string[]> | null` on `ForceSim` (term ids per node; multi-term nodes have multiple). Setter: `setClusters(membership)`. Null disables the force entirely.
- Add a new force-config flag `attractorStrength: number` (default 0; nonzero enables the loop). `setForceConfig({ attractorStrength })` mutates it.
- New tick step (between gravity and integrate):
  - Compute per-term centroids: scratch `Map<termId, {sx, sy, n}>`. One pass over members.
  - For each node with membership: target = mean of its term centroids (weighted equally for v1; revisit if needed). Force = `(target - position) * attractorStrength`.
  - Apply to `node.vx`, `node.vy` before damping.
- Nodes with no membership (the "Uncategorized" cluster) are pulled toward the same scratch entry keyed on a sentinel (e.g., `__uncategorized__`).
- Existing repulsion + spring + gravity + damping + velocity clamp + drag-influence smoothstep all continue to apply unchanged.

**Execution note:** Add cluster-membership unit tests first; the force loop is small and the assertion ("multi-term node settles between cluster centroids") is testable with deterministic seeds and many ticks.

**Patterns to follow:**
- The existing repulsion loop (lines 130-154) and spring loop (lines 157-172) for shape and style.
- The `dragOrigin` smoothstep (lines 175-216) as a reminder that conditional force application is already a precedent.

**Test scenarios:**
- Happy path: with one term centroid and a small ring of members, members converge inward over N ticks.
- Happy path (Covers AE1): a multi-term node with two term centroids settles approximately on the line between them, not inside either cluster.
- Happy path (Covers AE2): a node with no membership is pulled to the "Uncategorized" centroid.
- Edge case: `clusterMembership = null` disables the force entirely; behavior matches today's sim.
- Edge case: `attractorStrength = 0` disables the force regardless of membership.
- Edge case: a term with one member produces a centroid equal to that member's position (force is zero).
- Edge case: pinned nodes are not displaced by the attractor.
- Integration: after `setClusters` swaps to a new membership, `reheat(0.3, false)` re-equilibrates within ~200 ticks.

**Verification:**
- `tests/vitest/content-graph-sim-clusters.test.ts` green.
- `npm run typecheck` green.
- Existing sim tests (if any) continue to pass.

---

### U5. GraphScene: lens API, cluster labels, edge-kind-aware bridge highlighting

**Goal:** Add `setLens(lensId)` to `GraphScene`. Branch the `draw()` loop on edge `kind` for color/weight. Apply bridge highlighting (intra fades, cross pops) when the active lens is Galaxy. Add a cluster-label layer rendered at scale-aware visibility.

**Requirements:** R1, R2, R3, R5, R8, R11, R12, R13

**Dependencies:** U3, U4.

**Files:**
- Modify: `src/content-graph/scene.ts`
- Possibly create: `src/content-graph/lenses.ts` (extracted iff the lens config's surface area pushes past a single page in `scene.ts`)
- Test: `tests/vitest/content-graph-scene-lens.test.ts`

**Approach:**
- Lens config object: `{ id, forces: { attractor: boolean, attractorStrength: number }, edgeKinds: { intraDimAlpha: number, defaults: EdgeKind[] }, showClusterLabels: boolean }`. Two constants: `CONSTELLATION_LENS` and `GALAXY_LENS`.
- `setLens(lensId)`:
  - Mutate `this.activeLens`.
  - Call `sim.setForceConfig({ attractorStrength: lens.forces.attractorStrength })` and `sim.setClusters(lens.forces.attractor ? this.clusterMembership : null)`.
  - Set `this.visibleEdgeKinds` to `lens.edgeKinds.defaults` (initial paint; user overrides via toolbar persist independently).
  - `sim.reheat(0.3, false)`.
  - Camera, focus, satellites: untouched.
- `draw()` loop changes:
  - Per edge: render only if `kind` is in `visibleEdgeKinds`.
  - Color/weight come from a per-kind palette (e.g., link = neutral gray, co-tag = blue, co-author = purple, hierarchy = teal, menu = amber). Palette lives next to the lens config.
  - Bridge highlighting (Galaxy only): if both endpoints share at least one term in the active clustering taxonomy, alpha = `lens.edgeKinds.intraDimAlpha` (e.g., 0.06); otherwise alpha = base. "Uncategorized" counts as one shared cluster for this rule (so two uncategorized posts' link is intra, faded).
- Cluster-label layer:
  - New `clusterLabelLayer: PixiContainer` added to `world` between `nodeLayer` and `labelLayer`.
  - Per-tick: for each term centroid, render a `PixiText` with term name + member count above the centroid. Reuse the existing label-visibility scale rule from `draw()` so labels disappear at low zoom.
- Label collision policy: when two cluster centroids drift close enough that their labels overlap, accept the overlap at the current zoom level. The scale-aware visibility rule already hides labels at low zoom; at normal zoom, overlapping cluster labels are an acceptable outcome of the force-driven layout (and a signal that the user might want to pan or zoom). No collision-avoidance logic in v1.
  - Empty terms (zero members) are not rendered. (R9, AE6.)
- `setClusterTaxonomy(taxonomySlug)`: re-derives cluster membership from the current node set's taxonomy data, calls `sim.setClusters(...)`, updates labels. Membership comes from the per-node `terms` field on each `GraphNode` (typed and emitted by U3 and U1 respectively); no extra REST round-trip is needed when the active taxonomy is already in the cached payload's `terms` scope. If the user picks a taxonomy outside that scope, the toolbar triggers a `loadGraph()` with the new `taxonomies` query parameter so the next payload carries the membership data.
- `setVisibleEdgeKinds(kinds)`: sets the field; next `draw()` reflects.
- **Focus and camera continuity across rebuilds (feasibility-2 fix):** `GraphScene.setData(payload)` is updated so it preserves `focusedId` and the camera target (`targetX`, `targetY`, `targetScale`) across a fresh data load when the focused node still exists in the new payload. Today's `setData()` re-randomises positions for missing nodes and constructs a new `ForceSim`; the change is to (a) carry forward `focusedId` if the new node set still contains that id (clear it otherwise), (b) leave `targetX/Y/Scale` untouched on the rebuild path so the camera does not snap to a default fit-to-view, and (c) re-apply the focused node's `pinned: true` and re-emit the satellite fan-out for the new node-detail (the panel content survives because U7 does not reload it on lens switch). `loadGraph()` in `index.ts` correspondingly stops calling `scene?.fitToView()` and `scene?.clearFocus()` when the load was triggered by a lens switch (vs. an initial mount or a post-type filter change). This satisfies AE4 along the U7 path that fetches both edge kinds for the new lens.

**Patterns to follow:**
- Existing `draw()` structure in `src/content-graph/scene.ts` for the per-edge and per-node loops.
- The label-visibility threshold logic at lines 607-654.

**Test scenarios:**
- Happy path: `setLens('galaxy')` while a node is focused leaves the focused node id and camera position unchanged. (Covers AE4.)
- Happy path: in Galaxy with `category` clustering, an edge between two posts in the same category has alpha equal to `intraDimAlpha`; an edge between posts in different categories has full alpha. (Covers AE3.)
- Happy path: cluster labels render at zoom > threshold; disappear at zoom < threshold.
- Edge case: setting a lens with no `attractor` does not re-derive cluster membership and skips label rendering.
- Edge case: setting `visibleEdgeKinds = []` results in zero edges drawn but nodes still render.
- Happy path (Covers AE4, focus-and-camera continuity through rebuild): with a node focused and camera panned/zoomed off-center, calling `scene.setData(newPayload)` where the new payload still contains the focused node id leaves `focusedId`, `targetX`, `targetY`, and `targetScale` unchanged. The focused node is re-pinned and the satellite fan-out re-renders against the new node detail. `loadGraph()` invoked via the lens-switch path skips `fitToView()` and `clearFocus()`.
- Edge case: `setData(newPayload)` where the focused node id is absent from the new payload clears `focusedId` and the satellite layer; camera target stays put (no implicit fit-to-view) so the user does not get yanked across the canvas.
- Edge case (Covers AE6): a term with zero in-scope members has no label and no centroid in the scratch map; given a taxonomy with 50 terms and 12 used, exactly 12 cluster centroids and 12 labels render (plus "Uncategorized" if any nodes lack terms).
- Edge case (R2 extensibility): a hypothetical third lens registered as a new entry in the lens-config map is selectable via `setLens()` without requiring changes to the branching logic in `setLens()` body or `draw()`. The test asserts the structural contract by registering a fixture lens object and verifying `setLens('fixture')` mutates the active config without throwing on unknown-lens branching.
- Integration: switching from Constellation to Galaxy and back returns the camera and focus to their pre-switch values (no implicit fit-to-view).

**Verification:**
- `tests/vitest/content-graph-scene-lens.test.ts` green.
- Manual: open Content Graph, switch lenses; observe cluster formation in Galaxy and the bridge-highlighting effect; switch back; confirm camera/focus survive.

---

### U6. Toolbar: <wpd-*> migration plus lens / taxonomy / edges controls

**Goal:** Migrate `src/content-graph/toolbar.ts` from raw DOM to `<wpd-*>` components. Add the lens segmented control, taxonomy dropdown, and edges multi-toggle. Per-lens visibility rules: taxonomy dropdown visible only in Galaxy; edges multi-toggle visible in both lenses.

**Requirements:** R1, R4, R11, R16

**Dependencies:** U3.

**Files:**
- Modify: `src/content-graph/toolbar.ts`
- Test: `tests/vitest/content-graph-toolbar.test.ts`

**Approach:**
- Replace the existing raw `<button>` chip rendering with `<wpd-chip>` rows. The parent owner of the active `Set` stays; only the rendered element changes.
- New `<wpd-segmented>` for the lens picker, with two `<wpd-segment>` children. `wpd-pick` event fires `onLensChange(lensId)`.
- New `<wpd-select>` for the taxonomy dropdown, populated from `cfg.taxonomies`. Hidden when the active lens is Constellation. `wpd-pick` fires `onTaxonomyChange(slug)`.
- New `<wpd-multiselect>` for the edges toggle, populated from `cfg.edgeKinds`. `wpd-pick` fires `onEdgesChange(kinds)`.
- Search input + Fit button preserved (refactor styling to fit the new component layout if needed).
- Layout: use `<wpd-row>` / `<wpd-cluster>` to compose the toolbar. Mobile/narrow handling: the existing toolbar sits in a horizontally-scrollable container; preserve.
- Removal: delete the raw `escapeHtml`/`escapeAttr` helpers if they become unused after migration.

**Patterns to follow:**
- Other toolbar consumers of `<wpd-segmented>` and `<wpd-select>` in the repo (the research map called these out as established stable components).
- `panel.ts`'s use of `wpd-spinner` for a precedent of `<wpd-*>` consumption inside content-graph.

**Test scenarios:**
- Happy path: clicking a lens segment fires `onLensChange` with the picked id.
- Happy path: picking a taxonomy fires `onTaxonomyChange` with the slug.
- Happy path: toggling an edge kind fires `onEdgesChange` with the new array of visible kinds.
- Happy path: post-type chip click toggles the chip and fires `onTypesChange`.
- Edge case: Constellation lens hides the taxonomy dropdown; switching to Galaxy reveals it.
- Edge case: edges multi-toggle disables the link entry in a lens that bans it (none in v1, but the wiring should be consistent).
- Integration: keyboard tab order traverses lens -> taxonomy -> chips -> edges -> search -> fit in a sensible reading order.

**Verification:**
- `tests/vitest/content-graph-toolbar.test.ts` green.
- `npm run lint` green (specifically: no remaining raw `document.createElement('button')` or `<input>` in `toolbar.ts`).
- Manual: open Content Graph, use only the keyboard to traverse and operate every control.

---

### U7. Orchestration: persistence wiring and lens switching end-to-end

**Goal:** In `src/content-graph/index.ts`, hydrate prefs from the injected window config on first paint, wire toolbar callbacks to scene + sim + REST, and persist user changes through a debounced saver.

**Requirements:** R3, R14

**Dependencies:** U2, U3, U5, U6.

**Files:**
- Modify: `src/content-graph/index.ts`
- Possibly create: `src/content-graph/preferences.ts` (extracted iff the persistence helper grows past ~50 lines)
- Test: `tests/vitest/content-graph-index-persistence.test.ts`

**Approach:**
- On render: read `cfg.prefs` and call `scene.setLens(prefs.lens)`, `scene.setClusterTaxonomy(prefs.byLens.galaxy.taxonomy)`, `scene.setVisibleEdgeKinds(prefs.byLens[prefs.lens].edges)`, `loadGraph()` with `prefs.byLens[prefs.lens].types` and `.edges`.
- Toolbar callbacks update local state, call the corresponding scene methods, and schedule a debounced `savePrefs(partial)`.
- Debounced saver: trailing-edge with 250ms wait. Mirrors `src/boot/session-saver.ts` but lighter (no `sendBeacon` flush; preferences are not safety-critical).
- **Lens switch path:** `loadGraph()` is invoked when the new lens's `(types, edges, taxonomies)` differs from what was last fetched. The call is annotated with a `reason: 'lens-switch'` flag so `loadGraph()` skips its post-load `scene?.fitToView()` and `scene?.clearFocus()` calls (those continue to run for `reason: 'initial'` and `reason: 'filter-change'`). Combined with U5's `setData()` continuity rules, this preserves `focusedId` and camera target across the lens transition (AE4). When the new lens's data shape matches the cached payload, the round-trip is skipped entirely and only `scene.setLens()` runs.
- Search, fit-to-view, post-type chips all preserved.

**Patterns to follow:**
- `src/boot/session-saver.ts` for the debounced-saver shape.
- The existing `buildToolbarCallbacks()` factory in `src/content-graph/index.ts`.

**Test scenarios:**
- Happy path: on first paint with `prefs.lens = 'galaxy'`, the scene mounts with Galaxy already active.
- Happy path (Covers AE5): the user switches lens to Galaxy, picks `post_tag`, toggles `co-author` on. After 250ms idle the saver POSTs prefs containing those values. On a fresh mount the same state is restored.
- Edge case: rapid toolbar interactions within 250ms collapse to a single POST.
- Edge case: switching lens when (types, edges) match the cached payload skips the network round-trip.
- Error path: a failed POST does not roll back the local UI state. The next successful save catches up.
- Integration: closing and reopening the window after toolbar changes restores the most recent prefs.

**Verification:**
- `tests/vitest/content-graph-index-persistence.test.ts` green.
- Manual end-to-end: walk through F1, F2, F3, F4 from the origin doc; verify outcomes match.

---

### U8. Documentation updates

**Goal:** Backfill the existing `desktop_mode_content_graph_*` filters in `docs/hooks-reference.md` (the gap research found). Document any new filters introduced by this work. Skip new `wp.desktop.*` API and `docs/examples/` entries; both are deferred per Key Technical Decisions.

**Requirements:** Indirect (preserves the project's documented-contract rule from `AGENTS.md`).

**Dependencies:** U1, U2.

**Files:**
- Modify: `docs/hooks-reference.md`
- Modify (only if a new filter is added during U1-U7): the same.

**Approach:**
- Add a new section in `docs/hooks-reference.md` covering the existing Content Graph filters that aren't documented today: `desktop_mode_content_graph_window_args`, `desktop_mode_content_graph_icon_args`, `desktop_mode_content_graph_user_can_use`, `desktop_mode_content_graph_post_types`, `desktop_mode_content_graph_template_html`. Status: Stable. Cite signatures and a one-line use case for each.
- If the implementation adds any new filter (likely candidates: a filter on the edge-kind catalog, a filter on the taxonomy catalog, a filter on the prefs schema), document it in the same section with status: Experimental and a note that the surface may change.
- Skip `docs/javascript-reference.md` updates: no public `wp.desktop.*` surface added in v1.
- Skip `docs/examples/`: no public extension surface to demo.

**Test expectation:** none. Documentation-only unit; correctness is reviewed via human read-through during PR review.

**Verification:**
- Markdown lints (if configured) clean.
- Hooks listed match the actual `apply_filters` calls in `includes/content-graph/`.

---

## System-Wide Impact

- **Interaction graph:** Content Graph is a self-contained native window. The new preferences endpoint adds one route under the existing `desktop-mode/v1` namespace; no other windows are touched. The Pixi `Application` lifecycle stays the same; lens switching does not remount it.
- **Error propagation:** REST failures surface to the existing toolbar status line via `setStatus()`. Persistence-write failures are non-fatal (toast or silent retry; the content-graph window continues to function).
- **State lifecycle risks:**
  - Cache invalidation on the new edge types must be tight; a stale cache after `set_object_terms` would silently misrepresent co-tag edges. Covered by U1's invalidation hooks and tested by an integration scenario.
  - Multi-term posts being attracted toward many centroids could destabilize the simulation if attractor force is too strong; tuning is deferred to implementation but the velocity clamp in `sim.ts` provides a hard ceiling.
- **API surface parity:** No other native window or external consumer reads the Content Graph's REST endpoints today. The `kind` field on edges is additive; existing handlers (none external) will not break.
- **Integration coverage:** Cross-layer scenarios that mocks alone will not prove are flagged as Integration in test scenarios for U1, U2, U4, U7. They cover end-to-end persistence, end-to-end edge-type invalidation, and lens-switch state preservation.
- **Unchanged invariants:** Existing satellite fan-out, side panel, search, fit-to-view, pan/zoom, and node-focus interactions are NOT changed (R15). The brainstorm's Key Flow F4 explicitly relies on this. Tests must verify these continue to behave identically across both lenses.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Force-sim becomes unstable when attractor force is added (oscillation, escape velocity). | The existing `MAX_VELOCITY` clamp and damping factor cap blow-up. Force coefficient tuning deferred to implementation with empirical fixtures (sparse, typical, dense sites). Tests assert convergence within N ticks for the typical case. |
| Co-tag query becomes expensive on sites with many tags or many posts (N posts × M tags). | One bulk `wp_term_relationships` JOIN keyed on the in-scope post IDs already fetched, not per-post. Existing transient cache covers steady-state cost. If empirical pain emerges, an opt-in "compute co-tag edges only on demand" path is a clean follow-up. |
| Cache invalidation gaps cause stale edges (e.g., a hook we forgot to listen to). | Explicit hook list in U1: `save_post`, `deleted_post`, `set_object_terms`, `wp_update_nav_menu`, `wp_update_nav_menu_item`. Integration tests in U1 exercise the most likely scenarios. |
| `<wpd-*>` migration of the existing chip row introduces visual regressions. | Toolbar visual diff via screenshots before/after on a seeded site during PR review. The component-kit replacements are functionally equivalent; risk is in styling spacing or dashicon rendering. |
| Lens switch loses camera or focus state because the rebuild path (`loadGraph()` + `setData()`) snaps to fit-to-view. | Resolved in design: `setData()` preserves `focusedId` and camera target on rebuilds, and `loadGraph()` accepts a `reason` flag that suppresses `fitToView()` and `clearFocus()` on lens-switch loads. AE4 is enforced as an explicit test scenario in U5. Any regression is caught by the test, not by review alone. |
| Per-node `terms` payload grows unbounded on sites with very long taxonomies (e.g., a tag taxonomy with hundreds of terms per post). | Per-node-per-taxonomy 50-term truncation cap in U1, with `do_action('desktop_mode_content_graph_terms_truncated', ...)` for observability. The scoping rule (only request taxonomies actually needed by the active lens + visible edge kinds) keeps typical payloads bounded; the cap is the safety net for outliers. |
| Bridge highlighting visually overpowers cross-cluster signal because intra-dim alpha is too aggressive (or too mild). | Default `intraDimAlpha = 0.06`; expose as a per-lens config field so it can be tuned without recompile. Tune empirically against seeded fixtures. |
| Preferences schema drift between PHP and TS leads to silent field loss. | PHP sanitizer is the gate; TS types describe the same shape; PHP unit tests in U2 assert the round-trip. Whenever the schema changes, both sides update in the same commit. |

---

## Documentation / Operational Notes

- Documentation: per U8, `docs/hooks-reference.md` is updated. No `docs/javascript-reference.md` or `docs/examples/` work in v1.
- Translation (i18n): user-facing strings ("Constellation", "Galaxy", lens labels, taxonomy labels, edge-kind labels, "Uncategorized") flow through the existing `__()` helper. Per the project memory, do NOT regenerate the POT/PO/JSON in this PR. That is a batched pre-translation step.
- Operational rollout: this is a single-plugin feature; no migration, no feature flag in v1. Ships in the next plugin release.
- Build: per `AGENTS.md`, run `npm run build` after every code change. Specifically `npm run build:content-graph` covers the relevant bundle, and `npm run build` covers all targets.
- PHPUnit conventions: every new test class under `tests/phpunit/tests/` MUST carry the `@group desktop-mode` PHPDoc tag at the class level. The repo's `tests/phpunit/phpunit.xml.dist` filters tests by `@group desktop-mode`; without the tag, the class runs zero tests and the suite reports green silently. File naming follows the existing camelCase convention (e.g., `contentGraphEdgeBuilders.php`, `contentGraphPreferences.php`).

---

## Sources & References

- **Origin document:** [docs/brainstorms/content-graph-multi-lens-galaxy-requirements.md](../brainstorms/content-graph-multi-lens-galaxy-requirements.md)
- Related code: `src/content-graph/`, `includes/content-graph/`, `src/ui/components/wpd-segmented/`, `src/ui/components/wpd-select/`, `src/ui/components/wpd-multiselect/`, `src/ui/components/wpd-chip/`, `includes/os-settings.php`, `src/boot/session-saver.ts`
- Related PRs/issues: none yet.
- External docs: none used.
