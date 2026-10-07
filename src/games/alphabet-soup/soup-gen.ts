import type { Dictionary } from '../dictionary';

export interface SoupCell {
	row: number;
	col: number;
}

export interface PlacedWord {
	word: string;

	cells: SoupCell[];
}

export interface SoupGrid {
	size: number;

	letters: string[][];
	words: PlacedWord[];
}

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

const WORD_DRAW_ATTEMPTS = 24;
const PLACEMENT_ATTEMPTS = 120;

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

export function generateSoup( opts: GenerateSoupOptions ): SoupGrid {
	const { size, dictionary, rng } = opts;
	const maxLen = Math.min( opts.maxLen, size );
	const minLen = Math.min( opts.minLen, maxLen );

	const letters: Array< Array< string | null > > = [];
	for ( let row = 0; row < size; row++ ) {
		letters.push( new Array( size ).fill( null ) );
	}

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

	chosen.sort( ( a, b ) => b.length - a.length || ( a < b ? -1 : 1 ) );

	const placed: PlacedWord[] = [];
	for ( const word of chosen ) {
		const cells = tryPlaceWord( letters, size, word, rng );
		if ( cells ) {
			placed.push( { word, cells } );
		}
	}

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

function tryPlaceWord(
	letters: Array< Array< string | null > >,
	size: number,
	word: string,
	rng: () => number,
): SoupCell[] | null {
	for ( let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++ ) {
		const dir = DIRECTIONS[ Math.floor( rng() * DIRECTIONS.length ) ];
		const span = word.length - 1;

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

function pathKey( cells: SoupCell[] ): string {
	return cells.map( ( cell ) => `${ cell.row }:${ cell.col }` ).join( '|' );
}

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
