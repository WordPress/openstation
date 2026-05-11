/**
 * My WordPress — type contracts.
 *
 * @public
 * @since 0.8.0
 */

export type EntityKind = 'post' | 'user';

export interface MyWordPressEntity {
	id: string;
	label: string;
	icon: string;
	restPath: string;
	/**
	 * Render strategy for this entity. `'post'` (default for back-
	 * compat) renders title/excerpt/featured-image tiles and the
	 * rendered-HTML preview. `'user'` renders an avatar + display-
	 * name tile and routes to the user dossier preview.
	 */
	kind?: EntityKind;
}

export interface MyWordPressConfig {
	restRoot: string;
	restNonce: string;
	editPostUrlBase: string;
	/**
	 * Admin URL base for `user-edit.php` — fallback when the
	 * native user-edit window isn't registered.
	 */
	editUserUrlBase?: string;
	entities: MyWordPressEntity[];
	perPage: number;
}

export interface EntityLock {
	userId: number;
	userName: string;
	userAvatarUrl: string;
	/** ISO-8601 timestamp of the lock heartbeat. Empty string when unknown. */
	time: string;
}

export interface EntityListItem {
	id: number;
	title: { rendered: string };
	excerpt?: { rendered: string };
	date: string;
	featured_media?: number;
	link?: string;
	desktop_mode_lock?: EntityLock | null;
	_embedded?: {
		'wp:featuredmedia'?: Array< {
			id: number;
			source_url: string;
			alt_text?: string;
			media_details?: {
				sizes?: Record< string, { source_url: string } | undefined >;
			};
		} >;
	};
	[ key: string ]: unknown;
}

export interface EntityDetail {
	id: number;
	title: { rendered: string };
	content: { rendered: string; protected?: boolean };
	excerpt?: { rendered: string };
	date: string;
	modified?: string;
	status?: string;
	link?: string;
	author?: number;
	featured_media?: number;
	categories?: number[];
	tags?: number[];
	comment_status?: string;
	desktop_mode_contributors?: ContributorRef[];
	_links?: Record< string, Array< { href: string; count?: number } > >;
	_embedded?: EntityListItem[ '_embedded' ] & {
		author?: Array< {
			id: number;
			name: string;
			link?: string;
			avatar_urls?: Record< string, string >;
		} >;
		'wp:term'?: Array<
			Array< {
				id: number;
				name: string;
				slug: string;
				taxonomy: string;
				link?: string;
			} >
		>;
		replies?: Array< Array< { id: number; href?: string } > >;
	};
}

export interface ListResult {
	items: EntityListItem[];
	total: number;
	totalPages: number;
}

/**
 * Compact user row returned by `/wp/v2/users` plus the
 * `desktop_mode_summary` REST field — enough to paint a rich
 * tile without an extra round-trip per row.
 *
 * @since 0.20.0
 */
export interface UserListItem {
	id: number;
	name: string;
	slug?: string;
	description?: string;
	link?: string;
	avatar_urls?: Record< string, string >;
	desktop_mode_summary?: {
		postCount: number;
		roleLabels: string[];
		registered: string;
		lastActive: string;
	};
	[ key: string ]: unknown;
}

export interface UserListResult {
	items: UserListItem[];
	total: number;
	totalPages: number;
}

/**
 * Per-user activity footprint payload returned by
 * `/desktop-mode/v1/user-footprint/<id>`. Drives the right-click
 * "View activity footprint" surface.
 *
 * @since 0.20.0
 */
export interface UserFootprint {
	profile: {
		id: number;
		name: string;
		avatarUrl: string;
		link: string;
		roleLabels?: string[];
		registered?: string;
	};
	range: {
		/** YYYY-MM-DD, inclusive. */
		from: string;
		/** YYYY-MM-DD, inclusive. */
		to: string;
		/** Count of day buckets (length of `daily`). */
		days: number;
	};
	daily: Array< {
		/** YYYY-MM-DD. */
		date: string;
		posts: number;
		comments: number;
	} >;
	/** Sunday-indexed weekday distribution; length 7. */
	weekday: number[];
	/** Hour-of-day distribution in site timezone; length 24. */
	hour: number[];
	streak: {
		longest: number;
		current: number;
		longestRange: { from: string; to: string };
	};
	timeline: Array< {
		kind: 'post' | 'comment';
		date: string;
		title: string;
		link: string;
		status: string;
		postId?: number;
		type?: string;
	} >;
	totals: {
		posts: number;
		pages: number;
		comments: number;
		mostProlificMonth?: { ym: string; n: number };
	};
}

/** Sub-relation drilled into from a post detail view. */
export type SubRelation =
	| 'author'
	| 'contributors'
	| 'comments'
	| 'categories'
	| 'tags'
	| 'media'
	| 'revisions';

/**
 * Compact user shape returned by the `desktop_mode_contributors`
 * REST field. Enough to paint a tile + tooltip without an extra
 * `/wp/v2/users/<id>` round-trip per row.
 *
 * @since 0.8.0
 */
export interface ContributorRef {
	userId: number;
	userName: string;
	userAvatarUrl: string;
}

export interface RelatedSummary {
	authorId: number | null;
	authorName: string;
	commentCount: number;
	categoryIds: number[];
	tagIds: number[];
	featuredMediaId: number | null;
	featuredMediaUrl: string;
	revisionsHref: string | null;
}

export type Route =
	| { kind: 'root' }
	| { kind: 'list'; entityId: string }
	| {
			kind: 'detail';
			entityId: string;
			postId: number;
			postTitle: string;
	}
	| {
			kind: 'sub-list';
			entityId: string;
			postId: number;
			postTitle: string;
			relation: SubRelation;
	}
	| {
			kind: 'user-footprint';
			entityId: string;
			userId: number;
			userName: string;
	};
