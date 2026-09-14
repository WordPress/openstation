/** Bounded local retrieval. Links resolve only inside the caller's manifest. */
import type { MioAbility, MioDocument } from './types';

const words = ( text: string ): string[] => text.toLocaleLowerCase().match( /[\p{L}\p{N}_-]+/gu ) ?? [];

export function searchMioHelp( documents: readonly MioDocument[], query: string ) {
	const terms = [ ...new Set( words( query ) ) ];
	return documents
		.map( ( doc ) => {
			const sections = doc.markdown.split( /\n(?=##? )/ );
			const scored = sections
				.map( ( section ) => ( {
					text: section,
					score: terms.reduce(
						( score, term ) =>
							score +
							( section.toLocaleLowerCase().includes( term ) ? 1 : 0 ) +
							( doc.title.toLocaleLowerCase().includes( term ) ? 2 : 0 ),
						0,
					),
				} ) )
				.sort( ( a, b ) => b.score - a.score );
			return {
				id: doc.id,
				title: doc.title,
				score: scored[ 0 ]?.score ?? 0,
				excerpt: scored
					.slice( 0, 2 )
					.map( ( s ) => s.text )
					.join( '\n' )
					.slice( 0, 3200 ),
			};
		} )
		.filter( ( doc ) => doc.score > 0 )
		.sort( ( a, b ) => b.score - a.score )
		.slice( 0, 4 );
}

export function linkedMioHelp( documents: readonly MioDocument[], id: string ) {
	const doc = documents.find( ( entry ) => entry.id === id );
	if ( ! doc ) {
		throw new Error( 'Unknown help document.' );
	}
	const base = new URL( id, 'https://mio.invalid/' );
	const links = [ ...doc.markdown.matchAll( /\]\(([^)\s]+)(?:\s+[^)]*)?\)/g ) ]
		.map( ( match ) => {
			try {
				const url = new URL( match[ 1 ], base );
				return url.origin === base.origin ? decodeURIComponent( url.pathname.slice( 1 ) ) : '';
			} catch {
				return '';
			}
		} )
		.filter( ( path ) => documents.some( ( entry ) => entry.id === path ) );
	return {
		id,
		title: doc.title,
		markdown: doc.markdown.slice( 0, 12000 ),
		links: [ ...new Set( links ) ],
	};
}

export function mioHelpAbilities( documents: readonly MioDocument[] ): MioAbility[] {
	return [ 'search_help', 'read_help' ].map( ( name ) => {
		const key = name === 'search_help' ? 'query' : 'id';
		return {
			name,
			description:
				name === 'search_help'
					? 'Search this window’s Markdown help. Use before explaining unfamiliar settings.'
					: 'Read a help document and discover linked documents in the same collection.',
			parameters: {
				type: 'object',
				properties: { [ key ]: { type: 'string' } },
				required: [ key ],
				additionalProperties: false,
			},
			validate: ( args ) =>
				Object.keys( args ).length === 1 &&
				typeof args[ key ] === 'string' &&
				( args[ key ] as string ).length <= 500,
			run: ( args ) =>
				name === 'search_help'
					? searchMioHelp( documents, args.query as string )
					: linkedMioHelp( documents, args.id as string ),
		};
	} );
}
