/**
 * My WordPress — type contracts.
 *
 * @public
 */

/**
 * Built-in entity render kinds. Plugins can register additional
 * kinds via `wp.os.myWordpress.registerEntityKind(...)` —
 * any non-empty string is accepted at runtime, this union just
 * documents the in-tree set.
 *
 * @public
 */
/**
 * Plugin-defined kinds register at runtime via
 * `wp.os.myWordpress.registerEntityKind()` — the type stays
 * `string` so the union accepts arbitrary slugs without sacrificing
 * IDE autocomplete on the in-tree set.
 */
export type EntityKind = 'post' | 'user' | 'media' | string;

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
	/**
	 * Whether this entity's REST route is actually registered.
	 *
	 * An entity can be listed while its feature is switched off — the
	 * Agents section ships regardless so it can render its own
	 * "disabled" preview and explain how to turn it on. Its route,
	 * however, only registers when the feature is enabled, so probing
	 * it 404s. Absent means enabled, so an entity that never opts out
	 * behaves exactly as before.
	 */
	enabled?: boolean;
	/**
	 * Canonical slug for cross-window broadcast events (e.g., 'post', 'page').
	 * The bundle prefixes 'os.' and suffixes '.changed' for subscriptions.
	 */
	post_type?: string;
	/**
	 * Whether tiles in this section show the entity's featured image
	 * in place of the section icon. Defaults to on — set false to keep
	 * a uniform icon grid.
	 */
	thumbnails?: boolean;
	/**
	 * Tile size for this section's list view.
	 *
	 * `'large'` roughly doubles the icon well, for sections whose rows
	 * carry a photograph worth looking at — a shop's products read as
	 * a catalogue rather than a file list, and a corner ribbon has
	 * room to be a corner flash instead of covering the subject.
	 * Defaults to `'regular'`.
	 */
	tileSize?: 'regular' | 'large';
	/**
	 * Extra REST fields to request for this section's list rows,
	 * appended to the `_fields` the window always asks for.
	 *
	 * The window sends an explicit `_fields` list, so a custom key a
	 * section's endpoint returns would otherwise be filtered out of
	 * the response before it reached the bundle. Declare it here to
	 * keep it — the WooCommerce Orders section uses this to carry the
	 * order status its tiles are banded by.
	 */
	listFields?: string[];
	/**
	 * Extra query parameters sent with this section's list requests.
	 *
	 * Lets a section mark its own requests so server-side query
	 * filters can scope themselves to the site window instead of
	 * rewriting every REST caller's query. The WooCommerce sections
	 * use it to opt into band ordering, which must not leak into a
	 * storefront block's `wp/v2/product` request.
	 */
	listQuery?: Record< string, string >;
	/**
	 * Who edits this section's rows.
	 *
	 * Omitted: the classic editor — "Open in editor" builds
	 * `post.php?post=<id>&action=edit` (a row-supplied `editUrl`
	 * field wins when present).
	 *
	 * A **string** names a preview action (declared via
	 * `openstation_my_wordpress_preview_actions`, so it stays
	 * capability-gated and its script auto-enqueues) that REPLACES
	 * "Open in editor" everywhere the section offers editing: the
	 * pane's primary button, the tile context menu's open entry (and
	 * its bulk fan-out), and tile double-click. The action is removed
	 * from the generic action row/menu so it doesn't render twice.
	 * If the named action didn't ship (capability) or no JS wired its
	 * `onSelect`, the edit affordances hide — for a type with no
	 * editor screen the classic URL is known-broken, and a button
	 * that 404s is worse than no button.
	 *
	 * **`false`** removes every edit affordance: no editor button, no
	 * open entry, double-click falls back to the detail dossier, and
	 * the bulk "Edit…" modal is suppressed too.
	 */
	editAction?: string | false;
	/**
	 * Folder this section nests under at the root of the window.
	 * Sections registered by the same plugin or theme share a group
	 * id, so they render as one folder that drills into its members.
	 * Null / omitted renders the section loose at the root.
	 */
	group?: string | null;
	/** Folder label. Falls back to the group id. */
	groupLabel?: string | null;
	/** Folder icon — dashicon class, URL, or data URI. */
	groupIcon?: string | null;
	/** Sort weight among folders. Lower sorts first. */
	groupOrder?: number | null;
}

