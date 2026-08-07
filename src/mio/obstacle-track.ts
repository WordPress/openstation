/**
 * OpenStation — Mio obstacle interpolation.
 *
 * The desk is measured on a throttle: `readSurfaces()` reads every
 * window, widget and dock rect out of the DOM at `SURFACE_REFRESH_MS`,
 * because `getBoundingClientRect()` on a dozen nodes is not something
 * to do sixty times a second. The simulation, meanwhile, runs every
 * frame.
 *
 * Feeding a sampled rect straight to a per-frame solver is what makes
 * a dragged window shove Mio in lurches: the window's own `left` /
 * `top` are written on every `pointermove`, so by the time the next
 * sample lands the rect has travelled a whole throttle interval, and
 * the contact pass — which is a positional push — applies that entire
 * delta in one step. Mio hops, holds for three frames, hops again.
 *
 * The fix is not a faster sample. It is to stop treating samples as
 * *the truth right now* and start treating them as **keyframes**: hold
 * the previous sample alongside the current one and hand the solver a
 * rect lerped between the two across the interval that separated them.
 * A 20 Hz measurement then drives a 60 Hz push, smoothly.
 *
 * The cost is that Mio reacts one sample interval late — it is chasing
 * where the window *was* 50 ms ago. That is invisible on a decorative
 * blob, and it is the trade that makes this preferable to
 * extrapolation, which buys back the latency but overshoots every time
 * the window stops and then snaps back.
 *
 * Two things this deliberately does **not** interpolate:
 *
 *   - **An obstacle with no previous keyframe** — a window that just
 *     opened, or the very first sample. It appears solid where it is.
 *     Sliding it in from nowhere would mean a window materialised
 *     mid-desk and then swept across it.
 *   - **Anything, after {@link ObstacleTrack.reset}.** A layout change
 *     re-bases every coordinate at once; lerping across that is a
 *     smear, not motion.
 *
 * Pure and DOM-free, like the rest of `environment.ts`, so the
 * behaviour is unit testable without a browser.
 */

import type { Obstacle } from './environment';

/**
 * Gap between samples, past which the pair is not one motion.
 *
 * A tab that was in the background comes back with two samples that are
 * before-and-after rather than two moments of a drag. Sweeping the
 * whole desk from one to the other would be a smear across everything
 * at once, so the newer sample is taken at face value instead.
 */
const MAX_STALE_MS = 250;

/** A pair of sampled desks, presented as one continuously moving desk. */
export interface ObstacleTrack {
	/**
	 * Record a freshly measured desk as the newest keyframe.
	 *
	 * @param obstacles The measured obstacle set. Retained by reference
	 *                  until the next sample — and handed straight back
	 *                  out of `at()` while the desk is still — so pass a
	 *                  fresh array, not a reused buffer.
	 * @param nowMs     Timestamp of the measurement.
	 */
	sample( obstacles: readonly Obstacle[], nowMs: number ): void;
	/**
	 * The desk as it stands at `nowMs`, interpolated between the two
	 * newest keyframes.
	 *
	 * Never runs past the newest keyframe: a frame that arrives late
	 * holds against it rather than extrapolating, because overshooting
	 * and snapping back is the artefact this module exists to avoid and
	 * it would reappear at the end of every drag.
	 *
	 * @param nowMs Frame timestamp, on the same clock as `sample()`.
	 */
	at( nowMs: number ): readonly Obstacle[];
	/**
	 * Drop the interpolation history, keeping the newest keyframe.
	 *
	 * For discontinuities that are not motion — a shell resize rebasing
	 * every coordinate. The next `at()` returns the newest sample
	 * verbatim rather than lerping toward it from coordinates that
	 * meant something else.
	 */
	reset(): void;
}

/**
 * Key a sample by identity, disambiguating repeats.
 *
 * Surface ids are namespaced and stable (`window:foo`, `dock:edge`),
 * which is what makes matching across two samples possible at all. They
 * are not, however, *guaranteed* unique — the widget branch of
 * `collectWallpaperSurfaces()` falls back to a positional index when a
 * card has no `data-widget-id`, and a plugin filter can return whatever
 * it likes. An occurrence counter keeps a duplicate id from collapsing
 * two obstacles onto one key, which would drop one of them from the
 * interpolated set entirely.
 */
