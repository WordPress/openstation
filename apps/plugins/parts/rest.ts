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
import { fullPluginFile } from './types';

export interface PluginsRest {
	browsePlugins: ( args?: {
		browse?: BrowseFilter;
		search?: string;
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

	isOpenStationSelf: ( pluginFile: string ) => boolean;
}

export type RestFetch = ( url: string, init?: RequestInit ) => Promise< Response >;

export function createPluginsRest( extra: () => PluginsExtra, fetcher: RestFetch ): PluginsRest {
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
		const response = await fetcher( cfg.ajaxUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body,
		} );
		return unwrapAjaxEnvelope< T >( await readJsonOrThrow( response ), response.status );
	};

	const ajaxUpload = async < T >( action: string, formData: FormData ): Promise< T > => {
		const cfg = extra();
		formData.set( 'action', action );
		if ( ! formData.has( '_ajax_nonce' ) ) {
			formData.set( '_ajax_nonce', cfg.ajaxNonce );
		}

		const response = await fetcher( cfg.ajaxUrl, { method: 'POST', body: formData } );
		return unwrapAjaxEnvelope< T >( await readJsonOrThrow( response ), response.status );
	};

	return {
		browsePlugins: ( args = {} ) =>
			ajaxRequest( 'openstation_plugins_browse', {
				browse: args.browse,
				search: args.search,
				page: args.page,
				per_page: args.perPage,
			} ),
		fetchPluginInfo: ( slug ) => ajaxRequest< WpOrgPluginInfo >( 'openstation_plugins_info', { slug } ),
		fetchPluginReviews: ( slug ) =>
			ajaxRequest< PluginReviewsResponse >( 'openstation_plugins_reviews', { slug } ),
		fetchFeaturedPlugins: () => ajaxRequest( 'openstation_plugins_featured' ),

		installPluginBySlug: ( slug ) => ajaxRequest( 'install-plugin', { slug }, 'updates' ),

		updateInstalledPlugin: ( plugin ) =>
			ajaxRequest< UpdatePluginResult >(
				'update-plugin',
				{
					plugin: fullPluginFile( plugin.plugin ),
					slug:
						plugin.openstation_update_available?.slug ||
						plugin.textdomain ||
						plugin.plugin.split( '/' )[ 0 ],
				},
				'updates',
			),

		toggleAutoUpdate: async ( plugin, state ) => {
			await ajaxRequest< unknown >(
				'toggle-auto-updates',
				{ type: 'plugin', asset: fullPluginFile( plugin.plugin ), state },
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
	};
}

export async function readJsonOrThrow( response: Response ): Promise< unknown > {
	let json: unknown;
	try {
		json = await response.json();
	} catch ( err ) {
		throw new Error( `Server returned ${ response.status } with non-JSON body. (${ String( err ) })` );
	}
	if ( ! response.ok ) {
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

export function unwrapAjaxEnvelope< T >( json: unknown, status: number ): T {
	if ( typeof json === 'object' && json !== null && 'success' in json ) {
		const env = json as { success: boolean; data?: unknown };
		if ( env.success ) {
			return ( env.data ?? null ) as T;
		}
		throw extractAjaxError( env.data, status );
	}

	return json as T;
}

function extractAjaxError( data: unknown, status: number ): Error {
	if ( typeof data === 'object' && data !== null ) {
		const obj = data as { message?: string; errorMessage?: string; code?: string; errorCode?: string };
		const msg = obj.message ?? obj.errorMessage ?? obj.code ?? obj.errorCode;
		if ( typeof msg === 'string' && msg !== '' ) {
			const err = new Error( msg );

			( err as Error & { code?: string; status?: number } ).code = obj.code ?? obj.errorCode;
			( err as Error & { code?: string; status?: number } ).status = status;
			return err;
		}
	}
	return new Error( `Request failed (${ status }).` );
}
