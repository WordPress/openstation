/**
 * Pulse Monitor — rhythm engine.
 *
 * Turns a stream of beat requests into an ECG signal the scene can
 * sample at any monitor time. Pure (no DOM, no Pixi) and clock-driven
 * by its caller, so the whole thing is unit-testable.
 *
 * Scheduling. Signals arrive in bursts — an admin page load fires
 * fifty asset requests in a second — so beats queue:
 *
 *   - Major beats (`qrs`, `double`, `pvc`) start at most one per
 *     refractory gap. A queue that overflows boosts the next beats'
 *     height instead of growing forever: a burst reads as a run of
 *     tall, fast beats.
 *   - Minor beats (`flutter`, `blip`) ride on top, with their own,
 *     much shorter gap.
 *   - With no activity a resting beat fires every 60/BPM seconds, and
 *     every activity beat resets that clock — a pacemaker, not a
 *     metronome. Sustained activity raises the resting rate.
 *
 * Condition. {@link Rhythm.setState} switches the morphology to the
 * diagnosed site health (see `health.ts`).
 */

import type { HealthState } from './health';
import { shapeFor, type BeatShape } from './sources';

export interface BeatRequest {
	/** Source id (see `sources.ts`) — picks the default shape and height. */
	source: string;
	/** Draw as a failed (ectopic) beat. */
	error?: boolean;
	/** Override the source's default height. */
	amplitude?: number;
	/**
	 * Why this beat failed, in a few words ("404", "network error",
	 * "TypeError: x is undefined"). Printed after the spike's label.
	 */
	detail?: string;
}

/** What the scene gets told when a beat starts. */
export interface BeatStarted {
	source: string;
	shape: BeatShape | 'vt';
	error: boolean;
	major: boolean;
	/** How long the complex lasts on the trace, ms. */
	duration: number;
	/**
	 * Why the beat is drawn as failed: the signal's own detail, or —
	 * for an ectopic or tachycardic beat the diagnosis produced — the
	 * condition's leading reason. Empty for a normal beat.
	 */
	detail: string;
	/**
	 * The diagnosis, not the signal, made this beat abnormal: a strained
	 * heart's PVC or a critical heart's ventricular tachycardia.
	 */
	ectopic: boolean;
}

type Wave = ReadonlyArray< readonly [ number, number, number ] >;

/**
 * Morphologies as sums of Gaussians: `[ amplitude, centre ms, sigma ms ]`.
 * Tuned by eye against a textbook lead-II trace.
 */
const WAVES: Record< BeatShape | 'vt' | 'qrsNoP', Wave > = {
	qrs: [
		[ 0.11, 90, 20 ], // P
		[ -0.12, 180, 8 ], // Q
		[ 1, 200, 9 ], // R
		[ -0.3, 222, 9 ], // S
		[ 0.28, 390, 38 ], // T
	],
	qrsNoP: [
		[ -0.12, 60, 8 ],
		[ 1, 80, 9 ],
		[ -0.3, 102, 9 ],
		[ 0.24, 260, 36 ],
	],
	double: [
		[ 0.95, 40, 9 ],
		[ -0.22, 60, 8 ],
		[ 0.7, 200, 9 ],
		[ -0.18, 220, 8 ],
		[ 0.22, 370, 40 ],
	],
	flutter: [
		[ 1, 30, 8 ],
		[ -0.3, 50, 8 ],
	],
	blip: [ [ 1, 10, 5 ] ],
	pvc: [
		[ -1, 70, 26 ],
		[ 0.25, 140, 20 ],
		[ 0.5, 290, 45 ],
	],
	vt: [
		[ 1, 100, 40 ],
		[ -0.75, 215, 40 ],
	],
};

/** How long each morphology lasts (its last Gaussian's centre + 3.5σ). */
const DURATIONS = Object.fromEntries(
	Object.entries( WAVES ).map( ( [ key, wave ] ) => [
		key,
		Math.max( ...wave.map( ( [ , mu, sigma ] ) => mu + sigma * 3.5 ) ),
	] ),
) as Record< keyof typeof WAVES, number >;

interface ActiveBeat {
	start: number;
	wave: Wave;
	duration: number;
	amp: number;
	error: boolean;
	/** ST-segment elevation (strained hearts). */
	st: number;
}

interface Pending {
	at: number;
	beat: BeatRequest;
}

const MAJOR: ReadonlySet< BeatShape > = new Set( [ 'qrs', 'double', 'pvc' ] );

/** Shortest gap between two major beats, ms (≈ 200 bpm). */
const MAJOR_GAP = 300;
/** Shortest gap between two minor beats, ms. */
const MINOR_GAP = 45;
const MAJOR_QUEUE_CAP = 24;
const MINOR_QUEUE_CAP = 48;
/**
 * Height of a resting (pacemaker) beat. Kept well under an activity
 * beat's so every request, page load and visitor reads as its own
 * tall spike rather than blending into the idle rhythm.
 */
