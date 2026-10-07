import { applyFilters, doAction } from '../hooks';
import { DefaultDesktopFile, DesktopFile } from './file';
import type { DesktopFileShape } from './types';

export type DesktopFileClass = new ( shape: DesktopFileShape ) => DesktopFile;

export interface DesktopFileTypeDef {
	type: string;
	label: string;
	sort: number;

	DesktopFile?: DesktopFileClass;
}

const seed = new Map< string, DesktopFileTypeDef >();
const listeners = new Set<() => void >();

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

export function unregisterType( typeSlug: string ): void {
	if ( seed.delete( typeSlug ) ) {
		doAction( 'os.files.type-unregistered', typeSlug );
		notify();
	}
}

export function getType( typeSlug: string ): DesktopFileTypeDef | null {
	const entry = seed.get( typeSlug );
	return entry ? entry : null;
}

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

export function resolve( shape: DesktopFileShape ): DesktopFile {
	const entry = seed.get( shape.type );
	if ( entry?.DesktopFile ) {
		return new entry.DesktopFile( shape );
	}
	return new DefaultDesktopFile( shape, shape.type );
}

export function subscribe( cb: () => void ): () => void {
	listeners.add( cb );
	return () => listeners.delete( cb );
}

function notify(): void {
	for ( const cb of listeners ) {
		try {
			cb();
		} catch ( err ) {
			console.error( '[openstation] files registry subscriber threw:', err );
		}
	}
}

export function __resetForTests(): void {
	seed.clear();
	listeners.clear();
}
