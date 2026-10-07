import { applyFilters, doAction } from '../hooks';
import type { DesktopFile } from './file';

export interface UrlOpenerHandler {
	kind: 'url';

	url: ( file: DesktopFile ) => string | Promise< string >;

	windowId?: ( file: DesktopFile ) => string;

	title?: ( file: DesktopFile ) => string;
}

export interface NativeWindowOpenerHandler {
	kind: 'window';

	windowId: string;

	config?: ( file: DesktopFile ) => unknown;
}

export interface OpenerContext {

	placement?: {
		id: number;
		x: number;
		y: number;
		meta: Record< string, unknown > | null;
	};
}

export interface JsOpenerHandler {
	kind: 'js';

	open: ( file: DesktopFile, ctx?: OpenerContext ) => void | Promise< void >;
}

export type OpenerHandler =
	| UrlOpenerHandler
	| NativeWindowOpenerHandler
	| JsOpenerHandler;

export interface FileOpenerDef {
	id: string;
	label: string;

	types: string[];

	isDefault?: boolean;

	sort?: number;

	appliesTo?: ( file: DesktopFile ) => boolean;
	handler: OpenerHandler;
}

const seed = new Map< string, FileOpenerDef >();
const listeners = new Set<() => void >();

let userAssociations: Record< string, string > = {};

export function setUserAssociations( map: Record< string, string > ): void {
	userAssociations = { ...map };
	notify();
}

export function getUserAssociations(): Record< string, string > {
	return { ...userAssociations };
}

export function registerOpener( def: FileOpenerDef ): void {
	if ( ! def.id ) {
		throw new Error( '[openstation] registerOpener: `id` is required.' );
	}
	if ( ! def.label ) {
		throw new Error( '[openstation] registerOpener: `label` is required.' );
	}
	if ( ! Array.isArray( def.types ) || def.types.length === 0 ) {
		throw new Error( '[openstation] registerOpener: `types` must be a non-empty array.' );
	}
	if ( ! def.handler || typeof def.handler !== 'object' ) {
		throw new Error( '[openstation] registerOpener: `handler` is required.' );
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
	doAction( 'os.files.opener-registered', def.id, def );
	notify();
}

export function unregisterOpener( id: string ): void {
	if ( seed.delete( id ) ) {
		doAction( 'os.files.opener-unregistered', id );
		notify();
	}
}

export function getOpener( id: string ): FileOpenerDef | null {
	return seed.get( id ) ?? null;
}

export function getOpeners(): FileOpenerDef[] {
	const list = Array.from( seed.values() ).slice();
	const filtered = applyFilters< FileOpenerDef[], [] >(
		'os.files.openers',
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

export function resolveOpener(
	type: string,
	file?: DesktopFile,
): FileOpenerDef | null {
	const candidates = getOpenersForType( type, file );
	if ( candidates.length === 0 ) {
		return null;
	}

	const override = userAssociations[ type ];
	let resolved: FileOpenerDef | null = null;
	if ( override ) {
		resolved = candidates.find( ( e ) => e.id === override ) ?? null;
	}

	if ( ! resolved ) {
		resolved = candidates.find( ( e ) => e.isDefault ) ?? null;
	}

	if ( ! resolved ) {
		resolved = candidates[ 0 ];
	}

	const filtered = applyFilters< FileOpenerDef | null, [ string ] >(
		'os.files.resolve-opener',
		resolved,
		type,
	);
	return filtered ?? null;
}

export function subscribeOpeners( cb: () => void ): () => void {
	listeners.add( cb );
	return () => listeners.delete( cb );
}

function notify(): void {
	for ( const cb of listeners ) {
		try {
			cb();
		} catch ( err ) {
			console.error( '[openstation] openers subscriber threw:', err );
		}
	}
}

export function __resetOpenersForTests(): void {
	seed.clear();
	listeners.clear();
	userAssociations = {};
}
