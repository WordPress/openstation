/**
 * OpenStation — deferred Core command-palette runtime.
 *
 * The ⌘K palette's WordPress baseline (Add new post, Manage plugins,
 * Switch theme, …) lives in the `core/commands` store, which only
 * exists once `wp-commands` + `wp-core-commands` — and their whole
 * dependency closure, i.e. the Gutenberg runtime, ~800 KB gzipped —
 * are in the tab. The shell used to enqueue all of it on every boot.
 *
 * It now ships as an ordered manifest in
 * `openStationConfig.commandPalette` (built by
 * `openstation_build_command_palette_assets_payload()`), and this
 * module replays it the first time the palette is invoked:
 *
 *   1. Every missing script URL gets a `<link rel="preload">` up
 *      front, so the whole chain downloads in parallel.
 *   2. The handles then EXECUTE strictly in dependency order —
 *      each through `loadVendorScript()`, which replays the
 *      handle's harvested inline data (translations → l10n →
 *      before → src → after) exactly as `wp_print_scripts()` would
 *      have printed it. Sequential awaits are cheap here: the
 *      preloads already put every file in the HTTP cache.
 *   3. Handles some other plugin already delivered at boot (a store
 *      loads `wp-block-editor` on the dashboard all by itself) are
 *      detected by a same-path DOM sniff and skipped — re-executing
 *      `wp-data` would wipe every registered store.
 *   4. Src-less aggregator handles carry only inline data; their
 *      snippets run at their slot in the order.
 *
 * When the chain has executed, `os-command-palette-ready` fires on
 * `document`; the shell command harvester listens and (re)installs,
 * so the WP baseline appears in the palette moments after its first
 * open. On a site where the runtime was on the page anyway, this
 * resolves without fetching anything and the harvester's idle-time
 * install has already done the work.
 */

import type { DesktopConfig } from '../types';
import {
	findScriptByPath,
	injectInlineScript,
	loadVendorScript,
} from '../wallpapers/vendor-loader';

/** Fired once, after the full chain has executed. */
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

/** Whether the `core/commands` store is reachable already. */
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

/** Warm the HTTP cache for every script the sequential pass will run. */
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
		// Pre-6.9 site (no Core palette), or another caller enqueued
		// the roots at boot and the manifest came back empty — either
		// way there is nothing for us to fetch. The store may still
		// be there courtesy of that other caller.
		return storeReady();
	}

	// Styles don't gate execution — kick them off and move on.
	for ( const style of manifest.styles ?? [] ) {
		injectStyleOnce( style );
	}

	const missing = manifest.scripts.filter(
		( script ) => ! script.url || ! findScriptByPath( script.url ),
	);
	for ( const script of missing ) {
		if ( script.url ) {
			preloadScript( script.url );
		}
	}

	for ( const script of missing ) {
		if ( script.url ) {
			// Sequential on purpose: dependency order is the whole
			// contract (wp-data before wp-core-data before
			// wp-block-editor, api-fetch's nonce middleware between
			// its before/after snippets, …). The preloads above make
			// each await a cache read, not a network round-trip.
			await loadVendorScript( script.url, {
				translations: script.translations,
				l10n: script.l10n,
				before: script.before,
				after: script.after,
			} );
		} else {
			// Src-less aggregator — inline data only, at its slot.
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

/**
 * Bring the Core command-palette runtime into the tab, once.
 *
 * Resolves `true` when the chain is in (or was already there),
 * `false` when there is nothing to load and no store to be found —
 * a pre-6.9 site. Safe to call from every palette entry point; the
 * first call does the work and the rest share its promise.
 *
 * A failed script load rejects through `loadVendorScript`; the
 * in-flight memo is cleared so the next palette open can retry a
 * flaky connection rather than being stuck with half a runtime.
 */
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

/** Test-only: forget the in-flight memo. */
export function __resetCommandPaletteAssetsForTests(): void {
	inflight = null;
}
