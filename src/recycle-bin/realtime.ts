/**
 * Recycle Bin — real-time signal subscriber.
 *
 * Two non-polling channels feed `document.dispatchEvent(
 * 'os-recycle-bin-changed' )` so the open window's
 * existing handler can refresh:
 *
 *   1. **Fast path — chromeless `postMessage`.**
 *      `realtime.php` emits a tiny inline script in every
 *      chromeless `admin_footer` carrying the current
 *      `_desktop_mode_recycle_bin_change_ts`. We listen on `window`
 *      `message`, scope to same-origin, and only act when
 *      `ts > seenTs`. Because the dominant delete flow is
 *      form-POST → 302 → fresh chromeless GET, this lands
 *      reliably within milliseconds of the click.
 *
 *   2. **Catch-all — Heartbeat.**
 *      We hook `heartbeat-send` to attach
 *      `openstation_recycle_bin_seen_ts` on every outgoing tick (more
 *      reliable than `enqueue()`, which the queue clears post-
 *      send) and `heartbeat-tick` to read the response. Covers
 *      AJAX trash actions, REST `DELETE`, other tabs, WP-CLI.
 *      Subscription is scoped to "window open"; closed bins
 *      cost zero per server tick.
 *
 * Idempotent — `start()` is safe to call multiple times and
 * `stop()` always tears down everything `start()` installed.
 */

const EVENT_NAME = 'os-recycle-bin-changed';
// Heartbeat sends the data object as `_POST['data'][key]`. The
// key IS the field name our `heartbeat_received` filter reads.
const HEARTBEAT_FIELD = 'openstation_recycle_bin_seen_ts';
const POSTMESSAGE_TYPE = 'os-recycle-bin-changed';

type DetailKind = 'restore' | 'purge' | 'empty' | 'external';

interface ChangedDetail {
	kind: DetailKind;
	ok: number;
	errors: Array< { id: number; code: string; message: string } >;
	source?: 'chromeless' | 'heartbeat' | 'local';
	ts?: number;
}

interface JQueryStaticLite {
	( selector: Document | Element ): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
		off: ( event: string, handler?: ( ...args: unknown[] ) => void ) => void;
	};
}

declare global {
	interface Window {
		jQuery?: JQueryStaticLite;
	}
}

/** Module-scoped state. Re-used across start/stop cycles. */
const state = {
	started: false,
	seenTs: 0,
	postMessageHandler: null as ( ( e: MessageEvent ) => void ) | null,
	heartbeatSendHandler: null as
		| ( ( ...args: unknown[] ) => void )
		| null,
	heartbeatTickHandler: null as
		| ( ( ...args: unknown[] ) => void )
		| null,
};

/**
 * Dispatch the canonical CustomEvent that the bin's `index.ts`
 * listens for. The `external` kind tells subscribers "re-fetch"
 * without confusing them about which sub-action ran.
 */
function dispatchChanged( source: ChangedDetail[ 'source' ], ts?: number ): void {
	const detail: ChangedDetail = {
		kind: 'external',
		ok: 0,
		errors: [],
		source,
		ts,
	};
	document.dispatchEvent( new CustomEvent( EVENT_NAME, { detail } ) );

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( 'openstation.recycleBin.changed', detail );
	}
}

/**
 * Begin listening on both channels. Idempotent.
 *
 * Called when the Recycle Bin window opens. The pair to this is
 * {@link stop}, called when the window closes — that releases
 * the heartbeat slot so closed-bin tabs don't tax the server.
 */
export function start(): void {
	if ( state.started ) {
		return;
	}
	state.started = true;

	// Initialize seenTs to "now" — the chromeless footer will only
	// fire `dispatchChanged` for ts > seenTs, so deletes that
	// happened before the bin opened are out of scope. The very
	// first `refresh()` (called by `index.ts` after start) loads
	// the current state of the bin, which IS the truth at t=open.
	state.seenTs = Date.now();

	// --- Fast path: chromeless postMessage ----------------------------

	const expectedOrigin = window.location.origin;
	state.postMessageHandler = ( e: MessageEvent ): void => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}
		const data = e.data as
			| { type?: string; ts?: number }
			| null
			| undefined;
		if ( ! data || data.type !== POSTMESSAGE_TYPE ) {
			return;
		}
		const ts = typeof data.ts === 'number' ? data.ts : Date.now();
		if ( ts <= state.seenTs ) {
			return;
		}
		state.seenTs = ts;
		dispatchChanged( 'chromeless', ts );
	};
	window.addEventListener( 'message', state.postMessageHandler );

	// --- Catch-all path: Heartbeat ------------------------------------

	const $ = window.jQuery;
	if ( ! $ ) {
		return;
	}

	// `heartbeat-send` fires BEFORE every outgoing tick with a
	// mutable `data` object. Setting our field here is more
	// reliable than `wp.heartbeat.enqueue()` because the heartbeat
	// queue is cleared post-send — `enqueue` once would only ride
	// the next tick, while this rides every tick.
	state.heartbeatSendHandler = ( ...args: unknown[] ): void => {
		const data = args[ 1 ] as Record< string, unknown > | undefined;
		if ( data ) {
			data[ HEARTBEAT_FIELD ] = state.seenTs;
		}
	};
	$( document ).on( 'heartbeat-send', state.heartbeatSendHandler );

	state.heartbeatTickHandler = ( ...args: unknown[] ): void => {
		const response = args[ 1 ] as
			| { openstation_recycle_bin?: { changed?: boolean; ts?: number } }
			| undefined;
		const block = response?.openstation_recycle_bin;
		if ( ! block ) {
			return;
		}
		const ts = typeof block.ts === 'number' ? block.ts : 0;
		if ( ts > state.seenTs ) {
			state.seenTs = ts;
			if ( block.changed ) {
				dispatchChanged( 'heartbeat', ts );
			}
		}
	};
	$( document ).on( 'heartbeat-tick', state.heartbeatTickHandler );
}

/**
 * Tear down both channels. Idempotent.
 */
export function stop(): void {
	if ( ! state.started ) {
		return;
	}
	state.started = false;

	if ( state.postMessageHandler ) {
		window.removeEventListener( 'message', state.postMessageHandler );
		state.postMessageHandler = null;
	}

	const $ = window.jQuery;
	if ( $ ) {
		if ( state.heartbeatSendHandler ) {
			$( document ).off( 'heartbeat-send', state.heartbeatSendHandler );
		}
		if ( state.heartbeatTickHandler ) {
			$( document ).off( 'heartbeat-tick', state.heartbeatTickHandler );
		}
	}
	state.heartbeatSendHandler = null;
	state.heartbeatTickHandler = null;
}

/**
 * Internal — read-only access to the high-water mark for tests
 * and debugging. Not part of the public API.
 *
 * @internal
 */
export function _seenTs(): number {
	return state.seenTs;
}
