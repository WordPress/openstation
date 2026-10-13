/**
 * Pulse Monitor — signal taps.
 *
 * Everything that can make the trace beat, wired in one place so the
 * teardown is auditable. Wired once per page by the hub (`hub.ts`),
 * however many monitors are on the desk. Two outputs per signal:
 *
 *   - a beat, emitted to the hub, which fans it out to every mounted
 *     monitor (each applies its own muting);
 *   - an observation for the shared {@link HealthMonitor}.
 *
 * Failed beats carry a short `detail` — the status, the error message —
 * which the trace prints after the spike's label.
 *
 * Taps, by source id:
 *
 *   requests   `os/request-settled` (every `wp.os.fetch`),
 *              `os.iframe.network-completed` (fetch/XHR inside admin
 *              windows), and a `PerformanceObserver` on the shell for
 *              raw fetch/XHR that bypassed both.
 *   assets     resource timing in the shell and in every same-origin
 *              window iframe: scripts, styles, images, fonts.
 *   pages      `os.window.content-loaded`, and every window iframe's
 *              `load` (in-window links, form POSTs, redirects), with
 *              the page's own HTTP status when same-origin.
 *   heartbeat  WordPress Heartbeat ticks (and its errors / lost
 *              connection, which feed the diagnosis).
 *   windows    window lifecycle, drags, snaps, overview, desktops,
 *              widgets, commands, desktop icons.
 *   input      clicks, key presses and wheel in the shell and windows.
 *   messages   postMessage traffic into the shell, `wp.os.broadcast`,
 *              connection messages.
 *   notices    toasts, notifications, badge changes.
 *   uploads    file-drop uploads.
 *   errors     JS errors and rejections (shell, windows, commands),
 *              failed resources, auth loss, going offline.
 *   server     visitors, bots, comments, publishes, orders, logins,
 *              API, cron and other people's admin traffic, relayed by
 *              `includes/pulse-monitor.php` over Heartbeat.
 *
 * Plugins add beats by publishing on the `pulse/beat` activity channel.
 */

import { activity } from '../../activity';
import { heartbeat } from '../../heartbeat';
import { addAction, removeAction, HOOKS } from '../../hooks';
import { __, sprintf } from '../../i18n';
import type { HealthMonitor, ServerHealth } from './health';
import type { BeatRequest } from './rhythm';

/** Hook namespace for every listener registered here. */
const NAMESPACE = 'desktop-mode/pulse';

/** Heartbeat field shared with `includes/pulse-monitor.php`. */
const HEARTBEAT_FIELD = 'openstation_pulse';

/** How long a URL seen on the activity bus suppresses its resource-timing twin, ms. */
const DEDUPE_MS = 5000;

/** A shell `content-loaded` and an iframe `load` this close together are one page load, ms. */
const PAGE_DEDUPE_MS = 1500;

/** Fetch-like initiators — the rest of resource timing counts as assets. */
const FETCH_INITIATORS = new Set( [ 'fetch', 'xmlhttprequest', 'beacon' ] );

/** Window-level shell hooks that each beat as a `windows` signal. */
const WINDOW_HOOKS = [
	HOOKS.WINDOW_OPENED,
	HOOKS.WINDOW_CLOSED,
	HOOKS.WINDOW_FOCUSED,
	HOOKS.WINDOW_MINIMIZED,
	HOOKS.WINDOW_RESTORED,
	HOOKS.WINDOW_MAXIMIZED,
	HOOKS.WINDOW_UNMAXIMIZED,
	HOOKS.WINDOW_FULLSCREEN_ENTERED,
	HOOKS.WINDOW_FULLSCREEN_EXITED,
	HOOKS.WINDOW_DRAG_END,
	HOOKS.WINDOW_RESIZE_END,
	HOOKS.WINDOW_RELOADED,
	HOOKS.WINDOW_TITLE_CHANGED,
	HOOKS.SNAP_ZONE_COMMITTED,
	HOOKS.OVERVIEW_ENTERED,
	HOOKS.OVERVIEW_EXITED,
	HOOKS.DESKTOP_SWITCHED,
	HOOKS.DESKTOP_ICON_CLICKED,
	HOOKS.WIDGET_ADDED,
	HOOKS.WIDGET_REMOVED,
	HOOKS.COMMAND_AFTER_RUN,
	HOOKS.CONSTELLATION_OPENED,
];

