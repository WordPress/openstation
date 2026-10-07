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

	pending: Map< string, DesktopWallpaperServerEntry >;

	inflight: Map< string, Promise< WallpaperDef | null > >;
}

const store = createSharedStore< LazyStore >(
	'desktop-mode/wallpaper-lazy',
	() => ( {
		pending: new Map< string, DesktopWallpaperServerEntry >(),
		inflight: new Map< string, Promise< WallpaperDef | null > >(),
	} ),
);

export function setPending( entry: DesktopWallpaperServerEntry ): void {
	store.state.pending.set( entry.id, entry );
}

export function clearPending( id: string ): void {
	store.state.pending.delete( id );
}

export function isPending( id: string ): boolean {
	return store.state.pending.has( id );
}

function readDef( id: string ): WallpaperDef | null {
	const globals =
		( window as unknown as WallpaperGlobals ).openStationWallpapers || {};
	return globals[ id ] ?? null;
}

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

				deps: entry.scriptDeps,
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

export async function hydrateAll(): Promise< void > {
	const ids = Array.from( store.state.pending.keys() );
	if ( ids.length === 0 ) {
		return;
	}
	await Promise.all( ids.map( ( id ) => hydrate( id ) ) );
}

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
				return () => {};
			}

			if ( def.needs && def.needs.length > 0 ) {
				await loadModules( def.needs );
			}
			return def.mount( container, ctx );
		},
	};
}
