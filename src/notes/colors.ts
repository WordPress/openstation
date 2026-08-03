/**
 * OpenStation — Pinned notes pastel palette.
 *
 * Mirror of `openstation_notes_colors()` in `includes/notes/cpt.php`
 * — keep both lists in sync. The actual paper/ink values live as CSS
 * custom properties in `assets/css/notes.css`, keyed by
 * `[data-note-color="<slug>"]`.
 */

export const NOTE_COLORS = [
	'butter',
	'blush',
	'sky',
	'mint',
	'lilac',
	'peach',
] as const;

export type NoteColor = ( typeof NOTE_COLORS )[ number ];

/** Clamp an arbitrary string to a BUILT-IN color slug (cycling). */
export function normalizeNoteColor( color: string ): NoteColor {
	return ( NOTE_COLORS as readonly string[] ).includes( color )
		? ( color as NoteColor )
		: NOTE_COLORS[ 0 ];
}

/**
 * Sanitize a color slug for rendering WITHOUT clamping to the
 * built-in palette. The server already whitelists against
 * `openstation_notes_colors()`, which plugins can extend — a
 * filter-added slug (with its own `[data-note-color="..."]` CSS)
 * must survive to the DOM, not get rewritten to butter. Unknown
 * slugs without CSS simply fall back to the default paper via the
 * `var(--dm-note-paper, ...)` fallbacks.
 */
export function sanitizeNoteColorSlug( color: string ): string {
	const slug = color.toLowerCase().replace( /[^a-z0-9_-]/g, '' );
	return slug || NOTE_COLORS[ 0 ];
}

/** The color after `color` in the cycle (wraps). */
export function nextNoteColor( color: string ): NoteColor {
	const index = ( NOTE_COLORS as readonly string[] ).indexOf(
		normalizeNoteColor( color ),
	);
	return NOTE_COLORS[ ( index + 1 ) % NOTE_COLORS.length ];
}