/** One server event, as the Heartbeat response carries it. */
interface ServerEvent {
	ts: number;
	kind: string;
	status: number;
	error: boolean;
}

interface ServerPayload {
	seq?: number;
	now?: number;
	events?: ServerEvent[];
	health?: ServerHealth;
}

interface JQueryish {
	( target: Document ): {
		on( events: string, handler: ( ...args: unknown[] ) => void ): unknown;
		off( events: string ): unknown;
	};
}

interface WpHeartbeat {
	interval( next?: number | string ): number;
	connectNow?: () => void;
}

export interface SignalOptions {
	health: HealthMonitor;
	/**
	 * Hand a beat to the monitors. `delayMs` postpones it — used to
	 * replay a Heartbeat batch of server events at their real spacing.
	 */
	emit: ( beat: BeatRequest, delayMs: number ) => void;
}

/** Trim a free-form error message to something that fits on a spike. */
function shortDetail( text: unknown ): string {
	const flat = String( text ?? '' ).replace( /\s+/g, ' ' ).trim();
	return flat.length > 48 ? `${ flat.slice( 0, 47 ) }…` : flat;
}

/** Detail for an HTTP outcome: the status, or why there was none. */
function statusDetail( status: number, fallback = 'network error' ): string {
	return status > 0 ? String( status ) : fallback;
}

/** A per-key throttle: true at most once every `ms`. */
function throttle( ms: number ): ( key: string ) => boolean {
	const last = new Map< string, number >();
	return ( key ) => {
		const t = performance.now();
		if ( t - ( last.get( key ) ?? -Infinity ) < ms ) {
			return false;
		}
		last.set( key, t );
		return true;
	};
}

function absoluteUrl( url: string ): string {
	try {
		return new URL( url, window.location.href ).href;
	} catch {
		return url;
	}
}

/**
 * Wire every tap. Returns the teardown.
 */
