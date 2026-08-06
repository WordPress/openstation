/**
 * The gear the OpenStation Preferences tile wears.
 *
 * Hand-drawn rather than borrowed from Dashicons for one reason:
 * `dashicons-admin-generic` IS the gear, and it is also the fallback
 * icon every registry hands to a plugin that registered without art.
 * The one tile that should be findable at a glance would have looked
 * exactly like the tiles nobody bothered to draw.
 *
 * Drawn in `currentColor`, like every other piece of shell art. That
 * keyword is what routes it down the mask path in both painters — the
 * dock masks image icons so a plugin's brand colours cannot break the
 * monochrome rail, and `renderIcon()` masks it to the title bar's own
 * text colour. Fixed fills would survive neither.
 *
 * Held to two shapes — an annulus and eight teeth — because it renders
 * as small as 20px in the dock, where the hole is under 7px across and
 * each tooth is 2.5px wide. Anything more becomes texture.
 */

/** Teeth around the rim. Eight is the count that still reads at 20px. */
const TEETH = 8;

/**
 * One tooth, pointing up, rotated into place around the centre. Radial
 * rather than tangential: an axis-aligned rect rotated about (32, 32)
 * keeps every tooth identical and lets the count change by editing one
 * number.
 */
const tooth = ( index: number ): string =>
	`<rect x="28" y="5" width="8" height="12" rx="2" fill="currentColor" transform="rotate(${
		( 360 / TEETH ) * index
	} 32 32)"/>`;

/**
 * The gear as standalone SVG source, in a 64×64 viewBox — the same
 * canvas the other hand-placed shell icons use.
 *
 * The rim is a stroked circle, so the hub is negative space rather than
 * a second shape: one element, and the hole can never drift off-centre.
 * The teeth are drawn first so the rim's stroke covers where they meet
 * it, which is what keeps the joins from showing.
 */
export const OS_GEAR_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
	Array.from( { length: TEETH }, ( _, i ) => tooth( i ) ).join( '' ) +
	'<circle cx="32" cy="32" r="15.5" fill="none" stroke="currentColor" stroke-width="9"/>' +
	'</svg>';

/**
 * The same art as a base64 data URI, ready for `renderIcon()` and for
 * any `icon:` field in the dock / desktop-icon / window APIs.
 */
export const OS_GEAR_ICON = `data:image/svg+xml;base64,${ btoa( OS_GEAR_SVG ) }`;
