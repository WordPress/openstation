/**
 * Desktop Mode — File-opener registry (JS side).
 *
 * Mirrors the PHP {@link desktop_mode_register_file_opener}
 * surface with one critical difference: this side carries the
 * executable handlers (URL builders, native-window openers, JS
 * callbacks) that PHP couldn't serialize. Plugins register
 * openers here when they want to teach the desktop a new way to
 * open an entity.
 *
 * Resolution chain on `open( file )`:
 *
 *   1. The user's per-type override read from
 *      `userFileAssociations` in the shell config.
 *   2. The first opener flagged `isDefault: true` for the type.
 *   3. The first registered opener for the type (sort order).
 *   4. No-op (returns `false` to the caller).
 *
 * Three handler kinds are supported:
 *
 *   - `url`     — handler returns a URL; the framework opens it in
 *                 a chromeless iframe window via
 *                 `wp.desktop.windowManager.open`.
 *   - `window`  — handler points at a registered native-window id
 *                 plus optional per-file `config`; the framework
 *                 opens the window by id (see the `config` caveat
 *                 on {@link NativeWindowOpenerHandler}).
 *   - `js`      — handler is a free-form callback the plugin owns.
 *                 Runs in the shell context. Useful for modals,
 *                 quick-actions, "preview" affordances.
 */

import { applyFilters, doAction } from '../hooks';
import type { DesktopFile } from './file';

export interface UrlOpenerHandler {
	kind: 'url';
	/** Build the URL to navigate to. May return a Promise. */
	url: ( file: DesktopFile ) => string | Promise< string >;
	/** Optional window id to reuse. Defaults to a stable id derived from the URL. */
	windowId?: ( file: DesktopFile ) => string;
	/** Optional title override for the opened window. */
	title?: ( file: DesktopFile ) => string;
}

export interface NativeWindowOpenerHandler {
	kind: 'window';
	/** Native-window id registered via `desktop_mode_register_window`. */
	windowId: string;
	/**
	 * Optional per-file config. Caveat: the computed config is
	 * currently dropped by the shell's opener wiring (it opens the
	 * window by id without forwarding it), so it never reaches
	 * `wp.desktop.getWindowConfig` — don't rely on per-file config
	 * delivery yet.
	 */
	config?: ( file: DesktopFile ) => unknown;
}

/**
 * Optional context passed to opener handlers. Provided when the
 * caller knows which placement triggered the open (e.g. a tile
 * dblclick); openers that need the placement's `meta` (saved
 * window geometry, custom names, …) can read it here.
 */
export interface OpenerContext {
	/** The placement that originated the open, when known. */
	placement?: {
		id: number;
		x: number;
		y: number;
		meta: Record< string, unknown > | null;
	};
}

export interface JsOpenerHandler {
	kind: 'js';
	/**
	 * Free-form opener — runs in the shell context. The `ctx`
	 * argument is populated when the caller has placement context;
	 * legacy openers that ignore it keep working.
	 */
	open: ( file: DesktopFile, ctx?: OpenerContext ) => void | Promise< void >;
}

export type OpenerHandler =
	| UrlOpenerHandler
	| NativeWindowOpenerHandler
	| JsOpenerHandler;

export interface FileOpenerDef {
	id: string;
	label: string;
	/** File-type slugs this opener handles. */
	types: string[];
	/** Whether this is the ship-time default for its type(s). */
	isDefault?: boolean;
	/** Sort order in pickers. Lower wins. Default 100. */
	sort?: number;
	/**
	 * Optional per-FILE predicate: the opener only applies to files
	 * it returns true for (e.g. the agent-chat opener applies to
	 * user files whose user is an agent). Openers with a predicate
	 * are excluded from type-level listings where no file is
	 * available to test (the default-apps settings tab).
	 */
	appliesTo?: ( file: DesktopFile ) => boolean;
	handler: OpenerHandler;
}

const seed = new Map< string, FileOpenerDef >();
const listeners = new Set<() => void >();

/** Per-user `{ type: openerId }` association map; written by the settings tab in Phase 5. */
let userAssociations: Record< string, string > = {};

/** Replace the active user-association map. Called once at boot from the shell config. */
export function setUserAssociations( map: Record< string, string > ): void {
	userAssociations = { ...map };
	notify();
}

