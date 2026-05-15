/**
 * Native Plugins window — REST + admin-ajax glue.
 *
 * Read paths use Core REST (`/wp/v2/plugins`); mutation paths split:
 *
 *   - Activate / Deactivate: `PUT /wp/v2/plugins/{plugin}` (Core REST,
 *     `wp-includes/`, no admin-only files needed).
 *   - Delete:                 `DELETE /wp/v2/plugins/{plugin}` (Core REST).
 *   - Install by slug:        `admin-ajax.php?action=install-plugin`
 *                             (Core's wp.updates handler — we just
 *                             call it from JS, no PHP of our own).
 *   - Upload .zip:            our `wp_ajax_desktop_mode_plugins_upload`.
 *   - Browse / Info / Reviews: our `wp_ajax_desktop_mode_plugins_*`.
 *
 * Every call goes through `trackedFetch` so the window's title-bar
 * activity indicator picks it up.
 *
 * @public
 * @since 0.9.0
 */

import { trackedFetch } from '../tracked-fetch';
import { joinRestUrl } from '../rest-url';
import type {
	BrowseFilter,
	InstalledPlugin,
	PluginReviewsResponse,
	WpOrgBrowsePlugin,
	WpOrgPluginInfo,
} from './types';

const WINDOW_ID = 'desktop-mode-plugins';

declare global {
	interface Window {
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

/**
 * Subset of the `desktop_mode_register_window( 'desktop-mode-plugins',
 * […, 'config' => […] ] )` blob this bundle reads. Re-declared here
 * so the REST module isn't entangled with `index.ts`.
 */
export interface PluginsWindowConfig {
	restRoot: string;
	restNonce: string;
	pluginsUrl: string;
	ajaxUrl: string;
	ajaxNonce: string;
	updatesNonce: string;
	caps: {
		activate: boolean;
		install: boolean;
		delete: boolean;
		upload: boolean;
		/**
		 * `current_user_can( 'update_plugins' )`. Mirrors Core's gate on
		 * the inline "Update now" link — when false the JS hides the
		 * Update action even for rows with a pending update.
		 */
		update: boolean;
	};
	currentUserId: number;
	introSeen: boolean;
	introUrl: string;
	/**
	 * Desktop Mode's own plugin file path (e.g.
	 * `"desktop-mode/desktop-mode.php"`) — the same value WordPress
	 * keys mutations by in `/wp/v2/plugins/{plugin}`. Compare
	 * against the `InstalledPlugin.plugin` field on a deactivate/
	 * delete response to detect "user just turned off the shell
	 * we're running inside" and fall back to a hard reload before
	 * they touch any stale UI.
	 */
	selfPluginFile: string;
	/**
	 * Root wp-admin URL (`admin_url()`). Used by the self-deactivate
	 * exit path to navigate the top frame to the classic Dashboard
	 * rather than reloading the current URL — the current URL might
	 * be a deactivated plugin's `?page=…` route that now 403s under
	 * classic admin.
	 */
	adminUrl: string;
}

/**
 * Read the localized config blob. Throws when missing — better to
 * fail loudly with a clear message than silently fall back to a
 * default that papers over a registration regression.
 */
export function getConfig(): PluginsWindowConfig {
	const store = window.desktopModeWindowConfig;
	const cfg = store
		? ( store[ WINDOW_ID ] as PluginsWindowConfig | undefined )
		: undefined;
	if ( ! cfg ) {
		throw new Error(
			`[${ WINDOW_ID }] config blob is missing — was the window opened ` +
				'without registration? See the matching `desktop_mode_register_window()` ' +
				'call in `includes/plugins-window/window.php`.',
		);
	}
	return cfg;
}

/**
 * Wrapper around `trackedFetch` that attributes every request to the
 * Plugins window so concurrent operations from other windows don't
 * fight for the same activity indicator.
 *
 * @internal
 */
function shellFetch( input: RequestInfo, init?: RequestInit ): Promise< Response > {
	return trackedFetch( input, init, {
		windowId: WINDOW_ID,
		source: 'desktop-mode/plugins-window',
	} );
}

/**
 * REST request helper — attaches the `X-WP-Nonce` and JSON content
 * type, throws on non-2xx with a useful message.
 */
async function restRequest< T >(
	url: string,
	init: RequestInit & { expectJson?: boolean } = {},
): Promise< T > {
	const cfg = getConfig();
	const { expectJson = true, ...rest } = init;
	const response = await shellFetch( url, {
		...rest,
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
			...( rest.body ? { 'Content-Type': 'application/json' } : {} ),
			...( rest.headers ?? {} ),
		},
	} );
	if ( ! response.ok ) {
		throw await unpackErrorResponse( response );
	}
	if ( ! expectJson ) {
		return undefined as unknown as T;
	}
	return ( await response.json() ) as T;
}

/**
 * Admin-AJAX request helper. Encodes the args as `application/x-www-form-urlencoded`
 * (the format Core's wp.updates expects) and parses the standard
 * `{ success, data }` envelope.
 */
async function ajaxRequest< T >(
	action: string,
	args: Record< string, string | number | boolean | undefined > = {},
	options: { nonceField?: string; nonceValue?: string } = {},
): Promise< T > {
	const cfg = getConfig();
	const body = new URLSearchParams();
	body.set( 'action', action );
	const nonceField = options.nonceField ?? '_ajax_nonce';
	const nonceValue = options.nonceValue ?? cfg.ajaxNonce;
	body.set( nonceField, nonceValue );
	for ( const [ key, value ] of Object.entries( args ) ) {
		if ( value === undefined ) {
			continue;
		}
		body.set( key, String( value ) );
	}
	const response = await shellFetch( cfg.ajaxUrl, {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			Accept: 'application/json',
		},
		body,
	} );
	const json = await readJsonOrThrow( response );
	return unwrapAjaxEnvelope< T >( json, response.status );
}

