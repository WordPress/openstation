/**
 * Client-side resolution of a WordPress release's album art + codename.
 *
 * The server only tells the shell *that* a core update is pending (see
 * `includes/update-notice.php`); the release art lives on the
 * wordpress.org/news announcement, which we fetch here so the update
 * notification can appear once — already as the vinyl, with art loaded —
 * rather than flashing a placeholder toast while the art warms up.
 *
 * The announcement post is titled `WordPress <X.Y> "Codename"`; we
 * search the feed for the branch, match that shape (which excludes
 * maintenance releases and unrelated posts), and take the post's
 * featured image. Results are cached in `localStorage` per branch — hits
 * indefinitely (art doesn't change), misses briefly so a just-published
 * release is picked up soon.
 *
 * @since 0.9.3
 */

import { trackedFetch } from './tracked-fetch';

export interface ReleaseArt {
	name: string;
	artUrl: string;
}

const CACHE_PREFIX = 'desktop-mode/release-art:';
const MISS_TTL_MS = 6 * 60 * 60 * 1000; // retry a miss after 6h

function str( v: unknown ): string {
	return typeof v === 'string' ? v : '';
}
function prop( o: unknown, key: string ): unknown {
	return o && typeof o === 'object'
		? ( o as Record< string, unknown > )[ key ]
		: undefined;
}

/** Decode HTML entities in a REST `title.rendered` (e.g. `&#8220;` → `“`). */
function decodeEntities( s: string ): string {
	const el = document.createElement( 'textarea' );
	el.innerHTML = s;
	return el.value;
}

/** Best featured-image size for the ~150px sleeve, falling back up the ladder. */
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

/**
 * Find the major-announcement post for `branch` in a news-feed response
 * and extract its codename + art. Exported for tests.
 */
export function parseReleaseArt(
	posts: unknown,
	branch: string,
): ReleaseArt | null {
	if ( ! Array.isArray( posts ) ) {
		return null;
	}
	const escaped = branch.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	// "WordPress <branch> "<Codename>"" — version followed by a quoted
	// codename (curly or straight). Excludes "7.0.1 Maintenance Release".
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

function readCache( branch: string ): ReleaseArt | 'miss' | null {
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
			Date.now() - v.ts < MISS_TTL_MS
		) {
			return 'miss';
		}
		return null; // stale miss → refetch
	} catch {
		return null;
	}
}

function writeCache( branch: string, value: object ): void {
	try {
		localStorage.setItem( CACHE_PREFIX + branch, JSON.stringify( value ) );
	} catch {
		// Storage unavailable / full — resolution just won't be cached.
	}
}

/**
 * Resolve `{ name, artUrl }` for a branch, from cache or the news feed.
 * Returns `null` when no announcement/art is found (the shell then falls
 * back to the plain toast).
 */
export async function resolveReleaseArt(
	branch: string,
): Promise< ReleaseArt | null > {
	if ( ! branch ) {
		return null;
	}
	const cached = readCache( branch );
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
			'&per_page=20&_embed=1';
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

/**
 * Preload an image, resolving `true` once it's decoded (so the card can
 * mount with art already painted), `false` on error / timeout.
 */
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
