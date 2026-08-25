/**
 * OpenStation — service worker.
 *
 * Built by Vite as its own IIFE bundle (target `pwa-sw`,
 * outputs `assets/js/sw[.min].js`). Served by PHP at
 * `/openstation/sw.js` with `Service-Worker-Allowed: /`.
 *
 * Caching policy — intentionally narrow. wp-admin HTML must NEVER be
 * served from cache: nonces, login state, and per-request screen
 * options would all desynchronise instantly. Our fetch handler
 * follows three rules:
 *
 *   1. Only intercept GETs whose path starts with `/openstation/` or
 *      `/wp-admin/`. Everything else falls through to the network with
 *      no SW involvement.
 *   2. Static assets shipped by this plugin (under
 *      `/wp-content/plugins/desktop-mode/assets/`): CSS / images /
 *      fonts — stale-while-revalidate, letting a returning user open
 *      the shell instantly while the SW updates the cache in the
 *      background. JS bundles — network-first with cache fallback,
 *      so a fresh deploy reaches online users immediately.
 *   3. Shared admin-asset cache (opt-in via the PHP filter
 *      `openstation_pwa_admin_asset_cache`, delivered through the
 *      `self.__OS_SW_CONFIG` preamble): versioned Core static assets
 *      and the `load-scripts.php` / `load-styles.php` concat blobs —
 *      exact-URL cache-first; versioned plugin/theme assets —
 *      stale-while-revalidate. One origin-wide bucket serves the
 *      shell and every chromeless iframe. Policy decisions live in
 *      `sw-policy.ts`.
 *   4. Everything else (HTML, REST, AJAX, uploads, unversioned
 *      URLs) — network-only with an offline fallback for navigation
 *      requests so the user sees a friendly placeholder instead of
 *      the browser's default offline page.
 *
 * The `push` handler is a no-op in v1 — it claims the event so a
 * future v2 push payload doesn't fall through to the browser's
 * default, but emits nothing until the push REST surface ships.
 * The `notificationclick` handler is live: it closes the
 * notification, focuses an existing `/openstation/` window client,
 * or opens `notification.data.url` (default `/openstation/`) when
 * none exists.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
	classifyAdminAssetRequest,
	isCacheableResponse,
	readSwConfig,
} from './sw-policy';

// Minimal local typings for the service-worker global scope. We
// intentionally don't pull in `lib.webworker.d.ts` — it re-declares
// `self`, `clients`, `caches` etc. in a way that collides with the
// `lib.dom.d.ts` declarations the rest of the codebase relies on.
// Instead we cast `globalThis` to a compact local interface and
// route every API call through that typed alias. One file's worth
// of casting beats a project-wide lib swap.
interface SWClient {
	url: string;
	focus?: () => Promise< void >;
}
interface SWClients {
	matchAll: ( opts?: {
		type?: 'window';
		includeUncontrolled?: boolean;
	} ) => Promise< SWClient[] >;
	openWindow?: ( url: string ) => Promise< SWClient | null >;
	claim: () => Promise< void >;
}
interface SWNotificationEvent {
	notification: {
		close: () => void;
		data?: { url?: string };
	};
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWPushEvent {
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWFetchEvent {
	request: Request;
	respondWith: ( r: Response | Promise< Response > ) => void;
}
interface SWExtendableEvent {
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWEventMap {
	install: SWExtendableEvent;
	activate: SWExtendableEvent;
	fetch: SWFetchEvent;
	push: SWPushEvent;
	notificationclick: SWNotificationEvent;
}
interface SWGlobal {
	addEventListener< K extends keyof SWEventMap >(
		type: K,
		fn: ( ev: SWEventMap[ K ] ) => void,
	): void;
	skipWaiting: () => Promise< void >;
	clients: SWClients;
	location: { origin: string; pathname: string };
	/**
	 * Config preamble injected by the PHP endpoint serving this file
	 * (`openstation_pwa_serve_service_worker()`). Optional on purpose:
	 * a body cached without the preamble must still boot with the
	 * defaults `readSwConfig` supplies.
	 */
	__OS_SW_CONFIG?: unknown;
}

// Single typed alias to the SW global. Avoids redeclaring `self`
// (which DOM lib already binds to `Window`) and keeps the call sites
// concise.
const sw = globalThis as unknown as SWGlobal;

const VERSION = '0.8.0-pwa-6';
const STATIC_CACHE = `os-static-${ VERSION }`;
const RUNTIME_CACHE = `os-runtime-${ VERSION }`;
const ADMIN_CACHE = `os-admin-${ VERSION }`;
const OFFLINE_URL = '/openstation/?offline=1';