function keyed( obstacles: readonly Obstacle[] ): Map< string, Obstacle > {
	const out = new Map< string, Obstacle >();
	const seen = new Map< string, number >();
	for ( const o of obstacles ) {
		const n = seen.get( o.id ) ?? 0;
		seen.set( o.id, n + 1 );
		out.set( 0 === n ? o.id : `${ o.id }#${ n }`, o );
	}
	return out;
}

/** Whether two keyed samples describe the same geometry. */
function unchanged(
	a: Map< string, Obstacle >,
	b: Map< string, Obstacle >,
): boolean {
	if ( a.size !== b.size ) {
		return false;
	}
	for ( const [ key, prev ] of a ) {
		const next = b.get( key );
		if (
			! next ||
			next.x !== prev.x ||
			next.y !== prev.y ||
			next.width !== prev.width ||
			next.height !== prev.height
		) {
			return false;
		}
	}
	return true;
}

function lerp( a: number, b: number, t: number ): number {
	return a + ( b - a ) * t;
}

/**
 * Create an obstacle track.
 *
 * A still desk — the overwhelmingly common case — costs nothing: the
 * two keyframes are geometrically identical, so `at()` short-circuits
 * and hands back the measured array itself, exactly as the caller would
 * have had without any of this.
 *
 * **`intervalMs` is the caller's throttle, not the measured gap between
 * the last two samples, and that is what makes the hand-off seamless.**
 * The gap varies — the ticker decides which frame `readSurfaces()`
 * actually runs on, so a 50 ms throttle produces gaps of 50 ms and
 * 66.7 ms in whatever order the frames fall. Spreading the lerp over
 * the *previous* gap and then sampling early leaves the interpolation
 * unfinished, and the new keyframe pair starts from the position the
 * old one was still travelling toward: a jump, the smaller cousin of
 * exactly the one this module exists to remove. Spreading it over the
 * throttle instead guarantees the lerp has arrived before the next
 * sample can land, because the throttle is a floor on the gap. The
 * worst case degrades to a hold of a frame or two at the end of an
 * interval, which reads as nothing at all.
 *
 * @param intervalMs The caller's minimum gap between `sample()` calls.
 */
export function createObstacleTrack( intervalMs: number ): ObstacleTrack {
	const interval = Math.max( 1, intervalMs );
	let previous = new Map< string, Obstacle >();
	let current = new Map< string, Obstacle >();
	/** The measured array behind `current`, for the still-desk path. */
	let currentList: readonly Obstacle[] = [];
	let sampledAt = 0;
	/** True while the desk is not moving, or while history is dropped. */
	let still = true;

	return {
		sample( obstacles: readonly Obstacle[], nowMs: number ): void {
			const gap = nowMs - sampledAt;
			previous = current;
			current = keyed( obstacles );
			currentList = obstacles;
			sampledAt = nowMs;
			still = gap > MAX_STALE_MS || unchanged( previous, current );
		},

		at( nowMs: number ): readonly Obstacle[] {
			if ( still ) {
				return currentList;
			}
			const t = Math.min(
				1,
				Math.max( 0, ( nowMs - sampledAt ) / interval ),
			);
			if ( 1 <= t ) {
				return currentList;
			}
			const out: Obstacle[] = [];
			for ( const [ key, o ] of current ) {
				const prev = previous.get( key );
				if ( ! prev ) {
					// Newly on the desk: solid where it is.
					out.push( o );
					continue;
				}
				out.push( {
					id: o.id,
					kind: o.kind,
					face: o.face,
					x: lerp( prev.x, o.x, t ),
					y: lerp( prev.y, o.y, t ),
					width: lerp( prev.width, o.width, t ),
					height: lerp( prev.height, o.height, t ),
				} );
			}
			return out;
		},

		reset(): void {
			previous = current;
			still = true;
		},
	};
}
