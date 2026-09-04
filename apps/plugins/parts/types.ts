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
	/** OpenStation's own plugin path, without `.php`, as Core's REST controller spells it. */
	selfPluginFile: string;
	/** Root wp-admin URL — where a self-deactivate lands. */
	adminUrl: string;
}

export type Ctx = ViewContext< AppState, AppData >;

export type PluginsTab = 'installed' | 'browse' | 'featured';

/** Core's plugin statuses; `network-active` only exists on a network. */
export type PluginStatus = 'active' | 'inactive' | 'network-active';

/**
 * A row from Core's `/wp/v2/plugins` list, with our REST-field
 * decorators (`openstation_*`) attached. Optional fields may be absent
 * in older Core versions; every access is guarded.
 */
export interface InstalledPlugin {
	/** Plugin file path relative to `wp-content/plugins/`, minus `.php`. The row id. */
	plugin: string;
	status: PluginStatus;
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
	homepage?: string;
	short_description: string;
	rating: number;
	num_ratings: number;
	active_installs: number;
	last_updated: string;
	tested: string;
	requires_php?: string;
	icons?: Record< string, string >;
}

/** The `plugin_information` payload — sections, screenshots, ratings, banners. */
export interface WpOrgPluginInfo extends WpOrgBrowsePlugin {
	sections?: Record< string, string >;
	screenshots?: Record< string, { src: string; caption: string } >;
	ratings?: Record< string, number >;
	banners?: Record< string, string >;
}

/** A Featured-tab card: a Browse row plus the curated flag. */
export interface FeaturedPlugin extends WpOrgBrowsePlugin {
	featured?: boolean;
}

/** Browse filters (the wp.org `browse` arg whitelist). */
export type BrowseFilter = 'featured' | 'popular' | 'recommended' | 'favorites' | 'new' | 'beta';

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
 * `plugins.php` iframe; the Heartbeat relay as `source: 'heartbeat'`)
 * can refresh. `source` lets the app skip its own emissions — its
 * mutations already returned fresh data.
 */
export const PLUGINS_CHANGED_TOPIC = 'os.plugin.changed';
export const PLUGINS_CHANGED_SOURCE = 'plugins-app';

export interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'update' | 'auto-update' | 'bulk';
	/** The Heartbeat relay's shape: `crc32( plugin file )` per plugin. */
	ids?: number[];
}

/** The in-flight state the action buttons paint from — one bag per window. */
export interface BusyState {
	/** Rows in the update queue (enqueued or in flight) — the Update button disables. */
	updating: Set< string >;
	/** Rows whose auto-update toggle is in flight — the cell paints a spinner. */
	autoUpdating: Set< string >;
	/** Status painted before the server answers, keyed by plugin path. */
	optimistic: Map< string, PluginStatus >;
}

/** What wp.org told this window already — per slug, for the window's life. */
export interface WpOrgCaches {
	info: Map< string, WpOrgPluginInfo >;
	reviews: Map< string, PluginReviewsResponse >;
}

/**
 * What every part works against: the live config, the live installed
 * list, the admin-ajax client, the busy state and the wp.org caches,
 * and the framework's dispatch / toast / confirm — built once per
 * mounted view by `plugins.os.ts`.
 */
export interface PluginsHost {
	readonly extra: PluginsExtra;
	/** The installed rows as of the last server response (live). */
	readonly installed: InstalledPlugin[];
	readonly rest: PluginsRest;
	readonly root: HTMLElement;
	readonly busy: BusyState;
	readonly caches: WpOrgCaches;
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
	/** Repaint the dock + taskbar after a mutation the server did not perform. */
	refreshMenu: () => void;
	/** The installed row matching a wp.org slug (text domain) or plugin path. */
	installedFor: ( slug: string ) => InstalledPlugin | undefined;
	/**
	 * Tell other surfaces a plugin changed (skips our own listener), and
	 * remember the plugins it touched (`payload.plugin`, plus `touched`
	 * for a bulk run) so the Heartbeat relay of the same change is not
	 * mistaken for an external one.
	 */
	broadcastChange: ( payload: Omit< PluginsChangedPayload, 'source' >, touched?: string[] ) => void;
}

/** The key a Browse / Featured card looks an installed row up by. */
export function indexKeyFor( plugin: InstalledPlugin ): string {
	// Prefer the textdomain (matches the wp.org slug) so the lookup
	// from a card works; fall back to the plugin path on installs
	// without a Text Domain header.
	return plugin.textdomain || plugin.plugin;
}

export function isActiveStatus( status: string | undefined ): boolean {
	return status === 'active' || status === 'network-active';
}

export function describeError( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}

/** The full file Core's transient and upgrader key on (`foo/foo.php`). */
export function fullPluginFile( plugin: string ): string {
	return plugin.endsWith( '.php' ) ? plugin : plugin + '.php';
}

/**
 * The id the Heartbeat relay gives a plugin — `crc32()` of the plugin
 * file, as `openstation_content_changes_plugin_id()` computes it — so a
 * relayed `os.plugin.changed` can be matched to a plugin this window
 * just mutated itself.
 */
export function pluginChangeId( pluginFile: string ): number {
	/* eslint-disable no-bitwise -- CRC-32 is bit arithmetic; this mirrors PHP's crc32(). */
	let crc = 0xffffffff;
	for ( let i = 0; i < pluginFile.length; i++ ) {
		crc ^= pluginFile.charCodeAt( i ) & 0xff;
		for ( let bit = 0; bit < 8; bit++ ) {
			crc = crc & 1 ? ( crc >>> 1 ) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return Math.max( 1, ( crc ^ 0xffffffff ) >>> 0 );
	/* eslint-enable no-bitwise */
}
