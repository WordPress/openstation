/**
 * Alphabet Soup — synthesized sound effects (Web Audio, no assets).
 *
 * Same recipe as Inkfall's music-box: `OscillatorNode` + `GainNode`
 * plucks, lazily-created `AudioContext` (always inside a pointer
 * gesture), on/off preference in localStorage. The soup sings a
 * major-pentatonic scale: dragging across cells climbs the scale
 * one step per cell (any selection is a rising run), a found word
 * rolls a little arpeggio, a wrong selection is a soft pot-lid
 * thud, a cleared wave gets a four-note fanfare, and the Time
 * Attack clock ticks when it runs low.
 */

/** localStorage key for the sound on/off preference. */
const SOUND_STORAGE_KEY = 'desktop-mode/alphabet-soup-sound';

/** Master output level — deliberately quiet, it's an admin screen. */
const MASTER_LEVEL = 0.16;

/** Per-pluck peak level (pre-master). */
const PLUCK_LEVEL = 0.5;

/** Major pentatonic steps in semitones — every pair is consonant. */
const PENTATONIC = [ 0, 2, 4, 7, 9 ] as const;

/** Base frequency for the selection climb — A3, warm and round. */
const BASE_FREQUENCY = 220;

/**
 * The frequency for the `index`-th cell of a selection: climb the
 * pentatonic scale one degree per cell, octave-wrapping. Pure —
 * unit-tested.
 *
 * @param index 0-based cell position within the drag.
 * @return Frequency in Hz.
 */
export function selectionStepFrequency( index: number ): number {
	const step = Math.max( 0, Math.floor( index ) );
	const semitones =
		12 * Math.floor( step / PENTATONIC.length ) +
		PENTATONIC[ step % PENTATONIC.length ];
	return BASE_FREQUENCY * Math.pow( 2, semitones / 12 );
}

export interface SoupAudio {
	/** Rising pluck as the drag covers its `index`-th cell. */
	cellTouch: ( index: number ) => void;
	/** Rolled arpeggio when a word is found. */
	found: ( length: number ) => void;
	/** Soft pot-lid thud for a wrong selection. */
	invalid: () => void;
	/** Four-note fanfare when a wave clears. */
	waveClear: () => void;
	/** Low-time clock tick. */
	tick: () => void;
	/** Descending sign-off when the run ends. */
	gameOver: () => void;
	setEnabled: ( enabled: boolean ) => void;
	isEnabled: () => boolean;
	/** Close the AudioContext. Safe to call twice. */
	dispose: () => void;
}

interface AudioContextLike {
	currentTime: number;
	destination: AudioNode;
	state: string;
	createOscillator: () => OscillatorNode;
	createGain: () => GainNode;
	resume: () => Promise< void >;
	close: () => Promise< void >;
}

type AudioContextCtor = new () => AudioContextLike;

function readStoredEnabled(): boolean {
	try {
		return window.localStorage.getItem( SOUND_STORAGE_KEY ) !== '0';
	} catch {
		return true;
	}
}

function storeEnabled( enabled: boolean ): void {
	try {
		window.localStorage.setItem( SOUND_STORAGE_KEY, enabled ? '1' : '0' );
	} catch {
		/* storage unavailable — best effort */
	}
}

export function createSoupAudio(): SoupAudio {
	let ctx: AudioContextLike | null = null;
	let master: GainNode | null = null;
	let enabled = readStoredEnabled();
	let disposed = false;

	const ensureContext = (): AudioContextLike | null => {
		if ( disposed ) {
			return null;
		}
		if ( ctx ) {
			// A backgrounded tab can suspend the context; nudge it.
			if ( 'suspended' === ctx.state ) {
				void ctx.resume().catch( () => undefined );
			}
			return ctx;
		}
		const Ctor =
			( window as unknown as { AudioContext?: AudioContextCtor } )
				.AudioContext ??
			( window as unknown as { webkitAudioContext?: AudioContextCtor } )
				.webkitAudioContext;
		if ( ! Ctor ) {
			return null;
		}
		try {
			ctx = new Ctor();
		} catch {
			return null;
		}
		master = ctx.createGain();
		master.gain.value = MASTER_LEVEL;
		master.connect( ctx.destination );
		return ctx;
	};

	/** One enveloped tone: fast attack, exponential decay. */
	const pluck = (
		frequency: number,
		opts: {
			type?: OscillatorType;
			delay?: number;
			duration?: number;
			level?: number;
		} = {},
	): void => {
		if ( ! enabled || frequency <= 0 ) {
			return;
		}
		const context = ensureContext();
		if ( ! context || ! master ) {
			return;
		}
		const { type = 'sine', delay = 0, duration = 0.22, level = PLUCK_LEVEL } = opts;
		const start = context.currentTime + delay;
		const osc = context.createOscillator();
		const gain = context.createGain();
		osc.type = type;
		osc.frequency.value = frequency;
		gain.gain.setValueAtTime( 0.0001, start );
		gain.gain.exponentialRampToValueAtTime( level, start + 0.008 );
		gain.gain.exponentialRampToValueAtTime( 0.0001, start + duration );
		osc.connect( gain );
		gain.connect( master );
		osc.start( start );
		osc.stop( start + duration + 0.05 );
	};

	return {
		cellTouch( index ) {
			pluck( selectionStepFrequency( index ), { duration: 0.14, level: 0.35 } );
		},

		found( length ) {
			// Roll a major arpeggio; longer words reach one note higher.
			const root = selectionStepFrequency( Math.min( length, 6 ) );
			pluck( root, { duration: 0.3 } );
			pluck( root * 1.25, { delay: 0.05, duration: 0.3 } );
			pluck( root * 1.5, { delay: 0.1, duration: 0.35 } );
			pluck( root * 2, { delay: 0.16, duration: 0.4, level: 0.4 } );
		},

		invalid() {
			// A muted pot-lid thud — feedback, never punishment.
			pluck( 110, { type: 'triangle', duration: 0.15, level: 0.35 } );
			pluck( 116, { type: 'triangle', duration: 0.12, level: 0.2 } );
		},

		waveClear() {
			// A rising four-note fanfare: the next course is served.
			pluck( 330, { duration: 0.25 } );
			pluck( 415, { delay: 0.09, duration: 0.25 } );
			pluck( 494, { delay: 0.18, duration: 0.3 } );
			pluck( 660, { delay: 0.28, duration: 0.5, level: 0.45 } );
		},

		tick() {
			pluck( 880, { type: 'triangle', duration: 0.06, level: 0.18 } );
		},

		gameOver() {
			// A gentle falling third — the bowl is empty.
			pluck( 392, { type: 'triangle', duration: 0.35, level: 0.4 } );
			pluck( 311, { type: 'triangle', delay: 0.14, duration: 0.45, level: 0.4 } );
		},

		setEnabled( next ) {
			enabled = next;
			storeEnabled( next );
		},

		isEnabled() {
			return enabled;
		},

		dispose() {
			disposed = true;
			if ( ctx ) {
				void ctx.close().catch( () => undefined );
				ctx = null;
				master = null;
			}
		},
	};
}