/** Multipart variant of {@link ajaxRequest} for the .zip upload route. */
async function ajaxUpload< T >(
	action: string,
	formData: FormData,
): Promise< T > {
	const cfg = getConfig();
	formData.set( 'action', action );
	if ( ! formData.has( '_ajax_nonce' ) ) {
		formData.set( '_ajax_nonce', cfg.ajaxNonce );
	}
	const response = await shellFetch( cfg.ajaxUrl, {
		method: 'POST',
		credentials: 'same-origin',
		body: formData,
		// Don't set Content-Type — the browser appends the boundary.
	} );
	const json = await readJsonOrThrow( response );
	return unwrapAjaxEnvelope< T >( json, response.status );
}

async function readJsonOrThrow( response: Response ): Promise< unknown > {
	let json: unknown;
	try {
		json = await response.json();
	} catch ( err ) {
		throw new Error(
			`Server returned ${ response.status } with non-JSON body. (${ String( err ) })`,
		);
	}
	if ( ! response.ok ) {
		// admin-ajax handlers wrap errors as `wp_send_json_error( $err )`
		// → `{ success: false, data: { code, message, … } }`. The inner
		// `data` is what carries the code/message — pass it through so
		// `extractAjaxError()` actually finds them on a non-OK response.
		const errPayload =
			typeof json === 'object' &&
			json !== null &&
			'success' in json &&
			( json as { success?: unknown } ).success === false
				? ( json as { data?: unknown } ).data
				: json;
		throw extractAjaxError( errPayload, response.status );
	}
	return json;
}

function unwrapAjaxEnvelope< T >( json: unknown, status: number ): T {
	if ( typeof json === 'object' && json !== null && 'success' in json ) {
		const env = json as { success: boolean; data?: unknown };
		if ( env.success ) {
			return ( env.data ?? null ) as T;
		}
		throw extractAjaxError( env.data, status );
	}
	// Some Core handlers (the install-plugin one in particular) ship a
	// non-enveloped `{ slug, plugin, errorCode, … }` shape. Forward as
	// the generic T.
	return json as T;
}

function extractAjaxError( data: unknown, status: number ): Error {
	if ( typeof data === 'object' && data !== null ) {
		const obj = data as {
			message?: string;
			errorMessage?: string;
			code?: string;
			errorCode?: string;
		};
		const msg = obj.message ?? obj.errorMessage ?? obj.code ?? obj.errorCode;
		if ( typeof msg === 'string' && msg !== '' ) {
			const err = new Error( msg );
			// Core's ajax handlers split on the field name: `WP_Error`-wrapped
			// errors come through as `code`, but `wp_ajax_update_plugin` (and
			// friends) hand-rolls the envelope and ships `errorCode`. Fall
			// back to either so callers like `runUpdate()` can detect the
			// `'up_to_date'` soft-success signal without caring which
			// handler produced it.
			( err as Error & { code?: string; status?: number } ).code =
				obj.code ?? obj.errorCode;
			( err as Error & { code?: string; status?: number } ).status = status;
			return err;
		}
	}
	return new Error( `Request failed (${ status }).` );
}

