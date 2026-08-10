/**
 * OpenStation Desktop — server handshake + liveness heartbeat.
 *
 * ## Why the main process owns this
 *
 * The renderer already talks to WordPress constantly; adding one more
 * request there would have been easier. It lives here instead because
 * the heartbeat has to survive things the renderer does not: a freed
 * window being the only thing on screen, the shell window being closed
 * on macOS (where the app keeps running), an in-shell navigation that
 * tears the page down. The host is alive as long as the *app* is, so
 * the app is what reports it.
 *
 * ## Injected dependencies
 *
 * `fetch`, the timer, and the clock all come in through the
 * constructor. Not for purity's sake — because the interesting
 * behaviour here is *timing*, and timing that can only be observed by
 * waiting two minutes is timing nobody tests. See
 * `tests/connection.test.ts`.
 *
 * Pacing rules live in `./schedule.ts`.
 */

import {
	DEFAULT_INTERVAL,
	clampInterval,
	nextDelay,
	shouldSkipBeat,
} from './schedule';
import { isSameSiteUrl } from './site-url';
import type { ConnectionState, HandshakeArgs } from './protocol';

/** Minimal `fetch` shape this module needs. */
export type FetchLike = (
	url: string,
	init: {
		method: string;
		credentials?: string;
		headers: Record< string, string >;
		body: string;
	},
) => Promise< {
	ok: boolean;
	status: number;
	json: () => Promise< unknown >;
} >;

/** Everything the connection needs from the outside world. */
export interface ConnectionDeps {
	/** HTTP transport. In production, Electron's `net.fetch`. */
	fetch: FetchLike;
	/** REST namespace to post under, e.g. `openstation-electron/v1`. */
	namespace: string;
	/**
	 * The site this app is paired with. Every REST root the shell hands
	 * over is checked against it before anything is sent — see
	 * `handshake()`.
	 */
	siteUrl: () => string;
	/** Identity to send. */
	hostId: () => string;
	/** App + platform description for the handshake. */
	describe: () => Record< string, unknown >;
	/** Called on every state transition. */
	onChange: ( state: ConnectionState ) => void;
	/** Deferred-callback scheduler. Defaults to `setTimeout`. */
	setTimer?: ( fn: () => void, ms: number ) => unknown;
	/** Cancel a scheduled callback. Defaults to `clearTimeout`. */
	clearTimer?: ( handle: unknown ) => void;
	/** Clock. Defaults to `Date.now`. */
	now?: () => number;
}

/** A request that failed authentication rather than the network. */
class AuthError extends Error {
	public readonly authFailure = true;
}

export class Connection {
	private readonly deps: Required<
		Pick< ConnectionDeps, 'setTimer' | 'clearTimer' | 'now' >
	> &
		ConnectionDeps;

	private state: ConnectionState = { state: 'idle' };
	private restUrl = '';
	private nonce = '';
	private interval = DEFAULT_INTERVAL;
	private timer: unknown = null;
	private failures = 0;
	private skips = 0;

	/** Set whenever an app window is focused; cleared on each beat. */
	private activeSinceLastBeat = true;
	/** True while at least one window is freed onto the OS desktop. */
	private hasFreedWindows = false;

	/**
	 * @param deps Injected collaborators.
	 */
	constructor( deps: ConnectionDeps ) {
		this.deps = {
			setTimer: ( fn, ms ) => setTimeout( fn, ms ),
			clearTimer: ( handle ) => clearTimeout( handle as NodeJS.Timeout ),
			now: () => Date.now(),
			...deps,
		};
	}

	/** @return The current connection state. */
	getState(): ConnectionState {
		return this.state;
	}

	/** Note that the user interacted with the app since the last beat. */
	markActive(): void {
		this.activeSinceLastBeat = true;
	}

	/**
	 * @param has Whether any window is currently freed.
	 */
	setHasFreedWindows( has: boolean ): void {
		this.hasFreedWindows = !! has;
	}

	/**
	 * Introduce this host to the site and start beating.
	 *
	 * Safe to call repeatedly — the shell calls it on every load and
	 * again whenever its REST nonce is refreshed. A repeat handshake
	 * just refreshes the server record and re-reads the interval.
	 *
	 * ## Why the REST root is checked
	 *
	 * The handshake body is not a greeting; it carries `describe()`,
	 * and `describe()` carries the local agent's URL and bearer token —
	 * the pairing secret, the one thing in this app worth stealing.
	 * Where that goes is decided entirely by `args.restUrl`, and
	 * `args.restUrl` arrives from a renderer.
	 *
	 * A renderer is not a trusted source of destinations. It is the
	 * layer an attacker gets a foothold in, and the preload bridge that
	 * reaches this method survives navigation. So the REST root is held
	 * to the same rule as every other URL the main process acts on
	 * (`routeNewWindow`, `FreeWindows.isAllowedUrl`, `guardNavigation`):
	 * it must be on the site this app is paired with. Somewhere else is
	 * not a misconfiguration to report — it is a request to post a
	 * secret to a stranger, and it is refused before `describe()` is
	 * ever called.
	 *
	 * @param args REST coordinates from the shell.
	 * @return The resulting state.
	 */
	async handshake( args: HandshakeArgs ): Promise< ConnectionState > {
		const restUrl = String( args.restUrl || '' ).replace( /\/+$/, '' );
		const nonce = String( args.nonce || '' );
		if ( ! restUrl || ! nonce ) {
			this.setState( {
				state: 'error',
				message: 'Shell did not supply REST coordinates.',
			} );
			return this.state;
		}

		if ( ! isSameSiteUrl( restUrl, this.deps.siteUrl() ) ) {
			// Left disconnected on purpose: a previously good `restUrl`
			// is not re-armed by a bad handshake, so a page that
			// navigated away cannot keep the heartbeat alive either.
			this.stopTimer();
			this.restUrl = '';
			this.setState( {
				state: 'error',
				message: 'REST root is not on the connected site.',
			} );
			return this.state;
		}

		this.restUrl = restUrl;
		this.nonce = nonce;

		this.setState( { state: 'connecting', siteUrl: args.siteUrl } );

		try {
			const data = await this.request( 'host/handshake', {
				hostId: this.deps.hostId(),
				...this.deps.describe(),
			} );
			this.interval = clampInterval( data.heartbeatInterval );
			this.failures = 0;
			this.setState( {
				state: 'connected',
				interval: this.interval,
				lastBeat: this.deps.now(),
				user: 'string' === typeof data.user ? data.user : undefined,
				message: undefined,
			} );
			this.scheduleNext();
		} catch ( err ) {
			this.handleFailure( err );
			this.scheduleNext();
		}
		return this.state;
	}

