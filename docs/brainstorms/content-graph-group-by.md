---
title: Content Graph — Group-by selector (Categories / Authors / Tags / Date)
status: brainstorm
date: 2026-05-15
related:
  - ../../wairehouse/desktop-mode/plans/2026-05-10-001-feat-content-graph-multi-lens-galaxy-plan.md
---

# Content Graph — Group-by selector

Add a toolbar selector that clusters Content Graph posts around the
values of a chosen facet. First-ship facets: **Categories**, **Authors**,
**Tags**, **Post date**. Each cluster has its value labeled at the
cluster centre.

## How this relates to the existing Galaxy-lens plan

There is already a comprehensive plan in the warehouse for a Galaxy
lens that clusters posts by an arbitrary public taxonomy with
emergent centroids and centre-of-cluster labels (R5–R9 in that plan).
That plan covers Categories and Tags directly (both are public
taxonomies). It does **not** cover Authors or Post date as grouping
facets — those would require additions to the force model and the
toolbar.

Two ways to land what was requested:

- **Option A — Extend the Galaxy lens.** Generalize the "taxonomy
  dropdown" into a "Group by" selector with three buckets: any public
  taxonomy, `author`, `date`. The cluster-attractor force from U4 of
  the existing plan stays — it already does "pull each post toward
  the centroid of its group" — but the *grouping function* is now
  pluggable per facet.
- **Option B — Ship grouping as a smaller, standalone feature first.**
  Skip the lens architecture, multi-edge-kinds, persistence, and
  toolbar `<wpd-*>` migration from the Galaxy plan; ship just the
  selector + cluster-attractor force + labels. The lens architecture
  can land later if needed.

I'd default to **Option B** for first ship. Smaller surface, faster to
visible value, and the existing plan can absorb the work as its U4 +
U5 + U6 once the multi-lens story actually has demand. The cluster
force loop and the label layer are the same code either way.

## What the selector controls

Single-select dropdown (`<wpd-select>`) in the toolbar, near the
search input. Options:

- **None** (default — current behaviour, no clustering)
- **Category**
- **Tag**
- **Author**
- **Date** (post published-date)

When a facet is selected:

1. Each post is assigned to a group based on the facet's value.
2. A per-tick cluster-attractor force pulls non-pinned posts toward
   their group's emergent centroid (running average of group
   members). Existing repulsion + spring forces stop them collapsing.
3. The centroid is labeled with the group's name (taxonomy term name,
   author display name, or date bucket).
4. Switching the selector live-swaps the grouping function and
   reheats the sim at low alpha; no remount.

## Grouping rules per facet

### Categories / Tags
- Use the term **name** as the group label.
- A post can have multiple terms — handle multi-membership via a
  weighted pull (each term contributes `1/N` of the attractor force).
  Posts with no terms in that taxonomy form an "Uncategorized" /
  "Untagged" cluster.
- Empty terms (zero members in the current node set) get no label
  marker.

### Authors
- One author per post → unambiguous group assignment.
- Label = display name.
- Optional: include contributors (revision authors + commenters who
  have user accounts) in the same way categories handle multi-term
  posts. *I'd ship without this in v1.*

### Post date
- Bucket by **year** by default. Year buckets are durable, cleanly
  labelable, and produce a usable cluster count on most blogs.
- Alternatives: year-month, month-of-year (cyclic). Year-month
  produces many clusters on long-lived blogs; month-of-year produces
  12 stable clusters but loses chronological identity. Defer; ship
  year-only first.
- Label = `2026` etc.

## Cluster label rendering

- New Pixi layer between `nodeLayer` and the satellite layer:
  `groupLabelLayer`.
- Each label = `Container { Graphics(pill bg), Text(name) }`, painted
  once per group, repositioned per tick at the running centroid.
- Scale-aware via `labelBox.scale.set(1 / world.scale.x)` (mirrors the
  node-label pattern in `scene.ts`).
- Fades in via `smoothstep` between two zoom thresholds, same idea as
  node labels but biased to be visible at lower zooms (the whole
  point of clusters is to read the scene from far away).
- Empty groups render no label.

## Force model

Add to `ForceSim`:

