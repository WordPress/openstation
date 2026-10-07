import {
	DEFAULT_INTERVAL,
	clampInterval,
	nextDelay,
	shouldSkipBeat,
} from './schedule';
import { isSameSiteUrl } from './site-url';
import type { ConnectionState, HandshakeArgs } from './protocol';

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

export interface ConnectionDeps {

	fetch: FetchLike;

	namespace: string;

	siteUrl: () => string;

	hostId: () => string;

	describe: () => Record< string, unknown >;

	onChange: ( state: ConnectionState ) => void;

	setTimer?: ( fn: () => void, ms: number ) => unknown;

	clearTimer?: ( handle: unknown ) => void;

	now?: () => number;
}

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

	private activeSinceLastBeat = true;

	private hasFreedWindows = false;

	constructor( deps: ConnectionDeps ) {
		this.deps = {
			setTimer: ( fn, ms ) => setTimeout( fn, ms ),
			clearTimer: ( handle ) => clearTimeout( handle as NodeJS.Timeout ),
			now: () => Date.now(),
			...deps,
		};
	}

	getState(): ConnectionState {
		return this.state;
	}

	markActive(): void {
		this.activeSinceLastBeat = true;
	}

	setHasFreedWindows( has: boolean ): void {
		this.hasFreedWindows = !! has;
	}

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

	resume(): void {
		if ( ! this.restUrl ) {
			return;
		}
		this.activeSinceLastBeat = true;
		void this.beat();
	}

	async farewell(): Promise< void > {
		this.stopTimer();
		if ( ! this.restUrl ) {
			return;
		}
		try {
			await this.request( 'host/disconnect', { hostId: this.deps.hostId() } );
		} catch {

		}
		this.setState( { state: 'idle', message: undefined } );
	}

	stopTimer(): void {
		if ( null !== this.timer ) {
			this.deps.clearTimer( this.timer );
			this.timer = null;
		}
	}

	private setState( patch: Partial< ConnectionState > ): void {
		this.state = { ...this.state, ...patch };
		this.deps.onChange( this.state );
	}

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

	private scheduleNext(): void {
		this.stopTimer();
		this.timer = this.deps.setTimer( () => {
			void this.beat();
		}, nextDelay( this.interval, this.failures ) );

		const handle = this.timer as { unref?: () => void };
		if ( handle && 'function' === typeof handle.unref ) {
			handle.unref();
		}
	}
}
