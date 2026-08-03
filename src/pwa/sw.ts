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
 *   3. Everything else (HTML, REST, AJAX) — network-only with an
 *      offline fallback for navigation requests so the user sees a
 *      friendly placeholder instead of the browser's default offline
 *      page.
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
}

// Single typed alias to the SW global. Avoids redeclaring `self`
// (which DOM lib already binds to `Window`) and keeps the call sites
// concise.
const sw = globalThis as unknown as SWGlobal;

const VERSION = '0.8.0-pwa-5';
const STATIC_CACHE = `os-static-${ VERSION }`;
const RUNTIME_CACHE = `os-runtime-${ VERSION }`;
const OFFLINE_URL = '/openstation/?offline=1';

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

	// Only intercept paths under the openstation portal or wp-admin.
	const isPortal = url.pathname.startsWith( '/openstation/' );
	const isAdmin = url.pathname.startsWith( '/wp-admin/' );
	const isPluginAsset = url.pathname.includes(
		'/wp-content/plugins/desktop-mode/',
	);
	if ( ! isPortal && ! isAdmin && ! isPluginAsset ) {
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
		event.respondWith( staleWhileRevalidate( req ) );
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
	// Plugin URL — we can't read OPENSTATION_URL from the JS-side
	// service-worker context, so we hardcode the conventional path.
	// Hosts using a non-default `wp-content/plugins/` directory
	// (Bedrock/Trellis's `web/app/plugins/`, Composer-based sites,
	// custom `WP_CONTENT_DIR`, multisite with `wp-content` moved out)
	// will see precache silently no-op — `addAll` rejects on the
	// first 404 and the install handler swallows the error. Runtime
	// caching still works because it keys off the real URL the page
	// requests, so the only user-visible loss is the install-time
	// precache warmup.
	//
	// TODO: in the next SW revision, surface the plugin URL via the
	// PHP-side `?ver=` query string (`<script src="…/sw.js?plugin_url=…">`)
	// so non-standard install layouts get the precache benefit too.
	// Today this lives as a hardcoded fallback because every
	// non-trivial alternative needs that PHP-side handoff.
	return sw.location.origin + '/wp-content/plugins/desktop-mode/';
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

async function staleWhileRevalidate( req: Request ): Promise< Response > {
	const cache = await caches.open( RUNTIME_CACHE );
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
			if ( res && res.status === 200 ) {
				cache.put( req, res.clone() ).catch( () => undefined );
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
