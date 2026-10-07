import { layoutAtlas } from './atlas-layout';
import { __ } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import type { RestFetch } from '../../posts/parts/rest';

export interface AtlasPage {
	id: number;
	parent: number;
	title: { rendered: string };
	link: string;
	slug: string;
	status: string;
	content?: { rendered?: string; protected?: boolean };
}
export interface AtlasEdge { from: number; to: number; kind: 'parent' | 'link' }
export interface AtlasNode { page: AtlasPage; x: number; y: number }
export interface AtlasData { pages: AtlasPage[]; edges: AtlasEdge[]; total: number }
export const SHEET_WIDTH = 300;
export const SHEET_HEIGHT = 258;
export const PREVIEW_WIDTH = 1440;
export const PREVIEW_HEIGHT = 900;
export const PREVIEW_SCALE = 0.2;

export const pageTitle = ( page: AtlasPage ): string => decodeHTML( page.title.rendered ) || __( '(no title)' );

export function previewUrl( page: AtlasPage, origin = location.origin ): string | null {
	try {
		const url = new URL( page.link, origin );
		if ( url.origin !== origin || ! /^https?:$/.test( url.protocol ) || /\/wp-admin(?:\/|$)|\/wp-login\.php/.test( url.pathname ) ) {
			return null;
		}
		url.hash = '';
		if ( ! [ 'publish', 'private' ].includes( page.status ) ) {
			url.searchParams.set( 'preview', 'true' );
		}
		return url.href;
	} catch {
		return null;
	}
}

function linkKey( url: URL ): string {
	const id = url.searchParams.get( 'page_id' ) || url.searchParams.get( 'p' );
	return id ? `${ url.origin }/#${ id }` : `${ url.origin }${ url.pathname.replace( /\/+$/, '' ) }`;
}

export function connectPages( pages: AtlasPage[] ): AtlasEdge[] {
	const byId = new Map( pages.map( ( page ) => [ page.id, page ] ) );
	const paths = new Map< string, number >();
	for ( const page of pages ) {
		try {
			paths.set( linkKey( new URL( page.link ) ), page.id );
		} catch { }
	}
	const result = new Map< string, AtlasEdge >();
	for ( const page of pages ) {
		if ( page.parent && page.parent !== page.id && byId.has( page.parent ) ) {
			result.set( `parent:${ page.parent }:${ page.id }`, { from: page.parent, to: page.id, kind: 'parent' } );
		}
		if ( ! page.content?.rendered || page.content.protected ) {
			continue;
		}
		const doc = new DOMParser().parseFromString( page.content.rendered, 'text/html' );
		for ( const anchor of doc.querySelectorAll( 'a[href]' ) ) {
			try {
				const base = new URL( page.link );
				const url = new URL( anchor.getAttribute( 'href' )!, base );
				if ( url.origin !== base.origin ) {
					continue;
				}
				const rawId = Number( url.searchParams.get( 'page_id' ) || url.searchParams.get( 'p' ) );
				const target = rawId && byId.has( rawId ) ? rawId : paths.get( linkKey( url ) );
				if ( target && target !== page.id ) {
					result.set( `link:${ page.id }:${ target }`, { from: page.id, to: target, kind: 'link' } );
				}
			} catch { }
		}
	}
	return Array.from( result.values() );
}

export async function loadAtlas( fetcher: RestFetch, signal: AbortSignal ): Promise< AtlasData > {
	const pages: AtlasPage[] = [];
	let total = 0;
	let count = 1;
	for ( let page = 1; page <= Math.min( count, 5 ); page++ ) {
		const query = new URLSearchParams( { context: 'edit', status: 'publish,future,draft,pending,private', per_page: '100', page: String( page ), orderby: 'menu_order', order: 'asc', _fields: 'id,parent,title,link,slug,status,content' } );
		const res = await fetcher( `wp/v2/pages?${ query }`, { signal } );
		if ( ! res.ok ) {
			throw new Error( __( 'Pages could not be loaded. Try refreshing the atlas.' ) );
		}
		const batch = await res.json() as AtlasPage[];
		if ( ! Array.isArray( batch ) ) {
			throw new Error( __( 'The page response was invalid.' ) );
		}
		pages.push( ...batch );
		count = Math.max( 1, Number( res.headers.get( 'X-WP-TotalPages' ) ) || 1 );
		total = Number( res.headers.get( 'X-WP-Total' ) ) || pages.length;
	}
	const unique = Array.from( new Map( pages.map( ( page ) => [ page.id, page ] ) ).values() );
	return { pages: unique, edges: connectPages( unique ), total };
}

export function arrangePages( pages: AtlasPage[], frontPageId?: number, edges = connectPages( pages ) ): AtlasNode[] {
	return layoutAtlas( pages, edges, frontPageId );
}
