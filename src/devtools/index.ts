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
 * `desktop-mode-instrument-set` with a single `headers` map plus an
 * `observe` flag. The iframe-side bridges (the inline chromeless
 * bridge in `includes/render.php` and `iframe-bridge-standalone.ts`)
 * apply it to every captured request — see the
 * `DESKTOP_MODE_INSTRUMENT` glue below.
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

export interface ReloadWithDebugSessionOptions {
	/**
	 * Query-arg name added to the iframe's URL so the document load
	 * itself carries the session id (HTTP headers can't be set on a
	 * full-document navigation — a query-arg is the only same-origin
	 * carrier the server can read at `init`). Defaults to
	 * `wp_debug_session`.
	 */
	queryArg?: string;
	/**
	 * The header name contributed alongside. Plugins that publish to
	 * the debug bus from REST / AJAX endpoints read this header via
	 * {@link desktop_mode_debug_session_for_request}; it defaults to
	 * `X-WP-Debug-Session` (the canonical one).
	 */
	headerName?: string;
}

export interface ReloadWithDebugSessionResult {
	/** Disposer — removes the header contribution AND the load listener. */
	dispose: () => void;
}

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
	/**
	 * Reload a window's iframe with a debug-session id baked into both
	 * the URL (so the document load itself is captured) AND the
	 * request-header contribution registry (so subsequent fetch / XHR
	 * / sendBeacon calls carry the same session). Bundles the
	 * boilerplate every devtool plugin would otherwise re-derive:
	 *
	 *   1. Add the header contribution.
	 *   2. Rewrite `iframe.src` with a session query-arg.
	 *   3. Re-push the header on the iframe's load event (handled by
	 *      the per-window load listener `addRequestHeader` already
	 *      installs).
	 *   4. Hand back a single disposer that tears down everything.
	 *
	 * Returns `null` if the window doesn't exist or has no iframe
	 * (native windows; cross-origin iframe pages would fail the same-
	 * origin guard the bridge enforces elsewhere).
	 *
	 * @since 0.6.0
	 */
	reloadWithDebugSession: (
		windowId: string,
		sessionId: string,
		opts?: ReloadWithDebugSessionOptions,
	) => ReloadWithDebugSessionResult | null;
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
	/**
	 * Bound `load` listener on the target iframe. Installed once per
	 * window when the first contribution / observer registers; ensures
	 * a fresh document (e.g. after `iframe.src = newUrl`) re-receives
	 * its instrumentation. Removed when the state is gc'd.
	 */
	loadHandler: ( () => void ) | null;
	/** The iframe we attached `loadHandler` to. Tracked so we can remove it. */
	loadHandlerTarget: HTMLIFrameElement | null;
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
			loadHandler: null,
			loadHandlerTarget: null,
		};
		states.set( windowId, s );
	}
	ensureLoadHandler( windowId, s );
	return s;
}

/**
 * Make sure the target iframe has a `load` listener that re-pushes
 * instrumentation. Plugins frequently mutate `iframe.src` directly
 * (to add a debug-session query arg, switch admin pages without
 * the framework's navigate bridge, etc.); without this, the new
 * document lands with `__wpdInstrument.headers` empty because the
 * chromeless inline bridge resets that slot on every fresh page.
 *
 * The shell's `IFRAME_READY` action is the spec'd path for the
 * same job, but `desktop-mode-ready` isn't actually emitted by the
 * chromeless bridge today, so relying on that hook leaves a
 * timing gap. The native `load` event fires unconditionally and
 * is also same-origin-safe to attach to.
 *
 * Idempotent: re-runs cheaply when the iframe element changes
 * (rare — mostly happens if a window is reused after destroy /
 * recreate cycles).
 */
function ensureLoadHandler( windowId: string, s: WindowState ): void {
	const iframe = findIframe( windowId );
	if ( ! iframe ) {
		return;
	}
	if ( s.loadHandlerTarget === iframe && s.loadHandler ) {
		return;
	}
	if (
		s.loadHandlerTarget &&
		s.loadHandler &&
		typeof s.loadHandlerTarget.removeEventListener === 'function'
	) {
		s.loadHandlerTarget.removeEventListener( 'load', s.loadHandler );
	}
	if ( typeof iframe.addEventListener !== 'function' ) {
		// Stub iframes (typical in tests where the consumer mocks
		// just `contentWindow.postMessage`) don't expose the
		// listener API. Skip the install rather than throw — header
		// pushes still go out, only the post-reload re-push is gated
		// on a real event surface.
		return;
	}
	const handler = (): void => {
		// `load` fires before the iframe document's listeners are
		// guaranteed installed. Defer one microtask so the chromeless
		// inline bridge has run its synchronous setup (it's at the top
		// of `admin_footer`, so it's parsed by the time `load` fires,
		// but its message listener attaches synchronously inside the
		// same tick — defer is belt-and-braces).
		queueMicrotask( () => pushInstrumentation( windowId ) );
	};
	iframe.addEventListener( 'load', handler );
	s.loadHandler = handler;
	s.loadHandlerTarget = iframe;
}

