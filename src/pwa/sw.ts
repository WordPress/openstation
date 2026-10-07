import {
	classifyAdminAssetRequest,
	isCacheableResponse,
	isSpeculatableDocument,
	readSwConfig,
} from './sw-policy';
import { SPECULATIVE_MAX, SpeculativeStore } from './speculative-store';
import { applyFlagMessage } from './sw-flags';

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
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWExtendableEvent {
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWMessageEvent {
	data?: unknown;

	source?: { postMessage: ( data: unknown ) => void } | null;
	waitUntil: ( p: Promise< unknown > ) => void;
}
interface SWEventMap {
	install: SWExtendableEvent;
	activate: SWExtendableEvent;
	fetch: SWFetchEvent;
	push: SWPushEvent;
	notificationclick: SWNotificationEvent;
	message: SWMessageEvent;
}
interface SWGlobal {
	addEventListener< K extends keyof SWEventMap >(
		type: K,
		fn: ( ev: SWEventMap[ K ] ) => void,
	): void;
	skipWaiting: () => Promise< void >;
	clients: SWClients;
	location: { origin: string; pathname: string };
	registration: { scope: string };

	__OS_SW_CONFIG?: unknown;
}

const sw = globalThis as unknown as SWGlobal;

const VERSION = '0.8.0-pwa-6';
const STATIC_CACHE = `os-static-${ VERSION }`;
const RUNTIME_CACHE = `os-runtime-${ VERSION }`;
const ADMIN_CACHE = `os-admin-${ VERSION }`;

const SCOPE_PATH = ( () => {
	try {
		const path = new URL( sw.registration.scope ).pathname;
		return path.endsWith( '/' ) ? path : `${ path }/`;
	} catch {
		return '/';
	}
} )();
const OFFLINE_URL = `${ SCOPE_PATH }openstation/?offline=1`;

const FALLBACK_PLUGIN_URL =
	sw.location.origin + '/wp-content/plugins/desktop-mode/';

const CONFIG = readSwConfig( sw.__OS_SW_CONFIG, FALLBACK_PLUGIN_URL );

const OWN_PLUGIN_PATH = new URL( CONFIG.pluginUrl ).pathname;

let windowPrewarmEnabled = CONFIG.windowPrewarm;

let adminAssetCacheEnabled = CONFIG.adminAssetCache;

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
} );

sw.addEventListener( 'activate', ( event: SWExtendableEvent ) => {
	event.waitUntil(
		( async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter( ( k ) => ! k.endsWith( VERSION ) )
					.map( ( k ) => caches.delete( k ) ),
			);

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

	if ( url.pathname.endsWith( '/wp-login.php' ) ) {
		speculative.clear();
		event.waitUntil( caches.delete( SESSION_CACHE ) );
		return;
	}

	const isPortal = url.pathname.startsWith( `${ SCOPE_PATH }openstation/` );
	const isAdmin = url.pathname.startsWith( `${ SCOPE_PATH }wp-admin/` );
	const isPluginAsset = url.pathname.includes( OWN_PLUGIN_PATH );

	const adminAssetClass =
		adminAssetCacheEnabled && ! req.headers.has( 'range' )
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
		event.respondWith( networkFirstForAsset( req ) );
		return;
	}

	if ( isPluginAsset && isStaticAssetPath( url.pathname ) ) {
		event.respondWith( staleWhileRevalidate( req, RUNTIME_CACHE ) );
		return;
	}

	if ( adminAssetClass === 'core-cache-first' ) {
		event.respondWith( cacheFirstAdminAsset( req ) );
		return;
	}
	if ( adminAssetClass === 'content-swr' ) {
		event.respondWith( staleWhileRevalidate( req, ADMIN_CACHE ) );
		return;
	}

	if ( req.mode === 'navigate' && req.cache === 'reload' ) {
		speculative.take( url.toString() );
	} else if ( req.mode === 'navigate' && speculative.size > 0 ) {
		const held = speculative.take( url.toString() );
		if ( held ) {
			event.respondWith(
				held.then( ( res ) => {
					if ( res ) {
						return res;
					}

					return fetch( req );
				} ),
			);
			return;
		}
	}

	if ( req.mode === 'navigate' && req.destination === 'document' ) {
		event.waitUntil( replayRestoreTargets() );

		event.respondWith( networkFirstWithOfflineFallback( req ) );
	}
} );

const speculative = new SpeculativeStore();

const SESSION_CACHE = `os-session-${ VERSION }`;
const SESSION_KEY = '/__openstation_restore_targets__';

let lastReplayAt = 0;
const REPLAY_THROTTLE_MS = 3_000;

async function replayRestoreTargets(): Promise< void > {
	const now = Date.now();
	if ( ! windowPrewarmEnabled || now - lastReplayAt < REPLAY_THROTTLE_MS ) {
		return;
	}
	lastReplayAt = now;
	try {
		const cache = await caches.open( SESSION_CACHE );
		const stored = await cache.match( SESSION_KEY );
		if ( ! stored ) {
			return;
		}
		const urls = ( await stored.json() ) as unknown;
		if ( ! Array.isArray( urls ) ) {
			return;
		}
		for ( const raw of urls.slice( 0, SPECULATIVE_MAX ) ) {
			if ( typeof raw !== 'string' ) {
				continue;
			}
			try {
				const url = new URL( raw );
				if (
					url.origin === sw.location.origin &&
					isSpeculatableDocument( url )
				) {
					beginSpeculation( url.toString() );
				}
			} catch {

			}
		}
	} catch {

	}
}

