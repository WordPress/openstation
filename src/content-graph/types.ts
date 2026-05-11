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
}

/**
 * Lens identifiers the front end recognises. Mirrors the PHP
 * `DESKTOP_MODE_CONTENT_GRAPH_LENSES` constant.
 *
 * @since 0.9.0
 */
export type LensId = 'constellation' | 'galaxy';

/**
 * Discriminated union of edge kinds the wire protocol can carry.
 * `link` is the legacy hyperlink edge from `<a href>` extraction; the
 * other four arrived in 0.9.0 with the multi-lens work.
 *
 * @since 0.9.0
 */
export type EdgeKind =
	| 'link'
	| 'co_tag'
	| 'co_author'
	| 'hierarchy'
	| 'menu';

export interface GraphNodePayload {
	id: number;
	type: string;
	title: string;
	status: string;
	slug: string;
	edit_url: string;
	/**
	 * Per-taxonomy term-id memberships scoped to whatever taxonomies
	 * the request asked about (the Galaxy clustering taxonomy plus
	 * any others required by the requested edge kinds, e.g., co-tag
	 * pulls in all non-clustering public taxonomies).
	 *
	 * The map is always present on every node. Nodes with no in-scope
	 * memberships carry an empty object so consumers do not have to
	 * branch on undefined.
	 *
	 * @since 0.9.0
	 */
	terms: Record< string, number[] >;
}

export interface GraphEdgePayload {
	from: number;
	to: number;
	/**
	 * Edge kind tag. Existing hyperlink edges carry `'link'`. Added
	 * 0.9.0 with the multi-lens work; the server always emits this
	 * field on every edge.
	 *
	 * @since 0.9.0
	 */
	kind: EdgeKind;
}

/**
 * Descriptor for one public taxonomy eligible to drive Galaxy
 * clustering. Mirrors the PHP `desktop_mode_content_graph_taxonomies`
 * server output.
 *
 * @since 0.9.0
 */
export interface TaxonomyDescriptor {
	slug: string;
	label: string;
	hierarchical: boolean;
	post_types: string[];
}

/**
 * Descriptor for one edge kind offered to the toolbar's edges
 * multi-toggle. Mirrors the PHP
 * `desktop_mode_content_graph_edge_kind_descriptors` server output.
 *
 * @since 0.9.0
 */
export interface EdgeKindDescriptor {
	slug: EdgeKind;
	label: string;
	color: string;
	weight: number;
}

/**
 * Per-user preferences mirror of the PHP
 * `desktop_mode_content_graph_default_prefs()` shape. The server is
 * the source of truth; this type just describes what the wire
 * carries.
 *
 * @since 0.9.0
 */
export interface ContentGraphPrefs {
	lens: LensId;
	byLens: {
		constellation: {
			types: string[];
			edges: EdgeKind[];
		};
		galaxy: {
			types: string[];
			edges: EdgeKind[];
			taxonomy: string;
		};
	};
}

export interface GraphPayload {
	nodes: GraphNodePayload[];
	edges: GraphEdgePayload[];
	stats: {
		nodes: number;
		edges: number;
		generated_at: number;
	};
}

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
	/** Public taxonomies offered as Galaxy clustering keys. @since 0.9.0 */
	taxonomies: TaxonomyDescriptor[];
	/** Edge-kind catalog offered to the toolbar's edges multi-toggle. @since 0.9.0 */
	edgeKinds: EdgeKindDescriptor[];
	/** Initial per-user prefs hydrated server-side to skip a first-paint round-trip. @since 0.9.0 */
	prefs: ContentGraphPrefs;
}

/**
 * Live in-memory node — the REST payload plus simulation state.
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
	/** Edge kind, carried through from the wire payload. @since 0.9.0 */
	kind: EdgeKind;
}
