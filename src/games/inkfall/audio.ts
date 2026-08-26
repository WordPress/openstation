/**
 * Inkfall — synthesized sound effects (Web Audio, no assets).
 *
 * A music-box: every letter has a FIXED note — `a` always sounds
 * like `a`, `k` like `k` — mapped alphabetically onto a C-major
 * scale across four octaves, so any word you type is a small
 * consonant melody. Each keystroke is a soft sine pluck (fast
 * attack, exponential decay); typos are a muted low thud rather
 * than a buzzer; finishing a word arpeggiates a little chord off
 * its last letter; a missed word sighs two low notes.
 *
 * Everything is `OscillatorNode` + `GainNode` — no samples, no
 * network. The `AudioContext` is created lazily on the first sound
 * (always inside a keystroke gesture, so autoplay policies are
 * satisfied) and closed on dispose. The on/off preference persists
 * to localStorage.
 */

/** localStorage key for the sound on/off preference. */
const SOUND_STORAGE_KEY = 'desktop-mode/inkfall-sound';

/** Master output level — deliberately quiet, it's an admin screen. */
const MASTER_LEVEL = 0.16;

/** Per-pluck peak level (pre-master). */
const PLUCK_LEVEL = 0.5;

/** C-major scale steps in semitones. */
const MAJOR_SCALE = [ 0, 2, 4, 5, 7, 9, 11 ] as const;

/** Base frequency for the letter map — G3, warm but not muddy. */
const BASE_FREQUENCY = 196;

/**
 * The fixed frequency for a letter. Alphabetical position indexes a
 * C-major scale over four octaves (26 letters < 28 scale degrees),
 * so consecutive letters are neighboring scale notes and every
 * possible pair is consonant. Pure — unit-tested.
 *
 * @param ch A single letter (any case).
 * @return Frequency in Hz, or 0 for non-letters.
 */
export function letterFrequency( ch: string ): number {
	const letter = ch.toLowerCase();
	if ( letter.length !== 1 || letter < 'a' || letter > 'z' ) {
		return 0;
	}
	const index = letter.charCodeAt( 0 ) - 97;
	const semitones =
		12 * Math.floor( index / MAJOR_SCALE.length ) +
		MAJOR_SCALE[ index % MAJOR_SCALE.length ];
	return BASE_FREQUENCY * Math.pow( 2, semitones / 12 );
}

export interface GameAudio {
	/** Pluck the letter's fixed note. */
	letter: ( ch: string ) => void;
	/** Soft low thud — a wrong key, never a buzzer. */
	typo: () => void;
	/** Little ascending chord when a word tears apart. */
	wordBurst: ( lastLetter: string ) => void;
	/** Two-note low sigh when a word reaches the page bottom. */
	miss: () => void;
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

export function createGameAudio(): GameAudio {
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

	/**
	 * One enveloped tone: fast attack, exponential decay, then the
	 * oscillator stops and the nodes are garbage.
	 */
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
		letter( ch ) {
			pluck( letterFrequency( ch ) );
		},

		typo() {
			// A muted felt-piano thud two octaves down — audible
			// feedback without punishment.
			pluck( 98, { type: 'triangle', duration: 0.15, level: 0.35 } );
			pluck( 103, { type: 'triangle', duration: 0.12, level: 0.2 } );
		},

		wordBurst( lastLetter ) {
			// Major arpeggio rooted on the word's last letter, rolled
			// like a tiny harp as the characters scatter.
			const root = letterFrequency( lastLetter ) || BASE_FREQUENCY;
			pluck( root, { duration: 0.3 } );
			pluck( root * 1.25, { delay: 0.06, duration: 0.3 } );
			pluck( root * 1.5, { delay: 0.12, duration: 0.35 } );
			pluck( root * 2, { delay: 0.18, duration: 0.4, level: 0.4 } );
		},

		miss() {
			// A gentle two-note sigh, falling — ink hitting the page.
			pluck( 165, { type: 'triangle', duration: 0.3, level: 0.4 } );
			pluck( 123, { type: 'triangle', delay: 0.12, duration: 0.4, level: 0.4 } );
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
