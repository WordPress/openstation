---
date: 2026-05-10
topic: content-graph-multi-lens-galaxy
---

# Content Graph: Multi-Lens Views and the Radial Galaxy

## Summary

Content Graph becomes a multi-lens viewer. The first new lens, Radial Galaxy, clusters posts by a user-chosen taxonomy via a force-driven layout, with bridge highlighting that fades intra-cluster edges and pops cross-cluster ones. Four new edge types (co-tag, co-author, page hierarchy, menu) join the existing hyperlinks under a toolbar multi-toggle. A lens-switcher in the toolbar establishes the architecture so future lenses (Sitemap, Timeline) can drop in as new lens IDs without refactor.

---

## Problem Frame

Content Graph today is a single-geometry tool: one force-directed layout, one edge type (`<a href>` extracted from `post_content`), one mental model, "the web of internal links." That story serves curiosity well but undersells what's actually in WordPress. Posts are also organized by taxonomies, written by authors, parented to pages, and exposed through nav menus. None of that surfaces in the graph today.

Editors and content strategists currently reach for the categories admin page or a sitemap export to answer questions like "what topics am I covering?" or "which categories overlap?", and the answers come back as flat lists, not as a visual whose density and connectedness tell the story. There's no surface in WordPress where an editor can see "the constellations of my topical coverage" at a glance. The graph is the natural place to deliver that, but it has to grow beyond a single layout and a single edge type to do so.

---

## Actors

- A1. **Site editor**: opens Content Graph to understand topical coverage, find related content, and spot structural patterns (clusters, bridges, gaps). Primary user.
- A2. **Content strategist**: uses the lens to audit how categories overlap, which authors span topics, and where the IA's spine (menus, hierarchy) sits. Secondary user.
- A3. **Plugin developer extending Desktop Mode**: currently consumes Content Graph as a fixed window; benefits from the lens architecture being clean enough to add their own lens later. Tertiary; informs API and architecture quality, not v1 features.

---

## Key Flows

- F1. **Switch lens from Constellation to Galaxy**
  - **Trigger:** User opens Content Graph (defaults to last-used lens, Constellation on first ever open) and clicks the Galaxy segment in the toolbar's lens switcher.
  - **Actors:** A1
  - **Steps:** (1) Force sim re-equilibrates with per-cluster centroid attractors added. (2) Existing nodes drift toward their term clusters; multi-term nodes settle between. (3) Edge rendering switches to bridge-highlighting (intra fades, cross pops). (4) Toolbar reveals the taxonomy dropdown and edge multi-toggle. (5) Toolbar status updates to show terms count alongside nodes/links count.
  - **Outcome:** Same data, new visual. Lens choice persists for next open.
  - **Covered by:** R1, R3, R6, R8, R13

- F2. **Pick a different clustering taxonomy**
  - **Trigger:** User in Galaxy lens opens the taxonomy dropdown and selects a different taxonomy.
  - **Actors:** A1, A2
  - **Steps:** (1) Force sim re-equilibrates with new term centroids. (2) Nodes drift to their new clusters. (3) Cluster labels update. (4) The "Uncategorized" cluster appears or shrinks based on coverage of the new taxonomy. (5) Choice persists per user.
  - **Outcome:** Same nodes, regrouped by the new taxonomic axis.
  - **Covered by:** R4, R5, R7, R14

- F3. **Reveal a hidden edge type**
  - **Trigger:** User toggles "Co-author" from off to on in the edges multi-toggle.
  - **Actors:** A2
  - **Steps:** (1) The new edge set becomes visible (loaded eagerly with the rest of the graph payload, just rendered or hidden by toggle). (2) Edges render in their type's distinct color and weight. (3) Bridge highlighting still applies in Galaxy. (4) Toggle state persists per user, scoped per lens.
  - **Outcome:** Co-authorship bridges become visible; user can spot polymath authors writing across category clusters.
  - **Covered by:** R10, R11, R12, R13, R14