export function wireSignals( opts: SignalOptions ): () => void {
	const { health, emit } = opts;
	const now = (): number => performance.now();
	// A hidden tab is throttled: the browser delays timers and
	// callbacks, so a duration measured then is the throttling, not the
	// site. Dropping those samples keeps a backgrounded tab from
	// diagnosing "slow responses" (and drawing amber PVCs) on its own.
	const latency = ( ms: number ): void => {
		if ( document.visibilityState === 'visible' ) {
			health.recordLatency( now(), ms );
		}
	};
	const disposers: Array< () => void > = [];
	const gates = {
		input: throttle( 70 ),
		wheel: throttle( 160 ),
		messages: throttle( 40 ),
		bounds: throttle( 150 ),
	};

	const beat = (
		source: string,
		extra: { error?: boolean; amplitude?: number; delay?: number; detail?: string } = {},
	): void => {
		emit(
			{ source, error: extra.error === true, amplitude: extra.amplitude, detail: extra.detail },
			extra.delay ?? 0,
		);
	};

	const on = < E extends Event >(
		target: EventTarget,
		type: string,
		handler: ( e: E ) => void,
		options: AddEventListenerOptions = { passive: true },
	): void => {
		target.addEventListener( type, handler as EventListener, options );
		disposers.push( () => target.removeEventListener( type, handler as EventListener, options ) );
	};

	const hook = ( name: string, handler: ( ...args: unknown[] ) => void ): void => {
		const ns = `${ NAMESPACE }/${ name }`;
		addAction( name, ns, handler );
		disposers.push( () => removeAction( name, ns ) );
	};

	const channel = ( name: string, handler: ( payload: unknown ) => void ): void => {
		disposers.push( activity.subscribe( name as 'os/request-settled', handler as ( p: unknown ) => void ) );
	};

	// URLs the activity bus already reported, so resource timing does
	// not beat for them twice. Consumed on match: two calls to the same
	// URL are two beats.
	const recent = new Map< string, number[] >();
	const remember = ( url: string ): void => {
		const key = absoluteUrl( url );
		const list = recent.get( key ) ?? [];
		list.push( performance.now() + DEDUPE_MS );
		recent.set( key, list );
	};
	const consume = ( url: string ): boolean => {
		const list = recent.get( url );
		if ( ! list ) {
			return false;
		}
		const t = performance.now();
		while ( list.length && list[ 0 ] < t ) {
			list.shift();
		}
		const hit = list.length > 0;
		list.shift();
		if ( ! list.length ) {
			recent.delete( url );
		}
		return hit;
	};

	/* ---------------------------------------------------------------
	 * requests
	 * ------------------------------------------------------------- */

	channel( 'os/request-settled', ( raw ) => {
		const p = raw as { url?: string; status?: number; ok?: boolean; aborted?: boolean; error?: string };
		if ( p.url ) {
			remember( p.url );
		}
		if ( p.aborted ) {
			return;
		}
		const status = typeof p.status === 'number' ? p.status : 0;
		health.recordRequest( now(), status );
		beat( 'requests', {
			error: status === 0 || status >= 400,
			detail: statusDetail( status, shortDetail( p.error ) || 'network error' ),
		} );
	} );

	hook( HOOKS.IFRAME_NETWORK_COMPLETED, ( raw ) => {
		const p = raw as { status?: number; duration?: number; failed?: boolean };
		const status = p.failed && ! p.status ? 0 : Number( p.status ) || 0;
		health.recordRequest( now(), status );
		if ( typeof p.duration === 'number' ) {
			latency( p.duration );
		}
		beat( 'requests', { error: status === 0 || status >= 400, detail: statusDetail( status ) } );
	} );

	/* ---------------------------------------------------------------
	 * assets (+ raw shell fetches) via resource timing
	 * ------------------------------------------------------------- */

	const observeResources = ( win: Window, isShell: boolean ): void => {
		const PO = ( win as unknown as { PerformanceObserver?: typeof PerformanceObserver } ).PerformanceObserver;
		if ( typeof PO !== 'function' ) {
			return;
		}
		let observer: PerformanceObserver;
		try {
			observer = new PO( ( list ) => {
				for ( const entry of list.getEntries() as PerformanceResourceTiming[] ) {
					const status = ( entry as { responseStatus?: number } ).responseStatus ?? 0;
					const failed = status >= 400;
					if ( FETCH_INITIATORS.has( entry.initiatorType ) ) {
						// Window iframes report fetch/XHR through the
						// chromeless bridge already; only the shell's raw
						// requests need resource timing.
						if ( ! isShell ) {
							continue;
						}
						latency( entry.duration );
						if ( consume( entry.name ) ) {
							continue;
						}
						health.recordRequest( now(), status || 200 );
						beat( 'requests', { error: failed, detail: statusDetail( status ) } );
					} else {
						beat( 'assets', { error: failed, detail: statusDetail( status ) } );
					}
				}
			} );
			observer.observe( { type: 'resource', buffered: false } );
		} catch {
			return;
		}
		disposers.push( () => observer.disconnect() );
	};

	/* ---------------------------------------------------------------
	 * input
	 * ------------------------------------------------------------- */

	const observeInput = ( doc: Document ): void => {
		const capture: AddEventListenerOptions = { passive: true, capture: true };
		on( doc, 'pointerdown', () => beat( 'input', { amplitude: 0.16 } ), capture );
		on( doc, 'keydown', () => {
			if ( gates.input( 'key' ) ) {
				beat( 'input' );
			}
		}, capture );
		on( doc, 'wheel', () => {
			if ( gates.wheel( 'wheel' ) ) {
				beat( 'input', { amplitude: 0.07 } );
			}
		}, capture );
	};

	observeResources( window, true );
	observeInput( document );

	// Same-origin window iframes: resource timing + input. An iframe's
	// `contentWindow` keeps its identity across navigations but its
	// document does not, so documents are what we remember. Cross-origin
	// frames throw on access and are skipped (their network traffic
	// still arrives via the chromeless bridge).
	const seenDocs = new WeakSet< Document >();
	const scanFrames = (): void => {
		for ( const frame of Array.from( document.querySelectorAll( 'iframe' ) ) ) {
			const win = frame.contentWindow;
			if ( ! win ) {
				continue;
			}
			try {
				const doc = win.document;
				if ( ! doc || seenDocs.has( doc ) || doc.URL === 'about:blank' ) {
					continue;
				}
				seenDocs.add( doc );
				observeResources( win, false );
				observeInput( doc );
			} catch {
				/* cross-origin */
			}
		}
	};
	scanFrames();
	const frameTimer = window.setInterval( scanFrames, 1500 );
	disposers.push( () => window.clearInterval( frameTimer ) );

	/* ---------------------------------------------------------------
	 * pages, windows
	 * ------------------------------------------------------------- */

	// Page loads. `os.window.content-loaded` only fires for loads the
	// shell starts; a navigation INSIDE a window (a link, a form POST,
	// a redirect) only shows up as the iframe's `load` — which does not
	// bubble, but does reach a capturing document listener. The two
	// overlap for shell-started loads, so a load within PAGE_DEDUPE_MS
	// of the other counts once.
	let lastPage = -Infinity;
	const pageLoaded = ( status = 0, duration: number | null = null ): void => {
		const t = performance.now();
		if ( status ) {
			health.recordRequest( now(), status );
		}
		if ( duration !== null ) {
			latency( duration );
		}
		if ( t - lastPage < PAGE_DEDUPE_MS ) {
			return;
		}
		lastPage = t;
		beat( 'pages', { error: status >= 400, detail: statusDetail( status ) } );
		// A window just navigated — its new document is ready to tap.
		window.setTimeout( scanFrames, 50 );
	};
	hook( HOOKS.WINDOW_CONTENT_LOADED, () => pageLoaded() );
	on( document, 'load', ( e: Event ) => {
		if ( ! ( e.target instanceof HTMLIFrameElement ) ) {
			return;
		}
		// Same-origin frames tell us how the page itself went;
		// cross-origin ones throw and still beat, status unknown.
		let status = 0;
		let duration: number | null = null;
		try {
			const nav = e.target.contentWindow?.performance.getEntriesByType( 'navigation' )[ 0 ] as
				| ( PerformanceNavigationTiming & { responseStatus?: number } )
				| undefined;
			status = nav?.responseStatus ?? 0;
			duration = nav ? nav.responseEnd - nav.startTime : null;
		} catch {
			/* cross-origin */
		}
		pageLoaded( status, duration );
	}, { passive: true, capture: true } );

	for ( const name of WINDOW_HOOKS ) {
		hook( name, () => beat( 'windows' ) );
	}
	hook( HOOKS.WINDOW_BOUNDS_CHANGED, () => {
		if ( gates.bounds( 'bounds' ) ) {
			beat( 'windows', { amplitude: 0.12 } );
		}
	} );

	/* ---------------------------------------------------------------
	 * messages, notices, uploads
	 * ------------------------------------------------------------- */

	on( window, 'message', () => {
		if ( gates.messages( 'message' ) ) {
			beat( 'messages' );
		}
	} );
	hook( HOOKS.BROADCAST, () => beat( 'messages', { amplitude: 0.25 } ) );
	hook( HOOKS.CONNECTION_MESSAGE, () => {
		if ( gates.messages( 'connection' ) ) {
			beat( 'messages' );
		}
	} );

	channel( 'os/toast-shown', () => beat( 'notices' ) );
	channel( 'os/notification-shown', () => beat( 'notices' ) );
	hook( HOOKS.ICON_BADGE_CHANGED, () => beat( 'notices', { amplitude: 0.3 } ) );

	hook( HOOKS.FILE_DROP_UPLOAD_STARTED, () => beat( 'uploads', { amplitude: 0.5 } ) );
	hook( HOOKS.FILE_DROP_AFTER_UPLOAD, () => {
		health.recordRequest( now(), 200 );
		beat( 'uploads' );
	} );
	hook( HOOKS.FILE_DROP_UPLOAD_FAILED, () => {
		health.recordRequest( now(), 500 );
		beat( 'uploads', { error: true, detail: __( 'upload failed' ) } );
	} );

	/* ---------------------------------------------------------------
	 * errors, connectivity
	 * ------------------------------------------------------------- */

	const jsError = ( message: unknown ): void => {
		health.recordJsError( now() );
		beat( 'errors', { detail: shortDetail( message ) || __( 'JavaScript error' ) } );
	};
	const messageOf = ( value: unknown ): unknown =>
		( value as { message?: unknown } | null )?.message ?? value;
	// Capture phase: resource load failures (a broken <img>) fire on the
	// element and only reach window while capturing.
	on( window, 'error', ( e: Event ) => {
		if ( e instanceof ErrorEvent ) {
			jsError( e.message );
		} else {
			const tag = ( e.target as Element | null )?.tagName?.toLowerCase() ?? 'resource';
			/* translators: %s: HTML tag name of the element that failed to load, e.g. "img". */
			beat( 'errors', { amplitude: 0.5, detail: sprintf( __( '%s failed to load' ), tag ) } );
		}
	}, { passive: true, capture: true } );
	on( window, 'unhandledrejection', ( e: Event ) =>
		jsError( messageOf( ( e as PromiseRejectionEvent ).reason ) ),
	);
	hook( HOOKS.IFRAME_ERROR, ( raw ) => jsError( ( raw as { message?: string } | undefined )?.message ) );
	hook( HOOKS.SHELL_ERROR, ( raw ) => {
		const p = raw as { scope?: string; error?: unknown } | undefined;
		jsError( p?.error ? messageOf( p.error ) : p?.scope );
	} );
	hook( HOOKS.COMMAND_ERROR, ( raw ) =>
		jsError( messageOf( ( raw as { error?: unknown } | undefined )?.error ) ),
	);
	hook( HOOKS.AUTH_LOST, () => {
		health.setAuthLost( true );
		beat( 'errors', { detail: __( 'session expired' ) } );
	} );
	hook( HOOKS.AUTH_RESTORED, () => health.setAuthLost( false ) );

	const syncOnline = (): void => health.setOffline( navigator.onLine === false );
	syncOnline();
	on( window, 'online', syncOnline );
	on( window, 'offline', () => {
		syncOnline();
		beat( 'errors', { detail: __( 'offline' ) } );
	} );

	/* ---------------------------------------------------------------
	 * plugins
	 * ------------------------------------------------------------- */

	channel( 'pulse/beat', ( raw ) => {
		const p = ( raw ?? {} ) as { source?: unknown; error?: unknown; amplitude?: unknown; detail?: unknown };
		beat( typeof p.source === 'string' && p.source ? p.source : 'custom', {
			error: p.error === true,
			detail: shortDetail( p.detail ),
			amplitude:
				typeof p.amplitude === 'number' && Number.isFinite( p.amplitude )
					? Math.min( 2, Math.max( 0, p.amplitude ) )
					: undefined,
		} );
	} );

	/* ---------------------------------------------------------------
	 * heartbeat + the server feed
	 * ------------------------------------------------------------- */

	const $ = ( window as unknown as { jQuery?: JQueryish } ).jQuery;
	const wpHeartbeat = ( window.wp as unknown as { heartbeat?: WpHeartbeat } | undefined )?.heartbeat;
	if ( $ ) {
		const doc = $( document );
		doc.on( 'heartbeat-send.osPulse', () => {
			const ajaxurl = ( window as unknown as { ajaxurl?: string } ).ajaxurl;
			if ( ajaxurl ) {
				remember( ajaxurl );
			}
		} );
		doc.on( 'heartbeat-tick.osPulse', () => {
			health.recordRequest( now(), 200 );
			health.setHeartbeatLost( false );
			beat( 'heartbeat' );
		} );
		doc.on( 'heartbeat-error.osPulse', ( ...args: unknown[] ) => {
			const jqXHR = args[ 1 ] as { status?: number } | undefined;
			const status = Number( jqXHR?.status ) || 0;
			health.recordRequest( now(), status );
			// textStatus: "timeout", "error", "abort", "parsererror".
			beat( 'heartbeat', { error: true, detail: statusDetail( status, shortDetail( args[ 2 ] ) || 'error' ) } );
		} );
		doc.on( 'heartbeat-connection-lost.osPulse', () => health.setHeartbeatLost( true ) );
		doc.on( 'heartbeat-connection-restored.osPulse', () => health.setHeartbeatLost( false ) );
		disposers.push( () => doc.off( '.osPulse' ) );
	}

	// Site-wide events. The cursor starts at 0, which the server answers
	// with its current sequence only — mounting does not replay history.
	let seq = 0;
	let lastResponse = performance.now();
	disposers.push( heartbeat.contribute( HEARTBEAT_FIELD, () => ( { since: seq } ) ) );
	disposers.push(
		heartbeat.subscribe< ServerPayload >( HEARTBEAT_FIELD, ( payload ) => {
			const arrived = performance.now();
			// Replay the last tick's worth of server events at their real
			// spacing, one tick late — a steady rhythm instead of a burst
			// every 15–60 seconds.
			const span = Math.min( 60000, Math.max( 5000, arrived - lastResponse ) );
			lastResponse = arrived;
			if ( seq > 0 && Array.isArray( payload?.events ) && typeof payload.now === 'number' ) {
				const start = payload.now - span;
				for ( const ev of payload.events ) {
					const offset = Math.min( span, Math.max( 0, ev.ts - start ) );
					beat( String( ev.kind ), {
						error: ev.error === true,
						delay: offset,
						detail: ev.error ? statusDetail( ev.status, __( 'failed' ) ) : undefined,
					} );
					if ( ev.kind === 'visitors' || ev.kind === 'bots' ) {
						health.recordVisit( now() );
					} else if ( ev.kind === 'requests' || ev.kind === 'heartbeat' ) {
						// This user's own editor traffic, which only the
						// server saw — it counts toward this shell's numbers.
						health.recordRequest( now(), ev.status || 200 );
					}
				}
			}
			if ( typeof payload?.seq === 'number' ) {
				seq = payload.seq;
			}
			if ( payload?.health ) {
				health.setServer( now(), payload.health );
			}
		} ),
	);

	// Server events arrive one tick late, so a faster tick is a
	// livelier trace. Raise a slow Heartbeat to 15 s while mounted and
	// put it back afterwards.
	if ( wpHeartbeat && typeof wpHeartbeat.interval === 'function' ) {
		const previous = wpHeartbeat.interval();
		if ( previous > 15 ) {
			wpHeartbeat.interval( 15 );
			disposers.push( () => {
				if ( wpHeartbeat.interval() === 15 ) {
					wpHeartbeat.interval( previous );
				}
			} );
		}
		wpHeartbeat.connectNow?.();
	}

	return (): void => {
		for ( const dispose of disposers.splice( 0 ) ) {
			try {
				dispose();
			} catch {
				/* one failed teardown must not strand the rest */
			}
		}
	};
}
