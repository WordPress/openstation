/**
 * Pulse Monitor — site health diagnosis.
 *
 * Turns what the shell and the server observe into one of five
 * conditions, each of which the rhythm engine draws as a recognisable
 * ECG pattern:
 *
 *   healthy   regular sinus rhythm
 *   strained  sinus with ectopic (PVC) beats and ST elevation
 *   sick      atrial fibrillation — irregular, no P waves, quivering baseline
 *   critical  ventricular tachycardia — fast, wide, alarm-coloured
 *   down      asystole — a flatline
 *
 * Inputs over a sliding one-minute window: request outcomes and
 * latency (shell + iframes), JavaScript errors, and the server's
 * Heartbeat snapshot (Site Health criticals, 5xx share of site-wide
 * traffic, overdue cron). Connectivity (offline, Heartbeat
 * connection lost, session expired) is a hard override.
 *
 * Pure and clock-injected so it is unit-testable.
 */

import { __, sprintf } from '../../i18n';

export type HealthState = 'healthy' | 'strained' | 'sick' | 'critical' | 'down';

/** The server half, as `includes/pulse-monitor.php` sends it. */
export interface ServerHealth {
	siteHealth: { good: number; recommended: number; critical: number } | null;
	requests: number;
	failures: number;
	cronLate: number;
	load: number | null;
}

export interface HealthReading {
	state: HealthState;
	/** 0 (dead) – 100 (perfect), smoothed. */
	score: number;
	/** Share of requests in the window that succeeded, or null with too few to say. */
	successRate: number | null;
	/** Median request latency in ms, or null. */
	latencyP50: number | null;
	/** 95th-percentile request latency in ms, or null. */
	latencyP95: number | null;
	/** Requests this shell saw settle over the last minute. */
	requestsPerMinute: number;
	/**
	 * Front-end page views (visitors + bots) over the last minute, from
	 * the server feed — null when the feed is not reaching this user.
	 */
	visitsPerMinute: number | null;
	/** Human-readable reasons the score is not 100, worst first. */
	reasons: string[];
}

interface RequestSample {
	at: number;
	/** 0 ok, 1 client error (4xx), 2 failure (5xx / network). */
	outcome: 0 | 1 | 2;
}

interface LatencySample {
	at: number;
	ms: number;
}

/** What a penalty is about — decides how far it can push the rhythm. */
type PenaltyKind = 'config' | 'slow' | 'failure';

/** Kinds from least to most serious. */
const SEVERITY_ORDER: readonly PenaltyKind[] = [ 'config', 'slow', 'failure' ];

/** The worst condition each kind of trouble can produce on its own. */
const SEVERITY_CAP: Record< PenaltyKind, HealthState > = {
	config: 'strained',
	slow: 'sick',
	failure: 'critical',
};

/** Conditions from best to worst (excluding `down`, which is connectivity). */
const STATES: readonly HealthState[] = [ 'healthy', 'strained', 'sick', 'critical' ];

function stateForScore( score: number ): HealthState {
	if ( score >= 80 ) {
		return 'healthy';
	}
	if ( score >= 55 ) {
		return 'strained';
	}
	return score >= 30 ? 'sick' : 'critical';
}

/** Fewer requests than this in the window and the error ratio is noise. */
const MIN_SAMPLE = 4;

/** Time constant of the score smoothing, ms. */
const SMOOTHING_MS = 6000;

/** Consecutive network-level failures that read as "the site is down". */
const DOWN_AFTER_FAILURES = 5;

export class HealthMonitor {
	private requests: RequestSample[] = [];
	private latencies: LatencySample[] = [];
	private jsErrors: number[] = [];
	private visits: number[] = [];
	private server: ServerHealth | null = null;
	private serverAt = -Infinity;
	private offline = false;
	private heartbeatLost = false;
	private authLost = false;
	private consecutiveFailures = 0;
	private smoothed = 100;
	private lastRead = -Infinity;

	private readonly windowMs: number;

	constructor( windowMs = 60000 ) {
		this.windowMs = windowMs;
	}

	/**
	 * One request settled.
	 *
	 * @param at     Monitor time, ms.
	 * @param status HTTP status, or 0 for a network-level failure.
	 */
	recordRequest( at: number, status: number ): void {
		let outcome: 0 | 1 | 2 = 0;
		if ( status === 0 || status >= 500 ) {
			outcome = 2;
		} else if ( status >= 400 ) {
			outcome = 1;
		}
		this.consecutiveFailures = status === 0 ? this.consecutiveFailures + 1 : 0;
		this.requests.push( { at, outcome } );
	}

