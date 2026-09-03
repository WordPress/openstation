/**
 * Plugins app — the wire shapes and the host the parts share.
 *
 * Part of the `desktop-mode-plugins` client view: imported by
 * `plugins.os.ts` and every other part. The row types mirror Core's
 * `/wp/v2/plugins` resource plus the `openstation_*` REST fields
 * `parts/rest-fields.php` registers; the wp.org shapes mirror
 * `plugins_api()`; `PluginsHost` is the slice of the view context the
 * parts work against, so none of them reaches for `wp.os` on its own.
 *
 * @public
 */

import type { ViewContext } from '@openstation/app';
import type { PluginsRest } from './rest';

/** The declared state — what the server echoes back. */
export interface AppState extends Record< string, unknown > {
	tab: PluginsTab;
	status: string;
	search: string;
	browse: BrowseFilter;
	query: string;
}

/** What `App::data()` returns. */
export interface AppData {
	installed: InstalledPlugin[];
	error: string;
}

/** What `App::config()` ships once with the window (`ctx.extra`). */
export interface PluginsExtra {
	ajaxUrl: string;
	ajaxNonce: string;
	updatesNonce: string;
	caps: {
		activate: boolean;
		install: boolean;
		delete: boolean;
		upload: boolean;
		update: boolean;
	};
	autoUpdatesEnabled: boolean;
	currentUserId: number;
	/** OpenStation's own plugin path, without `.php`, as Core's REST controller spells it. */
	selfPluginFile: string;
	/** Root wp-admin URL — where a self-deactivate lands. */
	adminUrl: string;
}

export type Ctx = ViewContext< AppState, AppData >;

export type PluginsTab = 'installed' | 'browse' | 'featured';

/**
 * A row from Core's `/wp/v2/plugins` list, with our REST-field
 * decorators (`openstation_*`) attached. Optional fields may be absent
 * in older Core versions; every access is guarded.
 */
export interface InstalledPlugin {
	/** Plugin file path relative to `wp-content/plugins/`, minus `.php`. The row id. */
	plugin: string;
	status: 'active' | 'inactive' | 'active-network';
	name: string;
	plugin_uri?: string;
	author?: string;
	author_uri?: string;
	description?: { raw: string; rendered: string } | string;
	version?: string;
	/** Core uses the text domain as the wp.org slug for .org plugins. */
	textdomain?: string;
	network_only?: boolean;
	requires_wp?: string;
	requires_php?: string;
	/** Pending wp.org update, from the `update_plugins` transient. */
	openstation_update_available?: {
		available: boolean;
		new_version: string | null;
		/** Download URL; empty for premium / private hosts (Core shows "Auto-update unavailable"). */
		package: string;
		slug: string;
	};
	/** Per-row capability flags — UX only; the server re-validates. */
	openstation_can_manage?: {
		activate: boolean;
		deactivate: boolean;
		delete: boolean;
	};
	/** The wp.org directory slug, or `null` when not listed there. */
	openstation_wporg_slug?: string | null;
	/** A local-folder icon, falling back to the `ps.w.org` SVN URL. */
	openstation_icon_url?: string | null;
	/** Disk size of the plugin folder in kilobytes (null when unreadable). */
	openstation_size_kb?: number | null;
	/** Auto-update state, mirroring Core's "Automatic Updates" column. */
	openstation_auto_update?: {
		enabled: boolean;
		forced: boolean | null;
		supported: boolean;
	};
	[ key: string ]: unknown;
}

/** One entry of a wp.org Browse response (`plugins_api( 'query_plugins' )`). */
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

/** The `plugin_information` payload — sections, screenshots, ratings. */
export interface WpOrgPluginInfo extends WpOrgBrowsePlugin {
	sections?: Record< string, string >;
	screenshots?: Record< string, { src: string; caption: string } >;
	ratings?: Record< string, number >;
	contributors?: Record< string, { profile: string; avatar: string; display_name: string } >;
	donate_link?: string;
}

/** A Featured-tab card: a Browse row plus the curated flag. */
export interface FeaturedPlugin extends WpOrgBrowsePlugin {
	featured?: boolean;
	requires_plugins?: string[];
}

/** Browse filters (the wp.org `browse` arg whitelist). */
export type BrowseFilter =
	| 'featured'
	| 'popular'
	| 'recommended'
	| 'favorites'
	| 'new'
	| 'beta'
	| 'updated';

/** A review parsed from the wp.org plugin reviews page. */
export interface PluginReview {
	author: string;
	stars: number;
	excerpt: string;
	date: string;
	url: string;
}

/** Response of `wp_ajax_openstation_plugins_reviews`. */
export interface PluginReviewsResponse {
	items: PluginReview[];
	parsed: boolean;
	reason?: string;
}

/** Core's `wp_ajax_update_plugin` success envelope, forwarded verbatim. */
export interface UpdatePluginResult {
	update: 'plugin';
	slug: string;
	oldVersion: string;
	newVersion: string;
	plugin: string;
	pluginName: string;
	debug?: string[];
}

/** Response of `wp_ajax_openstation_plugins_upload`. */
export interface UploadPluginResult {
	plugin_file: string;
	plugin_name: string;
	plugin_version: string;
	status: 'inactive';
	messages: string[];
}

/**
 * Cross-window sync topic: emitted after every plugin mutation so
 * another surface (the chromeless bridge emits it too, from a
 * `plugins.php` iframe) can refresh. `source` lets the app skip its
 * own emissions — its mutations already returned fresh data.
 */
export const PLUGINS_CHANGED_TOPIC = 'os.plugin.changed';
export const PLUGINS_CHANGED_SOURCE = 'plugins-app';

export interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?:
		| 'activate'
		| 'deactivate'
		| 'delete'
		| 'install'
		| 'update'
		| 'auto-update'
		| 'bulk';
}

/**
 * What every part works against: the live config, the live installed
 * list, the admin-ajax client, and the framework's dispatch / toast /
 * confirm — built once per mounted view by `plugins.os.ts`.
 */
export interface PluginsHost {
	readonly extra: PluginsExtra;
	/** The installed rows as of the last server response (live). */
	readonly installed: InstalledPlugin[];
	readonly rest: PluginsRest;
	readonly root: HTMLElement;
	/** A server action (a round trip); resolves once its response was applied. */
	dispatch: Ctx[ 'dispatch' ];
	/** Re-read `data()` — after an admin-ajax mutation the server did not see. */
	refresh: () => Promise< boolean >;
	repaint: () => void;
	toast: ( message: string, duration?: number ) => void;
	confirm: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
	} ) => Promise< boolean >;
	/** The installed row matching a wp.org slug (text domain) or plugin path. */
	installedFor: ( slug: string ) => InstalledPlugin | undefined;
	/** Tell other surfaces a plugin changed (skips our own listener). */
	broadcastChange: ( payload: Omit< PluginsChangedPayload, 'source' > ) => void;
}

/** The key a Browse / Featured card looks an installed row up by. */
export function indexKeyFor( plugin: InstalledPlugin ): string {
	// Prefer the textdomain (matches the wp.org slug) so the lookup
	// from a card works; fall back to the plugin path on installs
	// without a Text Domain header.
	return plugin.textdomain || plugin.plugin;
}

export function isActiveStatus( status: string | undefined ): boolean {
	return status === 'active' || status === 'active-network';
}

export function describeError( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}

export function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}
