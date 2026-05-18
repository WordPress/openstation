/**
 * My WordPress — type contracts.
 *
 * @public
 * @since 0.8.0
 */

/**
 * Built-in entity render kinds. Plugins can register additional
 * kinds via `wp.desktop.myWordpress.registerEntityKind(...)` —
 * any non-empty string is accepted at runtime, this union just
 * documents the in-tree set.
 *
 * @public
 */
/**
 * Plugin-defined kinds register at runtime via
 * `wp.desktop.myWordpress.registerEntityKind()` — the type stays
 * `string` so the union accepts arbitrary slugs without sacrificing
 * IDE autocomplete on the in-tree set.
 */
export type EntityKind = 'post' | 'user' | 'media' | 'agents' | string;

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
	/**
	 * Per-page count for the Media grid. Media tiles are denser than
	 * post tiles, so the default (`48`) is higher than the post
	 * default. Filterable server-side via `desktop_mode_my_wordpress_window_args`.
	 *
	 * @since 0.21.0
	 */
	mediaPerPage?: number;
	/**
	 * Server-declared preview-action descriptors collected via
	 * `desktop_mode_my_wordpress_preview_actions`. Already capability-
	 * gated — never present here unless the current user can run
	 * the action.
	 *
	 * @since 0.21.0
	 */
	previewActions?: MediaPreviewAction[];
}

/**
 * Server-declared descriptor for a right-pane action button.
 * Plugins push these via `desktop_mode_my_wordpress_preview_actions`
 * (PHP) and complete the JS handler via the
 * `desktop-mode.my-wordpress.preview-actions` filter.
 *
 * @public
 * @since 0.21.0
 */
export interface MediaPreviewAction {
	id: string;
	label: string;
	icon?: string;
	/** PCRE — server-checked before shipping; client re-checks per item. */
	mime?: string;
	/** Section ids this action is visible in. Default: all. */
	sections?: string[];
	/** Optional `wp_register_script` handle the server enqueues. */
	script?: string;
	/**
	 * Optional JS handler — wired by the
	 * `desktop-mode.my-wordpress.preview-actions` JS filter, never
	 * by the server descriptor.
	 */
	onSelect?: ( ctx: MediaPreviewActionContext ) => void | Promise< void >;
	/**
	 * Optional visibility predicate evaluated client-side after the
	 * server-side `capability` / `mime` checks have already passed.
	 */
	isVisible?: ( ctx: MediaPreviewActionContext ) => boolean;
}

/**
 * Slot identifier for plugin-injected DOM in the right pane.
 *
 * - `header` — above the rendered media / metadata table
 * - `meta`   — interleaved with the metadata grid
 * - `footer` — below the action button row
 *
 * @public
 * @since 0.21.0
 */
export type MediaPreviewSlot = 'header' | 'meta' | 'footer';

/**
 * Context object passed to every preview-action handler.
 *
 * @public
 * @since 0.21.0
 */
export interface MediaPreviewActionContext {
	/** Entity id (`'media'`, `'posts'`, `'users'`, …). */
	entityId: string;
	/** Section render-kind (`'media'`, `'post'`, `'user'`, …). */
	kind: string;
	/** MIME type for media items, undefined for non-media kinds. */
	mime?: string;
	/** The full server item record. */
	item: Record< string, unknown >;
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
	/**
	 * Publication status — `'publish' | 'draft' | 'pending' |
	 * 'private' | 'future' | 'trash'`. Surfaced on the list response
	 * since 0.21.0 so tiles can paint a status ribbon for non-
	 * published rows.
	 */
	status?: string;
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
	/**
	 * Authoritative list of attachment ids referenced by this post —
	 * featured image + every attachment found in `post_content`
	 * (class scan + raw `<img src>` URL resolution). Computed
	 * server-side by the `desktop_mode_attached_media` REST field;
	 * the regex-based `extractContentMediaIds` is a fallback for
	 * older API responses that don't carry this.
	 *
	 * @since 0.21.0
	 */
	desktop_mode_attached_media?: number[];
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
		/**
		 * Revisions saved by the user that day, excluding the initial
		 * save of brand-new posts (those count under `posts`). Added
		 * in 0.8.7 so the heatmap registers update activity, not just
		 * publications and comments.
		 */
		updates: number;
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
		/** `'post-update'` rows are most-recent-save-per-parent rollups (since 0.8.7). */
		kind: 'post' | 'comment' | 'post-update';
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
		/** Lifetime revision count, excluding the initial save. Since 0.8.7. */
		updates: number;
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
	}
	| {
			kind: 'media-detail';
			entityId: string;
			mediaId: number;
			mediaTitle: string;
	};

/**
 * Single-row payload returned by `/wp/v2/media`. Trimmed to the
 * fields the My WordPress media grid + preview pane consume.
 *
 * @public
 * @since 0.21.0
 */
export interface MediaListItem {
	id: number;
	title: { rendered: string };
	date: string;
	mime_type: string;
	source_url: string;
	alt_text?: string;
	caption?: { rendered: string };
	description?: { rendered: string };
	author?: number;
	media_details?: {
		width?: number;
		height?: number;
		filesize?: number;
		file?: string;
		sizes?: Record< string, { source_url: string; width?: number; height?: number } | undefined >;
	};
	_embedded?: {
		author?: Array< {
			id: number;
			name: string;
			avatar_urls?: Record< string, string >;
		} >;
	};
	[ key: string ]: unknown;
}

export interface MediaListResult {
	items: MediaListItem[];
	total: number;
	totalPages: number;
}

/**
 * Per-attachment "used in" payload returned by
 * `/desktop-mode/v1/media-usage/<id>`.
 *
 * @public
 * @since 0.21.0
 */
export interface MediaUsage {
	media: {
		id: number;
		title: string;
		mime: string;
		sourceUrl: string;
		filename: string;
		date: string;
		author: { id: number; name: string };
	};
	usedIn: Array< {
		postId: number;
		postType: string;
		postTypeLabel: string;
		title: string;
		status: string;
		link: string;
		editLink: string;
		usedAs: 'featured' | 'content' | 'meta';
		authorId: number;
		authorName: string;
		date: string;
	} >;
}