	/**
	 * One request's round-trip time. Kept apart from outcomes because
	 * they arrive from different places: the activity bus knows the
	 * status, the browser's resource timing knows the duration.
	 */
	recordLatency( at: number, ms: number ): void {
		if ( Number.isFinite( ms ) && ms >= 0 ) {
			this.latencies.push( { at, ms } );
		}
	}

	/** A front-end page view relayed by the server feed. */
	recordVisit( at: number ): void {
		this.visits.push( at );
	}

	/** A JavaScript error surfaced in the shell or a window. */
	recordJsError( at: number ): void {
		this.jsErrors.push( at );
	}

	setServer( at: number, server: ServerHealth ): void {
		this.server = server;
		this.serverAt = at;
	}

	setOffline( offline: boolean ): void {
		this.offline = offline;
	}

	setHeartbeatLost( lost: boolean ): void {
		this.heartbeatLost = lost;
	}

	setAuthLost( lost: boolean ): void {
		this.authLost = lost;
	}

	private prune( now: number ): void {
		const cutoff = now - this.windowMs;
		while ( this.requests.length && this.requests[ 0 ].at < cutoff ) {
			this.requests.shift();
		}
		while ( this.latencies.length && this.latencies[ 0 ].at < cutoff ) {
			this.latencies.shift();
		}
		while ( this.jsErrors.length && this.jsErrors[ 0 ] < cutoff ) {
			this.jsErrors.shift();
		}
		while ( this.visits.length && this.visits[ 0 ] < cutoff ) {
			this.visits.shift();
		}
		// A server snapshot older than three windows is stale (Heartbeat
		// stopped answering, or the user lost the capability).
		if ( now - this.serverAt > this.windowMs * 3 ) {
			this.server = null;
		}
	}