// Fallback plugin URL for bodies served without the config preamble.
// See `pluginAssetBase()` for the layout caveats this covers.
const FALLBACK_PLUGIN_URL =
	sw.location.origin + '/wp-content/plugins/desktop-mode/';

// Resolved once at evaluation time — the preamble (when present) runs
// before this module body, so the value is already on the global.
const CONFIG = readSwConfig( sw.__OS_SW_CONFIG, FALLBACK_PLUGIN_URL );

// Pathname fragment of the plugin directory, derived from the config
// so non-default layouts (Bedrock etc.) classify their own assets
// correctly. `CONFIG.pluginUrl` is validated by `readSwConfig`.
const OWN_PLUGIN_PATH = new URL( CONFIG.pluginUrl ).pathname;

/**
 * Asset URLs precached on install. Kept narrow on purpose — paths
 * are unversioned, and the runtime cache lookups pass
 * `ignoreSearch: true` so a versioned request like
 * `desktop.min.js?ver=1717519200` finds the cached unversioned
 * `desktop.min.js`. This gives the SW a real-bytes fallback when
 * the network fails or is too slow to serve the navigation —
 * without forcing the SW to know each build's `?ver=` upfront.
 *
 * What goes here: the JS bundles + CSS the shell needs to paint
 * its first frame. Lazy bundles (`window-system`, `shell-overlays`)
 * are included because the main bundle's preloader requests them
 * immediately after first paint, so they're effectively
 * critical-path for any user who opens a window or triggers an
 * overlay.
 *
 * Paths are relative to `/wp-content/plugins/desktop-mode/`; we
 * resolve to the actual origin at install time using `sw.location`.
 *
 * Production builds ship `.min.js`; dev/SCRIPT_DEBUG builds ship
 * the un-minified `.js`. We precache the minified set (the common
 * production shape) and the runtime `staleWhileRevalidate` path
 * picks up the un-minified bundle on demand for any host running
 * with SCRIPT_DEBUG on.
 */
const PRECACHE_PATHS: readonly string[] = [
	'assets/css/desktop.css',
	'assets/css/variables.css',
	'assets/css/dock.css',
	'assets/css/windows.css',
	'assets/js/desktop.min.js',
	'assets/js/window-system.min.js',
	'assets/js/shell-overlays.min.js',
	'assets/images/wp-logo.png',
];

sw.addEventListener( 'install', ( event: SWExtendableEvent ) => {
	event.waitUntil( precache() );
	void sw.skipWaiting();
} );

sw.addEventListener( 'activate', ( event: SWExtendableEvent ) => {
	event.waitUntil(
		( async () => {
			// Drop old cache versions so a deploy doesn't accumulate
			// stale buckets indefinitely. We only keep the current
			// VERSION's caches.
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter( ( k ) => ! k.endsWith( VERSION ) )
					.map( ( k ) => caches.delete( k ) ),
			);
			// Also trim the (versioned) admin-asset bucket, so a bucket
			// that grew past the cap while puts were throttled gets
			// squared away on every activation.
			await pruneAdminCache();
			await sw.clients.claim();
		} )(),
	);
} );

