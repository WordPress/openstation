/**
 * Desktop Mode — DevTools primitives.
 *
 * Cross-plugin instrumentation surface. Lets a third-party plugin
 * (a SQL inspector, a perf profiler, a request logger) attach
 * behavior to a window registered by another plugin without reaching
 * into `iframe.contentWindow` or wrapping globals from outside.
 *
 * The shell owns a single per-window instrumentation channel and
 * brokers contributions from many devtools so they don't fight each
 * other:
 *
 *   - **Header contribution** —
 *     `addRequestHeader( windowId, name, value )` registers a
 *     header (or computed value) the iframe should attach to every
 *     fetch / XHR / sendBeacon. Multiple devtools may contribute the
 *     same header name; values are joined with `, ` per RFC 7230. When
 *     the last contributor unregisters, the header is removed entirely.
 *
 *   - **Request observation** —
 *     `onRequest( windowId, cb )` subscribes to every completed
 *     network call from a window. Mirrors `HOOKS.IFRAME_NETWORK_COMPLETED`
 *     but pre-filters by `windowId`, so plugin code doesn't carry
 *     boilerplate. Ties into the same wrappers — opt-in via the
 *     `observe` flag fires extended payloads that include request +
 *     response headers (otherwise the default privacy-conscious
 *     summary stays in effect).
 *
 *   - **Generic debug bus** —
 *     `debug.publish( sessionId, channel, payload )` and
 *     `debug.subscribe( sessionId, channel, cb )` are sugar over the
 *     server-side `desktop_mode_debug_publish()` / REST poll loop.
 *     A SQL inspector flips on `SAVEQUERIES`, captures `$wpdb->queries`,
 *     publishes via the PHP API; the inspector window subscribes here.
 *
 * The instrumentation message protocol (parent → iframe) is
 * `wp-desktop-instrument-set` with a single `headers` map plus an
 * `observe` flag. The iframe-side bridges (the inline chromeless
 * bridge in `includes/render.php` and `iframe-bridge-standalone.ts`)
 * apply it to every captured request — see the
 * `WP_DESKTOP_INSTRUMENT` glue below.
 *
 * @since 0.6.0
 */

import { addAction, removeAction, HOOKS } from '../hooks';

/** A computed header value — recomputed for every request. */
export type HeaderValue = string | ( () => string );

/**
 * Payload delivered to `onRequest` callbacks. Mirrors
 * `HOOKS.IFRAME_NETWORK_COMPLETED` plus optional headers when an
 * `observe: true` listener is active for the window.
 */
export interface RequestObservation {
	windowId: string;
	method: string;
	url: string;
	status: number;
	duration: number;
	failed: boolean;
	/** Set only when at least one `observe: true` listener is active. */
	requestHeaders?: Record< string, string >;
	/** Set only when at least one `observe: true` listener is active. */
	responseHeaders?: Record< string, string >;
}

export interface OnRequestOptions {
	/**
	 * When true, the iframe is asked to send request + response
	 * headers along with each completion. Defaults to false — the
	 * privacy-conscious summary (method/url/status/duration only) is
	 * delivered. The shell aggregates: as long as ANY active listener
	 * for the window asks for `observe`, the iframe runs in observed
	 * mode.
	 */
	observe?: boolean;
}

export type RequestObserver = ( obs: RequestObservation ) => void;

export interface DevtoolsApi {
	/**
	 * Contribute an HTTP header that the target window's iframe will
	 * attach to every outgoing fetch / XHR / sendBeacon. Returns a
	 * disposer that removes this contribution; the header lingers as
	 * long as ANY contributor is registered for the same name on the
	 * same window. Values can be a literal string or a thunk that
	 * recomputes per-request.
	 */
	addRequestHeader: (
		windowId: string,
		name: string,
		value: HeaderValue,
	) => () => void;
	/**
	 * Subscribe to completed network calls from the target window.
	 * Returns a disposer.
	 */
	onRequest: (
		windowId: string,
		cb: RequestObserver,
		opts?: OnRequestOptions,
	) => () => void;
	/** Generic per-session debug bus. See {@link DebugBusApi}. */
	debug: DebugBusApi;
}

export interface DebugEvent {
	id: number;
	t: number;
	channel: string;
	payload: unknown;
}