/**
 * Root-level folder grouping sections by the plugin or theme that
 * registered them. Shipped from PHP via
 * `openstation_my_wordpress_post_type_groups`; the bundle falls back
 * to deriving groups from the entity list when absent.
 *
 * @public
 */
export interface MyWordPressGroup {
	id: string;
	label: string;
	icon: string;
	order: number;
}

export interface MyWordPressConfig {
	restRoot: string;
	restNonce: string;
	/**
	 * The site's own name, used as the window title and the
	 * breadcrumb root. Sourced from `openstation_site_title()`
	 * server-side, so it already honours the
	 * `openstation_site_title` filter and is entity-decoded.
	 */
	siteName?: string;
	editPostUrlBase: string;
	/**
	 * Admin URL base for `user-edit.php` — fallback when the
	 * native user-edit window isn't registered.
	 */
	editUserUrlBase?: string;
	/**
	 * Core's Add User screen (`user-new.php`), opened as a window from
	 * the Users section. On multisite this is the invite flow — Add
	 * Existing User, confirmation emails, the network's Add Users
	 * setting — so the window surfaces Core's screen rather than
	 * re-implementing it.
	 */
	newUserUrl?: string;
	/**
	 * Whether the viewer may open it: Core's own menu gate —
	 * `create_users`, or `promote_users` on multisite.
	 */
	canCreateUsers?: boolean;
	entities: MyWordPressEntity[];
	/**
	 * Ordered root-level folders. Derived from the entity list when
	 * the server doesn't ship it.
	 */
	groups?: MyWordPressGroup[];
	perPage: number;
	/**
	 * Per-page count for the Media grid. Media tiles are denser than
	 * post tiles, so the default (`48`) is higher than the post
	 * default. Filterable server-side via `openstation_my_wordpress_window_args`.
	 */
	mediaPerPage?: number;
	/**
	 * Server-declared preview-action descriptors collected via
	 * `openstation_my_wordpress_preview_actions`. Already capability-
	 * gated — never present here unless the current user can run
	 * the action.
	 */
	previewActions?: PreviewAction[];
}

/**
 * Server-declared descriptor for a preview action — a button in the
 * right pane and an entry in the tile context menu, in every section
 * regardless of kind. Plugins push these via
 * `openstation_my_wordpress_preview_actions` (PHP) and complete the
 * JS handler via the `os.my-wordpress.preview-actions` filter.
 *
 * @public
 */
export interface PreviewAction {
	id: string;
	label: string;
	icon?: string;
	/** PCRE — server-checked before shipping; client re-checks per item. */
	mime?: string;
	/**
	 * Section ids and/or post type slugs this action is visible in
	 * (`'*'` matches every section). Default: all.
	 */
	sections?: string[];
	/** Optional `wp_register_script` handle the server enqueues. */
	script?: string;
	/**
	 * Optional JS handler — wired by the
	 * `os.my-wordpress.preview-actions` JS filter, never
	 * by the server descriptor.
	 */
	onSelect?: ( ctx: PreviewActionContext ) => void | Promise< void >;
	/**
	 * Optional visibility predicate evaluated client-side after the
	 * server-side `capability` / `mime` checks have already passed.
	 */
	isVisible?: ( ctx: PreviewActionContext ) => boolean;
}

/**
 * @deprecated Use {@link PreviewAction}. Alias kept while the surface
 * was media-only.
 * @public
 */
export type MediaPreviewAction = PreviewAction;

/**
 * Slot identifier for plugin-injected DOM in the right pane.
 *
 * - `header` — above the rendered media / metadata table
 * - `meta`   — interleaved with the metadata grid
 * - `footer` — below the action button row
 *
 * @public
 */