sw.addEventListener( 'fetch', ( event: SWFetchEvent ) => {
	const req = event.request;
	if ( req.method !== 'GET' ) {
		return;
	}
	const url = new URL( req.url );
	if ( url.origin !== sw.location.origin ) {
		return;
	}

	// Only intercept paths under the openstation portal or wp-admin —
	// plus, when the shared admin-asset cache is opted in, versioned
	// static assets anywhere WordPress serves them from (wp-includes
	// lives outside /wp-admin/, and so do plugin/theme directories).
	const isPortal = url.pathname.startsWith( '/openstation/' );
	const isAdmin = url.pathname.startsWith( '/wp-admin/' );
	const isPluginAsset = url.pathname.includes( OWN_PLUGIN_PATH );

	// Range requests must never meet the cache: answering one with a
	// cached 200 full body (or caching a 206) desyncs the consumer.
	const adminAssetClass =
		CONFIG.adminAssetCache && ! req.headers.has( 'range' )
			? classifyAdminAssetRequest( url, OWN_PLUGIN_PATH )
			: 'bypass';

	if (
		! isPortal &&
		! isAdmin &&
		! isPluginAsset &&
		adminAssetClass === 'bypass'
	) {
		return;
	}

	if ( isPluginAsset && isJsAssetPath( url.pathname ) ) {
		// JS bundles change per deploy — `network-first` ensures
		// online users see the latest code immediately, with no
		// stale-revalidate window where a freshly-pushed fix is
		// invisible until the next reload. The cache is still
		// populated as a fallback for offline use. The previous
		// stale-while-revalidate strategy caused PR #121's
		// "install icon hidden in standalone" fix to require a
		// manual refresh inside the PWA window, because the first
		// post-deploy navigation served the cached pre-fix bundle.
		event.respondWith( networkFirstForAsset( req ) );
		return;
	}

	if ( isPluginAsset && isStaticAssetPath( url.pathname ) ) {
		event.respondWith( staleWhileRevalidate( req, RUNTIME_CACHE ) );
		return;
	}

	// Shared admin-asset cache (opt-in via the PHP filter
	// `openstation_pwa_admin_asset_cache`). One origin-wide bucket
	// serves every window: an asset fetched by one chromeless iframe
	// is answered from Cache Storage for every later window. The
	// own-plugin branches above deliberately keep precedence — the
	// policy module classifies our own assets as `own-plugin`, so
	// they can never reach these branches; the guard order here is
	// still explicit because `tests/vitest/sw-policy.test.ts` pins it.
	if ( adminAssetClass === 'core-cache-first' ) {
		event.respondWith( cacheFirstAdminAsset( req ) );
		return;
	}
	if ( adminAssetClass === 'content-swr' ) {
		event.respondWith( staleWhileRevalidate( req, ADMIN_CACHE ) );
		return;
	}

	if ( req.mode === 'navigate' && req.destination === 'document' ) {
		// Only intercept TOP-LEVEL navigations. Iframe navigations
		// (`req.destination === 'iframe'`) pass through directly to
		// the browser. If the SW called `fetch( req )` for an iframe
		// load, Chrome would forward the request with
		// `Sec-Fetch-Dest: empty` instead of `iframe`, and the
		// server-side Sec-Fetch fallback in
		// `openstation_is_chromeless_request()` would fail to
		// detect the chromeless context. The plain-admin → portal
		// redirect would then fire inside a chromeless iframe,
		// rendering the entire desktop shell inside an existing
		// window (the "screen on screen" bug from issue #171).
		// Iframe-targeted offline fallback is not useful anyway —
		// the user-facing offline page is the desktop shell, which
		// is the top-level navigation.
		event.respondWith( networkFirstWithOfflineFallback( req ) );
	}

	// Everything else inside our scoped origin — pass through. We
	// don't want to cache REST / AJAX (they carry nonces, per-request
	// screen state) and HTML in admin pages is never safe to cache.
} );

sw.addEventListener( 'push', ( event: SWPushEvent ) => {
	// v1: no-op. Phase 4 will populate this from the push payload.
	// We claim the event so a hosting environment that signs us up
	// for a push subscription before the v2 PR lands doesn't see
	// silently-dropped pushes — the empty handler still satisfies
	// `Notification` capability checks on browsers that gate them.
	event.waitUntil( Promise.resolve() );
} );

sw.addEventListener( 'notificationclick', ( event: SWNotificationEvent ) => {
	event.notification.close();
	event.waitUntil(
		( async () => {
			const target = event.notification.data?.url ?? '/openstation/';
			const all = await sw.clients.matchAll( {
				type: 'window',
				includeUncontrolled: true,
			} );
			const existing = all.find( ( c ) => c.url.includes( '/openstation/' ) );
			if ( existing ) {
				if ( typeof existing.focus === 'function' ) {
					await existing.focus();
				}
				return;
			}
			if ( sw.clients.openWindow ) {
				await sw.clients.openWindow( target );
			}
		} )(),
	);
} );

async function precache(): Promise< void > {
	try {
		const cache = await caches.open( STATIC_CACHE );
		// Resolve paths against the SW location's origin so the cache
		// keys match what the fetch handler later looks up.
		const base = pluginAssetBase();
		await cache.addAll( PRECACHE_PATHS.map( ( p ) => base + p ) );
	} catch {
		// Best-effort: a missing asset on first install (e.g. a
		// half-deployed bundle) shouldn't strand the SW in a
		// permanent install-failed state.
	}
}

function pluginAssetBase(): string {
	// Plugin URL — handed to us by the PHP serve endpoint via the
	// `self.__OS_SW_CONFIG` preamble, so hosts using a non-default
	// `wp-content/plugins/` directory (Bedrock/Trellis's
	// `web/app/plugins/`, Composer-based sites, custom
	// `WP_CONTENT_DIR`, multisite with `wp-content` moved out) get a
	// working precache too. `readSwConfig` falls back to the
	// conventional path for a body cached without the preamble; in
	// that case precache silently no-ops on exotic layouts (`addAll`
	// rejects on the first 404 and the install handler swallows the
	// error) while runtime caching keeps working off real URLs.
	return CONFIG.pluginUrl;
}

