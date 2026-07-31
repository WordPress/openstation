/**
 * Desktop Mode — Module registry.
 *
 * Shared vendor-library system. A "module" is a named bundle (typically
 * a runtime library like PixiJS, Three.js, confetti) that ships at a
 * known URL and lights up a global once loaded. Plugins declare
 * dependencies by id — `needs: ['pixijs']` — instead of hardcoding
 * vendor paths, so the shell owns the URL indirection and duplicate
 * loads are deduped across plugins.
 *
 * Any plugin can also register its own modules (a graphics engine,
 * a chart library, a sound engine), making them available to other
 * plugins by id. This is the building block for a cross-plugin
 * shared-dependency story that keeps bundle sizes down without
 * forcing everyone through our vendor/ folder.
 */

import { loadVendorScript } from '../wallpapers/vendor-loader';

/**
 * One vendor module the shell knows how to fetch on demand.
 */
export interface ModuleDef {
	/**
	 * Stable id used by plugins in `needs: [...]`. Conventionally
	 * lowercase with no spaces — `pixijs`, `threejs`, `confetti`.
	 */
	id: string;
	/**
	 * Fully-qualified URL the module ships at. The shell loads it via
	 * the shared {@link loadVendorScript} memoized `<script>` injector,
	 * so concurrent loads dedupe naturally.
	 */
	url: string;
	/**
	 * Optional readiness probe. When present, the shell skips the
	 * script-tag injection if it returns true (e.g. the library is
	 * already loaded by Core or another plugin). Most callers leave
	 * this undefined and rely on the memoized loader to dedupe.
	 */
	isReady?: () => boolean;
}

const registry = new Map<string, ModuleDef>();

/**
 * Register a module. Late registration wins (overwrites any prior
 * registration for the same id) — matches the `register_*` semantics
 * of WordPress's own APIs.
 */
export function registerModule( def: ModuleDef ): void {
	if ( ! def || typeof def.id !== 'string' || def.id === '' ) {
		if ( typeof console !== 'undefined' ) {
			console.warn( '[desktop-mode] Ignored invalid module registration:', def );
		}
		return;
	}
	if ( typeof def.url !== 'string' || def.url === '' ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				`[desktop-mode] Module "${ def.id }" has no url; ignored.`,
			);
		}
		return;
	}
	registry.set( def.id, def );
}

/** Lookup by id — exposed so plugins can introspect what's available. */
export function getModule( id: string ): ModuleDef | undefined {
	return registry.get( id );
}

/** Every registered module id, in registration order. */
export function moduleIds(): string[] {
	return Array.from( registry.keys() );
}

/**
 * Ensure every listed module is loaded. Unknown ids reject the whole
 * batch with a readable error — loud failure is better than a silent
 * "wallpaper didn't start" for plugin authors debugging a typo.
 *
 * Concurrent calls dedupe via the underlying `loadVendorScript`
 * memoization, so two wallpapers depending on `pixijs` share a single
 * fetch even if they activate at the same time.
 */
export async function loadModules( ids: string[] ): Promise<void> {
	if ( ! ids || ids.length === 0 ) {
		return;
	}

	const unknown = ids.filter( ( id ) => ! registry.has( id ) );
	if ( unknown.length > 0 ) {
		throw new Error(
			`[desktop-mode] Unknown module(s) in needs: ${ unknown
				.map( ( id ) => `"${ id }"` )
				.join( ', ' ) }. Known modules: ${ moduleIds().join( ', ' ) || '(none)' }.`,
		);
	}

	await Promise.all(
		ids.map( ( id ) => {
			const def = registry.get( id );
			if ( ! def ) {
				// Unreachable — we filtered unknowns above — but the
				// compiler can't see through that.
				return Promise.resolve();
			}
			if ( def.isReady && def.isReady() ) {
				return Promise.resolve();
			}
			return loadVendorScript( def.url );
		} ),
	);
}
