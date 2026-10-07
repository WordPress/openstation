import { trackedFetch } from '../tracked-fetch';

export interface Dictionary {

	size: number;

	pick: (
		minLen: number,
		maxLen: number,
		rng: () => number,
		avoidInitials?: Set< string >,
	) => string;
}

export function parseDictionary( raw: string ): Dictionary {
	const words: string[] = [];
	for ( const line of raw.split( '\n' ) ) {
		const word = line.trim();
		if ( '' === word || word.startsWith( '#' ) ) {
			continue;
		}
		words.push( word );
	}

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
			`[openstation] Games dictionary failed to load (${ res.status }).`,
		);
	}
	const dictionary = parseDictionary( await res.text() );
	if ( dictionary.size === 0 ) {
		throw new Error( '[openstation] Games dictionary is empty.' );
	}
	return dictionary;
}