function isStaticAssetPath( pathname: string ): boolean {
	return /\.(css|png|jpg|jpeg|svg|webp|woff2?|ttf|gif|ico)$/i.test(
		pathname,
	);
}

function isJsAssetPath( pathname: string ): boolean {
	return /\.js$/i.test( pathname );
}

/**
 * Network-first with cache fallback. Used for JS bundles so a fresh
 * deploy reaches online users on the very next page load instead of
 * waiting for stale-while-revalidate to catch up. The cache still
 * gets populated so offline users see the most-recent successful
 * fetch.
 *
 * **`cache: 'reload'` is load-bearing.** Without it, `fetch(req)`
 * still honours the browser's *HTTP* cache — a separate layer below
 * the SW. WordPress plugin static assets ship without a
 * `Cache-Control` header from nginx, so Chrome falls back to
 * heuristic freshness and may serve a stale bundle from the HTTP
 * cache without ever hitting the origin. That's how a reinstalled
 * PWA window kept showing the pre-fix bundle: the freshly-opened
 * window inherited Chrome's shared HTTP cache from the regular
 * browser tab that had loaded the old code a minute earlier.
 * `cache: 'reload'` forces a true network fetch (the fetch spec's
 * "reload" mode bypasses the HTTP cache on both request and
 * response paths).
 */
async function networkFirstForAsset( req: Request ): Promise< Response > {
	const cache = await caches.open( RUNTIME_CACHE );
	try {
		// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.os` global available; raw fetch is the API.
		const fresh = await fetch( req.url, { cache: 'reload' } );
		if ( fresh && fresh.status === 200 ) {
			cache.put( req, fresh.clone() ).catch( () => undefined );
		}
		return fresh;
	} catch {
		// Try the runtime cache first (request URL with `?ver=` etc),
		// then fall back to the static precache with `ignoreSearch` so a
		// versioned URL like `desktop.min.js?ver=…` can resolve to the
		// unversioned precached `desktop.min.js`. Without the second
		// lookup, the first navigation after an offline reload would
		// 504 even though the bundle is sitting right there in the
		// install-time precache.
		const cachedRuntime = await cache.match( req );
		if ( cachedRuntime ) {
			return cachedRuntime;
		}
		const staticCache = await caches.open( STATIC_CACHE );
		const cachedStatic = await staticCache.match( req, { ignoreSearch: true } );
		if ( cachedStatic ) {
			return cachedStatic;
		}
		return new Response( '', { status: 504 } );
	}
}

async function staleWhileRevalidate(
	req: Request,
	cacheName: string,
): Promise< Response > {
	const cache = await caches.open( cacheName );
	// **Runtime cache: EXACT match (no `ignoreSearch`).** The runtime
	// cache stores responses keyed by their full URL including any
	// `?ver=<filemtime>` cache-bust suffix WordPress appends on every
	// asset enqueue. We must respect that suffix — earlier versions of
	// this function passed `ignoreSearch: true` here, which collapsed
	// every version of an asset onto the same cache entry. The visible
	// failure: after editing a CSS or JS file, the new `?ver=` URL hit
	// the SWR path, the lookup matched the stale `?ver=` entry, SWR
	// returned the stale bytes immediately. Users saw old CSS / old JS
	// for as long as the SW lived in their profile. Fixed in pwa-5.
	const cached = await cache.match( req );
	// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.os` global available; raw fetch is the API.
	const network = fetch( req )
		.then( ( res ) => {
			if (
				res &&
				isCacheableResponse(
					res.status,
					res.type,
					res.redirected,
					res.headers.get( 'cache-control' ),
				)
			) {
				cache.put( req, res.clone() ).catch( () => undefined );
				if ( cacheName === ADMIN_CACHE ) {
					void pruneAdminCacheThrottled();
				}
			}
			return res;
		} )
		.catch( () => undefined );
	if ( cached ) {
		// Exact `?ver=` hit — genuinely the bytes for this URL.
		// Refresh in the background; return the cached copy now.
		void network;
		return cached;
	}

	// No runtime entry for THIS version. The precache could answer —
	// it stores UNVERSIONED URLs, so an `ignoreSearch` lookup always
	// matches — but it must NOT answer first.
	//
	// That was a real bug, and a long-lived one. Edit a stylesheet →
	// WordPress stamps a new `?ver=<mtime>` → runtime cache misses →
	// the precache matched the OLD bytes with `ignoreSearch: true` and
	// SWR returned them immediately. Every CSS change was invisible on
	// the load that shipped it and only appeared on the next one, for
	// the four sheets in `PRECACHE_PATHS`. The symptom was worst when
	// a stylesheet and a bundle had to land together — freshly-shipped
	// JS rendering elements the stale CSS had no rules for, so icons
	// came out unsized and therefore invisible until a hard reload.
	//
	// A version-mismatched precache entry is stale BY CONSTRUCTION, so
	// it is only ever an offline fallback. Go to the network first and
	// fall back to it if that fails.
	const fresh = await network;
	if ( fresh ) {
		return fresh;
	}
	const staticCache = await caches.open( STATIC_CACHE );
	const precached = await staticCache.match( req, { ignoreSearch: true } );
	if ( precached ) {
		return precached;
	}
	return new Response( '', { status: 504 } );
}

