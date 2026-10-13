/**
 * Pulse Monitor — one mounted monitor.
 *
 * The composition the wallpaper and the widget both mount: its own
 * {@link Rhythm} and Pixi scene, subscribed to the page's shared
 * {@link PulseHub}, plus the numbers readout, the spike labels and the
 * beeper. The wallpaper and the widget differ only in the scene
 * `variant` and where the readout sits.
 *
 * Muting is per monitor: the hub hands every beat to every monitor and
 * each drops the sources its settings switched off. The diagnosis is
 * shared — muting quiets a trace, it never blinds the health reading.
 */

import { doAction } from '../../hooks';
import type { HealthReading } from './health';
import { acquirePulseHub } from './hub';
import { openIssues } from './issues';
import type { PixiNamespace } from './pixi-types';
import { Beeper, createReadout } from './readout';
import { Rhythm, type BeatStarted } from './rhythm';
import { mountPulseScene, type PulseSceneOptions } from './scene';
import type { PulseSettings } from './settings';
import { spikeLabel } from './sources';

/** Action fired for every beat a monitor draws. */
export const BEAT_HOOK = 'os.pulse.beat';

/** How often the diagnosis and the readout refresh, ms. */
const REFRESH_MS = 250;

export interface MonitorOptions {
	container: HTMLElement;
	pixi: PixiNamespace;
	settings: PulseSettings;
	prefersReducedMotion: boolean;
	variant: NonNullable< PulseSceneOptions[ 'variant' ] >;
}

export interface Monitor {
	applySettings( settings: PulseSettings ): void;
	setAnimating( animating: boolean ): void;
	destroy(): void;
}

/**
 * The text printed on a spike: what caused it and, for a failed
 * (amber) beat, why. A beat the diagnosis made abnormal names the
 * rhythm and its leading cause.
 *
 *   request · 404
 *   heartbeat · timeout
 *   PVC: slow responses (p95 3.1 s)          (a resting beat)
 *   request · VT: 42% of requests failing
 */
export function spikeText( beat: Pick< BeatStarted, 'source' | 'shape' | 'error' | 'detail' | 'ectopic' > ): string {
	const cause = beat.source === 'rest' ? '' : spikeLabel( beat.source );
	let why = beat.error ? beat.detail : '';
	if ( beat.ectopic ) {
		const name = beat.shape === 'vt' ? 'VT' : 'PVC';
		why = why ? `${ name }: ${ why }` : name;
	}
	return [ cause, why ].filter( Boolean ).join( ' · ' );
}

export async function mountMonitor( opts: MonitorOptions ): Promise< Monitor > {
	let settings = opts.settings;
	let muted = new Set< string >( settings.muted );
	const { hub, release } = acquirePulseHub();
	const beeper = new Beeper();
	const soundOn = ( s: PulseSettings ): boolean => s.sound && opts.variant !== 'preview';
	beeper.setEnabled( soundOn( settings ) );
	// Hidden tab or suspended wallpaper: the trace is frozen, so beats
	// are dropped rather than queued (the rhythm only drains its queues
	// while the scene ticks — a long pause would replay as a burst).
	// Reduced motion draws one still frame and never ticks at all.
	let suspended = false;

	// Assigned once the scene mounts; beats only start inside the
	// scene's own step, so it is always set by the time one fires.
	let labelBeat: ( ( text: string, error: boolean, durationMs: number ) => void ) | null = null;
	const rhythm = new Rhythm( {
		restingBpm: settings.restingBpm,
		onBeat: ( beat ) => {
			if ( soundOn( settings ) && beat.major ) {
				beeper.beep( beat.error ? 520 : 880, 70 );
			}
			// Name every spike a person caused, and every failed beat —
			// not the idle pacemaker's normal beats, and not the tiny
			// blips (clicks, assets) that would bury the trace in words.
			const named = beat.source !== 'rest' || beat.error;
			if ( labelBeat && named && ( beat.shape !== 'blip' || beat.error ) ) {
				labelBeat( spikeText( beat ), beat.error, beat.duration );
			}
			/**
			 * Fires for every beat a monitor draws. Payload:
			 * `{ source, shape, error, major, duration, detail, surface }`
			 * — `source` is the signal id (`requests`, `visitors`, …) or
			 * `rest` for the idle pacemaker; `surface` is `wallpaper` or
			 * `widget`.
			 */
			// The band is the wallpaper face in its band layout.
			doAction( BEAT_HOOK, { ...beat, surface: opts.variant === 'band' ? 'wallpaper' : opts.variant } );
		},
	} );

	let scene;
	try {
		scene = await mountPulseScene( {
			container: opts.container,
			pixi: opts.pixi,
			settings,
			prefersReducedMotion: opts.prefersReducedMotion,
			rhythm,
			variant: opts.variant,
		} );
	} catch ( err ) {
		release();
		beeper.destroy();
		throw err;
	}
	labelBeat = scene.labelBeat;
	const mounted = scene;

	const unsubscribe = hub.subscribe( ( beat, delayMs ) => {
		if ( suspended || opts.prefersReducedMotion || muted.has( beat.source ) ) {
			return;
		}
		const next = beat.error && muted.has( 'errors' ) ? { ...beat, error: false, detail: undefined } : beat;
		rhythm.push( next, delayMs > 0 ? mounted.now() + delayMs : undefined );
	} );

	// The widget card and the reserved band can be clicked; the
	// full-screen wallpaper lies under the desk and cannot.
	const readout = createReadout(
		opts.container,
		opts.variant === 'widget' || opts.variant === 'band' ? opts.variant : 'wallpaper',
		opts.variant === 'widget' || opts.variant === 'band' ? openIssues : undefined,
	);
	readout.setVisible( settings.readout );

	let lastAlarm = 0;
	const refresh = (): void => {
		const real = hub.health.read( performance.now() );
		const reading: HealthReading = settings.diagnose ? real : { ...real, state: 'healthy', reasons: [], cause: '' };
		rhythm.setState( reading.state, reading.cause );
		if ( settings.readout ) {
			readout.update( { reading, lineColor: settings.lineColor, errorColor: settings.errorColor } );
		}
		// The flatline alarm: one long tone every two seconds.
		if ( soundOn( settings ) && reading.state === 'down' && performance.now() - lastAlarm > 2000 ) {
			lastAlarm = performance.now();
			beeper.beep( 440, 900, 0.04 );
		}
	};
	refresh();
	// Paused with the trace: a hidden or suspended monitor neither
	// redraws its numbers nor sounds the flatline alarm.
	let timer = window.setInterval( refresh, REFRESH_MS );

	return {
		applySettings( next: PulseSettings ): void {
			settings = next;
			muted = new Set( settings.muted );
			rhythm.setRestingBpm( settings.restingBpm );
			beeper.setEnabled( soundOn( settings ) );
			mounted.applySettings( settings );
			readout.setVisible( settings.readout );
			refresh();
		},
		setAnimating( animating: boolean ): void {
			mounted.setAnimating( animating );
			if ( suspended === ! animating ) {
				return;
			}
			suspended = ! animating;
			window.clearInterval( timer );
			if ( animating ) {
				refresh();
				timer = window.setInterval( refresh, REFRESH_MS );
			}
		},
		destroy(): void {
			window.clearInterval( timer );
			unsubscribe();
			readout.destroy();
			beeper.destroy();
			mounted.destroy();
			release();
		},
	};
}
