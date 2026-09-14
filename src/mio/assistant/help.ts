/** Deterministic, section-aware local retrieval. No URLs outside the manifest. */
import type { MioAbility, MioDocument } from './types';

const STOP_WORDS = new Set( 'a an and are as at be by can do for from how i in is it me of on or please that the this to use we what with you your'.split( ' ' ) );
const words = ( text: string ): string[] => ( text.toLocaleLowerCase().match( /[\p{L}\p{N}_-]+/gu ) ?? [] ).filter( ( word ) => ! STOP_WORDS.has( word ) );
const metadata = ( doc: MioDocument ) => ( { id: doc.id, title: doc.title, version: doc.version, topics: doc.topics ?? [], componentIds: doc.componentIds ?? [] } );

function sections( markdown: string ) {
	const result: Array<{ id: string; title: string; markdown: string }> = [];
	const counts = new Map<string, number>();
	let section = { id: 'intro', title: 'Introduction', markdown: '' };
	let fence = '';
	for ( const line of markdown.split( '\n' ) ) {
		const delimiter = line.match( /^\s*(`{3,}|~{3,})/ )?.[ 1 ];
		if ( delimiter ) {
			if ( ! fence ) {
				fence = delimiter;
			} else if ( delimiter[ 0 ] === fence[ 0 ] && delimiter.length >= fence.length ) {
				fence = '';
			}
		}
		const heading = ! fence && line.match( /^#{1,6}\s+(.+?)\s*#*$/ );
		if ( heading ) {
			if ( section.markdown ) {
				result.push( section );
			}
			const slug = heading[ 1 ].toLowerCase().replace( /[^\p{L}\p{N}_-]+/gu, '-' ).replace( /^-|-$/g, '' ) || 'section';
			const count = counts.get( slug ) ?? 0; counts.set( slug, count + 1 );
			section = { id: count ? `${ slug }-${ count }` : slug, title: heading[ 1 ], markdown: '' };
		}
		section.markdown += `${ section.markdown ? '\n' : '' }${ line }`;
	}
	if ( section.markdown ) {
		result.push( section );
	}
	return result;
}

function fingerprint( text: string ): string {
	let hash = 2166136261;
	for ( let i = 0; i < text.length; i++ ) {
		hash = ( hash * 31 + text.charCodeAt( i ) ) % 4294967291;
	}
	return hash.toString( 36 );
}

export function searchMioHelp( documents: readonly MioDocument[], query: string ) {
	const terms = [ ...new Set( words( query ) ) ];
	const exact = query.trim().toLowerCase();
	return documents.map( ( doc ) => {
		const ids = [ doc.id, doc.id.replace( /\.md$/, '' ), doc.title, ...( doc.componentIds ?? [] ), ...( doc.topics ?? [] ) ].map( ( value ) => value.toLowerCase() );
		const identity = ids.includes( exact ) ? 1000 : 0;
		const scored = sections( doc.markdown ).map( ( section ) => {
			const body = new Set( words( section.markdown ) );
			const heading = new Set( words( `${ doc.title } ${ doc.id } ${ section.title } ${ ids.join( ' ' ) }` ) );
			return { section, score: identity + terms.reduce( ( score, term ) => score + ( body.has( term ) ? 1 : 0 ) + ( heading.has( term ) ? 10 : 0 ), 0 ) };
		} ).sort( ( a, b ) => b.score - a.score );
		const best = scored[ 0 ];
		const source = best?.section.markdown ?? '';
		let end = Math.min( source.length, 3200 );
		if ( end < source.length && /[\uD800-\uDBFF]/.test( source[ end - 1 ] ) ) {
			end--;
		}
		const excerpt = source.slice( 0, end );
		return { ...metadata( doc ), score: best?.score ?? 0, section: best?.section.id, excerpt, truncated: ( best?.section.markdown.length ?? 0 ) > excerpt.length,
			sections: scored.slice( 0, 2 ).map( ( item ) => ( { id: item.section.id, title: item.section.title } ) ) };
	} ).filter( ( doc ) => doc.score > 0 ).sort( ( a, b ) => b.score - a.score ).slice( 0, 4 );
}

export function linkedMioHelp( documents: readonly MioDocument[], id: string, sectionId?: string, cursor?: string ) {
	const doc = documents.find( ( entry ) => entry.id === id );
	if ( ! doc ) {
		throw new Error( 'Unknown help document.' );
	}
	const parts = sections( doc.markdown );
	const selected = sectionId ? parts.find( ( part ) => part.id === sectionId ) : null;
	if ( sectionId && ! selected ) {
		throw new Error( 'Unknown help section.' );
	}
	const source = selected?.markdown ?? doc.markdown;
	const revision = fingerprint( `${ id }\n${ doc.version ?? '' }\n${ sectionId ?? '' }\n${ source }` );
	let offset = 0;
	if ( cursor ) {
		const match = cursor.match( /^([a-z0-9]+):(\d+)$/ );
		if ( ! match || match[ 1 ] !== revision || Number( match[ 2 ] ) >= source.length ) {
			throw new Error( 'Invalid or stale help cursor; read the document again.' );
		}
		offset = Number( match[ 2 ] );
	}
	let end = Math.min( source.length, offset + 12000 );
	if ( end < source.length && /[\uD800-\uDBFF]/.test( source[ end - 1 ] ) ) {
		end--;
	}
	const base = new URL( id, 'https://mio.invalid/' );
	const links = [ ...doc.markdown.matchAll( /\]\(([^)\s]+)(?:\s+[^)]*)?\)/g ) ].map( ( match ) => {
		try {
			const url = new URL( match[ 1 ], base ); return url.origin === base.origin ? decodeURIComponent( url.pathname.slice( 1 ) ) : '';
		} catch {
			return '';
		}
	} ).filter( ( path ) => documents.some( ( entry ) => entry.id === path ) );
	return { ...metadata( doc ), section: sectionId, markdown: source.slice( offset, end ), truncated: end < source.length,
		cursor: end < source.length ? `${ revision }:${ end }` : null,
		sections: parts.map( ( part ) => ( { id: part.id, title: part.title } ) ), links: [ ...new Set( links ) ] };
}

export function mioHelpAbilities( documents: readonly MioDocument[] ): MioAbility[] {
	return [ 'search_help', 'read_help' ].map( ( name ) => {
		const key = name === 'search_help' ? 'query' : 'id';
		return { name, effect: 'read',
			description: name === 'search_help' ? 'Search local help by document, topic or exact component ID. Returns section IDs and explicit truncation.' : 'Read a document or section. Follow cursor with the same id and section until truncated is false.',
			parameters: { type: 'object', properties: { [ key ]: { type: 'string' }, ...( name === 'read_help' ? { section: { type: 'string' }, cursor: { type: 'string' } } : {} ) }, required: [ key ], additionalProperties: false },
			validate: ( args ) => {
				const valid = Object.keys( args ).every( ( field ) => ( name === 'read_help' ? [ 'id', 'section', 'cursor' ] : [ 'query' ] ).includes( field ) && typeof args[ field ] === 'string' && ( args[ field ] as string ).length <= 500 ) && typeof args[ key ] === 'string';
				if ( ! valid ) {
					return false;
				}
				if ( name === 'read_help' ) {
					try {
						linkedMioHelp( documents, args.id as string, args.section as string | undefined, args.cursor as string | undefined );
					} catch ( error ) {
						return { ok: false, retryable: true, errors: [ { code: 'help_location', path: '$', message: ( error as Error ).message, suggestion: 'Use search_help to find a current document and section.' } ] };
					}
				}
				return true;
			},
			run: ( args ) => name === 'search_help' ? searchMioHelp( documents, args.query as string ) : linkedMioHelp( documents, args.id as string, args.section as string | undefined, args.cursor as string | undefined ),
		};
	} );
}