```ts
public groupAssignment: Map<number /*nodeId*/, string[] /*groupKeys*/> | null = null;
public groupAttractorStrength = 0.06; // tunable
```

Per tick, between the existing spring loop and the integrate step:

```
if (groupAssignment) {
  // 1. Compute centroid per group from member positions.
  // 2. For each non-pinned node:
  //      for each group it belongs to:
  //        apply force toward centroid, weighted 1/membershipCount.
}
```

This integrates into the alpha cooling cleanly — no separate cooling
loop needed. Multi-group posts settle at the force balance between
their centroids.

When the selector is `None`, `groupAssignment` is `null` and the
existing gravity-toward-origin stays the only global pull.

## Server side

Re-use the existing `/nodes` endpoint, extended to emit per-node:

- `author_id: number`
- `terms: Record<taxonomy_slug, number[]>` — only for the requested
  facet's taxonomy when the facet is Category or Tag.
- `date_ymd: 'YYYY-MM-DD'` or just `year: number` (cheaper) — only
  emitted when the facet is Date.

Plus a top-level lookups map per facet:

- `groups: { authors: Record<id, { name, avatar }>, terms: Record<id, { name, taxonomy }> }`

This avoids per-post `display_name`/term-name lookups on the client.
The membership data the existing plan emits already covers Categories
and Tags; this is just adding author/date.

Group-label content is then `groups.authors[node.author_id].name`,
`groups.terms[termId].name`, or the year directly.

## Resolved decisions

1. **Option B** — ship lean. No multi-lens architecture, no edge-kind
   discriminator, no toolbar `<wpd-*>` migration. Just the selector,
   cluster-attractor force, group labels.
2. **Date bucketing:** year. Year-month deferred.
3. **Multi-term posts:** weighted pull (each membership contributes
   `1/N` of the attractor force toward its term centroid).
4. **Persistence:** session-local. No per-user meta in v1. Selector
   resets to "None" on each window open. Simpler, no new endpoint, no
   sanitiser. Promote to per-user later if it lands as a real ask.
5. **Empty/Uncategorized cluster:** yes — one bucket per facet for
   posts with no matching value (Categories → "Uncategorized",
   Tags → "Untagged"). Authors / Date never produce an empty bucket.
6. **Cluster spacing:** emergent. No new spacing parameter — centroid
   drift + the existing inter-node repulsion handle it.
7. **Pages in clusters:** yes — every node in the active type set
   participates regardless of post type. Pages will mostly fall into
   "Uncategorized" / "Untagged" because they don't usually carry
   those taxonomies; that reads correctly as "pages aren't tagged
   here", not as a bug.

## Scope-trim from the brainstorm

These were considered but deferred:

- Custom taxonomies beyond `category` and `post_tag`. v1 wires only
  WordPress's two built-ins; arbitrary public taxonomies wait for the
  Galaxy lens.
- Contributors counted toward author cluster membership. v1 = strict
  `post_author` only.
- Drag-to-reposition a cluster label.
- Compare mode (two clusterings side-by-side).

## Cost estimate

- Server side (extend `/nodes` payload + group lookups for author/date):
  ~half a day.
- TypeScript types + REST helpers: a few hours.
- `ForceSim` cluster-attractor force loop: half a day with tuning.
- Group-label Pixi layer: half a day.
- Toolbar `<wpd-select>` wiring and live-swap orchestration: half a day.
- Tests (PHPUnit for new payload fields, Vitest for force-loop math,
  manual visual verification at small/large node counts): half a day.

Roughly 2–3 dev-days for Option B. Option A is several weeks because
it pulls in the multi-lens architecture, per-user preferences endpoint,
edge-kind discriminator, and toolbar migration from the existing plan.

## Out of scope (v1)

- Drag a cluster label to manually reposition the centroid.
- Switch between "balanced" centroids (current proposal) and
  "fixed lattice" centroids (predictable layout regardless of
  membership).
- Sub-clustering (cluster by author *within* category).
- "Compare" mode that shows two clusterings side by side.

## Next steps

1. Pick A/B and answer the open questions above.
2. If B, I'll branch the implementation into U-style units mirroring
   the existing plan's structure so they can compose later.
