/**
 * Plugins app — the admin-ajax client.
 *
 * Part of the `desktop-mode-plugins` client view. What the framework
 * does NOT cover for this window: the wp.org marketplace (browse /
 * info / reviews / featured, `parts/ajax.php`), the .zip upload
 * (`parts/ajax.php`), and the install / update / auto-update toggles
 * that go through Core's own `wp.updates` handlers with the `updates`
 * nonce. Every call goes through `trackedFetch` attributed to the
 * window so the title-bar activity indicator picks it up. Activate /
 * deactivate / delete are app actions (`plugins.os.php`), not here.
 *
 * The nonces are read from the window config at call time, never
 * cached in a closure: the shell's nonce refresh rewrites
 * `ajaxNonce` / `updatesNonce` in place when a session's nonces roll.
 *
 * @public
 */

import { leaveForClassicAdmin } from '../../../src/exit-openstation';
import { trackedFetch } from '../../../src/tracked-fetch';
import type {
	BrowseFilter,
	FeaturedPlugin,
	InstalledPlugin,
	PluginReviewsResponse,
	PluginsExtra,
	UpdatePluginResult,
	UploadPluginResult,
	WpOrgBrowsePlugin,
	WpOrgPluginInfo,
} from './types';

const WINDOW_ID = 'desktop-mode-plugins';

export interface PluginsRest {
	browsePlugins: ( args?: {
		browse?: BrowseFilter;
		search?: string;
		tag?: string;
		page?: number;
		perPage?: number;
	} ) => Promise< { plugins: WpOrgBrowsePlugin[]; info: Record< string, unknown > } >;
	fetchPluginInfo: ( slug: string ) => Promise< WpOrgPluginInfo >;
	fetchPluginReviews: ( slug: string ) => Promise< PluginReviewsResponse >;
	fetchFeaturedPlugins: () => Promise< {
		plugins: FeaturedPlugin[];
		info: { curated?: number; discovered?: number; results?: number };
	} >;
	installPluginBySlug: ( slug: string ) => Promise< {
		plugin?: string;
		slug: string;
		activateUrl?: string;
		blogId?: number;
	} >;
	updateInstalledPlugin: ( plugin: InstalledPlugin ) => Promise< UpdatePluginResult >;
	toggleAutoUpdate: ( plugin: InstalledPlugin, state: 'enable' | 'disable' ) => Promise< void >;
	uploadPluginZip: ( file: File, options?: { overwrite?: boolean } ) => Promise< UploadPluginResult >;
	/** True when `pluginFile` is OpenStation itself. */
	isOpenStationSelf: ( pluginFile: string ) => boolean;
	/** Leave the shell for the classic Dashboard after a self-deactivate. */
	reloadOutOfOpenStation: () => void;
	/** Repaint the dock + taskbar after a mutation (best-effort). */
	refreshFrameworkMenu: () => Promise< void >;
}

