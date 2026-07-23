/**
 * Focus Timer — a self-contained alarm synthesized with the Web Audio
 * API. No audio files are bundled.
 *
 * Browsers only allow audio to start from a user gesture. We `prime()`
 * the AudioContext on the Start click (a gesture), which unlocks it; the
 * same context is then reused when the timer finishes minutes later, so
 * the alarm plays even though no gesture happens at that moment.
 *
 * @since 0.26.0
 */

type AudioCtor = typeof AudioContext;

export class Alarm {
	private ctx: AudioContext | null = null;
	private loop: ReturnType< typeof setInterval > | null = null;

	/** Create/resume the audio context from within a user gesture. */
	prime(): void {
		if ( ! this.ctx ) {
			const Impl: AudioCtor | undefined =
				window.AudioContext ||
				( window as unknown as { webkitAudioContext?: AudioCtor } )
					.webkitAudioContext;
			if ( Impl ) {
				this.ctx = new Impl();
			}
		}
		void this.ctx?.resume?.();
	}

	/** One rising three-note chime (an A major arpeggio). */
	private chime(): void {
		const ctx = this.ctx;
		if ( ! ctx ) {
			return;
		}
		const now = ctx.currentTime;
		[ 880, 1108.73, 1318.51 ].forEach( ( freq, i ) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			const t = now + i * 0.16;
			gain.gain.setValueAtTime( 0.0001, t );
			gain.gain.exponentialRampToValueAtTime( 0.22, t + 0.02 );
			gain.gain.exponentialRampToValueAtTime( 0.0001, t + 0.22 );
			osc.connect( gain ).connect( ctx.destination );
			osc.start( t );
			osc.stop( t + 0.24 );
		} );
	}

	/** Begin ringing on a loop until `stop()`. */
	start(): void {
		if ( this.loop !== null ) {
			return;
		}
		this.prime();
		this.chime();
		this.loop = setInterval( () => this.chime(), 1600 );
	}

	stop(): void {
		if ( this.loop !== null ) {
			clearInterval( this.loop );
			this.loop = null;
		}
	}

	isRinging(): boolean {
		return this.loop !== null;
	}
}
