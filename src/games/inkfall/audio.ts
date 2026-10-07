const SOUND_STORAGE_KEY = 'desktop-mode/inkfall-sound';

const MASTER_LEVEL = 0.16;

const PLUCK_LEVEL = 0.5;

const MAJOR_SCALE = [ 0, 2, 4, 5, 7, 9, 11 ] as const;

const BASE_FREQUENCY = 196;

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

	letter: ( ch: string ) => void;

	typo: () => void;

	wordBurst: ( lastLetter: string ) => void;

	miss: () => void;
	setEnabled: ( enabled: boolean ) => void;
	isEnabled: () => boolean;

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
			pluck( 98, { type: 'triangle', duration: 0.15, level: 0.35 } );
			pluck( 103, { type: 'triangle', duration: 0.12, level: 0.2 } );
		},

		wordBurst( lastLetter ) {
			const root = letterFrequency( lastLetter ) || BASE_FREQUENCY;
			pluck( root, { duration: 0.3 } );
			pluck( root * 1.25, { delay: 0.06, duration: 0.3 } );
			pluck( root * 1.5, { delay: 0.12, duration: 0.35 } );
			pluck( root * 2, { delay: 0.18, duration: 0.4, level: 0.4 } );
		},

		miss() {
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