/** Build the client over a live reader of the window config. */
export function createPluginsRest( extra: () => PluginsExtra ): PluginsRest {
	const shellFetch = ( input: RequestInfo, init?: RequestInit ): Promise< Response > =>
		trackedFetch( input, init, { windowId: WINDOW_ID, source: 'desktop-mode/plugins-window' } );

	/**
	 * Encode the args as `application/x-www-form-urlencoded` (the format
	 * Core's wp.updates expects) and unwrap the `{ success, data }`
	 * envelope.
	 */
	const ajaxRequest = async < T >(
		action: string,
		args: Record< string, string | number | boolean | undefined > = {},
		nonce: 'ajax' | 'updates' = 'ajax',
	): Promise< T > => {
		const cfg = extra();
		const body = new URLSearchParams();
		body.set( 'action', action );
		body.set( '_ajax_nonce', nonce === 'updates' ? cfg.updatesNonce : cfg.ajaxNonce );
		for ( const [ key, value ] of Object.entries( args ) ) {
			if ( value !== undefined ) {
				body.set( key, String( value ) );
			}
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
		return unwrapAjaxEnvelope< T >( await readJsonOrThrow( response ), response.status );
	};

	/** Multipart variant for the .zip upload route. */
	const ajaxUpload = async < T >( action: string, formData: FormData ): Promise< T > => {
		const cfg = extra();
		formData.set( 'action', action );
		if ( ! formData.has( '_ajax_nonce' ) ) {
			formData.set( '_ajax_nonce', cfg.ajaxNonce );
		}
		// No Content-Type — the browser appends the boundary.
		const response = await shellFetch( cfg.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			body: formData,
		} );
		return unwrapAjaxEnvelope< T >( await readJsonOrThrow( response ), response.status );
	};

	/**
	 * Core's `update-plugin` / `toggle-auto-updates` handlers key on the
	 * FULL filename (`foo/foo.php`) while Core's REST controller strips
	 * the extension — re-append it, or the transient lookup misses.
	 */
	const fullFile = ( plugin: InstalledPlugin ): string =>
		plugin.plugin.endsWith( '.php' ) ? plugin.plugin : plugin.plugin + '.php';

	return {
		browsePlugins: ( args = {} ) =>
			ajaxRequest( 'openstation_plugins_browse', {
				browse: args.browse,
				search: args.search,
				tag: args.tag,
				page: args.page,
				per_page: args.perPage,
			} ),
		fetchPluginInfo: ( slug ) => ajaxRequest< WpOrgPluginInfo >( 'openstation_plugins_info', { slug } ),
		fetchPluginReviews: ( slug ) =>
			ajaxRequest< PluginReviewsResponse >( 'openstation_plugins_reviews', { slug } ),
		fetchFeaturedPlugins: () => ajaxRequest( 'openstation_plugins_featured' ),
		// Core's `wp_ajax_install_plugin` — verified against the `updates`
		// nonce, not our window-scoped one.
		installPluginBySlug: ( slug ) => ajaxRequest( 'install-plugin', { slug }, 'updates' ),
		// Core's `wp_ajax_update_plugin` — the exact handler the classic
		// screen's "Update now" hits. Callers MUST serialise through
		// `enqueueUpdateJob`: concurrent upgrader runs corrupt the
		// `update_plugins` transient.
		updateInstalledPlugin: ( plugin ) =>
			ajaxRequest< UpdatePluginResult >(
				'update-plugin',
				{
					plugin: fullFile( plugin ),
					slug:
						plugin.openstation_update_available?.slug ||
						plugin.textdomain ||
						plugin.plugin.split( '/' )[ 0 ],
				},
				'updates',
			),
		// Core's `wp_ajax_toggle_auto_updates` — an empty success
		// envelope; the caller updates the row from the requested state.
		toggleAutoUpdate: async ( plugin, state ) => {
			await ajaxRequest< unknown >(
				'toggle-auto-updates',
				{ type: 'plugin', asset: fullFile( plugin ), state },
				'updates',
			);
		},
		uploadPluginZip: ( file, options = {} ) => {
			const data = new FormData();
			data.set( 'pluginzip', file );
			if ( options.overwrite ) {
				data.set( 'overwrite', '1' );
			}
			return ajaxUpload( 'openstation_plugins_upload', data );
		},
		isOpenStationSelf: ( pluginFile ) => {
			const self = extra().selfPluginFile ?? '';
			const trim = ( s: string ): string => ( s.endsWith( '.php' ) ? s.slice( 0, -4 ) : s );
			return self !== '' && trim( self ) === trim( pluginFile );
		},
		reloadOutOfOpenStation: () => {
			leaveForClassicAdmin( extra().adminUrl ?? '' );
		},
		refreshFrameworkMenu: async () => {
			const refresh = window.wp?.os?.refreshMenu;
			if ( typeof refresh !== 'function' ) {
				return;
			}
			try {
				await refresh();
			} catch {
				// Best-effort; never throw from a refresh call.
			}
		},
	};
}

async function readJsonOrThrow( response: Response ): Promise< unknown > {
	let json: unknown;
	try {
		json = await response.json();
	} catch ( err ) {
		throw new Error( `Server returned ${ response.status } with non-JSON body. (${ String( err ) })` );
	}
	if ( ! response.ok ) {
		// `wp_send_json_error( $err )` → `{ success: false, data: { code,
		// message } }`; the inner `data` is what carries them.
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
	// Some Core handlers (install-plugin) ship a non-enveloped shape.
	return json as T;
}

function extractAjaxError( data: unknown, status: number ): Error {
	if ( typeof data === 'object' && data !== null ) {
		const obj = data as { message?: string; errorMessage?: string; code?: string; errorCode?: string };
		const msg = obj.message ?? obj.errorMessage ?? obj.code ?? obj.errorCode;
		if ( typeof msg === 'string' && msg !== '' ) {
			const err = new Error( msg );
			// `WP_Error`-wrapped failures come through as `code`; Core's
			// hand-rolled envelopes (`wp_ajax_update_plugin`) ship
			// `errorCode`. Either lets callers detect `up_to_date`.
			( err as Error & { code?: string; status?: number } ).code = obj.code ?? obj.errorCode;
			( err as Error & { code?: string; status?: number } ).status = status;
			return err;
		}
	}
	return new Error( `Request failed (${ status }).` );
}
