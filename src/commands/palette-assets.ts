import { isScriptInDocument } from '../script-presence';
import type { DesktopConfig } from '../types';
import {
	injectInlineScript,
	loadVendorScript,
} from '../wallpapers/vendor-loader';

export const PALETTE_ASSETS_READY_EVENT = 'os-command-palette-ready';

let inflight: Promise< boolean > | null = null;

function getManifest(): NonNullable< DesktopConfig[ 'commandPalette' ] > | null {
	const config = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;
	const manifest = config?.commandPalette;
	if ( ! manifest || ! Array.isArray( manifest.scripts ) ) {
		return null;
	}
	return manifest;
}

function storeReady(): boolean {
	const wp = (
		window as unknown as {
			wp?: { data?: { select?: ( store: string ) => unknown } };
		}
	).wp;
	try {
		return !! wp?.data?.select?.( 'core/commands' );
	} catch {
		return false;
	}
}

function injectStyleOnce( style: {
	handle: string;
	url: string;
	inline?: string[];
} ): void {
	if ( ! style.url ) {
		return;
	}
	const safeUrl = style.url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
	if (
		document.head.querySelector(
			`link[rel="stylesheet"][href="${ safeUrl }"]`,
		)
	) {
		return;
	}
	const link = document.createElement( 'link' );
	link.rel = 'stylesheet';
	link.href = style.url;
	link.dataset.osPaletteStyle = style.handle;
	document.head.appendChild( link );
	for ( const css of style.inline ?? [] ) {
		if ( typeof css !== 'string' || css === '' ) {
			continue;
		}
		const el = document.createElement( 'style' );
		el.dataset.osPaletteStyle = style.handle;
		el.textContent = css;
		document.head.appendChild( el );
	}
}

function preloadScript( url: string ): void {
	const safeUrl = url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
	if ( document.head.querySelector( `link[rel="preload"][href="${ safeUrl }"]` ) ) {
		return;
	}
	const link = document.createElement( 'link' );
	link.rel = 'preload';
	link.as = 'script';
	link.href = url;
	document.head.appendChild( link );
}

async function load(): Promise< boolean > {
	const manifest = getManifest();
	if ( ! manifest || manifest.scripts.length === 0 ) {
		return storeReady();
	}

	for ( const style of manifest.styles ?? [] ) {
		injectStyleOnce( style );
	}

	const seen = new Set< string >();
	const ordered = manifest.scripts.filter( ( script ) => {
		const key = script.handle || script.url;
		if ( ! key || seen.has( key ) ) {
			return false;
		}
		seen.add( key );
		return true;
	} );

	const missing = ordered.filter(
		( script ) => ! script.url || ! isScriptInDocument( script ),
	);
	for ( const script of missing ) {
		if ( script.url ) {
			preloadScript( script.url );
		}
	}

	for ( const script of missing ) {
		if ( script.url ) {
			await loadVendorScript( script.url, {
				handle: script.handle,
				translations: script.translations,
				l10n: script.l10n,
				before: script.before,
				after: script.after,
			} );
		} else {
			for ( const code of [
				script.translations ?? '',
				...( script.l10n ?? [] ),
				...( script.before ?? [] ),
				...( script.after ?? [] ),
			] ) {
				if ( typeof code === 'string' && code !== '' ) {
					injectInlineScript( code );
				}
			}
		}
	}

	document.dispatchEvent( new CustomEvent( PALETTE_ASSETS_READY_EVENT ) );
	return true;
}

export function ensureCommandPaletteAssets(): Promise< boolean > {
	if ( inflight ) {
		return inflight;
	}
	inflight = load().catch( ( err ) => {
		inflight = null;
		throw err;
	} );
	return inflight;
}

export function __resetCommandPaletteAssetsForTests(): void {
	inflight = null;
}