	/**
	 * One liveness beat. Cheap by construction: a tiny POST the server
	 * answers by touching a single user-meta row.
	 */
	async beat(): Promise< void > {
		if ( ! this.restUrl ) {
			return;
		}

		if (
			shouldSkipBeat( {
				activeSinceLastBeat: this.activeSinceLastBeat,
				hasFreedWindows: this.hasFreedWindows,
				skips: this.skips,
			} )
		) {
			this.skips += 1;
			this.scheduleNext();
			return;
		}

		this.skips = 0;
		this.activeSinceLastBeat = false;

		try {
			const data = await this.request( 'host/heartbeat', {
				hostId: this.deps.hostId(),
			} );
			this.interval = clampInterval( data.heartbeatInterval, this.interval );
			this.failures = 0;
			this.setState( {
				state: 'connected',
				interval: this.interval,
				lastBeat: this.deps.now(),
				message: undefined,
			} );
		} catch ( err ) {
			this.handleFailure( err );
		}
		this.scheduleNext();
	}

	/**
	 * Wake up after a suspend. The record has almost certainly expired
	 * server-side by now, and the user is looking at the screen, so
	 * beat immediately rather than waiting out the remaining interval.
	 */
	resume(): void {
		if ( ! this.restUrl ) {
			return;
		}
		this.activeSinceLastBeat = true;
		void this.beat();
	}

	/**
	 * Tell the server this host is going away, best-effort.
	 *
	 * Called on quit and deliberately not blocking it: a stale record
	 * expires on its own, and an app that hangs on quit because the
	 * network is down is a worse bug than a record that lingers for
	 * ten minutes.
	 */
	async farewell(): Promise< void > {
		this.stopTimer();
		if ( ! this.restUrl ) {
			return;
		}
		try {
			await this.request( 'host/disconnect', { hostId: this.deps.hostId() } );
		} catch {
			// The server's TTL covers us.
		}
		this.setState( { state: 'idle', message: undefined } );
	}

	/** Cancel any pending beat. */
	stopTimer(): void {
		if ( null !== this.timer ) {
			this.deps.clearTimer( this.timer );
			this.timer = null;
		}
	}

	/**
	 * @param patch Fields to merge into the state.
	 */
	private setState( patch: Partial< ConnectionState > ): void {
		this.state = { ...this.state, ...patch };
		this.deps.onChange( this.state );
	}

	/**
	 * @param route Route below the REST namespace.
	 * @param body  JSON body.
	 * @return Parsed JSON response.
	 */
	private async request(
		route: string,
		body: Record< string, unknown >,
	): Promise< Record< string, unknown > > {
		const response = await this.deps.fetch(
			`${ this.restUrl }/${ this.deps.namespace }/${ route }`,
			{
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': this.nonce,
				},
				body: JSON.stringify( body ),
			},
		);
		if ( 401 === response.status || 403 === response.status ) {
			throw new AuthError( `auth (${ response.status })` );
		}
		if ( ! response.ok ) {
			throw new Error( `HTTP ${ response.status }` );
		}
		const data = await response.json();
		return ( data && 'object' === typeof data
			? data
			: {} ) as Record< string, unknown >;
	}

	/**
	 * A nonce goes stale roughly every half-day, and the shell already
	 * owns the refresh path — so an auth failure is not an error to
	 * show the user, it is a request for a fresh nonce.
	 *
	 * @param err The failing request's error.
	 */
	private handleFailure( err: unknown ): void {
		this.failures += 1;
		if ( err instanceof AuthError ) {
			this.setState( {
				state: 'nonce-stale',
				message: 'Session credentials expired; asking the shell to refresh.',
			} );
			return;
		}
		this.setState( {
			state: 'error',
			message: err instanceof Error ? err.message : 'Unknown error',
		} );
	}

	/** Queue the next beat, widening the gap while failures persist. */
	private scheduleNext(): void {
		this.stopTimer();
		this.timer = this.deps.setTimer( () => {
			void this.beat();
		}, nextDelay( this.interval, this.failures ) );
		// Never hold the event loop open for a heartbeat.
		const handle = this.timer as { unref?: () => void };
		if ( handle && 'function' === typeof handle.unref ) {
			handle.unref();
		}
	}
}