export type MediaPreviewSlot = 'header' | 'meta' | 'footer';

/**
 * Where a preview action was invoked from.
 *
 * A multi-select run reports `'context-menu'`, not a surface of its
 * own: the selection layer fans a bulk choice out by replaying each
 * row's own single-item handler, so the handler genuinely is the
 * context-menu one, called once per item.
 *
 * @public
 */
export type PreviewActionSurface = 'pane' | 'context-menu' | 'dblclick';

/**
 * Context object passed to every preview-action handler.
 *
 * @public
 */
export interface PreviewActionContext {
	/** Entity id (`'media'`, `'posts'`, `'cpt-atf-forms'`, …). */
	entityId: string;
	/** Section render-kind (`'media'`, `'post'`, `'user'`, …). */
	kind: string;
	/** The section's declared post type slug, when it has one. */
	postType?: string;
	/** MIME type for media items, undefined for non-media kinds. */
	mime?: string;
	/**
	 * The selected entity, as the server sent it: the detail record
	 * in the right pane, the list row in context menus. `item.id` is
	 * present on both — deep-linking handlers should read that rather
	 * than detail-only fields.
	 */
	item: Record< string, unknown >;
	/** Convenience — `Number( item.id )` when numeric. */
	itemId?: number;
	/**
	 * Invocation surface. Always set by the bundle; optional only so
	 * pre-existing hand-built contexts stay type-valid.
	 */
	surface?: PreviewActionSurface;
}

/**
 * @deprecated Use {@link PreviewActionContext}. Alias kept while the
 * surface was media-only.
 * @public
 */
export type MediaPreviewActionContext = PreviewActionContext;

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
	 * so tiles can paint a status ribbon for non-
	 * published rows.
	 */
	status?: string;
	featured_media?: number;
	link?: string;
	openstation_lock?: EntityLock | null;
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
	/**
	 * Absent when the post type doesn't `supports( 'editor' )` — the
	 * REST controller omits the field entirely rather than sending an
	 * empty string. WooCommerce's `shop_coupon` is the in-tree
	 * example. Always read it optionally.
	 */
	content?: { rendered: string; protected?: boolean };
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
	openstation_contributors?: ContributorRef[];
	/**
	 * Authoritative list of attachment ids referenced by this post —
	 * featured image + every attachment found in `post_content`
	 * (class scan + raw `<img src>` URL resolution). Computed
	 * server-side by the `openstation_attached_media` REST field;
	 * the regex-based `extractContentMediaIds` is a fallback for
	 * older API responses that don't carry this.
	 */
	openstation_attached_media?: number[];
	/**
	 * Explicit editor URL, for a section whose rows don't live in
	 * `wp_posts` and so can't be edited at `post.php?post=<id>` — a
	 * WooCommerce order under High-Performance Order Storage is the
	 * in-tree case. Declare it in the section's `listFields` so
	 * `_fields` doesn't strip it off the list rows.
	 */
	editUrl?: string;
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
 * `openstation_summary` REST field — enough to paint a rich
 * tile without an extra round-trip per row.
 */
export interface UserListItem {
	id: number;
	name: string;
	slug?: string;
	description?: string;
	link?: string;
	avatar_urls?: Record< string, string >;
	openstation_summary?: {
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
		 * save of brand-new posts (those count under `posts`), so
		 * the heatmap registers update activity, not just
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
		/** `'post-update'` rows are most-recent-save-per-parent rollups. */
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
		/** Lifetime revision count, excluding the initial save. */
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
 * Compact user shape returned by the `openstation_contributors`
 * REST field. Enough to paint a tile + tooltip without an extra
 * `/wp/v2/users/<id>` round-trip per row.
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
	| { kind: 'group'; groupId: string }
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
	/**
	 * Parent post id — 0 when the file is unattached. Drives the
	 * Detach action, which is meaningless for a file with no parent.
	 */
	post?: number;
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
