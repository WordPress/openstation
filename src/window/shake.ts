/**
 * Shake — a pointer gesture the platform does not have.
 *
 * A shake is the pointer changing direction quickly and repeatedly
 * while a button is held: the thing a hand does to say "no, not that"
 * or "start again". macOS uses it to find the cursor; here it resets
 * the anchor of a grid-snap drag, and it is published as a first-class
 * event so anything else can listen for it.
 *
 * ## What counts
 *
 * The detector watches the pointer's motion along whichever axis it is
 * moving on and counts **reversals** — the moment the pointer, having
 * travelled at least {@link ShakeOptions.minAmplitudePx} one way, turns
 * back. A shake is {@link ShakeOptions.minReversals} of those within
 * a run whose reversals are never more than {@link ShakeOptions.maxGapMs}
 * apart and that has lasted at least {@link ShakeOptions.minDurationMs}.
 *
 * Every threshold exists to reject something specific:
 *
 * - **Amplitude** rejects jitter. A hand at rest wobbles by a pixel or
 *   two at 120 Hz, and without a floor every drag would be a shake.
 * - **Reversal count** rejects a single zig-zag, which is how a hand
 *   corrects an overshoot — three reversals is one correction, not a
 *   gesture.
 * - **Gap** rejects two separate wiggles a second apart from being
 *   summed into one shake.
 * - **Duration** is the contract the caller asked for: a shake is
 *   sustained, and a fast flick that meets the count in 300ms is not.
 *
 * ## Pure
 *
 * `feed()` takes samples and returns a verdict; nothing here touches
 * the DOM. That is what makes it testable as a table of pointer
 * traces, and what lets it be reused for any pointer — a window title
 * bar today, a file tile or a Mio drag tomorrow. `dispatchShake()` is
 * the one DOM-facing helper, kept separate.
 */

export interface ShakeOptions {
	/** Minimum sustained duration, first reversal to last. */
	minDurationMs: number;
	/** Reversals required, counted across both axes. */
	minReversals: number;
	/** Travel needed before a turn counts as a reversal. */
	minAmplitudePx: number;
	/** Longest pause between reversals before the run resets. */
	maxGapMs: number;
	/** Quiet period after a detection before another can begin. */
	cooldownMs: number;
}

export const DEFAULT_SHAKE_OPTIONS: Readonly< ShakeOptions > = {
	minDurationMs: 1000,
	minReversals: 5,
	minAmplitudePx: 14,
	maxGapMs: 320,
	cooldownMs: 600,
};

/** What a detected shake reports. */
export interface ShakeDetail {
	/** Pointer position at the reversal that completed the shake. */
	x: number;
	y: number;
	/** First reversal to last, in ms. */
	durationMs: number;
	reversals: number;
	/** The axis most of the motion happened on. */
	axis: 'x' | 'y';
}

/** Name of the CustomEvent {@link dispatchShake} fires. */
export const SHAKE_EVENT = 'os-pointer-shake';

/** Per-axis leg tracking: where the current excursion started and which way it is going. */
interface AxisRun {
	/** Position where the current leg began. */
	origin: number;
	/** Direction of the current leg: +1, -1, or 0 before the first leg. */
	dir: -1 | 0 | 1;
	/** Furthest the leg has travelled from `origin` in `dir`. */
	extent: number;
}

interface Reversal {
	t: number;
	axis: 'x' | 'y';
}

export interface ShakeDetector {
	/**
	 * Feed one pointer sample. Returns the shake it just completed, or
	 * `null`. A completed shake resets the run and starts the cooldown.
	 */
	feed( x: number, y: number, t: number ): ShakeDetail | null;
	/** Forget everything — call at the end of a gesture. */
	reset(): void;
}

/**
 * Build a detector. One per gesture (per drag), not one per element:
 * the run state belongs to a press, and a detector that outlived one
 * would carry half a shake into the next.
 */
export function createShakeDetector(
	options: Partial< ShakeOptions > = {},
): ShakeDetector {
	const opts: ShakeOptions = { ...DEFAULT_SHAKE_OPTIONS, ...options };

	let runX: AxisRun = { origin: 0, dir: 0, extent: 0 };
	let runY: AxisRun = { origin: 0, dir: 0, extent: 0 };
	let reversals: Reversal[] = [];
	let primed = false;
	let cooldownUntil = -Infinity;

	const reset = (): void => {
		runX = { origin: 0, dir: 0, extent: 0 };
		runY = { origin: 0, dir: 0, extent: 0 };
		reversals = [];
		primed = false;
	};

	/**
	 * Advance one axis. Returns `true` when this sample completed a
	 * reversal on it: the pointer had travelled at least the amplitude
	 * one way and has now moved the other way.
	 */
	const step = ( run: AxisRun, value: number ): boolean => {
		if ( run.dir === 0 ) {
			// First leg: direction is whichever way the pointer first
			// clears the amplitude.
			const delta = value - run.origin;
			if ( Math.abs( delta ) >= opts.minAmplitudePx ) {
				run.dir = delta > 0 ? 1 : -1;
				run.extent = Math.abs( delta );
			}
			return false;
		}
		const along = ( value - run.origin ) * run.dir;
		if ( along >= run.extent ) {
			run.extent = along;
			return false;
		}
		// Moving against the leg. A turn only counts once the pointer
		// has come back by the amplitude, so a one-pixel stutter at the
		// far end of a leg is not a reversal.
		if ( run.extent - along >= opts.minAmplitudePx ) {
			const turnedAt = run.origin + run.dir * run.extent;
			run.origin = turnedAt;
			run.dir = run.dir === 1 ? -1 : 1;
			run.extent = run.extent - along;
			return run.extent >= 0;
		}
		return false;
	};

	const feed = ( x: number, y: number, t: number ): ShakeDetail | null => {
		if ( t < cooldownUntil ) {
			return null;
		}
		if ( ! primed ) {
			primed = true;
			runX.origin = x;
			runY.origin = y;
			return null;
		}

		// A run whose last reversal is stale is over: the pointer
		// paused, and whatever comes next is a new gesture.
		const last = reversals[ reversals.length - 1 ];
		if ( last && t - last.t > opts.maxGapMs ) {
			reversals = [];
		}

		const turnedX = step( runX, x );
		const turnedY = step( runY, y );
		if ( turnedX ) {
			reversals.push( { t, axis: 'x' } );
		}
		if ( turnedY ) {
			reversals.push( { t, axis: 'y' } );
		}
		if ( ! turnedX && ! turnedY ) {
			return null;
		}

		if ( reversals.length < opts.minReversals ) {
			return null;
		}
		const durationMs = t - reversals[ 0 ].t;
		if ( durationMs < opts.minDurationMs ) {
			return null;
		}

		let onX = 0;
		for ( const r of reversals ) {
			if ( r.axis === 'x' ) {
				onX++;
			}
		}
		const detail: ShakeDetail = {
			x,
			y,
			durationMs,
			reversals: reversals.length,
			axis: onX * 2 >= reversals.length ? 'x' : 'y',
		};
		reset();
		cooldownUntil = t + opts.cooldownMs;
		return detail;
	};

	return { feed, reset };
}

/**
 * Publish a shake as a DOM event on `target`, bubbling and composed,
 * so a listener on `document` hears every shake in the shell and one
 * on a window hears only its own.
 */
export function dispatchShake( target: EventTarget, detail: ShakeDetail ): void {
	target.dispatchEvent(
		new CustomEvent< ShakeDetail >( SHAKE_EVENT, {
			detail,
			bubbles: true,
			composed: true,
		} ),
	);
}
