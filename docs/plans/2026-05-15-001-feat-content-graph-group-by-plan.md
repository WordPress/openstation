---
title: "feat: Content Graph — Group-by selector (Categories / Authors / Tags / Date)"
type: feat
status: ready
date: 2026-05-15
origin: docs/brainstorms/content-graph-group-by.md
---

# feat: Content Graph — Group-by selector

## Summary

Add a single-select dropdown to the Content Graph toolbar that
clusters the visible posts around one of four facets: **Category**,
**Tag**, **Author**, **Date (year)**. Each non-empty group renders
a centred label at its emergent centroid. Switching the selector
live-swaps the force model without remount. State is session-local
(no persistence). Scoped to ship lean — does **not** include the
multi-lens architecture, edge-kind discriminator, or per-user prefs
endpoint from the warehouse Galaxy plan.

## Requirements

- R1. Toolbar exposes a `<wpd-select>` with options: None / Category /
  Tag / Author / Date. Default = None (current behaviour).
- R2. On selection change, posts cluster around the centroid of their
  group within ~2 seconds; the Pixi `Application` and `world`
  container are not torn down.
- R3. Multi-term posts (multiple categories or tags) get a weighted
  pull toward all term centroids (`1/N` per membership).
- R4. Posts with no value for the active facet form an "Uncategorized"
  (Category) or "Untagged" (Tag) cluster. Author / Date never produce
  an empty bucket.
- R5. Each non-empty group renders a centred label with the group's
  display name (term name, author display name, year). Empty groups
  render no label.
