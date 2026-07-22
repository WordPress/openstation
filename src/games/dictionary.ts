/**
 * Games framework — dictionary loading + word picking.
 *
 * The shared dictionary asset (`assets/games/words.txt`, regenerated
 * by `bin/build-game-words.mjs`) is one word per line, `#` comment
 * header, sorted by length ascending then usage frequency
 * descending. Because of that ordering, one pass over the parsed
 * list yields per-length bucket boundaries, and picking from a
 * length band is an index draw — no scanning.
 *
 * Every game receives the asset's URL as the framework-injected
 * `wordsUrl` key on its launch-context `config` (see
 * `desktop_mode_games_words_url()`); the word list is identical for
 * every player, which is what lets seeded games generate the same
 * puzzle worldwide.
 *
 * Pure except for `loadDictionary`'s fetch (routed through
 * `trackedFetch`); `parseDictionary`/`pick` are fully testable.
 *
 * @since 0.9.6 as `src/games/inkfall/dictionary.ts`
 * @since 0.9.8 promoted to the games framework
 */

import { trackedFetch } from '../tracked-fetch';

export interface Dictionary {
	/** Total playable words. */
	size: number;
	/**
	 * Draw a word whose length falls inside `[minLen, maxLen]`.
	 * `rng` is a `() => number` in [0,1). Frequency bias: earlier
	 * (more common) entries in a bucket are favored. When
	 * `avoidInitials` is given, up to three redraws try to dodge
	 * words starting with an already-falling letter.
	 */
	pick: (
		minLen: number,
		maxLen: number,
		rng: () => number,
		avoidInitials?: Set< string >,
	) => string;
}

/** Parse the raw txt: skip blanks + `#` comments, trim CRLF. */
export function parseDictionary( raw: string ): Dictionary {
	const words: string[] = [];
	for ( const line of raw.split( '\n' ) ) {
		const word = line.trim();
		if ( '' === word || word.startsWith( '#' ) ) {
			continue;
		}
		words.push( word );
	}

	// The file is sorted by length ascending — a single scan finds
	// each length's [start, end) slice.
	const bucketStart = new Map< number, number >();
	const bucketEnd = new Map< number, number >();
	for ( let i = 0; i < words.length; i++ ) {
		const len = words[ i ].length;
		if ( ! bucketStart.has( len ) ) {
			bucketStart.set( len, i );
		}
		bucketEnd.set( len, i + 1 );
	}

	const sliceFor = (
		minLen: number,
		maxLen: number,
	): { start: number; end: number } => {
		let start = -1;
		let end = -1;
		for ( let len = minLen; len <= maxLen; len++ ) {
			const s = bucketStart.get( len );
			if ( s === undefined ) {
				continue;
			}
			if ( start === -1 ) {
				start = s;
			}
			end = bucketEnd.get( len ) as number;
		}
		if ( start === -1 ) {
			// Nothing in the band — fall back to the whole list.
			return { start: 0, end: words.length };
		}
		return { start, end };
	};

	const drawOne = (
		minLen: number,
		maxLen: number,
		rng: () => number,
	): string => {
		const { start, end } = sliceFor( minLen, maxLen );
		const span = end - start;
		if ( span <= 0 ) {
			return '';
		}
		// Mild bias toward earlier (more frequent) entries: raising
		// the uniform draw to a power > 1 skews the index low.
		const offset = Math.floor( span * Math.pow( rng(), 1.4 ) );
		return words[ start + Math.min( offset, span - 1 ) ];
	};

	return {
		size: words.length,
		pick: ( minLen, maxLen, rng, avoidInitials ) => {
			let word = drawOne( minLen, maxLen, rng );
			if ( avoidInitials && avoidInitials.size > 0 ) {
				for (
					let attempt = 0;
					attempt < 3 && word !== '' && avoidInitials.has( word[ 0 ] );
					attempt++
				) {
					word = drawOne( minLen, maxLen, rng );
				}
			}
			return word;
		},
	};
}

/**
 * Fetch + parse the dictionary. Aborts with the window's signal so
 * closing the game mid-load cancels the download.
 */
export async function loadDictionary(
	url: string,
	opts: { signal?: AbortSignal; windowId?: string; source?: string } = {},
): Promise< Dictionary > {
	const res = await trackedFetch(
		url,
		{ signal: opts.signal, credentials: 'same-origin' },
		{
			windowId: opts.windowId,
			source: opts.source ?? 'desktop-mode/games-dictionary',
		},
	);
	if ( ! res.ok ) {
		throw new Error(
			`[desktop-mode] Games dictionary failed to load (${ res.status }).`,
		);
	}
	const dictionary = parseDictionary( await res.text() );
	if ( dictionary.size === 0 ) {
		throw new Error( '[desktop-mode] Games dictionary is empty.' );
	}
	return dictionary;
}