export interface DebugBusApi {
	/**
	 * Allocate a fresh debug session id. The id is opaque from the
	 * shell's perspective; plugins pass it as the `X-WP-Debug-Session`
	 * request header so server-side hooks can target their captures.
	 */
	startSession: () => string;
	/**
	 * Publish locally — fires for any local subscriber on the same
	 * (sessionId, channel). Server-side publishes go through PHP
	 * `desktop_mode_debug_publish()`; the shell polls and replays them
	 * through the same dispatch path so subscribers don't need to know
	 * the source.
	 */
	publish: ( sessionId: string, channel: string, payload: unknown ) => void;
	/**
	 * Subscribe to a (sessionId, channel) stream. Starts a poll loop
	 * the first time a subscription opens for the session; the loop
	 * stops when the last subscription closes. Returns a disposer.
	 */
	subscribe: (
		sessionId: string,
		channel: string,
		cb: ( event: DebugEvent ) => void,
	) => () => void;
}

interface HeaderContribution {
	value: HeaderValue;
}

interface WindowState {
	headers: Map< string, HeaderContribution[] >;
	observers: Set< RequestObserver >;
	observeCount: number;
}

const states = new Map< string, WindowState >();

const INITIAL_ORIGIN = window.location.origin;

function ensureState( windowId: string ): WindowState {
	let s = states.get( windowId );
	if ( ! s ) {
		s = {
			headers: new Map(),
			observers: new Set(),
			observeCount: 0,
		};
		states.set( windowId, s );
	}
	return s;
}

function findIframe( windowId: string ): HTMLIFrameElement | null {
	// Resolve via the public window manager so this works for iframe
	// windows (`Window.iframe`) and for native windows that mounted an
	// iframe through `iframeContent` (the synthetic-iframe registry
	// the connection bridge maintains). Fall back to a DOM lookup so
	// the module remains usable in tests that don't boot the manager.
	const wpd = ( window as unknown as {
		wp?: { desktop?: { windowManager?: { getById?: ( id: string ) => unknown } } };
	} ).wp?.desktop?.windowManager;
	if ( wpd && typeof wpd.getById === 'function' ) {
		const win = wpd.getById( windowId ) as
			| { iframe?: HTMLIFrameElement | null; element?: HTMLElement }
			| undefined;
		if ( win?.iframe ) {
			return win.iframe;
		}
		if ( win?.element ) {
			const synth = win.element.querySelector< HTMLIFrameElement >( 'iframe' );
			if ( synth ) {
				return synth;
			}
		}
	}
	const fallback = document.getElementById( `wp-window-${ windowId }` );
	return fallback?.querySelector< HTMLIFrameElement >( 'iframe' ) ?? null;
}

function snapshotHeaders( s: WindowState ): Record< string, string > {
	const out: Record< string, string > = {};
	for ( const [ name, contributions ] of s.headers ) {
		const parts: string[] = [];
		for ( const c of contributions ) {
			let v: string;
			try {
				v = typeof c.value === 'function' ? c.value() : c.value;
			} catch {
				continue;
			}
			if ( typeof v === 'string' && v !== '' ) {
				parts.push( v );
			}
		}
		if ( parts.length > 0 ) {
			// RFC 7230 §3.2.2 — combine duplicate header values with
			// comma-space. Lets multiple devtools contribute under the
			// same canonical header name without each silently
			// overwriting the others.
			out[ name ] = parts.join( ', ' );
		}
	}
	return out;
}

function pushInstrumentation( windowId: string ): void {
	const iframe = findIframe( windowId );
	if ( ! iframe || ! iframe.contentWindow ) {
		return;
	}
	const s = states.get( windowId );
	const headers = s ? snapshotHeaders( s ) : {};
	const observe = !! s && s.observeCount > 0;
	try {
		iframe.contentWindow.postMessage(
			{
				type: 'wp-desktop-instrument-set',
				headers,
				observe,
			},
			INITIAL_ORIGIN,
		);
	} catch {
		/* iframe gone — nothing to do */
	}
}

/**
 * Re-push instrumentation to every window whenever a fresh iframe
 * reports ready. Without this, headers registered before the iframe
 * loaded would be applied to the iframe's load event itself but
 * dropped on subsequent in-place navigations (the iframe re-loads,
 * the chromeless bridge resets its mutable state, and our parent-
 * side state is the only place the headers still exist).
 */