sw.addEventListener( 'message', ( event: SWMessageEvent ) => {
	const data = event.data as
		| { type?: string; url?: string; urls?: unknown }
		| undefined;

	if ( data && data.type === 'os-sw-get-build' ) {
		try {
			event.source?.postMessage( {
				type: 'os-sw-build',
				shellBuild: CONFIG.shellBuild,
			} );
		} catch {

		}
		return;
	}

	if ( data && data.type === 'os-sw-skip-waiting' ) {
		void sw.skipWaiting();
		return;
	}

	const flagUpdate = applyFlagMessage( data, {
		windowPrewarm: windowPrewarmEnabled,
		adminAssetCache: adminAssetCacheEnabled,
	} );
	if ( flagUpdate ) {
		windowPrewarmEnabled = flagUpdate.flags.windowPrewarm;
		adminAssetCacheEnabled = flagUpdate.flags.adminAssetCache;
		if ( flagUpdate.clearSpeculative ) {
			speculative.clear();
		}
		if ( flagUpdate.dropSessionCache ) {
			event.waitUntil( caches.delete( SESSION_CACHE ) );
		}
		return;
	}

	if ( data && data.type === 'os-remember-session' ) {
		if ( ! windowPrewarmEnabled ) {
			return;
		}
		const urls = Array.isArray( data.urls ) ? data.urls : [];
		event.waitUntil(
			( async () => {
				try {
					const cache = await caches.open( SESSION_CACHE );
					await cache.put(
						SESSION_KEY,
						new Response( JSON.stringify( urls.slice( 0, SPECULATIVE_MAX ) ), {
							headers: { 'Content-Type': 'application/json' },
						} ),
					);
				} catch {

				}
			} )(),
		);
		return;
	}

	if ( ! data || data.type !== 'os-speculate-doc' || ! data.url ) {
		return;
	}
	if ( ! windowPrewarmEnabled ) {
		return;
	}
	let url: URL;
	try {
		url = new URL( data.url );
	} catch {
		return;
	}
	if ( url.origin !== sw.location.origin || ! isSpeculatableDocument( url ) ) {
		return;
	}
	const started = beginSpeculation( url.toString() );
	if ( started ) {
		event.waitUntil( started );
	}
} );

function beginSpeculation( href: string ): Promise< Response | null > | null {
	if ( speculative.has( href ) ) {
		return null;
	}
	const inFlight = ( async () => {
		try {
			const res = await fetch( href, {
				credentials: 'same-origin',
				redirect: 'follow',
			} );

			if ( res.status !== 200 || res.redirected ) {
				return null;
			}
			return res;
		} catch {
			return null;
		}
	} )();

	speculative.put( href, inFlight );
	return inFlight;
}

sw.addEventListener( 'push', ( event: SWPushEvent ) => {
	event.waitUntil( Promise.resolve() );
} );

sw.addEventListener( 'notificationclick', ( event: SWNotificationEvent ) => {
	event.notification.close();
	event.waitUntil(
		( async () => {
			const target =
				event.notification.data?.url ?? `${ SCOPE_PATH }openstation/`;
			const all = await sw.clients.matchAll( {
				type: 'window',
				includeUncontrolled: true,
			} );
			const existing = all.find( ( c ) =>
				c.url.includes( `${ SCOPE_PATH }openstation/` ),
			);
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

		const base = pluginAssetBase();
		await cache.addAll( PRECACHE_PATHS.map( ( p ) => base + p ) );
	} catch {

	}
}

function pluginAssetBase(): string {
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

async function networkFirstForAsset( req: Request ): Promise< Response > {
	const cache = await caches.open( RUNTIME_CACHE );
	try {
		const fresh = await fetch( req.url, { cache: 'reload' } );
		if ( fresh && fresh.status === 200 ) {
			cache.put( req, fresh.clone() ).catch( () => undefined );
		}
		return fresh;
	} catch {
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

	const cached = await cache.match( req );

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
		void network;
		return cached;
	}

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

async function cacheFirstAdminAsset( req: Request ): Promise< Response > {
	const cache = await caches.open( ADMIN_CACHE );
	const cached = await cache.match( req );
	if ( cached ) {
		return cached;
	}

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

const ADMIN_CACHE_MAX_ENTRIES = 500;
const ADMIN_CACHE_PRUNE_BATCH = 50;
const ADMIN_CACHE_PRUNE_EVERY_N_PUTS = 20;

let _putsSincePrune = 0;

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

		const excess = keys.slice(
			0,
			keys.length - ADMIN_CACHE_MAX_ENTRIES + ADMIN_CACHE_PRUNE_BATCH,
		);
		await Promise.all( excess.map( ( k ) => cache.delete( k ) ) );
	} catch {

	}
}

async function networkFirstWithOfflineFallback(
	req: Request,
): Promise< Response > {
	try {
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
