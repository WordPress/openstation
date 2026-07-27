/**
 * Desktop Mode — Screen-effect chain resolution.
 *
 * Pure functions turning the user's saved `screenEffects` OS setting
 * into an ordered, validated list of effects the stage can build
 * filters from. No DOM, no Pixi, no module state — which is what lets
 * the whole ordering / clamping / sanitizing contract be unit-tested
 * without a WebGL context.
 *
 * Two distinct jobs, deliberately kept apart:
 *
 * - `sanitizeScreenEffectSelection()` validates *shape* only (id
 *   syntax, numeric params, list length). It runs in `state.ts` while
 *   parsing persisted settings, where the registry may not be loaded
 *   yet — an effect from a plugin that hasn't booted must survive the
 *   round-trip, not get dropped.
 * - `resolveEffectChain()` matches the sanitized selection against the
 *   effects actually registered *right now*, filling parameter
 *   defaults and sorting by `order`.
 *
 * @since 0.9.8
 */

import type {
	ResolvedScreenEffect,
	ScreenEffectDef,
	ScreenEffectSelection,
} from './types';

/**
 * Upper bound on how many effects a user can stack. Each one is a
 * full-screen render pass over the entire desktop, so this is a
 * performance guard as much as a storage guard.
 */
export const MAX_SCREEN_EFFECTS = 8;

/** Chain position used when a def does not declare `order`. */
export const DEFAULT_EFFECT_ORDER = 100;

/** Cap on parameters per effect — mirrors the server-side sanitizer. */
const MAX_PARAMS_PER_EFFECT = 24;

const SCREEN_EFFECT_ID = /^[a-z0-9_/-]+$/;
const SCREEN_EFFECT_PARAM_KEY = /^[a-zA-Z0-9_]+$/;

/**
 * Validate the persisted shape of the `screenEffects` setting.
 *
 * Tolerant by design: anything malformed is dropped rather than
 * throwing, because this parses data that may have been hand-edited in
 * user meta or written by an older version. Unknown ids are *kept* —
 * resolution against the registry happens later, and a plugin's effect
 * must not be erased from the user's chain just because the plugin
 * happened to be inactive on this page load.
 *
 * @param raw Untrusted value from localStorage / the REST snapshot.
 * @return Clean selection list, capped at {@link MAX_SCREEN_EFFECTS}.
 */
export function sanitizeScreenEffectSelection(
	raw: unknown,
): ScreenEffectSelection[] {
	if ( ! Array.isArray( raw ) ) {
		return [];
	}

	const out: ScreenEffectSelection[] = [];
	const seen = new Set< string >();

	for ( const entry of raw ) {
		if ( out.length >= MAX_SCREEN_EFFECTS ) {
			break;
		}
		if ( ! entry || typeof entry !== 'object' ) {
			continue;
		}

		const rawId = ( entry as ScreenEffectSelection ).id;
		if ( typeof rawId !== 'string' ) {
			continue;
		}
		const id = rawId.trim().toLowerCase();
		if ( ! SCREEN_EFFECT_ID.test( id ) || seen.has( id ) ) {
			continue;
		}
		seen.add( id );

		const selection: ScreenEffectSelection = { id };
		const rawParams = ( entry as ScreenEffectSelection ).params;
		if ( rawParams && typeof rawParams === 'object' ) {
			const params: Record< string, number > = {};
			let count = 0;
			for ( const [ key, value ] of Object.entries( rawParams ) ) {
				if ( count >= MAX_PARAMS_PER_EFFECT ) {
					break;
				}
				if ( ! SCREEN_EFFECT_PARAM_KEY.test( key ) ) {
					continue;
				}
				const num = typeof value === 'number' ? value : Number( value );
				if ( ! Number.isFinite( num ) ) {
					continue;
				}
				params[ key ] = num;
				count++;
			}
			if ( count > 0 ) {
				selection.params = params;
			}
		}

		out.push( selection );
	}

	return out;
}

/**
 * Fill in every declared parameter for an effect, clamping the user's
 * values into range and substituting `default` for anything missing or
 * non-finite. Parameters the def does not declare are dropped, so a
 * stale saved value can never reach a shader as an unknown uniform.
 *
 * @param def      Effect definition.
 * @param supplied The user's saved values, if any.
 */
export function resolveParams(
	def: ScreenEffectDef,
	supplied?: Record< string, number >,
): Record< string, number > {
	const out: Record< string, number > = {};
	for ( const param of def.params ?? [] ) {
		const raw = supplied?.[ param.key ];
		const value = Number.isFinite( raw ) ? ( raw as number ) : param.default;
		out[ param.key ] = Math.min( param.max, Math.max( param.min, value ) );
	}
	return out;
}

/**
 * Match the user's selection against the registered effects and return
 * the chain in render order.
 *
 * Selections whose id is not registered are skipped silently — that is
 * the normal state of affairs for an effect whose plugin is deactivated,
 * not an error worth logging on every settings change.
 *
 * Ties on `order` keep the user's selection order, so a chain of
 * same-order effects stays predictable.
 *
 * @param selection Sanitized user selection.
 * @param defs      Effects currently registered (post-filter).
 */
export function resolveEffectChain(
	selection: readonly ScreenEffectSelection[],
	defs: readonly ScreenEffectDef[],
): ResolvedScreenEffect[] {
	const byId = new Map( defs.map( ( def ) => [ def.id, def ] ) );

	return selection
		.map( ( entry, index ) => {
			const def = byId.get( entry.id );
			return def ? { def, params: resolveParams( def, entry.params ), index } : null;
		} )
		.filter( ( e ): e is ResolvedScreenEffect & { index: number } => e !== null )
		.sort( ( a, b ) => {
			const orderA = a.def.order ?? DEFAULT_EFFECT_ORDER;
			const orderB = b.def.order ?? DEFAULT_EFFECT_ORDER;
			return orderA === orderB ? a.index - b.index : orderA - orderB;
		} )
		.map( ( { def, params } ) => ( { def, params } ) );
}

/**
 * Whether two resolved chains would render identically — same effects,
 * same order, same parameter values. Lets the stage skip a rebuild when
 * an unrelated OS setting changes and the subscriber fires anyway.
 *
 * @param a Previous chain.
 * @param b Next chain.
 */
export function chainsAreEqual(
	a: readonly ResolvedScreenEffect[],
	b: readonly ResolvedScreenEffect[],
): boolean {
	if ( a.length !== b.length ) {
		return false;
	}
	return a.every( ( entry, i ) => {
		const other = b[ i ];
		if ( entry.def !== other.def ) {
			return false;
		}
		const keys = Object.keys( entry.params );
		if ( keys.length !== Object.keys( other.params ).length ) {
			return false;
		}
		return keys.every( ( key ) => entry.params[ key ] === other.params[ key ] );
	} );
}
