/**
 * The Living Tree — shared types.
 *
 * The typed contract between the layers described in
 * `docs/living-tree-algorithm.md`. WordPress emits a {@link TreeSnapshot}
 * (raw metrics + compact DNA); {@link Hormones} is the only crossing into
 * the growth simulator; {@link Envelope} + {@link BranchNode} are the
 * morphology layer; {@link LeafDNA} feeds the decoration layer.
 *
 * @since 0.9.4
 */

/** A 2D vector / point. */
export interface Vec2 {
	x: number;
	y: number;
}

/**
 * Compact structural hint for one branch region, carried in the
 * snapshot's `branches` array. This is DNA, not geometry — the simulator
 * may use it to bias growth, but never as a coordinate.
 */
export interface BranchDNA {
	/** Nominal depth (level) this branch region sits at. */
	depth: number;
	/** Relative girth hint, 0..1. */
	girth: number;
	/** Relative length hint, 0..1. */
	length: number;
}

/**
 * Compact descriptor for a single leaf's appearance. Derived from post
 * aggregates, never a full post row.
 */
export interface LeafDNA {
	/** Hue (0..360) — the site's canopy green with natural variation. */
	hue: number;
	/** Vitality, 0..1 — from `health01` / SEO. Drives green→yellow→red→grey. */
	health01: number;
	/** Age of the represented content in days — old posts curl / desaturate. */
	ageDays: number;
	/** View count for the cluster — drives leaf size via `log( visits )`. */
	visits: number;
}

/**
 * Raw metrics + compact DNA returned by
 * `GET desktop-mode/v1/living-tree/snapshot`. Aggregates only — never the
 * full post list. The client turns this into {@link Hormones} and never
 * sees individual rows.
 */
export interface TreeSnapshot {
	/** Site URL — part of the determinism seed. */
	siteUrl: string;
	/**
	 * Site (blog) name — part of the determinism seed, so two blogs that
	 * share a URL shape (localhost installs, staging clones) still grow
	 * distinct individuals.
	 */
	siteName: string;
	/** Install epoch (unix seconds) — the rest of the seed. */
	installEpoch: number;
	/** Days since the site's oldest content / admin registration. */
	siteAgeDays: number;
	totalPosts: number;
	totalPages: number;
	totalCategories: number;
	totalTags: number;
	totalComments: number;
	/** Users currently online (from framework presence). */
	activeUsers: number;
	/** Recent traffic signal (e.g. 14-day view sum). */
	traffic: number;
	/** SEO / site-health score, 0..1. */
	seoHealth: number;
	/** Performance headroom, 0..1 (1 = plenty, 0 = under load). */
	performance: number;
	/** Compact per-region structural hints. */
	branches: BranchDNA[];
}

/**
 * The DNA — the only crossing point from WordPress into the simulator.
 * All normalised 0..1 except {@link Hormones.spark}. See
 * `docs/living-tree-algorithm.md` §A.3.
 */
export interface Hormones {
	/** Master clock — height, girth, maxDepth, envelope size. */
	age01: number;
	/** Growth speed + branching density. */
	vigor01: number;
	/** Canopy fill. */
	foliage01: number;
	/** Leaf colour temperature / vitality. */
	health01: number;
	/** Fraction of leaves that flower. */
	bloom01: number;
	/** Wind amplitude / frequency. */
	wind01: number;
	/**
	 * Structural mass from evergreen content (pages). Thickens the trunk
	 * and boughs at decoration time — a site with a solid page structure
	 * reads as heavier timber. Does NOT move any node (topology stays
	 * age+seed-invariant).
	 */
	structure01: number;
	/**
	 * Canopy vitality from site performance. Drives leaf turgor —
	 * fullness + brightness of the foliage. A fast, healthy site is lush
	 * and vivid; a struggling one thins and dims. Distinct from
	 * `health01` (SEO), which drives colour temperature.
	 */
	vitality01: number;
	/** Firefly count (integer). */
	spark: number;
}

/**
 * The morphological envelope — the silhouette the crown may fill plus the
 * age-derived structural ceiling. Depends on age + vigour ONLY (never on
 * post / term counts): this is what makes topology invariant across
 * wildly different content shapes. See §A.4.
 */
export interface Envelope {
	/** Overall tree height (Hmax), in layout units. */
	heightMax: number;
	/** Half-width of the canopy. */
	crownRadius: number;
	/** Base trunk thickness, scaled by `age01`. */
	trunkBaseGirth: number;
	/** Maximum branching levels (see the age table in §A.4). */
	maxDepth: number;
	/** Number of auxin attractors to scatter inside the envelope. */
	attractorBudget: number;
}

/**
 * One node of the growing skeleton. Produced by the
 * {@link Vec2}-space colonization simulator.
 */
export interface BranchNode {
	/** Index of this node in the simulator's `nodes` array. */
	id: number;
	/** Position in layout space. */
	pos: Vec2;
	/** Parent node index, or `null` for the root. */
	parent: number | null;
	/** Branching level (0 = root). */
	depth: number;
	/** Girth radius, filled by {@link computeGirth}. */
	radius: number;
	/** Wind compliance, 0 at the root → 1 at the tips. */
	compliance: number;
	/** Unit growth direction that spawned this node. */
	direction: Vec2;
}

/**
 * Tuning constants for the space-colonization step. Derived from the
 * hormones + envelope; never carries content identity.
 */
export interface GrowthConfig {
	/** Length of each new segment. */
	segLen: number;
	/** Influence radius `di` — attractors beyond this ignore a node. */
	influenceRadius: number;
	/** Kill radius `dk` — attractors within this of any node are removed. */
	killRadius: number;
	/** PRNG jitter magnitude applied to each new direction. */
	jitter: number;
	/** Upward tropism weight (drives bottom→top growth). */
	tropism: number;
	/** Gravity droop applied at the tips. */
	droop: number;
	/** Hard cap on total nodes (age-derived). */
	maxNodes: number;
	/** Nodes added per frame (from `vigor01`). */
	growthRate: number;
}

/**
 * Handle returned by {@link mountScene}. Mirrors the animated-logo
 * wallpaper's `SceneHandle` so the shell's wallpaper lifecycle drives
 * both identically.
 */
export interface SceneHandle {
	/** Stop the render loop and release WebGL resources. */
	destroy(): void;
	/** Pause / resume animation (wallpaper hidden, tab backgrounded). */
	setAnimating( playing: boolean ): void;
}
