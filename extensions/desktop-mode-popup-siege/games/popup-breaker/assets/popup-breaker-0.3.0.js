( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.2.1.js' )
				: null;
	const audioKit =
		global && global.OpenStationAudioKit
			? global.OpenStationAudioKit
			: typeof module === 'object' && module.exports
				? require( '../../../sdk/openstation-audio-kit-0.1.0.js' )
				: null;
	const api = factory( global, base, audioKit );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.PopupBreaker = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function (
	global,
	base,
	audioKit
) {
	'use strict';

	if ( ! base || ! audioKit ) {
		throw new Error(
			'Popup Siege 0.2.1 and OpenStation Audio Kit 0.1.0 are required.'
		);
	}

	const ASSET_VERSION = '0.3.0';
	const MUSIC_ID = 'skylog-midnight-mod';
	const BPM = 120;
	const STEPS_PER_BEAT = 4;
	const STEPS_PER_BAR = 8;
	const FORM_BARS = 32;
	const HARMONY = Object.freeze( [
		Object.freeze( { bass: 40, chord: [ 64, 67, 71, 78 ] } ),
		Object.freeze( { bass: 43, chord: [ 67, 71, 74, 76 ] } ),
		Object.freeze( { bass: 42, chord: [ 66, 69, 74, 76 ] } ),
		Object.freeze( { bass: 45, chord: [ 69, 74, 76, 79 ] } ),
		Object.freeze( { bass: 40, chord: [ 64, 67, 71, 76 ] } ),
		Object.freeze( { bass: 36, chord: [ 60, 64, 67, 71 ] } ),
		Object.freeze( { bass: 47, chord: [ 59, 67, 71, 74 ] } ),
		Object.freeze( { bass: 47, chord: [ 59, 64, 66, 69 ] } ),
	] );
	const MIRA_MOTIF = Object.freeze( [ 76, 83, 85, 79, 78 ] );

	function deriveMusicState( state ) {
		const popupCloses = Math.max( 0, Number( state?.popupCloses ) || 0 );
		const waveIndex = Math.max( 0, Number( state?.waveIndex ) || 0 );
		const lives = Math.max( 0, Number( state?.lives ) || 0 );
		const timeLeft = Math.max( 0, Number( state?.timeLeft ) || 0 );
		const balls = Array.isArray( state?.balls ) ? state.balls.length : 0;
		return Object.freeze( {
			phase: String( state?.phase || 'menu' ),
			popupCloses,
			waveIndex,
			lives,
			timeLeft,
			multiball: balls > 1 && Number( state?.multiballTimer ) > 0,
			pressure: timeLeft > 0 && timeLeft <= 20,
			boss: waveIndex >= base.WAVE_SCHEDULE.length,
			result: state?.result || null,
		} );
	}

	function createPopupSiegeAudio( options = {} ) {
		const win = options.window || global;
		const engine = audioKit.createAudioEngine( {
			window: win,
			timerHost: win,
			enabled: options.music !== false || options.effects !== false,
			musicGain: 0.105,
			sfxGain: 0.27,
			delaySeconds: 0.205,
		} );
		let musicEnabled = options.music !== false;
		let effectsEnabled = options.effects !== false;
		let snapshot = deriveMusicState( null );
		let previous = snapshot;
		let lastEventId = 0;
		let disposed = false;

		function playChord( notes, time, settings = {} ) {
			notes.forEach( ( midi, index ) => {
				engine.tone( {
					time,
					midi,
					type: settings.type || 'triangle',
					duration: settings.duration || 0.42,
					attack: settings.attack || 0.035,
					release: settings.release || 0.24,
					gain: settings.gain || 0.024,
					filter: settings.filter || 1900,
					pan:
						notes.length > 1
							? -0.42 + ( index / ( notes.length - 1 ) ) * 0.84
							: 0,
					send: settings.send ?? 0.16,
					bus: settings.bus || 'music',
				} );
			} );
		}

		function arrangeStep( { step, time, tone, noise, kick } ) {
			if ( ! musicEnabled || snapshot.phase !== 'playing' ) {
				return;
			}
			const bar = Math.floor( step / STEPS_PER_BAR ) % FORM_BARS;
			const position = step % STEPS_PER_BAR;
			const harmony = HARMONY[ bar % HARMONY.length ];
			const formSection = Math.floor( bar / 8 );
			const miraLevel = Math.min( 4, snapshot.popupCloses );
			const adwareLevel = Math.max(
				0,
				Math.min( 3, snapshot.waveIndex - snapshot.popupCloses + 1 )
			);

			if ( position === 0 || position === 4 ) {
				kick( {
					time,
					gain: position === 0 ? 0.12 : 0.085,
					bus: 'music',
				} );
			}
			if (
				( snapshot.pressure || snapshot.multiball || snapshot.boss ) &&
				position === 6
			) {
				kick( { time, gain: 0.07, bus: 'music' } );
			}
			if ( position === 4 ) {
				noise( {
					time,
					duration: 0.055,
					release: 0.07,
					gain: snapshot.boss ? 0.055 : 0.043,
					filter: 900,
					filterType: 'highpass',
					bus: 'music',
				} );
				tone( {
					time,
					frequency: 178,
					type: 'triangle',
					duration: 0.045,
					release: 0.05,
					gain: 0.026,
					bus: 'music',
				} );
			}
			if (
				position % 2 === 0 ||
				( ( snapshot.multiball || snapshot.pressure ) &&
					position % 2 === 1 )
			) {
				noise( {
					time,
					duration:
						snapshot.multiball && position % 4 === 3
							? 0.09
							: 0.018,
					release: 0.025,
					gain:
						position % 2 === 0
							? 0.018
							: snapshot.multiball
								? 0.012
								: 0.008,
					filter: position % 4 === 0 ? 5200 : 6800,
					filterType: 'highpass',
					bus: 'music',
				} );
			}

			if ( position === 0 || position === 4 || position === 6 ) {
				const passing =
					position === 6
						? harmony.bass + ( bar % 2 === 0 ? 7 : 5 )
						: harmony.bass;
				tone( {
					time,
					midi: passing,
					type: 'sawtooth',
					duration: position === 0 ? 0.24 : 0.15,
					release: 0.08,
					gain: 0.032,
					filter: 720 + adwareLevel * 110,
					resonance: 1.8,
					bus: 'music',
				} );
				tone( {
					time,
					midi: passing - 12,
					type: 'triangle',
					duration: 0.17,
					release: 0.07,
					gain: 0.022,
					filter: 520,
					bus: 'music',
				} );
			}

			if ( position === 0 ) {
				playChord( harmony.chord, time, {
					gain: 0.012,
					duration: 0.46,
					release: 0.28,
					filter: 1700 + miraLevel * 180,
					send: 0.18,
				} );
			}

			if ( snapshot.waveIndex > 0 && position % 2 === 0 ) {
				const chordIndex =
					( position / 2 + bar + formSection ) %
					harmony.chord.length;
				const octave =
					formSection >= 2 && position === 6 ? 12 : 0;
				tone( {
					time,
					midi: harmony.chord[ chordIndex ] + octave,
					type: 'square',
					duration: 0.065,
					release: 0.065,
					gain: 0.011 + miraLevel * 0.0017,
					filter: 2600 + miraLevel * 260,
					pan: position % 4 === 0 ? -0.28 : 0.28,
					send: 0.23,
					bus: 'music',
				} );
			}

			if ( snapshot.multiball ) {
				const sparkle = harmony.chord[
					( step + bar ) % harmony.chord.length
				];
				tone( {
					time,
					midi: sparkle + ( position % 2 === 0 ? 12 : 24 ),
					type: 'square',
					duration: 0.035,
					release: 0.055,
					gain: 0.008,
					filter: 5600,
					pan: position % 2 === 0 ? -0.62 : 0.62,
					send: 0.34,
					bus: 'music',
				} );
			}

			const motifBar =
				bar % 8 === 3 || bar % 8 === 7 || miraLevel >= 3;
			const motifPosition = [ 0, 2, 3, 5, 6 ].indexOf( position );
			if (
				motifBar &&
				motifPosition >= 0 &&
				( miraLevel > 0 || formSection === 1 || formSection === 3 )
			) {
				const note =
					MIRA_MOTIF[
						( motifPosition + ( bar % 8 === 7 ? 2 : 0 ) ) %
							MIRA_MOTIF.length
					];
				const motifGain = 0.009 + miraLevel * 0.003;
				tone( {
					time,
					midi: note,
					type: 'triangle',
					duration: position === 6 ? 0.2 : 0.09,
					release: 0.15,
					gain: motifGain,
					filter: 4300,
					pan: motifPosition % 2 === 0 ? -0.16 : 0.16,
					send: 0.3,
					bus: 'music',
				} );
				tone( {
					time,
					midi: note + 12,
					type: 'sine',
					duration: 0.055,
					release: 0.1,
					gain: motifGain * 0.45,
					send: 0.36,
					bus: 'music',
				} );
			}

			if (
				adwareLevel > 0 &&
				( position === 1 || position === 5 ) &&
				bar % 4 === 2
			) {
				tone( {
					time,
					midi: position === 1 ? 77 : 70,
					type: 'square',
					duration: 0.05,
					release: 0.035,
					gain: 0.006 + adwareLevel * 0.002,
					filter: 2200,
					pan: position === 1 ? -0.44 : 0.44,
					bus: 'music',
				} );
			}

			if ( snapshot.pressure && position === 7 ) {
				tone( {
					time,
					midi: bar % 2 === 0 ? 88 : 83,
					type: 'square',
					duration: 0.025,
					release: 0.035,
					gain: 0.006,
					filter: 5200,
					bus: 'music',
				} );
			}
		}

		const sequencer = engine.createSequencer( {
			bpm: BPM,
			stepsPerBeat: STEPS_PER_BEAT,
			lookaheadMs: 42,
			scheduleAheadSeconds: 0.17,
			onStep: arrangeStep,
		} );

		function musicalStinger( notes, settings = {} ) {
			if ( ! musicEnabled ) {
				return;
			}
			engine.ensureContext();
			const start = engine.context ? engine.context.currentTime + 0.015 : 0;
			notes.forEach( ( note, index ) => {
				engine.tone( {
					time: start + index * ( settings.spacing || 0.085 ),
					midi: note,
					type: settings.type || 'square',
					duration: settings.duration || 0.075,
					release: settings.release || 0.12,
					gain: settings.gain || 0.035,
					filter: settings.filter || 4400,
					send: settings.send ?? 0.24,
					bus: 'music',
				} );
			} );
		}

		function playEffectsForState( state ) {
			if ( ! effectsEnabled || ! state?.lastEvent ) {
				return;
			}
			if ( state.eventId === lastEventId ) {
				return;
			}
			lastEventId = state.eventId;
			const type = state.lastEvent.type;
			if ( type === 'brick' ) {
				engine.tone( {
					frequency: 320,
					duration: 0.025,
					release: 0.025,
					gain: 0.025,
					type: 'square',
				} );
			} else if ( type === 'paddle' ) {
				engine.tone( {
					frequency: 185,
					duration: 0.025,
					release: 0.025,
					gain: 0.022,
					type: 'triangle',
				} );
			} else if ( type === 'serve' ) {
				engine.tone( {
					midi: 64,
					duration: 0.05,
					release: 0.05,
					gain: 0.034,
					type: 'square',
				} );
			}
		}

		function sync( state ) {
			if ( disposed ) {
				return;
			}
			previous = snapshot;
			snapshot = deriveMusicState( state );
			playEffectsForState( state );

			if (
				snapshot.phase === 'playing' &&
				previous.phase !== 'playing' &&
				musicEnabled
			) {
				if ( previous.phase === 'paused' ) {
					sequencer.resume();
				} else {
					sequencer.start( true );
					musicalStinger( [ 64, 71, 76 ], {
						spacing: 0.07,
						gain: 0.028,
					} );
				}
			} else if (
				snapshot.phase === 'paused' &&
				previous.phase !== 'paused'
			) {
				sequencer.pause();
			} else if (
				snapshot.phase === 'menu' &&
				previous.phase !== 'menu'
			) {
				sequencer.stop();
			}

			if ( snapshot.popupCloses > previous.popupCloses ) {
				engine.duckMusic( 0.54, 0.24 );
				musicalStinger( [ 71, 73, 76, 83 ], {
					spacing: 0.065,
					gain: 0.038,
				} );
			}
			if ( snapshot.waveIndex > previous.waveIndex ) {
				musicalStinger(
					snapshot.boss ? [ 77, 70, 83 ] : [ 71, 76 ],
					{
						spacing: 0.09,
						gain: snapshot.boss ? 0.036 : 0.027,
						filter: snapshot.boss ? 2600 : 4200,
					}
				);
			}
			if ( snapshot.lives < previous.lives && snapshot.phase === 'playing' ) {
				engine.duckMusic( 0.46, 0.3 );
				musicalStinger( [ 64, 59, 52 ], {
					spacing: 0.09,
					gain: 0.032,
					filter: 1800,
				} );
			}
			if (
				snapshot.phase === 'results' &&
				previous.phase !== 'results'
			) {
				sequencer.pause();
				if ( snapshot.result === 'rescued' ) {
					musicalStinger( [ 64, 71, 73, 76, 78, 83 ], {
						spacing: 0.11,
						duration: 0.16,
						release: 0.32,
						gain: 0.041,
						send: 0.34,
					} );
				} else {
					musicalStinger( [ 64, 59, 53, 54 ], {
						spacing: 0.13,
						duration: 0.13,
						release: 0.24,
						gain: 0.036,
						filter: 1700,
					} );
				}
			}
		}

		function setMusicEnabled( nextEnabled ) {
			musicEnabled = Boolean( nextEnabled );
			engine.setEnabled( musicEnabled || effectsEnabled );
			if ( ! musicEnabled ) {
				sequencer.pause();
			} else if ( snapshot.phase === 'playing' ) {
				sequencer.resume();
			}
			return musicEnabled;
		}

		function setEffectsEnabled( nextEnabled ) {
			effectsEnabled = Boolean( nextEnabled );
			engine.setEnabled( musicEnabled || effectsEnabled );
			if ( effectsEnabled ) {
				engine.tone( {
					midi: 76,
					duration: 0.04,
					release: 0.04,
					gain: 0.03,
					type: 'square',
				} );
			}
			return effectsEnabled;
		}

		function unlock() {
			return engine.ensureContext();
		}

		function dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			sequencer.dispose();
			engine.dispose();
		}

		return Object.freeze( {
			sync,
			unlock,
			setMusicEnabled,
			setEffectsEnabled,
			dispose,
			get musicEnabled() {
				return musicEnabled;
			},
			get effectsEnabled() {
				return effectsEnabled;
			},
			get running() {
				return sequencer.running;
			},
			get context() {
				return engine.context;
			},
			get disposed() {
				return disposed;
			},
		} );
	}

	function enhanceAudioInterface( container, controller, options = {} ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const document = container.ownerDocument;
		const win = document.defaultView || global;
		const musicButton = root.querySelector( '[data-action="sound"]' );
		const actions = root.querySelector( '.siege-actions' );
		const stage = root.querySelector( '.siege-stage' );
		const resultTitle = root.querySelector( '[data-role="result-title"]' );
		const effectsButton = document.createElement( 'button' );
		const audio = createPopupSiegeAudio( {
			window: win,
			music: options.music !== false && options.sound !== false,
			effects: options.effects !== false && options.sound !== false,
		} );
		let frame = 0;
		let disposed = false;
		let resultFocusAvailable = true;
		let lastPhase = '';

		root.dataset.assetVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-3';
		root.dataset.music = MUSIC_ID;

		effectsButton.type = 'button';
		effectsButton.dataset.action = 'effects';
		effectsButton.setAttribute(
			'aria-pressed',
			String( audio.effectsEnabled )
		);
		effectsButton.textContent = audio.effectsEnabled
			? 'Effects on'
			: 'Effects off';
		if ( actions && musicButton ) {
			actions.insertBefore( effectsButton, musicButton.nextSibling );
		}
		if ( musicButton ) {
			musicButton.setAttribute(
				'aria-pressed',
				String( audio.musicEnabled )
			);
			musicButton.textContent = audio.musicEnabled
				? 'Music on'
				: 'Music off';
		}

		if ( resultTitle && typeof resultTitle.focus === 'function' ) {
			const nativeFocus = resultTitle.focus.bind( resultTitle );
			resultTitle.focus = ( focusOptions ) => {
				if ( ! resultFocusAvailable ) {
					return;
				}
				resultFocusAvailable = false;
				nativeFocus( {
					...( focusOptions || {} ),
					preventScroll: true,
				} );
			};
		}
		if ( stage && typeof stage.focus === 'function' ) {
			const nativeStageFocus = stage.focus.bind( stage );
			stage.focus = ( focusOptions ) =>
				nativeStageFocus( {
					...( focusOptions || {} ),
					preventScroll: true,
				} );
		}

		function updateButton( button, enabled, noun ) {
			if ( ! button ) {
				return;
			}
			button.setAttribute( 'aria-pressed', String( enabled ) );
			button.textContent = `${ noun } ${ enabled ? 'on' : 'off' }`;
			button.setAttribute(
				'aria-label',
				`${ noun } ${ enabled ? 'on' : 'off' }`
			);
		}

		function onClickCapture( event ) {
			const actionButton = event.target.closest( '[data-action]' );
			if (
				actionButton &&
				root.contains( actionButton ) &&
				( actionButton.dataset.action === 'start' ||
					actionButton.dataset.action === 'resume' )
			) {
				audio.unlock();
			}
			const button = event.target.closest(
				'[data-action="sound"], [data-action="effects"]'
			);
			if ( ! button || ! root.contains( button ) ) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			if ( button.dataset.action === 'sound' ) {
				const enabled = audio.setMusicEnabled( ! audio.musicEnabled );
				updateButton( musicButton, enabled, 'Music' );
			} else {
				const enabled = audio.setEffectsEnabled(
					! audio.effectsEnabled
				);
				updateButton( effectsButton, enabled, 'Effects' );
			}
		}

		function onKeyDown( event ) {
			const key = String( event.key || '' ).toLowerCase();
			if (
				key === 'enter' ||
				key === ' ' ||
				key === 'p' ||
				key === 'escape'
			) {
				audio.unlock();
			}
		}

		function sync() {
			if ( disposed ) {
				return;
			}
			const state = controller.getState();
			if ( state.phase !== 'results' ) {
				resultFocusAvailable = true;
			}
			if ( state.phase !== lastPhase || state.phase === 'playing' ) {
				audio.sync( state );
				lastPhase = state.phase;
			}
			if ( container.scrollTop !== 0 || container.scrollLeft !== 0 ) {
				container.scrollTop = 0;
				container.scrollLeft = 0;
			}
			root.dataset.assetVersion = ASSET_VERSION;
			frame = win.requestAnimationFrame( sync );
		}

		root.addEventListener( 'click', onClickCapture, true );
		win.addEventListener( 'keydown', onKeyDown );
		frame = win.requestAnimationFrame( sync );

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			win.cancelAnimationFrame( frame );
			root.removeEventListener( 'click', onClickCapture, true );
			win.removeEventListener( 'keydown', onKeyDown );
			audio.dispose();
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, {
			...options,
			sound: false,
		} );
		const removeAudio = enhanceAudioInterface(
			container,
			controller,
			options
		);
		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				removeAudio();
				controller.teardown();
			},
		} );
	}

	return Object.freeze( {
		...base,
		ASSET_VERSION,
		MUSIC_ID,
		BPM,
		STEPS_PER_BEAT,
		STEPS_PER_BAR,
		FORM_BARS,
		deriveMusicState,
		createPopupSiegeAudio,
		mount,
	} );
} );