const RESTING_AMPLITUDE = 0.4;
/** Window for the activity rate, ms. */
const RATE_WINDOW = 30000;

function gaussianSum( wave: Wave, t: number ): number {
	let v = 0;
	for ( const [ a, mu, sigma ] of wave ) {
		const d = t - mu;
		v += a * Math.exp( -( d * d ) / ( 2 * sigma * sigma ) );
	}
	return v;
}

export interface RhythmOptions {
	restingBpm: number;
	/** Random source, injectable for tests. */
	random?: () => number;
	/** Called when a beat starts (for sound, the readout, plugins). */
	onBeat?: ( beat: BeatStarted ) => void;
}

export class Rhythm {
	private restingBpm: number;
	private state: HealthState = 'healthy';
	private reason = '';
	private readonly random: () => number;
	private readonly onBeat?: ( beat: BeatStarted ) => void;

	private pending: Pending[] = [];
	private majorQueue: BeatRequest[] = [];
	private minorQueue: BeatRequest[] = [];
	private active: ActiveBeat[] = [];
	private lastMajor = -Infinity;
	private lastMinor = -Infinity;
	private nextRest = 0;
	private pressure = 0;
	private events: number[] = [];
	private majors: number[] = [];
	private now = 0;

	constructor( opts: RhythmOptions ) {
		this.restingBpm = opts.restingBpm;
		this.random = opts.random ?? Math.random;
		this.onBeat = opts.onBeat;
		// First resting beat straight away; none at all for a flatline.
		this.nextRest = this.restingBpm > 0 ? 0 : Infinity;
	}

	setRestingBpm( bpm: number ): void {
		this.restingBpm = bpm;
		this.scheduleRest( this.lastMajor );
	}

	/**
	 * Switch the morphology to a diagnosed condition. `reason` is the
	 * diagnosis's leading cause; beats the condition turns ectopic or
	 * tachycardic carry it as their detail.
	 */
	setState( state: HealthState, reason = '' ): void {
		this.reason = reason;
		if ( state === this.state ) {
			return;
		}
		this.state = state;
		this.scheduleRest( this.lastMajor );
	}

	getState(): HealthState {
		return this.state;
	}

	/**
	 * Queue a beat. `at` (monitor ms) delays it — used to replay a
	 * Heartbeat batch of server events with their real spacing.
	 */
	push( beat: BeatRequest, at?: number ): void {
		if ( at !== undefined && at > this.now ) {
			this.pending.push( { at, beat } );
			return;
		}
		this.enqueue( beat );
	}

	private enqueue( beat: BeatRequest ): void {
		this.events.push( this.now );
		if ( this.state === 'down' ) {
			// Asystole: the signal is counted, but nothing conducts.
			return;
		}
		const { shape } = shapeFor( beat.source );
		if ( MAJOR.has( shape ) || beat.error ) {
			if ( this.majorQueue.length >= MAJOR_QUEUE_CAP ) {
				this.majorQueue.shift();
				this.pressure = Math.min( 0.6, this.pressure + 0.05 );
			}
			this.majorQueue.push( beat );
		} else if ( this.minorQueue.length < MINOR_QUEUE_CAP ) {
			this.minorQueue.push( beat );
		}
	}

	/** Effective resting rate: the setting, raised by activity and by the condition. */
	private effectiveBpm(): number {
		const perMinute = ( this.events.length * 60000 ) / RATE_WINDOW;
		let bpm = this.restingBpm;
		if ( bpm > 0 ) {
			bpm += Math.min( 50, perMinute * 0.2 );
		}
		switch ( this.state ) {
			case 'strained':
				return bpm > 0 ? bpm + 8 : 0;
			case 'sick':
				return Math.max( bpm, 50 ) + 25;
			case 'critical':
				return 175;
			case 'down':
				return 0;
			default:
				return bpm;
		}
	}

	private scheduleRest( from: number ): void {
		const bpm = this.effectiveBpm();
		if ( bpm <= 0 ) {
			this.nextRest = Infinity;
			return;
		}
		const base = 60000 / bpm;
		// Atrial fibrillation is "irregularly irregular"; a healthy
		// heart still varies a few percent beat to beat.
		const jitter = this.state === 'sick' ? 0.45 + this.random() * 0.9 : 0.96 + this.random() * 0.08;
		this.nextRest = ( Number.isFinite( from ) ? from : this.now ) + base * jitter;
	}