addAction( HOOKS.IFRAME_READY, 'wp-desktop-mode/devtools/replay', ( payload: unknown ) => {
	const p = payload as { windowId?: string } | null;
	if ( p && typeof p.windowId === 'string' && states.has( p.windowId ) ) {
		pushInstrumentation( p.windowId );
	}
} );

/**
 * Bridge `IFRAME_NETWORK_COMPLETED` into our per-window observer
 * registry. Listeners installed via `onRequest( windowId, … )` only
 * fire for matching events; the dispatch is O(N) in observers per
 * window, which is fine for the expected single-digit subscriber
 * counts (one inspector, one perf widget).
 */
addAction(
	HOOKS.IFRAME_NETWORK_COMPLETED,
	'wp-desktop-mode/devtools/dispatch',
	( payload: unknown ) => {
		const p = payload as RequestObservation | null;
		if ( ! p || typeof p.windowId !== 'string' ) {
			return;
		}
		const s = states.get( p.windowId );
		if ( ! s ) {
			return;
		}
		for ( const cb of s.observers ) {
			try {
				cb( p );
			} catch {
				/* swallow subscriber errors so one buggy listener can't
				 * starve the rest. */
			}
		}
	},
);

/* istanbul ignore next — re-exported only for tests / advanced users */
export function _resetDevtoolsForTests(): void {
	states.clear();
	removeAction( HOOKS.IFRAME_READY, 'wp-desktop-mode/devtools/replay' );
	removeAction( HOOKS.IFRAME_NETWORK_COMPLETED, 'wp-desktop-mode/devtools/dispatch' );
}

// -----------------------------------------------------------------------------
// Debug bus — generic per-session pub/sub backed by REST polling.
// -----------------------------------------------------------------------------

interface SessionPoll {
	channels: Map< string, Set< ( e: DebugEvent ) => void > >;
	cursor: number;
	timer: ReturnType< typeof setTimeout > | null;
	inflight: boolean;
}

const sessions = new Map< string, SessionPoll >();
const POLL_INTERVAL_MS = 1000;

function pollOnce( sessionId: string, restUrl: string, restNonce: string ): void {
	const sp = sessions.get( sessionId );
	if ( ! sp || sp.inflight ) {
		return;
	}
	sp.inflight = true;
	const url = `${ restUrl }wp-desktop/v1/debug?sessionId=${ encodeURIComponent(
		sessionId,
	) }&since=${ sp.cursor }`;
	fetch( url, {
		credentials: 'same-origin',
		headers: { 'X-WP-Nonce': restNonce },
	} )
		.then( ( r ) => ( r.ok ? r.json() : { events: [], cursor: sp.cursor } ) )
		.then( ( body: { events: DebugEvent[]; cursor: number } ) => {
			sp.inflight = false;
			if ( ! sessions.has( sessionId ) ) {
				return;
			}
			if ( typeof body.cursor === 'number' ) {
				sp.cursor = body.cursor;
			}
			for ( const ev of body.events || [] ) {
				const bucket = sp.channels.get( ev.channel );
				if ( ! bucket ) {
					continue;
				}
				for ( const cb of bucket ) {
					try {
						cb( ev );
					} catch {
						/* swallow */
					}
				}
			}
		} )
		.catch( () => {
			sp.inflight = false;
		} )
		.finally( () => {
			const stillThere = sessions.get( sessionId );
			if ( stillThere && stillThere.channels.size > 0 ) {
				stillThere.timer = setTimeout(
					() => pollOnce( sessionId, restUrl, restNonce ),
					POLL_INTERVAL_MS,
				);
			}
		} );
}

function getRestEndpoint(): { restUrl: string; restNonce: string } | null {
	const cfg = ( window as unknown as {
		wpDesktopConfig?: { restUrl?: string; restNonce?: string };
	} ).wpDesktopConfig;
	if ( ! cfg || ! cfg.restUrl || ! cfg.restNonce ) {
		return null;
	}
	return { restUrl: cfg.restUrl, restNonce: cfg.restNonce };
}

/**
 * Dispatch a debug event into local subscribers immediately. Used by
 * `publish()` for echo-locally semantics and by the poll loop when
 * server-published events arrive.
 */
function dispatchLocal( sessionId: string, ev: DebugEvent ): void {
	const sp = sessions.get( sessionId );
	if ( ! sp ) {
		return;
	}
	const bucket = sp.channels.get( ev.channel );
	if ( ! bucket ) {
		return;
	}
	for ( const cb of bucket ) {
		try {
			cb( ev );
		} catch {
			/* swallow */
		}
	}
}

