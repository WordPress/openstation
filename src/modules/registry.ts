import { loadVendorScript } from '../wallpapers/vendor-loader';

export interface ModuleDef {

	id: string;

	url: string;

	isReady?: () => boolean;
}

const registry = new Map<string, ModuleDef>();

export function registerModule( def: ModuleDef ): void {
	if ( ! def || typeof def.id !== 'string' || def.id === '' ) {
		if ( typeof console !== 'undefined' ) {
			console.warn( '[openstation] Ignored invalid module registration:', def );
		}
		return;
	}
	if ( typeof def.url !== 'string' || def.url === '' ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				`[openstation] Module "${ def.id }" has no url; ignored.`,
			);
		}
		return;
	}
	registry.set( def.id, def );
}

export function getModule( id: string ): ModuleDef | undefined {
	return registry.get( id );
}

export function moduleIds(): string[] {
	return Array.from( registry.keys() );
}

export async function loadModules( ids: string[] ): Promise<void> {
	if ( ! ids || ids.length === 0 ) {
		return;
	}

	const unknown = ids.filter( ( id ) => ! registry.has( id ) );
	if ( unknown.length > 0 ) {
		throw new Error(
			`[openstation] Unknown module(s) in needs: ${ unknown
				.map( ( id ) => `"${ id }"` )
				.join( ', ' ) }. Known modules: ${ moduleIds().join( ', ' ) || '(none)' }.`,
		);
	}

	await Promise.all(
		ids.map( ( id ) => {
			const def = registry.get( id );
			if ( ! def ) {
				return Promise.resolve();
			}
			if ( def.isReady && def.isReady() ) {
				return Promise.resolve();
			}
			return loadVendorScript( def.url );
		} ),
	);
}