/** Read the active user-association map. */
export function getUserAssociations(): Record< string, string > {
	return { ...userAssociations };
}

/**
 * Register a file opener. Late registrations win — calling
 * `registerOpener` twice for the same id overwrites the entry.
 */
export function registerOpener( def: FileOpenerDef ): void {
	if ( ! def.id ) {
		throw new Error( '[desktop-mode] registerOpener: `id` is required.' );
	}
	if ( ! def.label ) {
		throw new Error( '[desktop-mode] registerOpener: `label` is required.' );
	}
	if ( ! Array.isArray( def.types ) || def.types.length === 0 ) {
		throw new Error( '[desktop-mode] registerOpener: `types` must be a non-empty array.' );
	}
	if ( ! def.handler || typeof def.handler !== 'object' ) {
		throw new Error( '[desktop-mode] registerOpener: `handler` is required.' );
	}
	seed.set( def.id, {
		id: def.id,
		label: def.label,
		types: def.types.slice(),
		isDefault: !! def.isDefault,
		sort: typeof def.sort === 'number' ? def.sort : 100,
		appliesTo:
			typeof def.appliesTo === 'function' ? def.appliesTo : undefined,
		handler: def.handler,
	} );
	doAction( 'desktop-mode.files.opener-registered', def.id, def );
	notify();
}

/** Unregister an opener. */
export function unregisterOpener( id: string ): void {
	if ( seed.delete( id ) ) {
		doAction( 'desktop-mode.files.opener-unregistered', id );
		notify();
	}
}

/** Lookup a single opener by id. */
export function getOpener( id: string ): FileOpenerDef | null {
	return seed.get( id ) ?? null;
}

/** Returns every registered opener, sorted by `sort` then label, with the filter applied. */
export function getOpeners(): FileOpenerDef[] {
	const list = Array.from( seed.values() ).slice();
	const filtered = applyFilters< FileOpenerDef[], [] >(
		'desktop-mode.files.openers',
		list,
	);
	const arr = Array.isArray( filtered ) ? filtered : list;
	arr.sort( ( a, b ) => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		if ( sa !== sb ) {
			return sa - sb;
		}
		return a.label.localeCompare( b.label );
	} );
	return arr;
}

/**
 * Returns every opener that handles `type`. With a `file`, per-file
 * predicates are evaluated against it; without one, predicate-bearing
 * openers are excluded (there is nothing to test them against).
 */
export function getOpenersForType(
	type: string,
	file?: DesktopFile,
): FileOpenerDef[] {
	return getOpeners()
		.filter( ( e ) => e.types.includes( type ) )
		.filter( ( e ) =>
			e.appliesTo ? file !== undefined && e.appliesTo( file ) : true,
		);
}

/**
 * Resolve the opener that should handle `type` for the current
 * user. Plugins can override the result via the
 * `desktop-mode.files.resolve-opener` filter.
 */
export function resolveOpener(
	type: string,
	file?: DesktopFile,
): FileOpenerDef | null {
	const candidates = getOpenersForType( type, file );
	if ( candidates.length === 0 ) {
		return null;
	}

	// 1. User override.
	const override = userAssociations[ type ];
	let resolved: FileOpenerDef | null = null;
	if ( override ) {
		resolved = candidates.find( ( e ) => e.id === override ) ?? null;
	}
	// 2. Default-flagged opener.
	if ( ! resolved ) {
		resolved = candidates.find( ( e ) => e.isDefault ) ?? null;
	}
	// 3. First match.
	if ( ! resolved ) {
		resolved = candidates[ 0 ];
	}

	const filtered = applyFilters< FileOpenerDef | null, [ string ] >(
		'desktop-mode.files.resolve-opener',
		resolved,
		type,
	);
	return filtered ?? null;
}

/** Subscribe to registry-or-association changes. */
export function subscribeOpeners( cb: () => void ): () => void {
	listeners.add( cb );
	return () => listeners.delete( cb );
}

function notify(): void {
	for ( const cb of listeners ) {
		try {
			cb();
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[desktop-mode] openers subscriber threw:', err );
		}
	}
}

/** Test-only — wipes everything. */
export function __resetOpenersForTests(): void {
	seed.clear();
	listeners.clear();
	userAssociations = {};
}