async function unpackErrorResponse( response: Response ): Promise< Error > {
	let message = `${ response.status } ${ response.statusText }`;
	try {
		const json = ( await response.json() ) as { message?: string; code?: string };
		if ( json && typeof json.message === 'string' && json.message !== '' ) {
			message = json.message;
		}
		const err = new Error( message );
		( err as Error & { code?: string; status?: number } ).code = json?.code;
		( err as Error & { code?: string; status?: number } ).status = response.status;
		return err;
	} catch {
		const err = new Error( message );
		( err as Error & { status?: number } ).status = response.status;
		return err;
	}
}

// ─── Installed plugins ────────────────────────────────────────────────

/**
 * Fetch the full installed-plugins list. Core's
 * `/wp/v2/plugins` doesn't paginate (the install can't realistically
 * have more than a few hundred), so we request `per_page=100` to
 * collapse the typical install into a single round-trip.
 *
 * Pass `{ force: true }` to bypass the server-side 12h `update_plugins`
 * throttle. The Refresh button uses this — without the flag, repeated
 * clicks within 12h of Core's last check return the same cached
 * "no updates" snapshot (GH#202).
 */
export async function fetchInstalledPlugins( opts: {
	force?: boolean;
} = {} ): Promise< InstalledPlugin[] > {
	const cfg = getConfig();
	const params = new URLSearchParams( { context: 'view', per_page: '100' } );
	if ( opts.force ) {
		params.set( 'desktop_mode_force_refresh', '1' );
	}
	const url = joinRestUrl( cfg.restRoot, `wp/v2/plugins?${ params.toString() }` );
	return restRequest< InstalledPlugin[] >( url, { method: 'GET' } );
}

/** Activate a plugin. */
export async function activateInstalledPlugin(
	plugin: InstalledPlugin,
): Promise< InstalledPlugin > {
	return mutateInstalledPlugin( plugin, { status: 'active' } );
}

/** Deactivate a plugin (status flips to `'inactive'`). */
export async function deactivateInstalledPlugin(
	plugin: InstalledPlugin,
): Promise< InstalledPlugin > {
	return mutateInstalledPlugin( plugin, { status: 'inactive' } );
}

async function mutateInstalledPlugin(
	plugin: InstalledPlugin,
	body: { status: 'active' | 'inactive' | 'active-network' },
): Promise< InstalledPlugin > {
	const cfg = getConfig();
	return restRequest< InstalledPlugin >(
		joinRestUrl( cfg.restRoot, `wp/v2/plugins/${ encodePluginPath( plugin.plugin ) }` ),
		{
			method: 'PUT',
			body: JSON.stringify( body ),
		},
	);
}

/** Delete a plugin. Plugin must be inactive — server returns 400 otherwise. */
export async function deleteInstalledPlugin(
	plugin: InstalledPlugin,
): Promise< void > {
	const cfg = getConfig();
	await restRequest< void >(
		joinRestUrl(
			cfg.restRoot,
			`wp/v2/plugins/${ encodePluginPath( plugin.plugin ) }?force=true`,
		),
		{
			method: 'DELETE',
			expectJson: false,
		},
	);
}

/**
 * Encode a plugin file path for use as a REST route segment. Core's
 * REST controller registers the route with regex
 * `(?P<plugin>[^.\/]+(?:\/[^.\/]+)?)` which expects literal slashes.
 *
 * `encodeURIComponent` would percent-encode the slash to `%2F`, and
 * Apache rejects encoded slashes by default (`AllowEncodedSlashes
 * Off`) — same gotcha that tripped Core's own JS REST client.
 * Encode each segment individually and rejoin with literal `/`s.
 */
function encodePluginPath( plugin: string ): string {
	return plugin.split( '/' ).map( encodeURIComponent ).join( '/' );
}

/**
 * Update success envelope as returned by Core's `wp_ajax_update_plugin`
 * (see `wp-admin/includes/ajax-actions.php::wp_ajax_update_plugin`).
 * The handler `wp_send_json_success( $status )` payload is forwarded
 * verbatim — the version fields are pre-prefixed with "Version ", so
 * we expose the raw values here and let the caller format.
 */
export interface UpdatePluginResult {
	update: 'plugin';
	slug: string;
	oldVersion: string;
	newVersion: string;
	plugin: string;
	pluginName: string;
	debug?: string[];
}

