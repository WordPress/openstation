/**
 * Desktop Mode — service worker.
 *
 * Built by Vite as its own IIFE bundle (target `pwa-sw`,
 * outputs `assets/js/sw[.min].js`). Served by PHP at
 * `/desktop-mode/sw.js` with `Service-Worker-Allowed: /`.
 *
 * Caching policy — intentionally narrow. wp-admin HTML must NEVER be
 * served from cache: nonces, login state, and per-request screen
 * options would all desynchronise instantly. Our fetch handler
 * follows three rules:
 *
 *   1. Only intercept GETs whose path starts with `/desktop-mode/` or
 *      `/wp-admin/`. Everything else falls through to the network with
 *      no SW involvement.
 *   2. Static assets shipped by this plugin (CSS / JS / icons under
 *      `/wp-content/plugins/desktop-mode/assets/`) — stale-while-
 *      revalidate. Lets a returning user open the shell instantly
 *      while the SW updates the cache in the background.
 *   3. Everything else (HTML, REST, AJAX) — network-only with an
 *      offline fallback for navigation requests so the user sees a
 *      friendly placeholder instead of the browser's default offline
 *      page.
 *
 * Push + notification-click handlers are registered as no-ops in v1.
 * They claim the events so a future v2 push payload doesn't fall
 * through to the browser's default — but emit nothing themselves
 * until the push REST surface ships.
 *
 * @since 0.8.0
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

const VERSION = '0.8.0-pwa-2';
const STATIC_CACHE = `desktop-mode-static-${ VERSION }`;
const RUNTIME_CACHE = `desktop-mode-runtime-${ VERSION }`;
const OFFLINE_URL = '/desktop-mode/?offline=1';

/**
 * Asset URLs precached on install. Kept tiny on purpose — additional
 * assets are picked up at runtime via stale-while-revalidate. We only
 * need enough here to render the shell shell-of-a-shell when offline.
 *
 * Paths are relative to `/wp-content/plugins/desktop-mode/`; we
 * resolve to the actual origin at install time using `sw.location`.
 */
const PRECACHE_PATHS: readonly string[] = [
	'assets/css/desktop.css',
	'assets/css/variables.css',
	'assets/css/dock.css',
	'assets/css/windows.css',
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

	// Only intercept paths under the desktop-mode portal or wp-admin.
	const isPortal = url.pathname.startsWith( '/desktop-mode/' );
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

	if ( req.mode === 'navigate' ) {
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
			const target = event.notification.data?.url ?? '/desktop-mode/';
			const all = await sw.clients.matchAll( {
				type: 'window',
				includeUncontrolled: true,
			} );
			const existing = all.find( ( c ) => c.url.includes( '/desktop-mode/' ) );
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
	const here = sw.location.pathname;
	const idx = here.indexOf( '/desktop-mode/' );
	const origin = sw.location.origin;
	// Plugin URL — we can't read DESKTOP_MODE_URL from JS-side, so
	// hardcode the conventional path. Hosts using a non-default
	// `wp-content/plugins/` path will see the precache silently
	// no-op; runtime caching still works because it keys off the
	// real URL the page asks for.
	if ( idx >= 0 ) {
		return origin + '/wp-content/plugins/desktop-mode/';
	}
	return origin + '/wp-content/plugins/desktop-mode/';
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
 */
async function networkFirstForAsset( req: Request ): Promise< Response > {
	const cache = await caches.open( RUNTIME_CACHE );
	try {
		// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.desktop` global available; raw fetch is the API.
		const fresh = await fetch( req );
		if ( fresh && fresh.status === 200 ) {
			cache.put( req, fresh.clone() ).catch( () => undefined );
		}
		return fresh;
	} catch {
		const cached = await cache.match( req );
		if ( cached ) {
			return cached;
		}
		return new Response( '', { status: 504 } );
	}
}

async function staleWhileRevalidate( req: Request ): Promise< Response > {
	const cache = await caches.open( RUNTIME_CACHE );
	const cached = await cache.match( req );
	// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.desktop` global available; raw fetch is the API.
	const network = fetch( req )
		.then( ( res ) => {
			if ( res && res.status === 200 ) {
				cache.put( req, res.clone() ).catch( () => undefined );
			}
			return res;
		} )
		.catch( () => undefined );
	if ( cached ) {
		// Refresh in the background; return the cached copy now.
		void network;
		return cached;
	}
	const fresh = await network;
	if ( fresh ) {
		return fresh;
	}
	return new Response( '', { status: 504 } );
}

async function networkFirstWithOfflineFallback(
	req: Request,
): Promise< Response > {
	try {
		// eslint-disable-next-line no-restricted-syntax -- service-worker context, no `wp.desktop` global available.
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