/**
 * Exact-URL cache-first for Core static assets and the concat loader
 * endpoints. Safe because every URL in this class embeds a `ver=`
 * cache-buster: the bytes behind a URL only change when the URL
 * changes (a WordPress update rewrites `ver=<wp_version>` everywhere),
 * which is the same contract Core expresses by serving
 * `load-scripts.php` with a one-year `Cache-Control`.
 *
 * A cache hit never touches the network — that is the whole point:
 * the second window opening any admin page gets its Core CSS/JS from
 * Cache Storage with zero HTTP requests, revalidations included.
 */
async function cacheFirstAdminAsset( req: Request ): Promise< Response > {
	const cache = await caches.open( ADMIN_CACHE );
	const cached = await cache.match( req );
	if ( cached ) {
		return cached;
	}
	// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.os` global available; raw fetch is the API.
	const fresh = await fetch( req );
	if (
		isCacheableResponse(
			fresh.status,
			fresh.type,
			fresh.redirected,
			fresh.headers.get( 'cache-control' ),
		)
	) {
		cache.put( req, fresh.clone() ).catch( () => undefined );
		void pruneAdminCacheThrottled();
	}
	return fresh;
}

/**
 * Cap on the admin-asset bucket. Cache Storage has no native
 * eviction, and an unbounded bucket on a plugin-heavy admin would
 * lean on the origin quota. Entries are immutable-by-URL, so FIFO by
 * insertion order is a fine proxy for "oldest version first" — a
 * re-`put` of an existing key doesn't move it to the tail, but an
 * immutable entry never needs to.
 */
const ADMIN_CACHE_MAX_ENTRIES = 500;
const ADMIN_CACHE_PRUNE_BATCH = 50;
const ADMIN_CACHE_PRUNE_EVERY_N_PUTS = 20;

let _putsSincePrune = 0;

/**
 * Runs the prune every Nth put rather than on every put — `keys()`
 * enumerates the whole bucket, which is too heavy to pay per asset
 * during a page load's burst of 30–60 requests. The activate handler
 * backstops anything the throttle window misses.
 */
async function pruneAdminCacheThrottled(): Promise< void > {
	_putsSincePrune += 1;
	if ( _putsSincePrune < ADMIN_CACHE_PRUNE_EVERY_N_PUTS ) {
		return;
	}
	_putsSincePrune = 0;
	await pruneAdminCache();
}

async function pruneAdminCache(): Promise< void > {
	try {
		const cache = await caches.open( ADMIN_CACHE );
		const keys = await cache.keys();
		if ( keys.length <= ADMIN_CACHE_MAX_ENTRIES ) {
			return;
		}
		// Delete down to (cap − batch) so consecutive puts don't each
		// trigger a full re-prune the moment the cap is grazed again.
		const excess = keys.slice(
			0,
			keys.length - ADMIN_CACHE_MAX_ENTRIES + ADMIN_CACHE_PRUNE_BATCH,
		);
		await Promise.all( excess.map( ( k ) => cache.delete( k ) ) );
	} catch {
		// Best-effort: quota/enumeration failures must never break
		// request handling.
	}
}

async function networkFirstWithOfflineFallback(
	req: Request,
): Promise< Response > {
	try {
		// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.os` global available.
		const fresh = await fetch( req );
		return fresh;
	} catch {
		const cache = await caches.open( STATIC_CACHE );
		const fallback = await cache.match( OFFLINE_URL );
		if ( fallback ) {
			return fallback;
		}
		return new Response(
			'<!doctype html><meta charset="utf-8"><title>Offline</title>' +
				'<p>You appear to be offline. The app will work again as soon as the connection returns.</p>',
			{
				status: 503,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			},
		);
	}
}
