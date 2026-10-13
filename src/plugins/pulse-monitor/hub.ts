/**
 * Pulse Monitor — the shared signal hub.
 *
 * The wallpaper and the widget can both be on the desk at once. They
 * must not each wire the taps: two `PerformanceObserver`s, two jQuery
 * Heartbeat bindings and — worse — two contributors to the one
 * `openstation_pulse` Heartbeat field (last writer wins, so the first
 * monitor's server feed would silently stop). So the taps, the server
 * feed and the {@link HealthMonitor} live here, once per page, and
 * every mounted monitor subscribes.
 *
 * Reference-counted: the first {@link acquirePulseHub} wires the taps,
 * the last release unwires them. Module state is safe because the
 * wallpaper and the widget ship in the same bundle.
 */

import { HealthMonitor } from './health';
import type { BeatRequest } from './rhythm';
import { wireSignals } from './signals';

/** Receives every beat; `delayMs` > 0 means "draw this later". */
export type BeatListener = ( beat: BeatRequest, delayMs: number ) => void;

export interface PulseHub {
	/** Shared diagnosis. Read it with `performance.now()`. */
	health: HealthMonitor;
	/** Listen to every beat. Returns the unsubscribe. */
	subscribe( listener: BeatListener ): () => void;
}

let refs = 0;
let health: HealthMonitor | null = null;
let unwire: ( () => void ) | null = null;
const listeners = new Set< BeatListener >();

const hub: PulseHub = {
	get health(): HealthMonitor {
		if ( ! health ) {
			health = new HealthMonitor();
		}
		return health;
	},
	subscribe( listener ) {
		listeners.add( listener );
		return () => {
			listeners.delete( listener );
		};
	},
};

/**
 * Take a reference on the hub, wiring the taps on the first one.
 * Call the returned `release` exactly once.
 */
export function acquirePulseHub(): { hub: PulseHub; release: () => void } {
	refs++;
	if ( refs === 1 ) {
		unwire = wireSignals( {
			health: hub.health,
			emit: ( beat, delayMs ) => {
				for ( const listener of listeners ) {
					try {
						listener( beat, delayMs );
					} catch {
						/* one broken monitor must not starve the others */
					}
				}
			},
		} );
	}
	let released = false;
	return {
		hub,
		release: () => {
			if ( released ) {
				return;
			}
			released = true;
			refs--;
			if ( refs === 0 ) {
				unwire?.();
				unwire = null;
				// A fresh diagnosis next time: stale observations from a
				// previous session on the desk would only mislead.
				health = null;
			}
		},
	};
}
