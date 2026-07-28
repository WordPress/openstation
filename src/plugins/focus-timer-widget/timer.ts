/**
 * The Focus Timer runtime — a DOM-independent state machine that owns
 * the countdown, the alarm, and the window-shake loop.
 *
 * It lives as a single instance on `window.__desktopModeFocusTimer` so a
 * running timer survives the widget being torn down and re-mounted (the
 * widget layer re-docks / re-renders cards freely). The view subscribes
 * for change notifications and never holds timer state itself.
 *
 * Why a `window` global and not `createSharedStore`: this is a live
 * controller (open intervals, an AudioContext, methods) rather than
 * serialisable state, and only this one bundle instantiates it — so the
 * cross-bundle divergence that `createSharedStore` guards against can't
 * arise here. Durable settings + an in-flight countdown are mirrored to
 * the widget's `ctx.storage` (localStorage) so a page reload can resume
 * a timer that is still counting down.
 */

import { Alarm } from './alarm';
import { shakeWindow, toast } from './desktop';
import { __ } from '../../i18n';

export type Phase = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerSnapshot {
	phase: Phase;
	/** Milliseconds left (0 when finished). */
	remainingMs: number;
	/** The configured full duration, in ms. */
	durationMs: number;
	/** Id of the linked Desktop Mode window, or null. */
	linkedWindowId: string | null;
	/** Whether the countdown digits are shown while running. */
	showRemaining: boolean;
}

interface PersistShape {
	phase: Phase;
	endAt: number | null;
	remainingMs: number;
	durationMs: number;
	linkedWindowId: string | null;
	showRemaining: boolean;
}

interface StorageLike {
	get< T >( key: string ): T | null;
	set< T >( key: string, value: T ): void;
}

const KEY = 'state';
const DEFAULT_DURATION = 25 * 60 * 1000;
const MIN_DURATION = 60 * 1000;
const MAX_DURATION = 180 * 60 * 1000;
const TICK_MS = 250;
const SHAKE_MS = 700;

class FocusTimer {
	private phase: Phase = 'idle';
	private endAt: number | null = null;
	private remainingMs = DEFAULT_DURATION;
	private durationMs = DEFAULT_DURATION;
	private linkedWindowId: string | null = null;
	private showRemaining = true;

	private tick: ReturnType< typeof setInterval > | null = null;
	private shaker: ReturnType< typeof setInterval > | null = null;
	private readonly alarm = new Alarm();
	private readonly subs = new Set<() => void >();
	private storage: StorageLike | null = null;
	private hydrated = false;
	private windowListenerInstalled = false;

	constructor() {
		this.installWindowListener();
	}

	/**
	 * React to the linked window being closed. The runtime (not the view)
	 * owns this subscription so it fires even when the widget card has
	 * been torn down or re-docked — a running timer must still respond to
	 * its target window going away. Per the widget's product decision
	 * (see issue #410): closing the linked window cancels the timer.
	 */
	private installWindowListener(): void {
		if ( this.windowListenerInstalled ) {
			return;
		}
		this.windowListenerInstalled = true;
		window.addEventListener( 'desktop-mode-window-closed', ( e ) => {
			const id = ( e as CustomEvent< { windowId?: string } > ).detail
				?.windowId;
			if ( ! id || id !== this.linkedWindowId ) {
				return;
			}
			this.onLinkedWindowClosed();
		} );
	}

	private onLinkedWindowClosed(): void {
		const wasActive =
			this.phase === 'running' || this.phase === 'paused';
		this.linkedWindowId = null;
		if ( wasActive ) {
			// reset() persists (with the now-cleared link) and notifies.
			this.reset();
			toast(
				__(
					'Focus timer cancelled — the linked window was closed.',
					'desktop-mode',
				),
			);
		} else {
			this.persist();
			this.notify();
		}
	}

	/**
	 * Wire up persistence and restore any saved timer. Called on every
	 * mount but only acts the first time (the instance is long-lived).
	 */
	attachStorage( storage: StorageLike ): void {
		if ( this.hydrated ) {
			return;
		}
		this.hydrated = true;
		this.storage = storage;
		const saved = storage.get< PersistShape >( KEY );
		if ( saved ) {
			this.restore( saved );
		}
	}

	private restore( s: PersistShape ): void {
		this.durationMs = clampDuration( s.durationMs || DEFAULT_DURATION );
		this.linkedWindowId = s.linkedWindowId ?? null;
		this.showRemaining = s.showRemaining ?? true;

		if ( s.phase === 'running' && s.endAt ) {
			if ( s.endAt - Date.now() > 0 ) {
				this.endAt = s.endAt;
				this.phase = 'running';
				this.startTick();
			} else {
				// Expired while the page was closed — ring on return.
				this.remainingMs = 0;
				this.enterFinished();
			}
		} else if ( s.phase === 'paused' ) {
			this.phase = 'paused';
			this.remainingMs = s.remainingMs || this.durationMs;
		} else {
			this.phase = 'idle';
			this.remainingMs = this.durationMs;
		}
	}

