/**
 * OpenStation — resolve `scriptDeps` handle lists back to payloads.
 *
 * The server sends each script dependency's payload (URL, l10n,
 * before/after, translations) once, in `scriptDepPayloads`, and every
 * entry's `scriptDeps` as a list of handles
 * (`openstation_compact_script_deps()`, GH#892). A dependency shared
 * by N entries used to be serialized N times. This puts the payloads
 * back in place, in the same order, before any loader reads them, so
 * `loadVendorScript()` and `src/script-presence.ts` see exactly what
 * they saw before.
 *
 * A list member that is already an object passes through untouched
 * (an older server, or a REST response that ships full payloads).
 * A handle missing from the map is dropped: the server only omits a
 * dependency that had nothing to fetch and nothing to run.
 */

import type { LazyScriptDependency } from './types';

type DepPayloads = Record< string, Omit< LazyScriptDependency, 'handle' > & { handle?: string } >;

/**
 * Rewrite every `scriptDeps` list under `payload` in place, resolving
 * handles through `payload.scriptDepPayloads`. Returns `payload`.
 *
 * @param payload A boot config or menu-refresh payload.
 */
export function hydrateScriptDeps< T >( payload: T ): T {
	const map = ( payload as { scriptDepPayloads?: unknown } | null )
		?.scriptDepPayloads;
	if ( ! map || typeof map !== 'object' ) {
		return payload;
	}
	walk( payload, map as DepPayloads );
	return payload;
}

function walk( node: unknown, map: DepPayloads ): void {
	if ( Array.isArray( node ) ) {
		for ( const item of node ) {
			walk( item, map );
		}
		return;
	}
	if ( ! node || typeof node !== 'object' ) {
		return;
	}
	const record = node as Record< string, unknown >;
	for ( const key of Object.keys( record ) ) {
		const value = record[ key ];
		if ( key === 'scriptDeps' && Array.isArray( value ) ) {
			record[ key ] = resolve( value, map );
		} else if ( key !== 'scriptDepPayloads' && value && typeof value === 'object' ) {
			walk( value, map );
		}
	}
}

function resolve( list: unknown[], map: DepPayloads ): LazyScriptDependency[] {
	const out: LazyScriptDependency[] = [];
	for ( const dep of list ) {
		if ( typeof dep !== 'string' ) {
			out.push( dep as LazyScriptDependency );
			continue;
		}
		const payload = map[ dep ];
		if ( payload ) {
			out.push( { ...payload, handle: dep } );
		}
	}
	return out;
}