function detachLoadHandler( s: WindowState ): void {
	if (
		s.loadHandlerTarget &&
		s.loadHandler &&
		typeof s.loadHandlerTarget.removeEventListener === 'function'
	) {
		s.loadHandlerTarget.removeEventListener( 'load', s.loadHandler );
	}
	s.loadHandler = null;
	s.loadHandlerTarget = null;
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
				type: 'desktop-mode-instrument-set',
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
addAction( HOOKS.IFRAME_READY, 'desktop-mode/devtools/replay', ( payload: unknown ) => {
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
	'desktop-mode/devtools/dispatch',
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
	removeAction( HOOKS.IFRAME_READY, 'desktop-mode/devtools/replay' );
	removeAction( HOOKS.IFRAME_NETWORK_COMPLETED, 'desktop-mode/devtools/dispatch' );
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
	// Compose the URL via WHATWG URL + searchParams so it stays valid
	// under BOTH permalink modes:
	//
	//   - Pretty: `restUrl` ends in `/wp-json/`, plain path append +
	//     `?sessionId=…` works.
	//   - Ugly:   `restUrl` is `<site>/?rest_route=/`. Naive string
	//     concatenation produces a URL with two `?` separators —
	//     WordPress routes the request to the homepage, returns HTML,
	//     and `JSON.parse` blows up. Using `searchParams.set` makes
	//     the URL parser handle the existing query correctly.
	//
	// Plus: stamp every active subscription channel as `channels[]=…`
	// so the server-side drain has the full list to walk. Without
	// this, the drain returns `{ events: [] }` on every poll unless a
	// `desktop_mode_debug_channels` filter contributor exists — silent
	// failure that looks like "publishes never arrive".
	const u = new URL( restUrl + 'desktop-mode/v1/debug', window.location.origin );
	u.searchParams.set( 'sessionId', sessionId );
	u.searchParams.set( 'since', String( sp.cursor ) );
	for ( const ch of sp.channels.keys() ) {
		u.searchParams.append( 'channels[]', ch );
	}
	const url = u.toString();
	// eslint-disable-next-line no-restricted-syntax -- background poller; opted out of the loading spinner so devtools polling doesn't visually look like user-initiated activity.
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
		desktopModeConfig?: { restUrl?: string; restNonce?: string };
	} ).desktopModeConfig;
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
	reloadWithDebugSession( windowId, sessionId, opts ) {
		if (
			typeof windowId !== 'string' ||
			windowId === '' ||
			typeof sessionId !== 'string' ||
			sessionId === ''
		) {
			return null;
		}
		const iframe = findIframe( windowId );
		if ( ! iframe ) {
			return null;
		}
		const headerName = opts?.headerName || 'X-WP-Debug-Session';
		const queryArg = opts?.queryArg || 'wp_debug_session';

		// Step 1: register the header contribution. This also installs
		// the per-window load listener that re-pushes instrumentation
		// after every reload — so the navigation we're about to
		// trigger gets its headers stamped onto the new document
		// without the caller wiring anything up.
		const stopHeader = devtools.addRequestHeader( windowId, headerName, sessionId );

		// Step 2: rewrite the URL with the session query-arg. We
		// preserve any existing query-args + hash so the page state
		// the user was looking at survives the reload. Falls through
		// silently if the URL is unparseable — better to swallow than
		// throw on what is otherwise a "best-effort reload" call.
		try {
			const currentSrc = iframe.getAttribute( 'src' ) || iframe.src || '';
			const u = new URL( currentSrc, window.location.origin );
			u.searchParams.set( queryArg, sessionId );
			iframe.src = u.toString();
		} catch {
			// Even if URL composition failed, the header contribution
			// is still useful for any subsequent same-document fetch /
			// XHR. Don't unwind — just return the disposer pointing at
			// what we did manage to set up.
		}

		return {
			dispose: () => {
				stopHeader();
			},
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
		detachLoadHandler( s );
		states.delete( windowId );
	}
}
