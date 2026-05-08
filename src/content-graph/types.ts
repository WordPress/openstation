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

export interface GraphNodePayload {
	id: number;
	type: string;
	title: string;
	status: string;
	slug: string;
	edit_url: string;
}

export interface GraphEdgePayload {
	from: number;
	to: number;
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