- R6. Group labels are scale-aware (don't shrink to illegibility on
  zoom-out, don't dominate on zoom-in) and don't compete with node
  labels.
- R7. Group state is session-local. Closing and re-opening the window
  resets to None.
- R8. Selecting None tears down the cluster force and labels; the
  layout relaxes back to the existing constellation in <2s.
- R9. The selector is orthogonal to post-type filter chips and to
  search; both keep working unchanged.
- R10. Switching the selector while a post is focused keeps the
  focused-node pinned position + satellites layer intact.

## Scope Boundaries

- No multi-lens architecture, edge-kind discriminator, per-user prefs
  endpoint, or toolbar `<wpd-*>` migration. Those remain in the
  warehouse Galaxy plan and can land later.
- No arbitrary-public-taxonomy support — v1 hard-codes `category` and
  `post_tag` (WordPress built-ins).
- No date bucketing other than year. Year-month / month-of-year
  deferred.
- No contributors-as-co-authors. Strict `post_author` only.
- No drag-to-reposition cluster labels.
- No persistence across window opens.

## Context & Related Code

- `src/content-graph/index.ts` — wires toolbar + scene + REST. The
  orchestration layer for the new selector lives here.
- `src/content-graph/toolbar.ts` — vanilla DOM toolbar (the `<wpd-*>`
  migration is out of scope; we add ONE `<wpd-select>` next to the
  existing actions without refactoring the rest).
- `src/content-graph/scene.ts` — `GraphScene`. Adds a
  `groupLabelLayer` Pixi container and a `setGrouping()` method.
- `src/content-graph/sim.ts` — `ForceSim`. Adds an attractor force
  loop gated on `groupAssignment`.
- `src/content-graph/rest.ts`, `types.ts` — extended for the new
  per-node fields (`author_id`, `year`, `category_ids`, `tag_ids`) and
  the per-payload `groups` catalog.
- `includes/content-graph/graph-builder.php` — emit the new per-node
  fields and the catalog. Cache key already covers
  `post_modified_gmt`; we add term-relationships state to the hash so
  retagging busts the cache.
- `includes/content-graph/rest.php` — `/nodes` response shape only.

## Key Technical Decisions

- **No new REST endpoint.** All grouping data ships on the existing
  `/nodes` payload. The selector switches client-side; no refetch
  per facet change.
- **Per-node fields stay flat:** `author_id: number`, `year: number`,
  `category_ids: number[]`, `tag_ids: number[]`. The client picks
  which one to use based on the active facet.
- **Group catalog:** the payload carries `groups: { authors:
  Record<id, { name }>, categories: Record<id, { name }>, tags:
  Record<id, { name }> }`. Only entries actually referenced by an
  in-scope node are emitted (keeps the payload tight on big sites).
- **Cluster force is emergent, not lattice.** Per tick, the sim
  computes a centroid per group as the running average of member
  positions; each non-pinned member is pulled toward its centroid
  with strength `groupAttractorStrength / membershipCount`. Same
  alpha cooling as everything else.
- **Group label layer sits ABOVE node labels.** Drawing order:
  `edgeLayer → spokeLayer → nodeLayer → labelLayer → groupLabelLayer
  → satelliteLayer`. Group labels are bigger (16px) and slightly
  bolder than node labels; they fade IN as you zoom OUT (the inverse
  of node labels) so the "shape of the clustering" reads at any
  zoom.
- **No cache-flush hooks added.** The existing `save_post` /
  `deleted_post` flush is sufficient for `category_ids` / `tag_ids`
  via the WP term-relationship saves that happen through the post
  edit path. We *don't* add `set_object_terms` because the existing
  fetch's `post_modified_gmt` won't change when only term assignments
  change directly via `wp_set_object_terms`; **this is a known
  limitation** documented in the brainstorm and accepted for v1 (the
  cache TTL is 6h, editorial flow nearly always goes through
  `save_post`). Promote to a hook addition if real users hit stale
  clusters.
- **Session-local state, no persistence.** Selector resets to None
  on window open. If a user wants to keep a clustering across
  refreshes, that's the trigger for adding the prefs endpoint from
  the Galaxy plan.

## Open Questions (resolved)

- A or B? → B.
- Date granularity? → Year.
- Multi-term posts? → Weighted pull.
- Persistence? → Session-local.
- All resolved in brainstorm. No remaining gating questions for
  implementation.

## Implementation Units

### U1. PHP: extend `/nodes` payload

**Goal:** Add per-node `author_id`, `year`, `category_ids`,
`tag_ids` and a top-level `groups` catalog to the `/nodes` response.

**Files:**
- Modify `includes/content-graph/graph-builder.php`
- Modify `includes/content-graph/rest.php` (no shape change beyond
  pass-through; the payload is built in graph-builder)
- Test `tests/phpunit/tests/contentGraphGroupBy.php`

**Approach:**
- Add `post_author` to the SELECT in
  `desktop_mode_content_graph_fetch_rows()` (already done in some
  in-progress branches per the Galaxy plan; if not, add here).
- Single bulk `wp_term_relationships` JOIN keyed on in-scope post
  IDs, filtered to `category` and `post_tag`. Build
  `node.category_ids` and `node.tag_ids` from the same result.
- Bucket `post_date` by year: `intval(date('Y', strtotime($row->post_date)))`.
- Build the `groups` catalog: walk every node, gather referenced
  author/category/tag ids, run one `WP_User_Query` + one `get_terms`
  per taxonomy to populate names.
- Extend the cache key hash to include the term-relationships digest
  (a `COUNT(*) + MAX(term_taxonomy_id)` over the in-scope posts is
  cheap and changes whenever a term is added/removed/renamed).

**Test scenarios:**
- A fixture with three posts where one is in two categories and one
  has no tags produces the expected per-node arrays and a `groups`
  catalog containing only referenced ids.
- Pages with no categories or tags produce empty arrays for both,
  not `null` or missing fields.
- The `year` field is the publish year (not modified year).

---

### U2. Frontend: types and REST client

**Goal:** Type the new payload shapes. No new endpoint, just an
extended `GraphNodePayload` and a new `GraphPayload.groups` field.

**Files:**
- Modify `src/content-graph/types.ts`
- Modify `src/content-graph/rest.ts` (only if a new helper is
  needed — likely just the type extension is enough)

**Approach:**
- Extend `GraphNodePayload`: `author_id: number`,
  `year: number`, `category_ids: number[]`, `tag_ids: number[]`.
- Extend `GraphPayload`: `groups: { authors: Record<number, { name:
  string }>, categories: Record<number, { name: string }>, tags:
  Record<number, { name: string }> }`.
- Extend in-memory `GraphNode` to carry the same fields (the
  payload-to-GraphNode mapper in `scene.ts:setData()` adds them).

---

### U3. `ForceSim`: cluster-attractor force loop

**Goal:** Add a per-tick force that pulls each non-pinned node toward
the centroid of every group it belongs to, weighted by
`1/membershipCount`. Gated on a `groupAssignment` map.

**Files:**
- Modify `src/content-graph/sim.ts`
- Test `tests/vitest/content-graph-sim.test.ts`

**Approach:**
- Add `public groupAssignment: Map<number /*nodeId*/, string[]
  /*groupKeys*/> | null = null`.
- Add `public groupAttractorStrength = 0.05` (tunable).
- In `step()`, between the spring loop and the integrate step:
  - If `groupAssignment` is null, skip.
  - First pass: compute centroid per group key. Single map: `Map<
    string, { x, y, count }>`.
  - Second pass: for each non-pinned node, look up its group keys;
    for each key, compute the attractor force toward that centroid
    weighted by `groupAttractorStrength / nodeGroupCount`. Sum the
    contributions into `n.vx` / `n.vy`.
- Provide a `setGroupAssignment(map | null)` method that also calls
  `reheat(0.3, false)` so the cluster visibly settles.

**Test scenarios:**
- Two nodes with one shared group key converge toward the same
  point.
- A node with two group keys settles at the midpoint of the two
  centroids (within tolerance).
- `setGroupAssignment(null)` lets the existing gravity-toward-origin
  reclaim the layout.

---

### U4. `GraphScene`: group label layer + orchestration

**Goal:** New Pixi layer rendering per-group labels at the live
centroid. `setGrouping(facet)` recomputes the assignment map from
the current nodes, hands it to the sim, builds the label set, and
reheats.

**Files:**
- Modify `src/content-graph/scene.ts`

**Approach:**
- Add `groupLabelLayer: PixiContainer` after `labelLayer` in
  layer-order; addChild to `world` between labelLayer and
  satellite-layer placement (currently satellites are added to
  `world` directly via `SatelliteLayer`; verify the resulting
  z-order keeps satellites on top during focus).
- New private `groupViews: Map<string, { container, bg, text,
  centroid: { x, y } }>` and `setGrouping(facet: GroupFacet | null)`.
- `setGrouping`:
  - Computes `Map<nodeId, string[]>` from the per-node fields:
    - `Category` → `n.category_ids.map(id => 'cat:' + id)` or
      `['cat:uncategorized']` if empty.
    - `Tag` → analogous for tags.
    - `Author` → `['author:' + n.author_id]`.
    - `Date` → `['year:' + n.year]`.
    - `None` → null map; skips below.
  - Calls `this.sim.setGroupAssignment(map)`.
  - Tears down existing `groupViews`; builds fresh per group key
    referenced in the map (with display label from the payload's
    `groups` catalog or the localised "Uncategorized" / "Untagged"
    fallbacks).
- In `draw()` / a new per-tick `drawGroupLabels()`:
  - For each `groupViews` entry, compute centroid from current
    member positions, set container.x / .y, set scale-inverse on
    the inner text container so it stays readable.
  - Alpha = smoothstep(zoom) — fades OUT as you zoom in past ~1.0
    (so the cluster labels don't fight the focused-post UI when
    you're close).
- Drawing order check: group labels appear ABOVE node labels but
  BELOW satellite overlays. Verify after first paint; if satellites
  end up underneath, move `groupLabelLayer` insertion before the
  satellite layer's addChild.

**Test scenarios:**
- Switching from None → Category produces N labels where N =
  number of distinct categories present in the current node set
  (plus "Uncategorized" if any post has no category).
- Switching Category → None removes every label and re-relaxes the
  layout.
- Empty category (zero members in the active type set) renders no
  label.
- Focus + select a satellite, then switch facet — focused node stays
  pinned, satellites still render.

---

### U5. Toolbar: `<wpd-select>` group-by control

**Goal:** Add a single `<wpd-select>` next to the existing search +
action buttons with the 5 options. Wire to the scene's
`setGrouping()`.

**Files:**
- Modify `src/content-graph/toolbar.ts`
- Modify `src/content-graph/index.ts` (orchestration)

**Approach:**
- Add `onGroupChange: (facet: GroupFacet | null) => void` to
  `ToolbarCallbacks`.
- Render `<wpd-select>` element with five `<wpd-option>` children.
  Listen for `wpd-pick`. The component is per
  `src/ui/components/index.ts` — exported, stable.
- In `index.ts`, wire `onGroupChange` to `scene.setGrouping()`.

---

### U6. Visual verification + tests

- Lint, type-check, `npm run test:js`, `npm run test:php`.
- Manual: open Content Graph on a seeded site, switch through all
  five facets, confirm:
  - Clusters form within ~2s.
  - Labels appear at each non-empty group's centre.
  - Labels are legible at fit-to-view AND on 4x zoom.
  - Focused post + satellites survive a facet switch.
  - "Uncategorized" and "Untagged" buckets render only when
    populated.
  - Zoom-out + zoom-in show the labels fading in/out at the
    expected thresholds.

## Cost estimate

- U1: ~3h (PHP + PHPUnit)
- U2: ~30m
- U3: ~2h (sim + Vitest)
- U4: ~3h (scene + label layer + tuning)
- U5: ~1h
- U6: ~1h
- Tuning slack: ~2h

~12 dev-hours all-in.

## Future hooks (not built in v1)

- Per-user persistence — add a tiny `/preferences` endpoint mirroring
  `os-settings.php`, single `groupBy` field. Cheap if/when needed.
- Custom-taxonomy support — generalize the per-node arrays into a
  `terms: Record<taxonomy, number[]>` map. Existing call sites become
  `terms.category` / `terms.post_tag`. Drop-in.
- Year-month / month-of-year — emit `ym` and `month` alongside
  `year`. Add facet options.
- Sub-clustering ("Author within Category") — compose two
  assignment maps. The force loop already supports multi-key
  membership.
