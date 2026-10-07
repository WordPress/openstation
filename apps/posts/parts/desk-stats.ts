import { __ } from '@openstation/app';
import type { RestFetch } from './rest';

export interface ContentMetrics { words: number | null; comments: number | null; errors?: Partial< Record< 'words' | 'comments', 'retry' | 'unavailable' > > }

export function countWords( markup: string ): number {
	const doc = new DOMParser().parseFromString( markup, 'text/html' );
	doc.querySelectorAll( 'script, style' ).forEach( ( node ) => node.remove() );
	doc.querySelectorAll( 'p, div, li, h1, h2, h3, h4, h5, h6, br' ).forEach( ( node ) => node.append( doc.createTextNode( ' ' ) ) );
	const text = doc.body.textContent || '';
	const Segmenter = ( Intl as unknown as { Segmenter?: new ( locale: undefined, options: { granularity: 'word' } ) => { segment( input: string ): Iterable< { isWordLike: boolean } > } } ).Segmenter;
	return Segmenter ? Array.from( new Segmenter( undefined, { granularity: 'word' } ).segment( text ) ).filter( ( part ) => part.isWordLike ).length : ( text.match( /[\p{L}\p{N}]+/gu ) || [] ).length;
}

export async function fetchMetrics( fetcher: RestFetch, collection: string, id: number, signal: AbortSignal ): Promise< ContentMetrics > {
	const errors: NonNullable< ContentMetrics['errors'] > = {};
	const read = async ( key: 'words' | 'comments', path: string, init: RequestInit, value: ( res: Response ) => Promise< number | null > ): Promise< number | null > => {
		try {
			const res = await fetcher( path, { ...init, signal }, { silent: true } );
			if ( ! res.ok ) {
				errors[ key ] = res.status === 429 || res.status >= 500 ? 'retry' : 'unavailable'; return null;
			}
			const result = await value( res );
			if ( result === null ) {
				errors[ key ] = 'unavailable';
			}
			return result;
		} catch {
			errors[ key ] = 'retry'; return null;
		}
	};
	const [ words, comments ] = await Promise.all( [
		read( 'words', `wp/v2/${ collection }/${ id }?context=edit&_fields=content`, {}, async ( res ) => {
			const body = await res.json() as { content?: { rendered?: string; protected?: boolean } };
			return typeof body.content?.rendered === 'string' && ! body.content.protected ? countWords( body.content.rendered ) : null;
		} ),
		read( 'comments', `wp/v2/comments?post=${ id }&status=approve&per_page=1`, { method: 'HEAD' }, async ( res ) => {
			const total = res.headers.get( 'X-WP-Total' );
			return total !== null && /^\d+$/.test( total ) ? Number( total ) : null;
		} ),
	] );
	return Object.keys( errors ).length ? { words, comments, errors } : { words, comments };
}

export function createDeskStats( root: HTMLElement, fetcher: RestFetch, collection: 'posts' | 'pages' ): { sync(): void; dispose(): void } {
	const controller = new AbortController();
	const cache = new Map< string, ContentMetrics >();
	const pending = new Set< string >();
	const queue = new Map< string, number >();
	const attempts = new Map< string, number >();
	const timers = new Set< ReturnType< typeof setTimeout > >();
	const observed = new WeakMap< Element, string >();
	let active = 0;
	const paint = (): void => {
		for ( const host of root.querySelectorAll< HTMLElement >( '[data-content-metrics]' ) ) {
			const metrics = cache.get( host.dataset.contentMetrics || '' );
			if ( ! metrics ) {
				continue;
			}
			for ( const key of [ 'words', 'comments' ] as const ) {
				const stat = host.querySelector( `[data-metric="${ key }"]` );
				stat?.setAttribute( 'value', metrics[ key ] === null ? '—' : metrics[ key ]!.toLocaleString() );
				let message = metrics.errors?.[ key ] ? __( 'This count is unavailable or access is restricted.' ) : '';
				if ( metrics.errors?.[ key ] === 'retry' ) {
					message = __( 'Could not load this count.' );
				}
				stat?.setAttribute( 'title', message );
			}
			const key = host.dataset.contentMetrics || '';
			let retry = host.querySelector( '[data-retry-metrics]' );
			if ( Object.values( metrics.errors || {} ).includes( 'retry' ) && ( attempts.get( key ) || 0 ) >= 3 ) {
				if ( ! retry ) {
					retry = document.createElement( 'os-button' ); retry.setAttribute( 'variant', 'ghost' ); retry.setAttribute( 'data-retry-metrics', '' ); retry.textContent = __( 'Retry counts' );
					retry.addEventListener( 'click', () => {
						attempts.delete( key ); cache.delete( key ); retry?.remove(); enqueue( key, Number( host.dataset.postId ) ); pump();
					} ); host.append( retry );
				}
			} else {
				retry?.remove();
			}
		}
	};
	const enqueue = ( key: string, id: number ): void => {
		if ( ! pending.has( key ) && ! controller.signal.aborted ) {
			pending.add( key ); queue.set( key, id );
		}
	};
	const pump = (): void => {
		if ( controller.signal.aborted ) {
			return;
		}
		while ( active < 2 && queue.size ) {
			const [ key, id ] = queue.entries().next().value!;
			queue.delete( key );
			active++; attempts.set( key, ( attempts.get( key ) || 0 ) + 1 );
			void fetchMetrics( fetcher, collection, id, controller.signal ).then( ( result ) => {
				if ( ! controller.signal.aborted ) {
					cache.set( key, result ); paint();
					if ( Object.values( result.errors || {} ).includes( 'retry' ) && attempts.get( key )! < 3 ) {
						const timer = setTimeout( () => {
							timers.delete( timer ); enqueue( key, id ); pump();
						}, 500 * attempts.get( key )! ); timers.add( timer );
					}
				}
			} ).finally( () => {
				pending.delete( key ); active--; pump();
			} );
		}
	};
	const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver( ( entries ) => {
		for ( const entry of entries ) {
			if ( ! entry.isIntersecting ) {
				continue;
			}
			const node = entry.target as HTMLElement;
			const key = node.dataset.contentMetrics || '';
			if ( ! cache.has( key ) ) {
				enqueue( key, Number( node.dataset.postId ) );
			}
			observer?.unobserve( node );
		}
		pump();
	}, { root: root.querySelector( '.os-posts-desk__feed' ), rootMargin: '80px' } );
	return {
		sync: () => {
			paint();
			root.querySelectorAll( '[data-content-metrics]' ).forEach( ( node ) => {
				const key = node.getAttribute( 'data-content-metrics' ) || '';
				if ( observed.get( node ) !== key ) {
					observed.set( node, key ); observer?.observe( node );
				}
			} );
		},
		dispose: () => {
			controller.abort(); observer?.disconnect(); timers.forEach( clearTimeout ); timers.clear(); queue.clear(); cache.clear();
		},
	};
}
