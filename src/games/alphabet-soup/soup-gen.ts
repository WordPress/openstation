/**
 * Alphabet Soup — seeded grid generation + selection geometry.
 *
 * `generateSoup()` builds one wave's word-search grid: draw words
 * from the shared dictionary, place them in the 8 compass
 * directions — words NEVER share a cell, every letter belongs to at
 * most one hidden word — then fill the leftover cells with decoy
 * letters drawn mostly from the placed words' own letter bag, so
 * the soup still looks like it is ALL words.
 *
 * Everything here is pure and driven by an injected `rng`, which is
 * what makes the daily puzzle identical worldwide: same date seed +
 * same dictionary asset → same soup for every player.
 */

import type { Dictionary } from '../dictionary';

export interface SoupCell {
	row: number;
	col: number;
}

export interface PlacedWord {
	word: string;
	/** Grid cells the word occupies, first letter first. */
	cells: SoupCell[];
}

export interface SoupGrid {
	size: number;
	/** `letters[row][col]`, lowercase. */
	letters: string[][];
	words: PlacedWord[];
}

/** The 8 compass directions a word can run in. */
const DIRECTIONS: ReadonlyArray< readonly [ number, number ] > = [
	[ 0, 1 ],
	[ 1, 0 ],
	[ 1, 1 ],
	[ 1, -1 ],
	[ 0, -1 ],
	[ -1, 0 ],
	[ -1, -1 ],
	[ -1, 1 ],
];

/** Bounded attempts so generation stays deterministic AND finite. */
const WORD_DRAW_ATTEMPTS = 24;
const PLACEMENT_ATTEMPTS = 120;

/** Share of filler letters drawn from the placed words' letter bag. */
const DECOY_BAG_BIAS = 0.6;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export interface GenerateSoupOptions {
	size: number;
	wordCount: number;
	minLen: number;
	maxLen: number;
	dictionary: Dictionary;
	rng: () => number;
}

/**
 * Generate one wave's soup. Words that cannot be placed after the
 * bounded attempts are dropped (rare on sane configs), so the
 * returned `words` list is the authoritative find-list.
 */
export function generateSoup( opts: GenerateSoupOptions ): SoupGrid {
	const { size, dictionary, rng } = opts;
	const maxLen = Math.min( opts.maxLen, size );
	const minLen = Math.min( opts.minLen, maxLen );

	const letters: Array< Array< string | null > > = [];
	for ( let row = 0; row < size; row++ ) {
		letters.push( new Array( size ).fill( null ) );
	}

	// Draw the word set: unique, in-band, bounded redraws.
	const chosen: string[] = [];
	const seen = new Set< string >();
	for ( let i = 0; i < opts.wordCount; i++ ) {
		for ( let attempt = 0; attempt < WORD_DRAW_ATTEMPTS; attempt++ ) {
			const word = dictionary.pick( minLen, maxLen, rng );
			if ( '' === word || word.length > size || seen.has( word ) ) {
				continue;
			}
			seen.add( word );
			chosen.push( word );
			break;
		}
	}
	// Longest first packs better (short words slot into leftovers).
	chosen.sort( ( a, b ) => b.length - a.length || ( a < b ? -1 : 1 ) );

	const placed: PlacedWord[] = [];
	for ( const word of chosen ) {
		const cells = tryPlaceWord( letters, size, word, rng );
		if ( cells ) {
			placed.push( { word, cells } );
		}
	}

	// Decoy fill: mostly letters the hidden words already use, so
	// near-misses abound and every glance looks promising.
	const bag: string[] = [];
	for ( const entry of placed ) {
		for ( const ch of entry.word ) {
			bag.push( ch );
		}
	}
	const filled: string[][] = letters.map( ( rowLetters ) =>
		rowLetters.map( ( letter ) => {
			if ( null !== letter ) {
				return letter;
			}
			if ( bag.length > 0 && rng() < DECOY_BAG_BIAS ) {
				return bag[ Math.floor( rng() * bag.length ) ];
			}
			return ALPHABET[ Math.floor( rng() * ALPHABET.length ) ];
		} ),
	);

	return { size, letters: filled, words: placed };
}

