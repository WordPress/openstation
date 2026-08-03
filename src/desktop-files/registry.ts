/**
 * OpenStation — File-type registry (JS side).
 *
 * Mirrors the PHP {@link open_station_register_file_type} surface:
 * maps a type slug to the {@link DesktopFile} subclass that
 * adapts shapes for that type, plus user-facing metadata (label,
 * sort order). Plugins use {@link registerType} to add their own
 * types; built-in types register themselves on bundle boot.
 *
 * The registry is cache-free: every call to {@link getTypes}
 * re-applies the `os.files.types` filter so plugins can
 * reorder, hide, or override entries at filter time.
 */

import { applyFilters, doAction } from '../hooks';
import { DefaultDesktopFile, DesktopFile } from './file';
import type { DesktopFileShape } from './types';

// eslint-disable-next-line func-call-spacing, @typescript-eslint/func-call-spacing
export type DesktopFileClass = new ( shape: DesktopFileShape ) => DesktopFile;

export interface DesktopFileTypeDef {
	type: string;
	label: string;
	sort: number;
	/** Class used to adapt shapes of this type. Optional — falls back to {@link DefaultDesktopFile}. */
	DesktopFile?: DesktopFileClass;
}

const seed = new Map< string, DesktopFileTypeDef >();
const listeners = new Set<() => void >();

/**
 * Register a desktop file type. Late registrations win — calling
 * `registerType` twice for the same slug overwrites the entry,
 * matching the PHP `register_*` semantics.
 */
export function registerType( def: DesktopFileTypeDef ): void {
	if ( ! def.type ) {
		throw new Error( '[openstation] registerType: `type` is required.' );
	}
	if ( ! def.label ) {
		throw new Error( '[openstation] registerType: `label` is required.' );
	}
	seed.set( def.type, {
		type: def.type,
		label: def.label,
		sort: typeof def.sort === 'number' ? def.sort : 100,
		DesktopFile: def.DesktopFile,
	} );
	doAction( 'os.files.type-registered', def.type, def );
	notify();
}

/** Unregister a type. Used by the server-sync module on plugin deactivation. */
export function unregisterType( typeSlug: string ): void {
	if ( seed.delete( typeSlug ) ) {
		doAction( 'os.files.type-unregistered', typeSlug );
		notify();
	}
}

/** Lookup a single type entry by slug, or `null` if unknown. */
export function getType( typeSlug: string ): DesktopFileTypeDef | null {
	const entry = seed.get( typeSlug );
	return entry ? entry : null;
}

/**
 * Returns every registered type, sorted by `sort` then label, with
 * the `os.files.types` filter applied.
 */
export function getTypes(): DesktopFileTypeDef[] {
	const list = Array.from( seed.values() ).slice();
	const filtered = applyFilters< DesktopFileTypeDef[], [] >(
		'os.files.types',
		list,
	);
	const arr = Array.isArray( filtered ) ? filtered : list;
	arr.sort( ( a, b ) => {
		if ( a.sort !== b.sort ) {
			return a.sort - b.sort;
		}
		return a.label.localeCompare( b.label );
	} );
	return arr;
}

/**
 * Resolve a serialized shape into a {@link DesktopFile} instance,
 * picking the registered subclass for `shape.type` or falling back
 * to {@link DefaultDesktopFile} when the type is unknown (so a
 * placement for a deactivated plugin still renders something).
 */
export function resolve( shape: DesktopFileShape ): DesktopFile {
	const entry = seed.get( shape.type );
	if ( entry?.DesktopFile ) {
		return new entry.DesktopFile( shape );
	}
	return new DefaultDesktopFile( shape, shape.type );
}

/** Subscribe to registry changes (UI surfaces re-render on call). */
export function subscribe( cb: () => void ): () => void {
	listeners.add( cb );
	return () => listeners.delete( cb );
}

function notify(): void {
	for ( const cb of listeners ) {
		try {
			cb();
		} catch ( err ) {
			// Don't let a single broken subscriber break the rest.
			// eslint-disable-next-line no-console
			console.error( '[openstation] files registry subscriber threw:', err );
		}
	}
}

/** Test-only — wipes the registry. Not exported via `wp.os.files`. */
export function __resetForTests(): void {
	seed.clear();
	listeners.clear();
}