	private start( beat: BeatRequest | null, at: number ): void {
		const source = beat?.source ?? 'rest';
		const def = shapeFor( source );
		let key: keyof typeof WAVES = def.shape;
		let error = beat?.error === true || def.shape === 'pvc';
		const major = beat === null || MAJOR.has( def.shape ) || error;
		let amp = beat?.amplitude ?? ( beat ? def.amplitude : RESTING_AMPLITUDE );
		let st = 0;
		let detail = error ? beat?.detail ?? '' : '';
		let ectopic = false;

		if ( major ) {
			if ( this.state === 'critical' ) {
				key = 'vt';
				error = true;
				ectopic = true;
				detail = this.reason;
				amp = Math.max( amp, 0.9 );
			} else if ( error ) {
				key = 'pvc';
			} else if ( this.state === 'sick' && key === 'qrs' ) {
				key = 'qrsNoP';
			} else if ( this.state === 'strained' ) {
				st = 0.14;
				// An ectopic beat now and then, with the compensatory
				// pause that gives PVCs their tell-tale gap.
				if ( key === 'qrs' && this.random() < 0.22 ) {
					key = 'pvc';
					error = true;
					ectopic = true;
					detail = this.reason;
				}
			}
			amp *= 1 + this.pressure;
			this.pressure *= 0.9;
			this.lastMajor = at;
			this.majors.push( at );
			const pause = key === 'pvc' && ! beat?.error ? 1.6 : 1;
			this.scheduleRest( at );
			if ( pause !== 1 && Number.isFinite( this.nextRest ) ) {
				this.nextRest = at + ( this.nextRest - at ) * pause;
			}
		} else {
			this.lastMinor = at;
		}

		this.active.push( {
			start: at,
			wave: WAVES[ key ],
			duration: DURATIONS[ key ],
			amp,
			error,
			st,
		} );
		this.onBeat?.( { source, shape: key === 'qrsNoP' ? 'qrs' : key, error, major, duration: DURATIONS[ key ], detail, ectopic } );
	}

	/** Advance the scheduler to monitor time `t` (ms). Call before {@link sample}. */
	step( t: number ): void {
		this.now = t;
		if ( this.pending.length ) {
			const due = this.pending.filter( ( p ) => p.at <= t );
			if ( due.length ) {
				this.pending = this.pending.filter( ( p ) => p.at > t );
				for ( const p of due ) {
					this.enqueue( p.beat );
				}
			}
		}

		const majorGap = this.state === 'sick' ? MAJOR_GAP * ( 0.7 + this.random() * 0.9 ) : MAJOR_GAP;
		if ( this.majorQueue.length && t - this.lastMajor >= majorGap ) {
			this.start( this.majorQueue.shift() ?? null, t );
		} else if ( ! this.majorQueue.length && t >= this.nextRest && this.state !== 'down' ) {
			this.start( null, t );
		}
		if ( this.minorQueue.length && t - this.lastMinor >= MINOR_GAP ) {
			this.start( this.minorQueue.shift() ?? null, t );
		}

		if ( this.active.length && this.active[ 0 ].start + this.active[ 0 ].duration < t ) {
			this.active = this.active.filter( ( b ) => b.start + b.duration >= t );
		}
		const cutoff = t - RATE_WINDOW;
		while ( this.events.length && this.events[ 0 ] < cutoff ) {
			this.events.shift();
		}
		while ( this.majors.length && this.majors[ 0 ] < t - 15000 ) {
			this.majors.shift();
		}
	}

	/**
	 * Signal value at monitor time `t`, in R-wave units (≈ −1…1.5),
	 * plus whether a failed beat is what is being drawn there.
	 */
	sample( t: number ): { value: number; error: boolean } {
		let value = 0;
		let error = false;
		for ( const beat of this.active ) {
			const local = t - beat.start;
			if ( local < 0 || local > beat.duration ) {
				continue;
			}
			let v = gaussianSum( beat.wave, local ) * beat.amp;
			if ( beat.st ) {
				// A raised plateau between S and T.
				const d = local - 300;
				v += beat.st * beat.amp * Math.exp( -( d * d ) / ( 2 * 60 * 60 ) );
			}
			if ( beat.error && Math.abs( v ) > 0.03 ) {
				error = true;
			}
			value += v;
		}

		// Baseline: breathing wander, plus a fibrillating quiver for a
		// sick heart, plus a whisper of noise so it never looks drawn
		// with a ruler.
		const down = this.state === 'down';
		value += ( down ? 0.2 : 1 ) * ( 0.035 * Math.sin( ( t / 4200 ) * Math.PI * 2 ) + 0.015 * Math.sin( ( t / 1700 ) * Math.PI * 2 + 1.3 ) );
		if ( this.state === 'sick' ) {
			value += 0.05 * Math.sin( ( t / 150 ) * Math.PI * 2 ) + 0.03 * Math.sin( ( t / 113 ) * Math.PI * 2 + 1 );
		}
		const noise = this.state === 'strained' || this.state === 'critical' ? 0.03 : 0.015;
		value += ( this.random() - 0.5 ) * noise;
		return { value, error };
	}

	/** Heart rate as a monitor would print it: full beats in the last 15 s × 4. */
	heartRate(): number {
		return this.majors.length * 4;
	}

	/** Signals per minute over the rate window. */
	eventsPerMinute(): number {
		return Math.round( ( this.events.length * 60000 ) / RATE_WINDOW );
	}
}
