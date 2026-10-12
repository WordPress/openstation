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
 * ENTRY DEPTH ONLY, mirroring the server: the payload's top-level
 * values are entry lists, and only a `scriptDeps` directly on one of
 * those entries is the shell's. A deeper one is a plugin's metadata
 * and is left exactly as it arrived.
 *
 * A list member that is already an object passes through untouched
 * (an older server, or a REST response that ships full payloads).
 * The server guarantees every handle it sends has a map entry, so a
 * handle without one came from somewhere else. It is dropped, since
 * there is nothing to load, and the drop is logged rather than silent.
 */

import type { LazyScriptDependency } from './types';

type DepPayloads = Record< string, Omit< LazyScriptDependency, 'handle' > & { handle?: string } >;

/**
 * Rewrite every entry's `scriptDeps` in place, resolving handles
 * through `payload.scriptDepPayloads`. Returns `payload`.
 *
 * @param payload A boot config or menu-refresh payload.
 */
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
