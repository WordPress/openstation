/**
 * Stable string-to-hue helper.
 *
 * Maps an arbitrary input string into the hue circle (0–359) using a
 * lite djb2 hash, so a label like "Jetpack" or a user name like
 * "Daniel López" always paints the same color across reloads. Used
 * by the dock's letter-tile fallback and `<wpd-avatar>`'s initials
 * fallback to give each subject a stable visual identity without
 * shipping art.
 *
 * Cheap, deterministic, not security-adjacent. Empty input falls back
 * to a neutral blue-gray so callers don't have to guard against it.
 */

export function hashTitleToHue( input: string ): number {
	if ( ! input ) {
		return 214; // Neutral blue-gray.
	}
	// djb2 with `hash * 33 + c`. `Math.imul` keeps the multiplication
	// inside int32 range without bitwise ops (the WP ESLint preset
	// disallows those), preserving enough entropy that realistic
	// inputs spread around the hue circle.
	let hash = 5381;
	for ( let i = 0; i < input.length; i++ ) {
		hash = Math.imul( hash, 33 ) + input.charCodeAt( i );
	}
	return ( ( hash % 360 ) + 360 ) % 360;
}