	snapshot(): TimerSnapshot {
		return {
			phase: this.phase,
			remainingMs: this.currentRemaining(),
			durationMs: this.durationMs,
			linkedWindowId: this.linkedWindowId,
			showRemaining: this.showRemaining,
		};
	}

	private currentRemaining(): number {
		if ( this.phase === 'running' && this.endAt !== null ) {
			return Math.max( 0, this.endAt - Date.now() );
		}
		if ( this.phase === 'finished' ) {
			return 0;
		}
		return this.remainingMs;
	}

	subscribe( cb: () => void ): () => void {
		this.subs.add( cb );
		return () => {
			this.subs.delete( cb );
		};
	}

	private notify(): void {
		this.subs.forEach( ( cb ) => cb() );
	}

	// --- Settings (only mutable while not running / ringing) -----------

	setDuration( ms: number ): void {
		if ( this.phase === 'running' || this.phase === 'finished' ) {
			return;
		}
		this.durationMs = clampDuration( ms );
		this.remainingMs = this.durationMs;
		this.phase = 'idle';
		this.endAt = null;
		this.persist();
		this.notify();
	}

	setLinkedWindow( id: string | null ): void {
		this.linkedWindowId = id;
		this.persist();
		this.notify();
	}

	setShowRemaining( value: boolean ): void {
		this.showRemaining = value;
		this.persist();
		this.notify();
	}

	// --- Transport -----------------------------------------------------

	start(): void {
		if ( this.phase === 'running' ) {
			return;
		}
		const base =
			this.phase === 'paused' ? this.remainingMs : this.durationMs;
		this.endAt = Date.now() + Math.max( 0, base );
		this.phase = 'running';
		// Unlock audio inside the click gesture so the alarm can fire later.
		this.alarm.prime();
		this.startTick();
		this.persist();
		this.notify();
	}

	pause(): void {
		if ( this.phase !== 'running' ) {
			return;
		}
		this.remainingMs = this.currentRemaining();
		this.endAt = null;
		this.phase = 'paused';
		this.stopTick();
		this.persist();
		this.notify();
	}

	reset(): void {
		this.stopTick();
		this.stopRinging();
		this.phase = 'idle';
		this.endAt = null;
		this.remainingMs = this.durationMs;
		this.persist();
		this.notify();
	}

	/** Silence the alarm + stop the shake, returning to idle. */
	dismiss(): void {
		this.stopRinging();
		this.phase = 'idle';
		this.endAt = null;
		this.remainingMs = this.durationMs;
		this.persist();
		this.notify();
	}

	isRinging(): boolean {
		return this.alarm.isRinging();
	}

	// --- Internals -----------------------------------------------------

	private startTick(): void {
		this.stopTick();
		this.tick = setInterval( () => {
			if ( this.currentRemaining() <= 0 ) {
				this.enterFinished();
			} else {
				this.notify();
			}
		}, TICK_MS );
	}

	private stopTick(): void {
		if ( this.tick !== null ) {
			clearInterval( this.tick );
			this.tick = null;
		}
	}

	private enterFinished(): void {
		this.stopTick();
		this.phase = 'finished';
		this.endAt = null;
		this.remainingMs = 0;
		this.persist();
		// Ring + shake the linked window until dismissed.
		this.alarm.start();
		this.doShake();
		this.shaker = setInterval( () => this.doShake(), SHAKE_MS );
		this.notify();
	}

	private doShake(): void {
		if ( this.linkedWindowId ) {
			shakeWindow( this.linkedWindowId );
		}
	}

	private stopRinging(): void {
		this.alarm.stop();
		if ( this.shaker !== null ) {
			clearInterval( this.shaker );
			this.shaker = null;
		}
	}

	private persist(): void {
		this.storage?.set< PersistShape >( KEY, {
			phase: this.phase,
			endAt: this.endAt,
			remainingMs: this.remainingMs,
			durationMs: this.durationMs,
			linkedWindowId: this.linkedWindowId,
			showRemaining: this.showRemaining,
		} );
	}
}

function clampDuration( ms: number ): number {
	if ( ! Number.isFinite( ms ) ) {
		return DEFAULT_DURATION;
	}
	return Math.min( MAX_DURATION, Math.max( MIN_DURATION, Math.round( ms ) ) );
}

/**
 * The single, page-wide timer instance. Held on `window` so it outlives
 * any single widget mount (re-dock / re-render) — see the module note.
 */
export function focusTimer(): FocusTimer {
	const holder = window as unknown as {
		__desktopModeFocusTimer?: FocusTimer;
	};
	if ( ! holder.__desktopModeFocusTimer ) {
		holder.__desktopModeFocusTimer = new FocusTimer();
	}
	return holder.__desktopModeFocusTimer;
}

export const DURATION_BOUNDS = {
	min: MIN_DURATION,
	max: MAX_DURATION,
	step: MIN_DURATION,
};
