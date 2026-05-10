/**
 * Native Plugins window — public type surface.
 *
 * Re-exported from `index.ts` so plugin authors writing JS-side
 * filters / extensions get the same shapes the bundle works against.
 *
 * @public
 * @since 0.9.0
 */

/**
 * A row from Core's `/wp/v2/plugins` list, with our REST-field
 * decorators (`desktop_mode_*`) attached.
 *
 * Fields with question marks are optional in older Core versions or
 * may be absent under a `_fields` whitelist; the JS guards every
 * access.
 */
export interface InstalledPlugin {
	/** Plugin file path relative to `wp-content/plugins/`, e.g. `"akismet/akismet.php"`. Acts as the row id. */
	plugin: string;
	/** Plugin status — `"active"` or `"inactive"` (`"active-network"` on multisite). */
	status: 'active' | 'inactive' | 'active-network';
	/** Display name from the plugin header. */
	name: string;
	/** Plugin URL from the plugin header (homepage). */
	plugin_uri?: string;
	/** Author display name (HTML allowed by Core; we rely on Core's escaping). */
	author?: string;
	/** Author URL from the plugin header. */
	author_uri?: string;
	/** Plugin description (HTML allowed). */
	description?: { raw: string; rendered: string } | string;
	/** Version from the plugin header. */
	version?: string;
	/** Plugin's text domain — Core uses this as the wp.org slug for .org plugins. */
	textdomain?: string;
	/** Network-only plugin flag. */
	network_only?: boolean;
	/** Whether the plugin requires WP at this version or higher. */
	requires_wp?: string;
	/** Whether the plugin requires PHP at this version or higher. */
	requires_php?: string;

	// ─── REST-field decorators added in `includes/plugins-window/rest-fields.php` ───

	/**
	 * `{ available, new_version }` — true if a wp.org update is
	 * pending. Read from the `update_plugins` site transient.
	 */
	desktop_mode_update_available?: {
		available: boolean;
		new_version: string | null;
	};
	/**
	 * Per-row capability flags so the JS doesn't re-derive caps. The
	 * server still re-validates every mutation; this is purely UX.
	 */
	desktop_mode_can_manage?: {
		activate: boolean;
		deactivate: boolean;
		delete: boolean;
	};
	/** wp.org icon URL derived from the slug; null when the plugin isn't on the .org repo. */
	desktop_mode_icon_url?: string | null;
	/** Disk size of the plugin folder in kilobytes (null when unreadable). */
	desktop_mode_size_kb?: number | null;

	/**
	 * Index signature so `InstalledPlugin` satisfies the
	 * `T extends Record<string, unknown>` constraint on `WpdTable<T>`.
	 * Same shape posts-window uses for `PostListItem`.
	 */
	[ key: string ]: unknown;
}

/**
 * A single plugin entry in the wp.org Browse response. Mirrors the
 * `plugins_api( 'query_plugins' )` row shape for the field set our
 * AJAX `browse` action requests.
 */
export interface WpOrgBrowsePlugin {
	slug: string;
	name: string;
	version: string;
	author: string;
	author_profile?: string;
	homepage?: string;
	short_description: string;
	rating: number;
	num_ratings: number;
	active_installs: number;
	last_updated: string;
	tested: string;
	requires?: string;
	requires_php?: string;
	icons?: Record< string, string >;
	banners?: Record< string, string >;
	download_link?: string;
}

/**
 * The `plugins_api( 'plugin_information' )` response — far richer than
 * Browse rows; includes the full description sections, screenshots,
 * ratings histogram, and contributors.
 */
export interface WpOrgPluginInfo extends WpOrgBrowsePlugin {
	sections?: Record< string, string >;
	screenshots?: Record< string, { src: string; caption: string } >;
	ratings?: Record< string, number >;
	contributors?: Record< string, { profile: string; avatar: string; display_name: string } >;
	donate_link?: string;
}

/** Browse filters (mirror the wp.org `browse` arg whitelist). */
export type BrowseFilter =
	| 'featured'
	| 'popular'
	| 'recommended'
	| 'favorites'
	| 'new'
	| 'beta'
	| 'updated';

/** A single review parsed from the wp.org plugin reviews page. */
export interface PluginReview {
	author: string;
	stars: number;
	excerpt: string;
	date: string;
	url: string;
}

/** Response shape for our `wp_ajax_desktop_mode_plugins_reviews` action. */
export interface PluginReviewsResponse {
	items: PluginReview[];
	parsed: boolean;
	reason?: string;
}