	/** Compute the current reading. Advances the smoothing clock. */
	read( now: number ): HealthReading {
		this.prune( now );
		// Each penalty has a kind, because kinds cap how bad the rhythm can
		// get (see SEVERITY_CAP): a slow or misconfigured site is not a
		// failing one, and must never draw ventricular tachycardia.
		const penalties: Array< { points: number; reason: string; kind: PenaltyKind } > = [];

		const total = this.requests.length;
		let failed = 0;
		let clientErrors = 0;
		for ( const sample of this.requests ) {
			if ( sample.outcome === 2 ) {
				failed++;
			} else if ( sample.outcome === 1 ) {
				clientErrors++;
			}
		}
		const durations = this.latencies.map( ( l ) => l.ms );
		const successRate = total >= MIN_SAMPLE ? ( total - failed - clientErrors ) / total : null;
		if ( total >= MIN_SAMPLE && ( failed || clientErrors ) ) {
			const ratio = ( failed + clientErrors * 0.25 ) / total;
			penalties.push( {
				kind: 'failure',
				points: Math.min( 80, ratio * 250 ),
				/* translators: %d: percentage of failed requests. */
				reason: sprintf( __( '%d%% of requests failing' ), Math.round( ( ( failed + clientErrors ) / total ) * 100 ) ),
			} );
		}

		durations.sort( ( a, b ) => a - b );
		const pct = ( p: number ): number | null =>
			durations.length
				? durations[ Math.min( durations.length - 1, Math.floor( p * durations.length ) ) ]
				: null;
		const p50 = pct( 0.5 );
		const p95 = durations.length >= MIN_SAMPLE ? pct( 0.95 ) : null;
		if ( p95 !== null && p95 > 800 ) {
			penalties.push( {
				kind: 'slow',
				points: Math.min( 25, ( p95 - 800 ) / 80 ),
				/* translators: %s: latency in seconds, e.g. "2.4". */
				reason: sprintf( __( 'slow responses (p95 %s s)' ), ( p95 / 1000 ).toFixed( 1 ) ),
			} );
		}

		const errorsPerMinute = ( this.jsErrors.length * 60000 ) / this.windowMs;
		if ( errorsPerMinute > 0 ) {
			penalties.push( {
				kind: 'slow',
				points: Math.min( 20, errorsPerMinute * 5 ),
				/* translators: %d: number of JavaScript errors in the last minute. */
				reason: sprintf( __( '%d JavaScript errors/min' ), Math.round( errorsPerMinute ) ),
			} );
		}

		if ( this.authLost ) {
			penalties.push( { kind: 'failure', points: 30, reason: __( 'session expired' ) } );
		}

		const server = this.server;
		if ( server ) {
			const critical = server.siteHealth?.critical ?? 0;
			const recommended = server.siteHealth?.recommended ?? 0;
			if ( critical > 0 ) {
				penalties.push( {
					kind: 'config',
					points: Math.min( 30, critical * 10 ),
					/* translators: %d: number of critical Site Health issues. */
					reason: sprintf( __( '%d critical Site Health issues' ), critical ),
				} );
			}
			if ( recommended > 0 ) {
				penalties.push( {
					kind: 'config',
					points: Math.min( 5, recommended ),
					/* translators: %d: number of recommended Site Health improvements. */
					reason: sprintf( __( '%d Site Health recommendations' ), recommended ),
				} );
			}
			if ( server.requests >= MIN_SAMPLE && server.failures > 0 ) {
				const ratio = server.failures / server.requests;
				penalties.push( {
					kind: 'failure',
					points: Math.min( 40, ratio * 200 ),
					/* translators: %d: percentage of site-wide requests ending in a server error. */
					reason: sprintf( __( '%d%% server errors site-wide' ), Math.round( ratio * 100 ) ),
				} );
			}
			if ( server.cronLate > 600 ) {
				penalties.push( {
					kind: 'config',
					points: Math.min( 15, ( server.cronLate / 600 ) * 4 ),
					/* translators: %d: minutes the scheduled tasks are overdue. */
					reason: sprintf( __( 'cron %d min overdue' ), Math.round( server.cronLate / 60 ) ),
				} );
			}
		}

		penalties.sort( ( a, b ) => b.points - a.points );
		const raw = Math.max( 0, 100 - penalties.reduce( ( sum, p ) => sum + p.points, 0 ) );

		// Smooth, so one failed request is a skipped beat and not a
		// rhythm change. Worsening moves faster than recovering — a
		// monitor should be quick to alarm and slow to stand down.
		const dt = Number.isFinite( this.lastRead ) ? Math.max( 0, now - this.lastRead ) : SMOOTHING_MS * 10;
		this.lastRead = now;
		const tau = raw < this.smoothed ? SMOOTHING_MS / 2 : SMOOTHING_MS;
		this.smoothed += ( raw - this.smoothed ) * ( 1 - Math.exp( -dt / tau ) );
		const score = Math.round( this.smoothed );

		const reasons = penalties.map( ( p ) => p.reason );
		let state: HealthState;
		if ( this.offline || this.heartbeatLost || this.consecutiveFailures >= DOWN_AFTER_FAILURES ) {
			state = 'down';
			reasons.unshift( this.offline ? __( 'offline' ) : __( 'server not answering' ) );
		} else {
			state = stateForScore( score );
			// Cap the rhythm by what actually hurts: misconfiguration
			// (Site Health, overdue cron) alone tops out at PVCs, adding
			// slowness or JS errors tops out at fibrillation, and only
			// failing requests reach ventricular tachycardia.
			const worst = penalties.reduce< PenaltyKind >(
				( acc, p ) => ( SEVERITY_ORDER.indexOf( p.kind ) > SEVERITY_ORDER.indexOf( acc ) ? p.kind : acc ),
				'config',
			);
			if ( STATES.indexOf( state ) > STATES.indexOf( SEVERITY_CAP[ worst ] ) ) {
				state = SEVERITY_CAP[ worst ];
			}
		}

		return {
			state,
			score: state === 'down' ? 0 : score,
			successRate,
			latencyP50: p50,
			latencyP95: p95,
			requestsPerMinute: Math.round( ( total * 60000 ) / this.windowMs ),
			visitsPerMinute: this.server ? Math.round( ( this.visits.length * 60000 ) / this.windowMs ) : null,
			reasons,
		};
	}
}

/** Readout label for a condition — what a monitor would print. */
export function rhythmLabel( state: HealthState ): string {
	switch ( state ) {
		case 'strained':
			return __( 'Sinus rhythm with PVCs' );
		case 'sick':
			return __( 'Atrial fibrillation' );
		case 'critical':
			return __( 'Ventricular tachycardia' );
		case 'down':
			return __( 'Asystole' );
		default:
			return __( 'Normal sinus rhythm' );
	}
}
