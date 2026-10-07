import { urlActs } from './acting-url';
import { isShellDocumentUrl } from '../shell-url';

export interface SwConfig {

	adminAssetCache: boolean;

	windowPrewarm: boolean;

	pluginUrl: string;

	shellBuild: string;
}

const SHELL_BUILD_RE = /^[a-f0-9]{8,64}$/;

export type AdminAssetClass =
	| 'own-plugin'
	| 'core-cache-first'
	| 'content-swr'
	| 'bypass';

const STATIC_EXTENSION_RE =
	/\.(css|js|png|jpg|jpeg|svg|webp|woff2?|ttf|gif|ico)$/i;

const LOADER_ENDPOINT_RE = /\/wp-admin\/load-(scripts|styles)\.php$/;

export function readSwConfig(
	raw: unknown,
	fallbackPluginUrl: string,
): SwConfig {
	const cfg: SwConfig = {
		adminAssetCache: false,
		windowPrewarm: false,
		pluginUrl: fallbackPluginUrl,
		shellBuild: '',
	};
	if ( ! raw || typeof raw !== 'object' ) {
		return cfg;
	}
	const obj = raw as Record< string, unknown >;
	cfg.adminAssetCache = obj.adminAssetCache === true;
	cfg.windowPrewarm = obj.windowPrewarm === true;
	if ( typeof obj.shellBuild === 'string' && SHELL_BUILD_RE.test( obj.shellBuild ) ) {
		cfg.shellBuild = obj.shellBuild;
	}
	if (
		typeof obj.pluginUrl === 'string' &&
		obj.pluginUrl.startsWith( 'http' )
	) {
		try {
			void new URL( obj.pluginUrl );
			cfg.pluginUrl = obj.pluginUrl.endsWith( '/' )
				? obj.pluginUrl
				: obj.pluginUrl + '/';
		} catch {

		}
	}
	return cfg;
}

export function classifyAdminAssetRequest(
	url: URL,
	ownPluginPath: string,
): AdminAssetClass {
	const path = url.pathname;

	if ( path.includes( ownPluginPath ) ) {
		return 'own-plugin';
	}

	if ( LOADER_ENDPOINT_RE.test( path ) && url.searchParams.has( 'ver' ) ) {
		return 'core-cache-first';
	}

	if ( ! STATIC_EXTENSION_RE.test( path ) ) {
		return 'bypass';
	}
	if ( ! url.searchParams.has( 'ver' ) ) {
		return 'bypass';
	}
	if ( path.includes( '/wp-content/uploads/' ) ) {
		return 'bypass';
	}
	if ( path.includes( '/wp-admin/' ) || path.includes( '/wp-includes/' ) ) {
		return 'core-cache-first';
	}
	if (
		path.includes( '/wp-content/plugins/' ) ||
		path.includes( '/wp-content/themes/' )
	) {
		return 'content-swr';
	}
	return 'bypass';
}

export function isSpeculatableDocument( url: URL ): boolean {
	if ( ! url.pathname.includes( '/wp-admin/' ) ) {
		return false;
	}
	if ( ! url.searchParams.has( 'openstation_chromeless' ) ) {
		return false;
	}

	if ( isShellDocumentUrl( url ) ) {
		return false;
	}
	return ! urlActs( url );
}

export function isCacheableResponse(
	status: number,
	type: string,
	redirected: boolean,
	cacheControl: string | null,
): boolean {
	if ( status !== 200 || redirected ) {
		return false;
	}
	if ( type !== 'basic' && type !== 'default' ) {
		return false;
	}
	if ( cacheControl ) {
		const cc = cacheControl.toLowerCase();
		if ( cc.includes( 'no-store' ) || cc.includes( 'private' ) ) {
			return false;
		}
	}
	return true;
}