- F4. **Focus a node**
  - **Trigger:** User clicks any node.
  - **Actors:** A1
  - **Steps:** Same as today's Constellation flow, focus animates, satellites fan out, side panel populates with post detail and per-relationship contextual views.
  - **Outcome:** Existing focused-detail UX, unchanged across both lenses.
  - **Covered by:** R15

---

## Requirements

**Lens architecture**

- R1. The Content Graph window exposes at least two lenses on first ship: **Constellation** (current behavior) and **Galaxy** (new). Lens choice is a first-class concept the toolbar exposes via a segmented control.
- R2. The lens architecture supports adding future lenses (e.g. Sitemap, Timeline) by registering a new lens ID without refactoring the existing two. Each lens controls its own layout strategy, default edge visibility, and toolbar extras.
- R3. Switching lenses re-equilibrates the existing scene (same node identities, same `GraphScene`) rather than tearing down and remounting. Camera state and focused-node state survive lens switches.

**Galaxy lens**

- R4. The user picks any registered **public** taxonomy from a toolbar dropdown to drive clustering. Default selection is `category` if present, otherwise the first available public taxonomy alphabetically.
- R5. Each term in the selected taxonomy becomes a cluster centroid that attracts posts holding that term. Centroids drift with their cluster's center of mass; positions are not fixed.
- R6. Posts holding multiple terms in the selected taxonomy are pulled toward each of their term clusters proportionally, settling visually between them by emergent force balance, not by duplicating a node per term.
- R7. Posts and pages with no terms in the selected taxonomy form a single "Uncategorized" cluster.
- R8. Each cluster carries a label rendered above its centroid showing the term name and the number of nodes it currently anchors. Labels are scale-aware: visible at zoom levels matching the existing node-label visibility rule.
- R9. Empty terms (zero nodes) are hidden from the rendered scene and the cluster-label set by default. There is no UI to opt them in for v1.

**Edges**

- R10. Four new edge types ship in v1 alongside the existing hyperlink edge type:
  - **Co-tag**: posts sharing one or more terms in any taxonomy *other than* the currently-selected clustering taxonomy.
  - **Co-author**: posts with the same `post_author`.
  - **Hierarchy**: `post_parent` relationships.
  - **Menu**: nav menu items pointing to posts.
