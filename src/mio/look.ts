/**
 * OpenStation — the user's own Mio, as stored.
 *
 * A {@link MioLook} travels further than most preferences: it is set in
 * the style panel (lazy Mio bundle), held by the controller (shell
 * bundle), stored in the OS Settings blob (`src/settings/state.ts`),
 * POSTed to `/os-settings`, and written to user meta. That is four
 * boundaries, and every one of them can be handed a look that came
 * from a hand-edited localStorage entry, an older release, or another
 * plugin.
 *
 * So the shape check lives here, once, and every boundary calls it.
 *
 * **This is a shape check, not a clamp.** It answers "are these the
 * right keys carrying the right kinds of value", nothing more.
 * Deciding what a *legal* hue or stiffness is remains
 * `sanitizeMioConfig`'s job in `config.ts`, which runs on everything on
 * the way into the simulation regardless of where it came from. Two
 * validators with overlapping opinions about ranges is how ranges
 * drift apart.
 */

import type { MioAppearance, MioLook, MioLookPhysics } from './types';

/**
 * Appearance keys a stored look may carry.
 *
 * A whitelist rather than "whatever was in the object", because this
 * ends up in user meta: an unbounded key set is an unbounded row.
 */
const APPEARANCE_KEYS: readonly ( keyof MioAppearance )[] = [
	'radius',
	'bodyColor',
	'bodyAlpha',
	'hueStart',
	'hueSpan',
	'hueDrift',
	'hueLoop',
	'hueAngle',
	'hueSpin',
	'saturation',
	'lightness',
	'iridescence',
	'outlineWidth',
	'linerWidth',
	'linerColor',
	'glow',
	'glowBlur',
	'eyeColor',
	'eyeScale',
];

/**
 * Physics keys a stored look may carry.
 *
 * Every one of them modulates a rest length. The spring constants are
 * deliberately absent: they are the site's, they interact, and a
 * stored bag that could reach them would be a way for a corrupt
 * preference to make Mio unstable.
 */
export const LOOK_PHYSICS_KEYS: readonly ( keyof MioLookPhysics )[] = [
	'shapePreset',
	'shapeLobes',
	'shapeAmount',
	'shapeAngle',
	'shapeShuffle',
	'idleWobble',
	'idleWobbleSpeed',
];

/** An empty look — no opinions, so the site's Mio shows through. */
export function emptyMioLook(): MioLook {
	return { appearance: {}, physics: {} };
}

/** Whether a value is worth storing under one of the known keys. */
function storable( value: unknown ): boolean {
	return (
		typeof value === 'boolean' ||
		typeof value === 'string' ||
		( typeof value === 'number' && Number.isFinite( value ) )
	);
}

/** Copy across the listed keys, dropping everything else. */
function pick< T extends object >(
	raw: unknown,
	keys: readonly ( keyof T )[],
): Partial< T > {
	const out: Partial< T > = {};
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return out;
	}
	const source = raw as Record< string, unknown >;
	for ( const key of keys ) {
		const value = source[ key as string ];
		if ( value !== undefined && storable( value ) ) {
			Object.assign( out, { [ key ]: value } );
		}
	}
	return out;
}

/**
 * Coerce anything into a well-shaped {@link MioLook}.
 *
 * Never throws and never returns `null`: an unreadable look means the
 * user sees the site's Mio, which is a perfectly good Mio.
 *
 * @param raw Candidate from storage, the server, or a plugin.
 */
export function sanitizeMioLook( raw: unknown ): MioLook {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return emptyMioLook();
	}
	const source = raw as { appearance?: unknown; physics?: unknown };
	return {
		appearance: pick< MioAppearance >( source.appearance, APPEARANCE_KEYS ),
		physics: pick< MioLookPhysics >( source.physics, LOOK_PHYSICS_KEYS ),
	};
}

/**
 * Split a flat "set part of my look" partial into the two groups the
 * config is organised by.
 *
 * The panel — and any plugin driving `setStyle` — thinks in one flat
 * bag of things a user may change; the simulation is organised as
 * appearance versus physics. This is the one place that knows both,
 * and it drops anything belonging to neither. `MioAppearance` and
 * `MioPhysics` share no key names, so the split is unambiguous.
 *
 * @param partial Untrusted flat bag.
 */
export function splitMioLook(
	partial: Partial< MioAppearance & MioLookPhysics >,
): MioLook {
	return {
		appearance: pick< MioAppearance >( partial, APPEARANCE_KEYS ),
		physics: pick< MioLookPhysics >( partial, LOOK_PHYSICS_KEYS ),
	};
}

/** Whether a look has any opinions at all. */
export function isEmptyMioLook( look: MioLook ): boolean {
	return (
		Object.keys( look.appearance ).length === 0 &&
		Object.keys( look.physics ).length === 0
	);
}
