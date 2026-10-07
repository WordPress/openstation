import { trackedFetch } from './tracked-fetch';

export interface ReleaseArt {
	name: string;
	artUrl: string;
}

const CACHE_PREFIX = 'desktop-mode/release-art:v1:';
const MISS_TTL_MS = 6 * 60 * 60 * 1000;

const PENDING_MISS_TTL_MS = 30 * 60 * 1000;

function str( v: unknown ): string {
	return typeof v === 'string' ? v : '';
}
function prop( o: unknown, key: string ): unknown {
	return o && typeof o === 'object'
		? ( o as Record< string, unknown > )[ key ]
		: undefined;
}

function decodeEntities( s: string ): string {
	const el = document.createElement( 'textarea' );
	el.innerHTML = s;
	return el.value;
}

function pickMedia( post: unknown ): string {
	const media = prop( prop( post, '_embedded' ), 'wp:featuredmedia' );
	const first = Array.isArray( media ) ? media[ 0 ] : undefined;
	const sizes = prop( prop( first, 'media_details' ), 'sizes' );
	for ( const key of [ 'medium_large', 'large', '1536x1536', 'medium' ] ) {
		const url = str( prop( prop( sizes, key ), 'source_url' ) );
		if ( url ) {
			return url;
		}
	}
	return str( prop( first, 'source_url' ) );
}

export function parseReleaseArt(
	posts: unknown,
	branch: string,
): ReleaseArt | null {
	if ( ! Array.isArray( posts ) ) {
		return null;
	}
	const escaped = branch.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

	const re = new RegExp(
		'^WordPress ' + escaped + '\\s*[“"]([^”"]+)[”"]',
	);
	for ( const post of posts ) {
		const title = decodeEntities( str( prop( prop( post, 'title' ), 'rendered' ) ) );
		const m = re.exec( title );
		if ( ! m ) {
			continue;
		}
		const artUrl = pickMedia( post );
		if ( artUrl ) {
			return { name: m[ 1 ].trim(), artUrl };
		}
	}
	return null;
}

function readCache(
	branch: string,
	missTtlMs: number,
): ReleaseArt | 'miss' | null {
	try {
		const raw = localStorage.getItem( CACHE_PREFIX + branch );
		if ( ! raw ) {
			return null;
		}
		const v = JSON.parse( raw ) as Record< string, unknown >;
		if ( v.ok === true && str( v.name ) && str( v.artUrl ) ) {
			return { name: str( v.name ), artUrl: str( v.artUrl ) };
		}
		if (
			v.ok === false &&
			typeof v.ts === 'number' &&
			Date.now() - v.ts < missTtlMs
		) {
			return 'miss';
		}
		return null;
	} catch {
		return null;
	}
}

function writeCache( branch: string, value: object ): void {
	try {
		localStorage.setItem( CACHE_PREFIX + branch, JSON.stringify( value ) );
	} catch {

	}
}

export async function resolveReleaseArt(
	branch: string,
	announcementPending = false,
): Promise< ReleaseArt | null > {
	if ( ! branch ) {
		return null;
	}
	const cached = readCache(
		branch,
		announcementPending ? PENDING_MISS_TTL_MS : MISS_TTL_MS,
	);
	if ( cached === 'miss' ) {
		return null;
	}
	if ( cached ) {
		return cached;
	}

	try {
		const url =
			'https://wordpress.org/news/wp-json/wp/v2/posts?search=' +
			encodeURIComponent( branch ) +
			'&per_page=100&_fields=title,_links,_embedded&_embed=wp:featuredmedia';
		const res = await trackedFetch(
			url,
			{ credentials: 'omit' },
			{ silent: true, source: 'desktop-mode/release-art' },
		);
		if ( ! res.ok ) {
			writeCache( branch, { ok: false, ts: Date.now() } );
			return null;
		}
		const art = parseReleaseArt( await res.json(), branch );
		if ( art ) {
			writeCache( branch, { ok: true, name: art.name, artUrl: art.artUrl } );
			return art;
		}
		writeCache( branch, { ok: false, ts: Date.now() } );
		return null;
	} catch {
		writeCache( branch, { ok: false, ts: Date.now() } );
		return null;
	}
}

export function preloadImage(
	url: string,
	timeoutMs = 5000,
): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		let done = false;
		const finish = ( ok: boolean ): void => {
			if ( done ) {
				return;
			}
			done = true;
			resolve( ok );
		};
		img.addEventListener( 'load', () => finish( true ), { once: true } );
		img.addEventListener( 'error', () => finish( false ), { once: true } );
		window.setTimeout( () => finish( false ), timeoutMs );
		img.src = url;
	} );
}
