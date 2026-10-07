import { addAction, removeAction, HOOKS } from '../hooks';

export type HeaderValue = string | ( () => string );

export interface RequestObservation {
	windowId: string;
	method: string;
	url: string;
	status: number;
	duration: number;
	failed: boolean;

	requestHeaders?: Record< string, string >;

	responseHeaders?: Record< string, string >;
}

export interface OnRequestOptions {

	observe?: boolean;
}

export type RequestObserver = ( obs: RequestObservation ) => void;

export interface ReloadWithDebugSessionOptions {

	queryArg?: string;

	headerName?: string;
}

export interface ReloadWithDebugSessionResult {

	dispose: () => void;
}

export interface DevtoolsApi {

	addRequestHeader: (
		windowId: string,
		name: string,
		value: HeaderValue,
	) => () => void;

	onRequest: (
		windowId: string,
		cb: RequestObserver,
		opts?: OnRequestOptions,
	) => () => void;

	reloadWithDebugSession: (
		windowId: string,
		sessionId: string,
		opts?: ReloadWithDebugSessionOptions,
	) => ReloadWithDebugSessionResult | null;

	debug: DebugBusApi;
}

export interface DebugEvent {
	id: number;
	t: number;
	channel: string;
	payload: unknown;
}

export interface DebugBusApi {

	startSession: () => string;

	publish: ( sessionId: string, channel: string, payload: unknown ) => void;

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

	loadHandler: ( () => void ) | null;

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
		return;
	}
	const handler = (): void => {
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
	const wpd = ( window as unknown as {
		wp?: { os?: { windowManager?: { getById?: ( id: string ) => unknown } } };
	} ).wp?.os?.windowManager;
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
				type: 'os-instrument-set',
				headers,
				observe,
			},
			INITIAL_ORIGIN,
		);
	} catch {

	}
}

addAction( HOOKS.IFRAME_READY, 'desktop-mode/devtools/replay', ( payload: unknown ) => {
	const p = payload as { windowId?: string } | null;
	if ( p && typeof p.windowId === 'string' && states.has( p.windowId ) ) {
		pushInstrumentation( p.windowId );
	}
} );

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

			}
		}
	},
);

export function _resetDevtoolsForTests(): void {
	states.clear();
	removeAction( HOOKS.IFRAME_READY, 'desktop-mode/devtools/replay' );
	removeAction( HOOKS.IFRAME_NETWORK_COMPLETED, 'desktop-mode/devtools/dispatch' );
}

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

	const u = new URL( restUrl + 'desktop-mode/v1/debug', window.location.origin );
	u.searchParams.set( 'sessionId', sessionId );
	u.searchParams.set( 'since', String( sp.cursor ) );
	for ( const ch of sp.channels.keys() ) {
		u.searchParams.append( 'channels[]', ch );
	}
	const url = u.toString();

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
		openStationConfig?: { restUrl?: string; restNonce?: string };
	} ).openStationConfig;
	if ( ! cfg || ! cfg.restUrl || ! cfg.restNonce ) {
		return null;
	}
	return { restUrl: cfg.restUrl, restNonce: cfg.restNonce };
}

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

		}
	}
}

let _localEventCounter = 0;

const debugBus: DebugBusApi = {
	startSession() {
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

		const stopHeader = devtools.addRequestHeader( windowId, headerName, sessionId );

		try {
			const currentSrc = iframe.getAttribute( 'src' ) || iframe.src || '';
			const u = new URL( currentSrc, window.location.origin );
			u.searchParams.set( queryArg, sessionId );
			iframe.src = u.toString();
		} catch {

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