/**
 * Trigger Core's `wp_ajax_update_plugin` handler — the exact same
 * endpoint the classic Plugins screen's "Update now" link hits via
 * `wp.updates.updatePlugin()`. We reuse it verbatim rather than
 * reimplementing `Plugin_Upgrader` (which lives in admin-only
 * includes and would tank Plugin Check).
 *
 * The handler validates `current_user_can( 'update_plugins' )`, calls
 * `wp_update_plugins()` to refresh the transient, and runs the
 * upgrader. On success returns `{ update, slug, oldVersion, newVersion,
 * plugin, pluginName }`; on failure throws with the server's
 * `errorMessage` and an `errorCode` attached.
 *
 * Note: the underlying upgrader holds a transient-level lock, so
 * concurrent runs can clobber each other's `update_plugins` transient
 * (see Core's comment in `wp_ajax_update_plugin`). Callers MUST route
 * through `enqueueUpdateJob` to serialize.
 *
 * @public
 * @since 0.18.0
 */
export async function updateInstalledPlugin(
	plugin: InstalledPlugin,
): Promise< UpdatePluginResult > {
	// Core's `update-plugin` handler keys into the `update_plugins`
	// transient with the FULL filename (`foo/foo.php`), but Core's REST
	// controller strips the `.php` extension when populating the
	// `plugin` field — so the value we received from `/wp/v2/plugins`
	// is one `.php` short of what the upgrader needs. Re-append before
	// firing, otherwise `Plugin_Upgrader::bulk_upgrade()` falls through
	// to the "already at latest version" branch (the transient lookup
	// misses on the stripped key). Mirrors the same fix we apply
	// server-side in `desktop_mode_plugins_window_row_plugin_file()`.
	const pluginFile = plugin.plugin.endsWith( '.php' )
		? plugin.plugin
		: plugin.plugin + '.php';
	return ajaxRequest< UpdatePluginResult >(
		'update-plugin',
		{
			plugin: pluginFile,
			slug:
				plugin.desktop_mode_update_available?.slug ||
				plugin.textdomain ||
				plugin.plugin.split( '/' )[ 0 ],
		},
		{ nonceField: '_ajax_nonce', nonceValue: getConfig().updatesNonce },
	);
}

// ─── Browse / Info / Reviews (admin-ajax) ─────────────────────────────

/** Browse the wp.org plugin directory. */
export async function browsePlugins( args: {
	browse?: BrowseFilter;
	search?: string;
	tag?: string;
	page?: number;
	perPage?: number;
} = {} ): Promise< {
	plugins: WpOrgBrowsePlugin[];
	info: Record< string, unknown >;
} > {
	return ajaxRequest( 'desktop_mode_plugins_browse', {
		browse: args.browse,
		search: args.search,
		tag: args.tag,
		page: args.page,
		per_page: args.perPage,
	} );
}

/** Fetch the full `plugin_information` payload for a slug. */
export async function fetchPluginInfo( slug: string ): Promise< WpOrgPluginInfo > {
	return ajaxRequest< WpOrgPluginInfo >( 'desktop_mode_plugins_info', { slug } );
}

/**
 * Card payload for the Featured tab. Same shape as a Browse card plus
 * a `featured` boolean — true when the row came from the curated seed
 * list, false when auto-discovered from wp.org's `requires_plugins`.
 */
export interface FeaturedPlugin extends WpOrgBrowsePlugin {
	featured?: boolean;
	requires_plugins?: string[];
}

/**
 * Fetch the curated + auto-discovered list of plugins that integrate
 * with Desktop Mode. Backed by a 1h server-side transient — repeat
 * calls within that window return the same payload.
 */
export async function fetchFeaturedPlugins(): Promise< {
	plugins: FeaturedPlugin[];
	info: { curated?: number; discovered?: number; results?: number };
} > {
	return ajaxRequest( 'desktop_mode_plugins_featured' );
}

/** Fetch (cached) recent reviews for a slug — falls back to histogram on parse failure. */
export async function fetchPluginReviews(
	slug: string,
): Promise< PluginReviewsResponse > {
	return ajaxRequest< PluginReviewsResponse >( 'desktop_mode_plugins_reviews', { slug } );
}

// ─── Install / Upload ─────────────────────────────────────────────────

/**
 * Install a plugin from the wp.org repository by slug. Calls Core's
 * existing `wp_ajax_install_plugin` handler — same payload Core's
 * own "Install" buttons use, no reimplementation. Verified against
 * the `'updates'` nonce, not our window-scoped `_ajax_nonce`.
 */
