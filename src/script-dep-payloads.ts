import type { LazyScriptDependency } from './types';

type DepPayloads = Record< string, Omit< LazyScriptDependency, 'handle' > & { handle?: string } >;

export function hydrateScriptDeps< T >( payload: T ): T {
	const map = ( payload as { scriptDepPayloads?: unknown } | null )
		?.scriptDepPayloads;
	if ( ! map || typeof map !== 'object' ) {
		return payload;
	}
	const record = payload as Record< string, unknown >;
	for ( const key of Object.keys( record ) ) {
		if ( key === 'scriptDepPayloads' ) {
			continue;
		}
		const entries = record[ key ];
		if ( ! entries || typeof entries !== 'object' ) {
			continue;
		}
		for ( const entry of Object.values( entries as Record< string, unknown > ) ) {
			if ( ! entry || typeof entry !== 'object' ) {
				continue;
			}
			const deps = ( entry as { scriptDeps?: unknown } ).scriptDeps;
			if ( Array.isArray( deps ) ) {
				( entry as { scriptDeps: unknown } ).scriptDeps = resolve( deps, map as DepPayloads, key );
			}
		}
	}
	return payload;
}

function resolve( list: unknown[], map: DepPayloads, where: string ): LazyScriptDependency[] {
	const out: LazyScriptDependency[] = [];
	for ( const dep of list ) {
		if ( typeof dep !== 'string' ) {
			out.push( dep as LazyScriptDependency );
			continue;
		}
		const payload = map[ dep ];
		if ( payload ) {
			out.push( { ...payload, handle: dep } );
			continue;
		}
		console.warn( `[openstation] ${ where }: script dependency "${ dep }" is not in scriptDepPayloads and was dropped.` );
	}
	return out;
}
