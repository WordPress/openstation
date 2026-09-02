/**
 * OpenStation — Deferred wallpaper hydration.
 *
 * A canvas wallpaper's bundle is the wallpaper: PixiJS scenes, a
 * year's worth of tree growth, a snowfield. Living Tree is 58 KB
 * minified and Snow is 42 KB, and until this module existed both
 * downloaded and parsed on every single admin page load — including
 * for the overwhelming majority of users, who are wearing a flat
 * gradient and will never open the wallpaper picker.
 *
 * So the server-sync registers a **stub** instead: the metadata PHP
 * already declared (id, label, preview swatch, description), enough
 * for the picker to paint a tile and for the registry to hold a
 * valid def, with the script left on the shelf. The real def is
 * fetched at exactly two moments:
 *
 *   - **It is the active wallpaper.** The sync hydrates that one id
 *     eagerly, because the desktop is about to paint it.
 *   - **The user opens the wallpaper picker.** {@link hydrateAll}
 *     pulls every remaining bundle in so live tile previews, the
 *     inline editor and the settings dialog all work exactly as
 *     they did before. This is a click, not a page load.
 *
 * A stub also knows how to hydrate itself: its `mount` loads the
 * bundle, swaps the real def into the registry and delegates. That
 * covers the third path — a plugin or a restored session selecting a
 * canvas wallpaper without going through the picker.
 *
 * State lives in a shared store because the two callers are in
 * different Vite bundles: the sync ships in `desktop.min.js`, the
 * picker in the Preferences app's bundle. Module-level state would
 * give each its own copy and the picker would hydrate nothing (see
 * the cross-bundle note in AGENTS.md).
 */

import { doAction, HOOKS } from '../hooks';
import { loadModules } from '../modules/registry';
import { createSharedStore } from '../shared-store';
import * as registry from './registry';
import { loadVendorScript } from './vendor-loader';
import type { DesktopWallpaperServerEntry } from '../types';
import type {
	CanvasWallpaperDef,
	WallpaperDef,
	WallpaperTeardown,
} from './types';

interface WallpaperGlobals {
	openStationWallpapers?: Record< string, WallpaperDef | undefined >;
}

interface LazyStore {
	/** id → server entry, for everything registered but not yet hydrated. */
	pending: Map< string, DesktopWallpaperServerEntry >;
	/** id → in-flight hydration, so concurrent callers share one load. */
	inflight: Map< string, Promise< WallpaperDef | null > >;
}

const store = createSharedStore< LazyStore >(
	'desktop-mode/wallpaper-lazy',
	() => ( {
		pending: new Map< string, DesktopWallpaperServerEntry >(),
		inflight: new Map< string, Promise< WallpaperDef | null > >(),
	} ),
);

/** Declare an entry as hydratable-on-demand. */
export function setPending( entry: DesktopWallpaperServerEntry ): void {
	store.state.pending.set( entry.id, entry );
}

/** Drop an entry (plugin deactivated, or hydration completed). */
export function clearPending( id: string ): void {
	store.state.pending.delete( id );
}

/** Whether this id is registered as a stub awaiting its bundle. */
export function isPending( id: string ): boolean {
	return store.state.pending.has( id );
}

function readDef( id: string ): WallpaperDef | null {
	const globals =
		( window as unknown as WallpaperGlobals ).openStationWallpapers || {};
	return globals[ id ] ?? null;
}

/**
 * Load one wallpaper's bundle and register the def it publishes.
 *
 * Resolves to the real def, or `null` when the id was never pending
 * (already hydrated, or not a lazy entry — both fine, both mean "no
 * work to do"), when the script fails, or when it loads but
 * publishes nothing on the global.
 *
 * Failures leave the entry pending on purpose: the stub stays in the
 * registry so the picker keeps its tile, and the next attempt
 * re-fetches rather than caching a dead state.
 */
export function hydrate( id: string ): Promise< WallpaperDef | null > {
	const inflight = store.state.inflight.get( id );
	if ( inflight ) {
		return inflight;
	}
	const entry = store.state.pending.get( id );
	if ( ! entry ) {
		return Promise.resolve( null );
	}

	const run = ( async (): Promise< WallpaperDef | null > => {
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'wallpaper-script-load',
				id: entry.id,
				error: err,
			} );
			return null;
		}

		let def = readDef( entry.id );
		// PHP owns metadata: overlay the server-declared description
		// when the JS def didn't carry one (typical — descriptions are
		// registered translatably on the PHP side).
		if ( def && ! def.description && entry.description ) {
			def = { ...def, description: entry.description };
		}
		if ( ! def ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'wallpaper-missing-def',
				id: entry.id,
				error: new Error(
					`[openstation] No wallpaper def on window.openStationWallpapers["${ entry.id }"]. Script loaded but didn't publish a def — check the plugin's enqueue + global assignment.`,
				),
			} );
			return null;
		}

		try {
			// Replaces the stub in place: the registry keys on id and
			// late registrations win.
			registry.register( def );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'wallpaper-register',
				id: entry.id,
				error: err,
			} );
			return null;
		}
		clearPending( entry.id );
		return def;
	} )().finally( () => {
		store.state.inflight.delete( id );
	} );

	store.state.inflight.set( id, run );
	return run;
}

/**
 * Hydrate every wallpaper still waiting on its bundle.
 *
 * Called when the wallpaper picker renders. Loads run concurrently —
 * these are independent bundles and the user is looking at a grid of
 * tiles that each want their own.
 */
export async function hydrateAll(): Promise< void > {
	const ids = Array.from( store.state.pending.keys() );
	if ( ids.length === 0 ) {
		return;
	}
	await Promise.all( ids.map( ( id ) => hydrate( id ) ) );
}

/**
 * Build the placeholder def registered in the bundle's stead.
 *
 * Carries every field the picker paints from, and a `mount` that
 * hydrates-then-delegates so selecting the wallpaper works even if
 * nothing hydrated it first. Typed as a canvas def because that is
 * what the registry's validation demands of anything with a mount —
 * a CSS wallpaper whose value is a plain string never reaches here
 * (the sync registers it outright, no script involved).
 */
export function buildStub(
	entry: DesktopWallpaperServerEntry,
): CanvasWallpaperDef {
	return {
		id: entry.id,
		label: entry.label,
		type: 'canvas',
		preview: entry.preview !== '' ? entry.preview : entry.value,
		description: entry.description || undefined,
		mount: async ( container, ctx ): Promise< WallpaperTeardown > => {
			const def = await hydrate( entry.id );
			if ( ! def || def.type !== 'canvas' ) {
				// Nothing to mount. The CSS `preview` value the layer
				// already painted stays on screen.
				return () => {};
			}
			// `needs` only exists on the real def, so the layer could
			// not have resolved it before calling this stub. Do it
			// here, in the same order the layer would have.
			if ( def.needs && def.needs.length > 0 ) {
				await loadModules( def.needs );
			}
			return def.mount( container, ctx );
		},
	};
}