let _localEventCounter = 0;

const debugBus: DebugBusApi = {
	startSession() {
		// Crypto-quality randomness when available (modern admins
		// always have it); fall back to Math.random for the rare
		// pre-Web-Crypto runtime.
		const cryptoApi = ( window as unknown as { crypto?: { randomUUID?: () => string } } )
			.crypto;
		if ( cryptoApi && typeof cryptoApi.randomUUID === 'function' ) {
			return cryptoApi.randomUUID();
		}
		return (
			'wpdbg-' +
			Date.now().toString( 36 ) +
			'-' +
			Math.random().toString( 36 ).slice( 2, 10 )
		);
	},
	publish( sessionId, channel, payload ) {
		dispatchLocal( sessionId, {
			id: ++_localEventCounter,
			t: Date.now(),
			channel,
			payload,
		} );
	},
	subscribe( sessionId, channel, cb ) {
		let sp = sessions.get( sessionId );
		const startedFresh = ! sp;
		if ( ! sp ) {
			sp = {
				channels: new Map(),
				cursor: 0,
				timer: null,
				inflight: false,
			};
			sessions.set( sessionId, sp );
		}
		let bucket = sp.channels.get( channel );
		if ( ! bucket ) {
			bucket = new Set();
			sp.channels.set( channel, bucket );
		}
		bucket.add( cb );

		// Spin up the poll loop only when this is a fresh session —
		// re-subscribing on a session that's already polling reuses
		// the existing timer.
		if ( startedFresh ) {
			const ep = getRestEndpoint();
			if ( ep ) {
				pollOnce( sessionId, ep.restUrl, ep.restNonce );
			}
		}

		return () => {
			const cur = sessions.get( sessionId );
			if ( ! cur ) {
				return;
			}
			const b = cur.channels.get( channel );
			if ( b ) {
				b.delete( cb );
				if ( b.size === 0 ) {
					cur.channels.delete( channel );
				}
			}
			if ( cur.channels.size === 0 ) {
				if ( cur.timer ) {
					clearTimeout( cur.timer );
				}
				sessions.delete( sessionId );
			}
		};
	},
};

// -----------------------------------------------------------------------------
// Public API surface assembly.
// -----------------------------------------------------------------------------

export const devtools: DevtoolsApi = {
	addRequestHeader( windowId, name, value ) {
		if ( typeof windowId !== 'string' || windowId === '' ) {
			return () => {};
		}
		if ( typeof name !== 'string' || name === '' ) {
			return () => {};
		}
		const s = ensureState( windowId );
		const contribution: HeaderContribution = { value };
		let bucket = s.headers.get( name );
		if ( ! bucket ) {
			bucket = [];
			s.headers.set( name, bucket );
		}
		bucket.push( contribution );
		pushInstrumentation( windowId );
		return () => {
			const cur = states.get( windowId );
			if ( ! cur ) {
				return;
			}
			const b = cur.headers.get( name );
			if ( ! b ) {
				return;
			}
			const i = b.indexOf( contribution );
			if ( i >= 0 ) {
				b.splice( i, 1 );
			}
			if ( b.length === 0 ) {
				cur.headers.delete( name );
			}
			pushInstrumentation( windowId );
			gcWindowState( windowId );
		};
	},
	onRequest( windowId, cb, opts ) {
		if ( typeof windowId !== 'string' || windowId === '' ) {
			return () => {};
		}
		if ( typeof cb !== 'function' ) {
			return () => {};
		}
		const s = ensureState( windowId );
		s.observers.add( cb );
		const wantsObserve = !! opts?.observe;
		if ( wantsObserve ) {
			s.observeCount++;
			pushInstrumentation( windowId );
		}
		return () => {
			const cur = states.get( windowId );
			if ( ! cur ) {
				return;
			}
			cur.observers.delete( cb );
			if ( wantsObserve ) {
				cur.observeCount = Math.max( 0, cur.observeCount - 1 );
				pushInstrumentation( windowId );
			}
			gcWindowState( windowId );
		};
	},
	debug: debugBus,
};

function gcWindowState( windowId: string ): void {
	const s = states.get( windowId );
	if ( ! s ) {
		return;
	}
	if ( s.headers.size === 0 && s.observers.size === 0 ) {
		states.delete( windowId );
	}
}
