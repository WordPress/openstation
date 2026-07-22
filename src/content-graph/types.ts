/**
 * Content Graph — shared types.
 *
 * The shapes here mirror what `includes/content-graph/` ships from
 * the REST endpoints — REST is the single source of truth, the JS
 * side just types the wire payloads.
 *
 * @public
 * @since 0.8.2
 */

export interface PostTypeDescriptor {
	slug: string;
	label: string;
	icon: string;
	count: number;
	taxonomies: {
		category: boolean;
		post_tag: boolean;
	};
}

export interface GraphNodePayload {
	id: number;
	type: string;
	title: string;
	status: string;
	slug: string;
	edit_url: string;
	/**
	 * Grouping facets. Always present on every node so the client never
	 * has to null-check. `author_id` is `0` for posts authored by a
	 * deleted user; `year` is `0` when `post_date` is unavailable
	 * (effectively never, but defensively typed).
	 */
	author_id: number;
	/**
	 * Distinct revision authors for the post, excluding the primary
	 * `author_id`. When grouping by author, the cluster-attractor
	 * force uses these to pull collaborator posts toward each
	 * contributor's centroid (the primary author is weighted more
	 * heavily so the post still lands closer to them).
	 */
	contributor_ids: number[];
	year: number;
	/**
	 * `'YYYY-MM'` derived server-side from `post_date`. Empty string
	 * when the post has no usable date (defensive — every WP post has
	 * one, but the field is typed as required so callers don't have
	 * to optional-chain).
	 */
	year_month: string;
	category_ids: number[];
	tag_ids: number[];
}

export interface GraphEdgePayload {
	from: number;
	to: number;
}

/**
 * Compact catalog of group labels referenced by at least one node in
 * the payload. Keyed by id (string-coerced from int by JSON). Only
 * entries actually referenced by a visible node are emitted — keeps
 * the payload tight on sites with many unused authors / terms.
 */
export interface GraphGroupCatalogs {
	authors: Record< number, { name: string } >;
	categories: Record< number, { name: string } >;
	tags: Record< number, { name: string } >;
}

export interface GraphPayload {
	nodes: GraphNodePayload[];
	edges: GraphEdgePayload[];
	groups: GraphGroupCatalogs;
	stats: {
		nodes: number;
		edges: number;
		generated_at: number;
	};
}

/**
 * Which facet the group-by selector is currently clustering on. `null`
 * means no clustering — the layout is the existing constellation.
 */
export type GroupFacet =
	| 'category'
	| 'tag'
	| 'author'
	| 'year'
	| 'year_month';

export interface UserRef {
	id: number;
	name: string;
	slug: string;
	avatar: string;
	edit_url: string;
}

export interface CommentRef {
	id: number;
	author: string;
	user_id: number;
	date: string;
	excerpt: string;
	edit_url: string;
}

export interface TermRef {
	id: number;
	name: string;
	slug: string;
	taxonomy: string;
	tax_label: string;
	count: number;
	edit_url: string;
}

export interface MediaRef {
	id: number;
	title: string;
	mime: string;
	thumb: string;
	edit_url: string;
}

export interface RevisionRef {
	id: number;
	date: string;
	author: UserRef | null;
	edit_url: string;
}

export interface PostDetail {
	post: {
		id: number;
		type: string;
		title: string;
		status: string;
		slug: string;
		edit_url: string;
		view_url: string;
		date: string;
		modified: string;
	};
	author: UserRef | null;
	contributors: UserRef[];
	comments: CommentRef[];
	categories: TermRef[];
	attached_media: MediaRef[];
	revisions: RevisionRef[];
}

export interface UserStats {
	profile: {
		id: number;
		name: string;
		description: string;
		link: string;
		website: string;
		avatarUrl: string;
		email?: string;
		username?: string;
		registered?: string;
		roles?: string[];
		roleLabels?: string[];
	};
	counts: {
		posts: { publish: number; total: number };
		pages: { publish: number; total: number };
		commentsReceived: number;
		commentsLeft: number;
		cpt: number;
	};
	recent: Array< {
		id: number;
		title: string;
		date: string;
		status: string;
		type: string;
		link: string;
	} >;
	topTerms: Array< {
		id: number;
		name: string;
		slug: string;
		taxonomy: string;
		count: number;
	} >;
	activity: Array< { ym: string; count: number } >;
	milestones: {
		firstPublished: string | null;
		lastPublished: string | null;
	};
}

export interface TermStats {
	profile: {
		id: number;
		name: string;
		slug: string;
		taxonomy: string;
		taxonomyLabel: string;
		description: string;
		link: string;
		parent: number;
		parentName?: string;
		storedCount: number;
	};
	counts: {
		posts: { publish: number; total: number };
		commentsReceived: number;
		distinctAuthors: number;
	};
	topAuthors: Array< {
		userId: number;
		userName: string;
		userAvatarUrl: string;
		count: number;
	} >;
	coTerms: Array< {
		id: number;
		name: string;
		slug: string;
		count: number;
	} >;
	activity: Array< { ym: string; count: number } >;
	milestones: {
		firstPosted: string | null;
		lastPosted: string | null;
	};
}

export interface CommentStats {
	comment: {
		id: number;
		parent: number;
		date: string;
		status: string;
		rendered: string;
		rendered_raw: string;
		editLink: string;
	};
	author: {
		name: string;
		url: string;
		avatarUrl: string;
		userId: number;
		displayName?: string;
		profileLink?: string;
		totalApprovedComments: number;
	};
	post: {
		id: number;
		title: string;
		link: string;
		editLink: string;
		status: string;
		type: string;
		date: string;
		author: { id: number; name: string; avatarUrl: string } | null;
	} | null;
	parent: {
		id: number;
		authorName: string;
		date: string;
		excerpt: string;
	} | null;
	replies: Array< {
		id: number;
		authorName: string;
		avatarUrl: string;
		date: string;
		excerpt: string;
		status: string;
	} >;
}

export interface ContentGraphConfig {
	restRoot: string;
	restNonce: string;
	apiBase: string;
	editPostUrl: string;
	editTermUrl: string;
	editUserUrl: string;
	editCommentUrl: string;
	mediaUrl: string;
	postTypes: PostTypeDescriptor[];
}

/**
 * Live in-memory node — the REST payload plus simulation state.
 * The grouping facets (`author_id`, `year`, `category_ids`,
 * `tag_ids`) come along for free via the `GraphNodePayload` extension
 * and are read directly by `GraphScene.setGrouping()` to derive each
 * node's group keys.
 */
export interface GraphNode extends GraphNodePayload {
	x: number;
	y: number;
	vx: number;
	vy: number;
	pinned: boolean;
	radius: number;
	color: number;
	degree: number;
}

export interface GraphEdge {
	from: GraphNode;
	to: GraphNode;
}