- R11. The toolbar exposes a multi-toggle (one control per edge type) controlling visibility of each edge type independently. Each edge type renders in a distinct color and weight, legend-friendly.
- R12. Default edge visibility on first paint is per-lens:
  - **Constellation**: hyperlinks on; all four new types off (preserves today's behavior).
  - **Galaxy**: hyperlinks on; **co-tag** on; co-author, hierarchy, menu off.
- R13. In Galaxy lens, **bridge highlighting** applies to all visible edge types: when both endpoints sit in the same cluster, the edge fades to a low-alpha background; when endpoints sit in different clusters (or one is in "Uncategorized"), the edge renders at full intensity in its type's color.

**Persistence**

- R14. Per-user persistence covers: last-selected lens, last-selected clustering taxonomy in Galaxy, per-lens edge-toggle state, and per-lens post-type chip state.

**Continuity with current behavior**

- R15. The existing satellite fan-out, side panel, search, fit-to-view, pan/zoom, and node-focus interactions work unchanged in both lenses.
- R16. The post-type filter chips remain a secondary filter on top of the chosen taxonomy and lens. Toggling a post type out hides matching nodes regardless of clustering.

---

## Acceptance Examples

- AE1. **Covers R6.** Given a post is tagged with both `News` and `Travel` in the Categories taxonomy, when Galaxy is the active lens with `category` selected, then the node settles approximately on the line between the News and Travel cluster centroids, not inside either cluster's interior.
- AE2. **Covers R7.** Given a Page with no `category` terms (Pages typically lack categories), when Galaxy is active with `category` selected, then the page node lives in the "Uncategorized" cluster, not in any term cluster.
- AE3. **Covers R12, R13.** Given Galaxy is the active lens with `category` selected and only the default edge types on (hyperlinks plus co-tag), when two posts in different category clusters share a tag in `post_tag`, then the co-tag edge between them renders at full intensity in the co-tag color; when two posts in the same category cluster share a tag, that intra-cluster co-tag edge renders faded.
- AE4. **Covers R3.** Given the user has focused a node in Constellation and the side panel is open, when the user switches to Galaxy via the toolbar, then the same node remains focused, the side panel stays populated, and the camera does not snap back to a default fit-to-view.
- AE5. **Covers R14.** Given the user picks `post_tag` as the Galaxy taxonomy and toggles `co-author` edges on, when the user closes Content Graph and reopens it, then the lens is still Galaxy, the taxonomy is still `post_tag`, and `co-author` edges are still visible.
- AE6. **Covers R9.** Given the selected clustering taxonomy has 50 terms but only 12 of them have at least one post in the current post-type filter, when Galaxy renders, then exactly 12 cluster centroids and 12 cluster labels are visible (plus "Uncategorized" if any nodes lack terms in that taxonomy).

---

## Success Criteria

- An editor opening Content Graph for the first time after this ships sees something visually distinct from "the same graph as before" and can articulate within roughly 30 seconds what each cluster represents.
- A content strategist can answer "which authors write across multiple categories?" by toggling on co-author edges in Galaxy without leaving the window.
- The lens architecture is clean enough that a Sitemap or Timeline lens can be added in a follow-up without touching `GraphScene`'s public surface beyond registering a new lens ID.
- A planning pass on this doc can produce concrete file diffs without inventing user-facing behavior, scope, or persistence semantics.
- Galaxy on the sites Constellation handles today does not regress on time-to-first-paint or interactive smoothness (pan, zoom, node drag).

---

## Scope Boundaries

- **Block reference edges** (featured images, cover blocks, image refs, post-loop queries, reusable blocks, embeds): explicitly deferred. Block parsing is materially more expensive than the four cheap edge types and earns its own follow-up.
- **AI-augmented features** (semantic similarity edges, prompt-driven views, AI cluster captions, suggested-link recommendations): separate brainstorm.
- **Editor-mode interactions** (drag-to-link, bulk edit, in-graph rename, spawn-here): separate brainstorm.
- **Sitemap and Timeline lens implementations**: the architecture supports them, but they ship as separate work.
- **Multi-taxonomy overlay** (visualizing two taxonomies' clustering simultaneously as nested cluster regions): explicitly considered and rejected for v1 due to visual-noise risk.
- **Auto-detect-by-post-type clustering** (different content types clustered by different keys in one mixed galaxy): explicitly considered and rejected for conceptual heterogeneity.
- **Site Audit overlays** (orphans, broken links, stale content): direction A in the brainstorm; separate effort.
- **Scale and performance work for huge graphs** (streaming load, level-of-detail rendering, mini-map): current Content Graph performance baseline applies. Optimizing for sites above the existing comfort range (the `ForceSim` comments cite roughly 500 nodes for the current O(n²) repulsion loop) is out of scope. Galaxy must not regress on the sites Constellation handles today.

---

## Key Decisions

- **Galaxy uses force-driven clusters, not strict polar coordinates.** Rejected rings-and-sectors, sun-and-planets, and sunburst alternatives. Rationale: galaxy of clusters extends the existing `ForceSim` rather than introducing a new geometric engine, and "multi-term posts pulled between clusters" is uniquely natural in a force model.
- **One taxonomy at a time, configurable.** Rejected hard-coded categories-only and rejected multi-taxonomy overlay. Rationale: configurable hits CPTs with custom taxonomies without inventing per-CPT logic; one-at-a-time keeps the visual interpretable.
- **Bridge highlighting is the default edge story in Galaxy.** Rejected "all edges equal weight" and "hide edges entirely." Rationale: clustered layouts make intra-vs-inter distinction inherently meaningful; faded intra ink lets the cross-cluster signal carry.
- **Lens switcher is a real architecture from day one, not a toggle.** Rejected single-toggle ("cluster on/off") and rejected multi-window ("each lens its own window"). Rationale: a single toggle wouldn't pay back when adding Sitemap or Timeline; multi-window fragments the experience and loses the "switch and compare" affordance.
- **Block references deferred, not absorbed into v1.** Rationale: the SQL-cheap edges (the other four) cost roughly the same as the existing hyperlink edges in build time; block parsing is its own engineering project with its own caching, invalidation, and edge-case story (Cover, Featured Image, post-loop, reusable, embed). It earns a focused follow-up.
- **Cluster centroids drift with their cluster's center of mass.** Rejected fixed-position centroids on a precomputed lattice. Rationale: drifting centroids let the layout breathe as the user toggles edge types or post-type chips, and avoid the "robot" feel of a hand-placed grid.
- **Empty terms hidden by default with no v1 UI to reveal them.** Rationale: a 50-term taxonomy with 12 used terms produces 38 invisible centroids if shown; the visual cost outweighs the once-in-a-while value of seeing them. A "show empty" toggle can land in a follow-up if real users ask.

---

## Dependencies / Assumptions

- The existing `ForceSim` (`src/content-graph/sim.ts`) supports adding per-cluster centroid attractor forces as an extension. The current sim has three forces (repulsion, spring, gravity); adding a fourth attractor force toward each node's term centroid is the same shape of code, not a rewrite.
- The REST endpoints under `desktop-mode/v1/content-graph/` are the right place to extend with new edge types and a `taxonomy` query parameter. The same caching model (transient keyed on participating rows' `post_modified_gmt` plus query parameters) extends naturally.
- Pixi `Container` reuse across lens switches is feasible without remounting the `Application`. Same `world` container; different per-lens force configuration.
- Per-user persistence has a natural home in existing user-meta or per-window persistence surfaces already used elsewhere in Desktop Mode. No new persistence primitive should be required.
- The existing `<wpd-*>` component kit covers most of the needed UI (segmented control, dropdown, toggle chips). Whether each specific control already exists is a planning-tier check against `src/ui/components/index.ts`.

---

## Outstanding Questions

### Resolve Before Planning

(None. All scope-shaping decisions are locked.)

### Deferred to Planning

- [Affects R10][Technical] How are co-tag, co-author, hierarchy, and menu edge sets queried efficiently? Co-tag in particular implies a self-join on `wp_term_relationships` filtered to non-clustering taxonomies; on large sites this needs the cache strategy to keep up.
- [Affects R5, R6][Technical] What attractor strength and cluster-spacing produces a visually pleasing Galaxy on a typical 200-node site, a sparse 30-node site, and a dense 500-node site without per-site tuning? Likely an empirical pass during implementation.
- [Affects R3][Technical] What's the cleanest way to swap the active force configuration on a live `ForceSim` so the lens transition feels graceful rather than thrashed? Options: re-create the sim, mutate force coefficients in place, or run a transition phase. Decide during planning.
- [Affects R11][Needs research] Is there a `<wpd-*>` component already suitable for the edges multi-toggle (chips with on/off plus a color swatch), or does this warrant a small new component? Check `src/ui/components/index.ts` during planning per the project's component-first rule.
- [Affects R14][Technical] Per-user persistence: existing user-meta key namespace conventions in this plugin are already established; the planning pass should grep current usage and reuse the convention rather than invent a new one.
- [Affects R10][Technical] Menu-structure edges: nav menus point at multiple target types (post, term, custom URL). Edge generation should resolve only menu items whose target is a post in scope, but the precise filter belongs in planning when querying `wp_get_nav_menu_items` (or equivalent) is implemented.