/** Try to place one word; returns its cells or null. */
function tryPlaceWord(
	letters: Array< Array< string | null > >,
	size: number,
	word: string,
	rng: () => number,
): SoupCell[] | null {
	for ( let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++ ) {
		const dir = DIRECTIONS[ Math.floor( rng() * DIRECTIONS.length ) ];
		const span = word.length - 1;
		// Start range so the word stays in bounds for this direction.
		const rowMin = dir[ 0 ] < 0 ? span : 0;
		const rowMax = dir[ 0 ] > 0 ? size - 1 - span : size - 1;
		const colMin = dir[ 1 ] < 0 ? span : 0;
		const colMax = dir[ 1 ] > 0 ? size - 1 - span : size - 1;
		if ( rowMax < rowMin || colMax < colMin ) {
			continue;
		}
		const row =
			rowMin + Math.floor( rng() * ( rowMax - rowMin + 1 ) );
		const col =
			colMin + Math.floor( rng() * ( colMax - colMin + 1 ) );

		const cells: SoupCell[] = [];
		let fits = true;
		for ( let i = 0; i < word.length; i++ ) {
			const r = row + dir[ 0 ] * i;
			const c = col + dir[ 1 ] * i;
			// No crossings: a cell belongs to at most one hidden word,
			// so a found word's capsule never bites into another word.
			if ( null !== letters[ r ][ c ] ) {
				fits = false;
				break;
			}
			cells.push( { row: r, col: c } );
		}
		if ( ! fits ) {
			continue;
		}
		for ( let i = 0; i < word.length; i++ ) {
			letters[ cells[ i ].row ][ cells[ i ].col ] = word[ i ];
		}
		return cells;
	}
	return null;
}

/**
 * Snap a drag from `anchor` toward `target` onto the nearest of the
 * 8 legal directions and return the covered cells (inclusive). A
 * zero-length drag returns just the anchor.
 */
export function lineCells(
	anchor: SoupCell,
	target: SoupCell,
	size: number,
): SoupCell[] {
	const dRow = target.row - anchor.row;
	const dCol = target.col - anchor.col;
	if ( 0 === dRow && 0 === dCol ) {
		return [ anchor ];
	}
	// Snap the drag angle to the nearest 45° spoke.
	const angle = Math.atan2( dRow, dCol );
	const spoke = Math.round( angle / ( Math.PI / 4 ) );
	const stepRow = [ 0, 1, 1, 1, 0, -1, -1, -1 ][ ( spoke + 8 ) % 8 ];
	const stepCol = [ 1, 1, 0, -1, -1, -1, 0, 1 ][ ( spoke + 8 ) % 8 ];
	const along =
		0 !== stepRow && 0 !== stepCol
			? Math.min( Math.abs( dRow ), Math.abs( dCol ) )
			: Math.abs( 0 !== stepRow ? dRow : dCol );

	const cells: SoupCell[] = [];
	for ( let i = 0; i <= along; i++ ) {
		const row = anchor.row + stepRow * i;
		const col = anchor.col + stepCol * i;
		if ( row < 0 || row >= size || col < 0 || col >= size ) {
			break;
		}
		cells.push( { row, col } );
	}
	return cells;
}

/** Stable key for a cell path (used to compare selections to words). */
function pathKey( cells: SoupCell[] ): string {
	return cells.map( ( cell ) => `${ cell.row }:${ cell.col }` ).join( '|' );
}

/**
 * Match a selection against the grid's words, forwards or
 * backwards. Returns the word index or -1.
 */
export function selectionMatches(
	grid: SoupGrid,
	selection: SoupCell[],
): number {
	if ( selection.length < 2 ) {
		return -1;
	}
	const forward = pathKey( selection );
	const backward = pathKey( selection.slice().reverse() );
	for ( let i = 0; i < grid.words.length; i++ ) {
		const key = pathKey( grid.words[ i ].cells );
		if ( key === forward || key === backward ) {
			return i;
		}
	}
	return -1;
}
