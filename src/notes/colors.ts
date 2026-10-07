export const NOTE_COLORS = [
	'butter',
	'blush',
	'sky',
	'mint',
	'lilac',
	'peach',
] as const;

export type NoteColor = ( typeof NOTE_COLORS )[ number ];

export function normalizeNoteColor( color: string ): NoteColor {
	return ( NOTE_COLORS as readonly string[] ).includes( color )
		? ( color as NoteColor )
		: NOTE_COLORS[ 0 ];
}

export function sanitizeNoteColorSlug( color: string ): string {
	const slug = color.toLowerCase().replace( /[^a-z0-9_-]/g, '' );
	return slug || NOTE_COLORS[ 0 ];
}

export function nextNoteColor( color: string ): NoteColor {
	const index = ( NOTE_COLORS as readonly string[] ).indexOf(
		normalizeNoteColor( color ),
	);
	return NOTE_COLORS[ ( index + 1 ) % NOTE_COLORS.length ];
}