export async function installPluginBySlug( slug: string ): Promise< {
	plugin?: string;
	slug: string;
	activateUrl?: string;
	blogId?: number;
} > {
	return ajaxRequest(
		'install-plugin',
		{ slug },
		{ nonceField: '_ajax_nonce', nonceValue: getConfig().updatesNonce },
	);
}

export interface UploadPluginResult {
	plugin_file: string;
	plugin_name: string;
	plugin_version: string;
	status: 'inactive';
	messages: string[];
}

/**
 * Upload + install a .zip via our `wp_ajax_desktop_mode_plugins_upload`
 * action. Pass `overwrite: true` to instruct the upgrader to replace
 * an existing plugin directory — used by the dialog's confirm flow
 * after the server has returned a `folder_exists` 409.
 */
export async function uploadPluginZip(
	file: File,
	options: { overwrite?: boolean } = {},
): Promise< UploadPluginResult > {
	const data = new FormData();
	data.set( 'pluginzip', file );
	if ( options.overwrite ) {
		data.set( 'overwrite', '1' );
	}
	return ajaxUpload( 'desktop_mode_plugins_upload', data );
}

// ─── Live-refresh helper ──────────────────────────────────────────────

/**
 * Repaint the dock + taskbar after a plugin mutation. Calls
 * `wp.desktop.refreshMenu()` which spawns a 1×1 hidden chromeless
 * iframe to capture the real-admin-context menu payload (handles
 * plugins that gate `admin_menu` on `is_admin()`).
 *
 * Best-effort — silently no-ops when the helper isn't on the public
 * facade. The window's own state still updates from its own
 * mutation responses; what we lose without this call is the dock
 * tile changing live.
 */
export async function refreshFrameworkMenu(): Promise< void > {
	const refresh = window.wp?.desktop?.refreshMenu;
	if ( typeof refresh !== 'function' ) {
		return;
	}
	try {
		await refresh();
	} catch {
		// Best-effort; never throw from a refresh call.
	}
}

// ─── Self-deactivation guard ──────────────────────────────────────────

/**
 * True if `plugin` is the Desktop Mode plugin file itself. Once
 * Desktop Mode is deactivated/deleted, the shell JS keeps running
 * in the browser but every shell-routed REST + AJAX call lands on
 * a "plugin gone" stub — the user is stranded in a UI that can't
 * do anything. The callers use this to short-circuit into a hard
 * reload so the user lands back on the classic admin.
 *
 * Normalizes both sides by trimming a trailing `.php` — Core's REST
 * `/wp/v2/plugins` controller returns the `plugin` field as
 * `substr( $file, 0, -4 )`, whereas `plugin_basename()` (which feeds
 * the config) keeps the extension. Match either form so an upstream
 * shape change can't silently re-introduce the bug where the reload
 * never fires.
 */
export function isDesktopModeSelf( pluginFile: string ): boolean {
	let self = '';
	try {
		self = getConfig().selfPluginFile;
	} catch {
		return false;
	}
	const trim = ( s: string ): string =>
		s.endsWith( '.php' ) ? s.slice( 0, -4 ) : s;
	return self !== '' && trim( self ) === trim( pluginFile );
}

/**
 * Navigate the top-level window to the classic wp-admin Dashboard
 * after a brief delay so the user can read the "Desktop Mode
 * deactivated" toast. Drives navigation against `config.adminUrl`
 * (the server-localized `admin_url()`) instead of `location.reload()`
 * because the current URL may be a deactivated plugin's
 * `admin.php?page=…` route — reloading that lands the user on
 * "Sorry, you are not allowed to access this page." Going to the
 * Dashboard is the WordPress-default landing the user expects when
 * desktop mode is off.
 *
 * The top frame is targeted (not just this window) because every
 * other open desktop-mode window is also iframing into a now-stale
 * shell context.
 *
 * The delay is short enough that the page swap feels like a natural
 * consequence of the click; long enough for the toast text to be
 * legible.
 */
export function reloadOutOfDesktopMode(): void {
	const target = window.top ?? window;
	let dest: string;
	try {
		dest = getConfig().adminUrl;
	} catch {
		dest = '';
	}
	window.setTimeout( () => {
		if ( dest ) {
			try {
				target.location.assign( dest );
				return;
			} catch {
				// Cross-origin top frame — fall through to a local
				// navigation. The caller has already shown a toast.
			}
			window.location.assign( dest );
			return;
		}
		// No admin URL in config (older registration / test harness) —
		// fall back to a plain reload. Better than getting stuck on
		// the now-stale shell.
		try {
			target.location.reload();
		} catch {
			window.location.reload();
		}
	}, 800 );
}
