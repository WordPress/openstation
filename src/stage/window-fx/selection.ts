/**
 * Desktop Mode — window-effect selection sanitizing.
 *
 * Pure, no DOM, no Pixi: the shape validation for the `windowEffects`
 * OS setting, shared by the settings state parser and the public
 * `updateOsSettings` path. Mirrors `sanitizeScreenEffectSelection()`
 * next door, and the PHP sanitizer in `includes/os-settings.php` — keep
 * the three in step.
 *
 * As there, unknown effect ids are KEPT: an effect belonging to a
 * deactivated plugin must survive the round-trip and light up again on
 * reactivation. Resolution against the live registry happens at play
 * time.
 *
 * @since 0.9.8
 */

import {
	WINDOW_TRANSITIONS,
	type WindowEffectSelection,
	type WindowTransition,
} from './types';

const EFFECT_ID = /^[a-z0-9_/-]+$/;
const PARAM_KEY = /^[a-zA-Z0-9_]+$/;

/** Cap on parameters per effect — mirrors the server-side sanitizer. */
const MAX_PARAMS = 24;

/**
 * Validate the persisted shape of `windowEffects`.
 *
 * @param raw Untrusted value from localStorage / the REST snapshot.
 * @return Map of transition → selection, with unknown transitions and
 *         malformed entries dropped.
 */
export function sanitizeWindowEffectSelection(
	raw: unknown,
): Record< string, WindowEffectSelection > {
	const out: Record< string, WindowEffectSelection > = {};
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return out;
	}

	for ( const [ key, value ] of Object.entries(
		raw as Record< string, unknown >,
	) ) {
		if ( ! WINDOW_TRANSITIONS.includes( key as WindowTransition ) ) {
			continue;
		}
		if ( ! value || typeof value !== 'object' ) {
			continue;
		}

		const rawId = ( value as WindowEffectSelection ).id;
		if ( typeof rawId !== 'string' ) {
			continue;
		}
		const id = rawId.trim().toLowerCase();
		if ( ! EFFECT_ID.test( id ) ) {
			continue;
		}

		const selection: WindowEffectSelection = { id };
		const rawParams = ( value as WindowEffectSelection ).params;
		if ( rawParams && typeof rawParams === 'object' ) {
			const params: Record< string, number > = {};
			let count = 0;
			for ( const [ paramKey, paramValue ] of Object.entries(
				rawParams,
			) ) {
				if ( count >= MAX_PARAMS ) {
					break;
				}
				if ( ! PARAM_KEY.test( paramKey ) ) {
					continue;
				}
				const num =
					typeof paramValue === 'number'
						? paramValue
						: Number( paramValue );
				if ( ! Number.isFinite( num ) ) {
					continue;
				}
				params[ paramKey ] = num;
				count++;
			}
			if ( count > 0 ) {
				selection.params = params;
			}
		}

		out[ key ] = selection;
	}

	return out;
}
