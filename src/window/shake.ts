export interface ShakeOptions {

	minDurationMs: number;

	minReversals: number;

	minAmplitudePx: number;

	maxGapMs: number;

	cooldownMs: number;
}

export const DEFAULT_SHAKE_OPTIONS: Readonly< ShakeOptions > = {
	minDurationMs: 1000,
	minReversals: 5,
	minAmplitudePx: 14,
	maxGapMs: 320,
	cooldownMs: 600,
};

export interface ShakeDetail {

	x: number;
	y: number;

	durationMs: number;
	reversals: number;

	axis: 'x' | 'y';
}

export const SHAKE_EVENT = 'os-pointer-shake';

interface AxisRun {

	origin: number;

	dir: -1 | 0 | 1;

	extent: number;
}

interface Reversal {
	t: number;
	axis: 'x' | 'y';
}

export interface ShakeDetector {

	feed( x: number, y: number, t: number ): ShakeDetail | null;

	reset(): void;
}

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

	const step = ( run: AxisRun, value: number ): boolean => {
		if ( run.dir === 0 ) {
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

export function dispatchShake( target: EventTarget, detail: ShakeDetail ): void {
	target.dispatchEvent(
		new CustomEvent< ShakeDetail >( SHAKE_EVENT, {
			detail,
			bubbles: true,
			composed: true,
		} ),
	);
}
