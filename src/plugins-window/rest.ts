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
	};
	currentUserId: number;
	introSeen: boolean;
	introUrl: string;
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
		throw extractAjaxError( json, response.status );
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
		const obj = data as { message?: string; errorMessage?: string; code?: string };
		const msg = obj.message ?? obj.errorMessage ?? obj.code;
		if ( typeof msg === 'string' && msg !== '' ) {
			const err = new Error( msg );
			( err as Error & { code?: string; status?: number } ).code = obj.code;
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
 */
export async function fetchInstalledPlugins(): Promise< InstalledPlugin[] > {
	const cfg = getConfig();
	const url = cfg.pluginsUrl + '?context=view&per_page=100';
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
		cfg.pluginsUrl + '/' + encodePluginPath( plugin.plugin ),
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
		cfg.pluginsUrl + '/' + encodePluginPath( plugin.plugin ) + '?force=true',
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

/**
 * Upload + install a .zip via our `wp_ajax_desktop_mode_plugins_upload`
 * action.
 */
export async function uploadPluginZip( file: File ): Promise< {
	plugin_file: string;
	status: 'inactive';
	messages: string[];
} > {
	const data = new FormData();
	data.set( 'pluginzip', file );
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
