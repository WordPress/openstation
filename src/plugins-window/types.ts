/**
 * Native Plugins window — public type surface.
 *
 * Re-exported from `index.ts` so plugin authors writing JS-side
 * filters / extensions get the same shapes the bundle works against.
 *
 * @public
 */

/**
 * A row from Core's `/wp/v2/plugins` list, with our REST-field
 * decorators (`open_station_*`) attached.
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
	 * Pending wp.org update for this row, derived from the
	 * `update_plugins` site transient.
	 *
	 * - `available` — there's a newer version in the transient.
	 * - `new_version` — the version the upgrader would install.
	 * - `package` — download URL for the new .zip. Empty when the
	 *               plugin doesn't ship a wp.org package (premium /
	 *               private hosts); JS uses this the same way Core's
	 *               `wp_plugin_update_row()` does — present means
	 *               "Update now" link, empty means "Automatic update
	 *               is unavailable for this plugin" copy.
	 * - `slug` — the wp.org slug as the transient carries it. Mostly
	 *            informational; the `update-plugin` AJAX action derives
	 *            the slug from `plugin` itself.
	 */
	open_station_update_available?: {
		available: boolean;
		new_version: string | null;
		package: string;
		slug: string;
	};
	/**
	 * Per-row capability flags so the JS doesn't re-derive caps. The
	 * server still re-validates every mutation; this is purely UX.
	 */
	open_station_can_manage?: {
		activate: boolean;
		deactivate: boolean;
		delete: boolean;
	};
	/** wp.org icon URL derived from the slug; null when the plugin isn't on the .org repo. */
	open_station_icon_url?: string | null;
	/** Disk size of the plugin folder in kilobytes (null when unreadable). */
	open_station_size_kb?: number | null;
	/**
	 * Auto-update state for this plugin, mirroring Core's
	 * "Automatic Updates" column on `plugins.php`.
	 *
	 * - `enabled`   — plugin is in the `auto_update_plugins` site option
	 *                 OR `forced === true` (Core treats a filter-pinned
	 *                 state as the effective state, regardless of option).
	 * - `forced`    — `true`/`false` when the `auto_update_plugin` filter
	 *                 has pinned the state; `null` when the user is free
	 *                 to toggle. JS renders a static label (no toggle)
	 *                 when forced.
	 * - `supported` — the plugin shows up in the `update_plugins`
	 *                 transient (either `response` or `no_update`).
	 *                 Premium / private plugins that never check in with
	 *                 wp.org land in neither bucket — Core hides the
	 *                 toggle entirely for those rows.
	 */
	open_station_auto_update?: {
		enabled: boolean;
		forced: boolean | null;
		supported: boolean;
	};

	/**
	 * Index signature so `InstalledPlugin` satisfies the
	 * `T extends Record<string, unknown>` constraint on `OsTable<T>`.
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

/** Response shape for our `wp_ajax_open_station_plugins_reviews` action. */
export interface PluginReviewsResponse {
	items: PluginReview[];
	parsed: boolean;
	reason?: string;
}
