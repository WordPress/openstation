( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.7.0.js' )
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

	if ( ! base || base.ASSET_VERSION !== '0.7.0' || ! audioKit ) {
		throw new Error(
			'Popup Siege 0.7.0 and OpenStation Audio Kit are required.'
		);
	}

	const AUDIO_VERSION = '0.7.0';
	const MUSIC_ID = 'skylog-midnight-mod-070';
	const BPM = 120;
	const STEPS_PER_BEAT = 4;
	const STEPS_PER_BAR = 8;
	const FORM_BARS = 32;
	const FALLBACK_SYNC_MS = 100;
	const MUSIC_GAIN = 0.1;
	const EFFECTS_GAIN = 0.28;
	const HARMONY = Object.freeze( [
		Object.freeze( { bass: 48, chord: [ 64, 67, 71, 78 ] } ),
		Object.freeze( { bass: 50, chord: [ 67, 71, 74, 76 ] } ),
		Object.freeze( { bass: 49, chord: [ 66, 69, 74, 76 ] } ),
		Object.freeze( { bass: 52, chord: [ 69, 74, 76, 79 ] } ),
		Object.freeze( { bass: 48, chord: [ 64, 67, 71, 76 ] } ),
		Object.freeze( { bass: 45, chord: [ 60, 64, 67, 71 ] } ),
		Object.freeze( { bass: 47, chord: [ 59, 67, 71, 74 ] } ),
		Object.freeze( { bass: 47, chord: [ 59, 64, 66, 69 ] } ),
	] );
	const MIRA_MOTIF = Object.freeze( [ 76, 83, 85, 79, 78 ] );

	function finiteNumber( value, fallback = 0 ) {
		const number = Number( value );
		return Number.isFinite( number ) ? number : fallback;
	}

	function derivePopupSiegeAudioState070( state = {} ) {
		const objective = state.objective || {};
		const finale = state.finale || {};
		const terminalSnapshot = state.terminalSnapshot || {};
		const derivedCloseCount = Array.isArray( state.closedPopupIds )
			? state.closedPopupIds.length
			: Array.isArray( objective.completedIds )
				? objective.completedIds.length
				: 0;
		const popupCloses = Math.max(
			0,
			finiteNumber(
				terminalSnapshot.popupsClosed ??
					state.popupCloses ??
					state.closedPopupCount,
				derivedCloseCount
			)
		);
		const waveIndex = Math.max( 0, finiteNumber( state.waveIndex, 0 ) );
		const lives = Math.max( 0, finiteNumber( state.lives, 0 ) );
		const timeLeft = Math.max( 0, finiteNumber( state.timeLeft, 0 ) );
		const balls = Array.isArray( state.balls ) ? state.balls.length : 0;
		const scheduleLength = Array.isArray( base.WAVE_SCHEDULE )
			? base.WAVE_SCHEDULE.length
			: 0;
		const levelId = String(
			state.levelId ||
				state.level?.id ||
				objective.currentId ||
				''
		).toLowerCase();
		const activeThreatId = String(
			objective.activeThreatId || state.activeThreatId || ''
		).toLowerCase();
		const finalePhase = String( finale.phase || '' ).toLowerCase();
		const hasObjectiveThreatContract = Object.prototype.hasOwnProperty.call(
			objective,
			'activeThreatId'
		);
		const boss = Boolean(
			state.bossActive ||
				state.boss ||
				activeThreatId === 'malware-boss' ||
				( ! hasObjectiveThreatContract &&
					scheduleLength > 0 &&
					waveIndex >= scheduleLength )
		);
		const multiball = Boolean(
			state.multiballActive ||
				( balls > 1 && finiteNumber( state.multiballTimer, 1 ) > 0 )
		);
		const pressure = Boolean(
			state.pressureActive || ( timeLeft > 0 && timeLeft <= 20 )
		);

		return Object.freeze( {
			phase: String( state.phase || 'menu' ),
			popupCloses,
			waveIndex,
			lives,
			timeLeft,
			multiball,
			pressure,
			boss,
			dense: boss && pressure && multiball,
			objectiveId: levelId,
			activeThreatId,
			finalePhase,
			result:
				terminalSnapshot.result ||
				terminalSnapshot.outcome ||
				state.result ||
				null,
		} );
	}

	function createPopupSiegeAudio070( options = {} ) {
		const win = options.window || global;
		const kit = options.audioKit || audioKit;
		const engine =
			options.engine ||
			kit.createAudioEngine( {
				window: win,
				timerHost: options.timerHost || win,
				enabled:
					options.music !== false || options.effects !== false,
				musicGain: MUSIC_GAIN,
				sfxGain: EFFECTS_GAIN,
				delaySeconds: 0.205,
			} );
		let musicEnabled = options.music !== false;
		let effectsEnabled = options.effects !== false;
		let snapshot = derivePopupSiegeAudioState070();
		let disposed = false;
		let environmentSuspended = Boolean( options.suspended );
		let lastEventSignature = '';

		function applyBusLevels() {
			if ( typeof engine.setLevels === 'function' ) {
				engine.setLevels( {
					music: musicEnabled ? MUSIC_GAIN : 0,
					sfx: effectsEnabled ? EFFECTS_GAIN : 0,
				} );
			}
		}

		applyBusLevels();

		function playChord( notes, time, settings = {} ) {
			notes.forEach( ( midi, index ) => {
				engine.tone( {
					time,
					midi,
					type: settings.type || 'triangle',
					duration: settings.duration || 0.36,
					attack: settings.attack || 0.03,
					release: settings.release || 0.2,
					gain: settings.gain || 0.021,
					filter: settings.filter || 1900,
					pan:
						notes.length > 1
							? -0.16 +
								( index / ( notes.length - 1 ) ) * 0.32
							: 0,
					send: 0,
					bus: 'music',
				} );
			} );
		}

		function arrangeStep( { step, time, tone, noise, kick } ) {
			if (
				disposed ||
				environmentSuspended ||
				! musicEnabled ||
				snapshot.phase !== 'playing'
			) {
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
			const cueSpace = snapshot.dense && position >= 6;

			// Reserve the last quarter of a dense bar for gameplay cues.
			if ( cueSpace ) {
				return;
			}

			if ( position === 0 || position === 4 ) {
				kick( {
					time,
					gain: position === 0 ? 0.105 : 0.072,
					bus: 'music',
				} );
			}
			if (
				! snapshot.dense &&
				( snapshot.pressure || snapshot.multiball || snapshot.boss ) &&
				position === 6
			) {
				kick( { time, gain: 0.055, bus: 'music' } );
			}
			if ( position === 4 ) {
				noise( {
					time,
					duration: 0.045,
					release: 0.055,
					gain: snapshot.boss ? 0.042 : 0.034,
					filter: 1100,
					filterType: 'highpass',
					bus: 'music',
				} );
			}
			if (
				position % 2 === 0 ||
				( ! snapshot.dense &&
					( snapshot.multiball || snapshot.pressure ) &&
					position % 2 === 1 )
			) {
				noise( {
					time,
					duration: 0.018,
					release: 0.023,
					gain: position % 2 === 0 ? 0.015 : 0.008,
					filter: position % 4 === 0 ? 5200 : 6800,
					filterType: 'highpass',
					bus: 'music',
				} );
			}

			if (
				position === 0 ||
				position === 4 ||
				( ! snapshot.dense && position === 6 )
			) {
				const passing =
					position === 6
						? harmony.bass + ( bar % 2 === 0 ? 7 : 5 )
						: harmony.bass;
				tone( {
					time,
					midi: passing,
					type: 'sawtooth',
					duration: position === 0 ? 0.2 : 0.13,
					release: 0.065,
					gain: 0.033,
					filter: 760 + adwareLevel * 100,
					resonance: 1.6,
					pan: 0,
					bus: 'music',
				} );
				tone( {
					time,
					midi: Math.max( 45, passing - 3 ),
					type: 'triangle',
					duration: 0.12,
					release: 0.055,
					gain: 0.014,
					filter: 620,
					pan: 0,
					bus: 'music',
				} );
			}

			if ( position === 0 ) {
				playChord( harmony.chord, time, {
					gain: snapshot.dense ? 0.008 : 0.011,
					duration: snapshot.dense ? 0.28 : 0.42,
					release: snapshot.dense ? 0.16 : 0.24,
					filter: 1700 + miraLevel * 180,
				} );
			}

			if (
				snapshot.waveIndex > 0 &&
				position % 2 === 0 &&
				( ! snapshot.dense || position <= 2 )
			) {
				const chordIndex =
					( position / 2 + bar + formSection ) %
					harmony.chord.length;
				tone( {
					time,
					midi: harmony.chord[ chordIndex ],
					type: 'square',
					duration: 0.055,
					release: 0.055,
					gain: 0.009 + miraLevel * 0.0014,
					filter: 2600 + miraLevel * 240,
					pan: position % 4 === 0 ? -0.14 : 0.14,
					send: 0,
					bus: 'music',
				} );
			}

			if (
				snapshot.multiball &&
				! snapshot.dense &&
				position % 2 === 1
			) {
				const sparkle =
					harmony.chord[ ( step + bar ) % harmony.chord.length ];
				tone( {
					time,
					midi: sparkle + 12,
					type: 'square',
					duration: 0.03,
					release: 0.045,
					gain: 0.006,
					filter: 5400,
					pan: position % 4 === 1 ? -0.18 : 0.18,
					send: 0,
					bus: 'music',
				} );
			}

			const motifBar =
				bar % 8 === 3 || bar % 8 === 7 || miraLevel >= 3;
			const motifPosition = [ 0, 2, 3, 5 ].indexOf( position );
			if (
				motifBar &&
				motifPosition >= 0 &&
				( ! snapshot.dense || position <= 2 ) &&
				( miraLevel > 0 || formSection === 1 || formSection === 3 )
			) {
				const note =
					MIRA_MOTIF[
						( motifPosition + ( bar % 8 === 7 ? 2 : 0 ) ) %
							MIRA_MOTIF.length
					];
				tone( {
					time,
					midi: note,
					type: 'triangle',
					duration: 0.085,
					release: 0.12,
					gain: 0.008 + miraLevel * 0.0024,
					filter: 4300,
					pan: motifPosition % 2 === 0 ? -0.1 : 0.1,
					send: 0,
					bus: 'music',
				} );
			}

			if (
				adwareLevel > 0 &&
				! snapshot.dense &&
				( position === 1 || position === 5 ) &&
				bar % 4 === 2
			) {
				tone( {
					time,
					midi: position === 1 ? 77 : 70,
					type: 'square',
					duration: 0.045,
					release: 0.03,
					gain: 0.005 + adwareLevel * 0.0015,
					filter: 2200,
					pan: position === 1 ? -0.16 : 0.16,
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

		function playEffectsStinger( notes, settings = {} ) {
			if (
				disposed ||
				environmentSuspended ||
				! effectsEnabled
			) {
				return false;
			}
			engine.ensureContext();
			const start = engine.context
				? engine.context.currentTime + 0.012
				: 0;
			notes.forEach( ( note, index ) => {
				engine.tone( {
					time: start + index * ( settings.spacing || 0.08 ),
					midi: note,
					type: settings.type || 'square',
					duration: settings.duration || 0.072,
					release: settings.release || 0.11,
					gain: settings.gain || 0.034,
					filter: settings.filter || 4200,
					pan: 0,
					send: 0,
					bus: 'sfx',
				} );
			} );
			return true;
		}

		function eventSignature( state ) {
			if ( ! state?.lastEvent ) {
				return '';
			}
			const event = state.lastEvent;
			const stableId =
				state.eventId ??
				event.id ??
				event.tick ??
				event.frame ??
				event.time ??
				'';
			return [
				String( event.type || '' ),
				String( stableId ),
				String( state.popupCloses ?? '' ),
				String( state.lives ?? '' ),
				String( state.waveIndex ?? '' ),
			].join( ':' );
		}

		function playRoutineEffect( state ) {
			if ( ! effectsEnabled || ! state?.lastEvent ) {
				return;
			}
			const signature = eventSignature( state );
			if ( ! signature || signature === lastEventSignature ) {
				return;
			}
			lastEventSignature = signature;
			const type = String( state.lastEvent.type || '' );
			if ( type === 'brick' ) {
				engine.tone( {
					frequency: 320,
					duration: 0.025,
					release: 0.025,
					gain: 0.023,
					type: 'square',
					pan: 0,
					send: 0,
					bus: 'sfx',
				} );
			} else if ( type === 'paddle' ) {
				engine.tone( {
					frequency: 185,
					duration: 0.025,
					release: 0.025,
					gain: 0.021,
					type: 'triangle',
					pan: 0,
					send: 0,
					bus: 'sfx',
				} );
			} else if ( type === 'serve' ) {
				engine.tone( {
					midi: 64,
					duration: 0.045,
					release: 0.045,
					gain: 0.03,
					type: 'square',
					pan: 0,
					send: 0,
					bus: 'sfx',
				} );
			}
		}

		function startMusic( reset ) {
			if (
				disposed ||
				environmentSuspended ||
				! musicEnabled ||
				snapshot.phase !== 'playing' ||
				sequencer.running
			) {
				return false;
			}
			return reset ? sequencer.start( true ) : sequencer.resume();
		}

		function pauseMusic() {
			if ( sequencer.running ) {
				sequencer.pause();
				return true;
			}
			return false;
		}

		function transitionCue( previous, next ) {
			if ( ! effectsEnabled || environmentSuspended ) {
				return false;
			}
			if (
				next.phase === 'results' &&
				previous.phase !== 'results'
			) {
				if ( next.result === 'rescued' ) {
					return playEffectsStinger(
						[ 64, 71, 73, 76, 78, 83 ],
						{
							spacing: 0.105,
							duration: 0.15,
							release: 0.3,
							gain: 0.04,
						}
					);
				}
				return playEffectsStinger( [ 64, 59, 53, 54 ], {
					spacing: 0.125,
					duration: 0.12,
					release: 0.22,
					gain: 0.035,
					filter: 1700,
				} );
			}
			if (
				next.lives < previous.lives &&
				next.phase === 'playing'
			) {
				engine.duckMusic( 0.46, 0.3 );
				return playEffectsStinger( [ 64, 59, 52 ], {
					spacing: 0.09,
					gain: 0.031,
					filter: 1800,
				} );
			}
			if ( next.popupCloses > previous.popupCloses ) {
				engine.duckMusic( 0.5, 0.24 );
				return playEffectsStinger(
					next.boss
						? [ 71, 73, 76, 78, 83 ]
						: [ 71, 73, 76, 83 ],
					{
						spacing: 0.065,
						gain: 0.037,
					}
				);
			}
			if (
				next.boss &&
				! previous.boss &&
				next.phase === 'playing'
			) {
				return playEffectsStinger( [ 77, 70, 83 ], {
					spacing: 0.09,
					gain: 0.035,
					filter: 2600,
				} );
			}
			if ( next.waveIndex > previous.waveIndex ) {
				return playEffectsStinger( [ 71, 76 ], {
					spacing: 0.09,
					gain: 0.026,
				} );
			}
			if (
				next.phase === 'playing' &&
				previous.phase !== 'playing' &&
				previous.phase !== 'paused'
			) {
				return playEffectsStinger( [ 64, 71, 76 ], {
					spacing: 0.07,
					gain: 0.027,
				} );
			}
			return false;
		}

		function sync( state = {} ) {
			if ( disposed ) {
				return snapshot;
			}
			const previous = snapshot;
			const next = derivePopupSiegeAudioState070( state );
			snapshot = next;

			if (
				next.phase === 'results' ||
				next.phase === 'paused'
			) {
				pauseMusic();
			} else if ( next.phase === 'menu' ) {
				if ( sequencer.running || sequencer.step > 0 ) {
					sequencer.stop();
				}
			} else if (
				next.phase === 'playing' &&
				previous.phase !== 'playing'
			) {
				startMusic( previous.phase !== 'paused' );
			}

			const playedPriorityCue = transitionCue( previous, next );
			if ( ! playedPriorityCue ) {
				playRoutineEffect( state );
			}
			return snapshot;
		}

		function setMusicEnabled( nextEnabled ) {
			if ( disposed ) {
				return musicEnabled;
			}
			musicEnabled = Boolean( nextEnabled );
			engine.setEnabled( musicEnabled || effectsEnabled );
			applyBusLevels();
			if ( ! musicEnabled ) {
				pauseMusic();
			} else {
				startMusic( false );
			}
			return musicEnabled;
		}

		function setEffectsEnabled( nextEnabled ) {
			if ( disposed ) {
				return effectsEnabled;
			}
			effectsEnabled = Boolean( nextEnabled );
			engine.setEnabled( musicEnabled || effectsEnabled );
			applyBusLevels();
			if ( effectsEnabled && ! environmentSuspended ) {
				playEffectsStinger( [ 76 ], {
					duration: 0.035,
					release: 0.035,
					gain: 0.027,
				} );
			}
			return effectsEnabled;
		}

		function unlock() {
			if ( disposed ) {
				return null;
			}
			return engine.ensureContext();
		}

		function setEnvironmentSuspended( nextSuspended ) {
			if ( disposed ) {
				return environmentSuspended;
			}
			environmentSuspended = Boolean( nextSuspended );
			if ( environmentSuspended ) {
				pauseMusic();
				const context = engine.context;
				if (
					context &&
					context.state === 'running' &&
					typeof context.suspend === 'function'
				) {
					Promise.resolve( context.suspend() ).catch( () => {} );
				}
			} else {
				startMusic( false );
			}
			return environmentSuspended;
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
			setEnvironmentSuspended,
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
			get snapshot() {
				return snapshot;
			},
			get disposed() {
				return disposed;
			},
			get environmentSuspended() {
				return environmentSuspended;
			},
		} );
	}

	function enhanceAudioInterface070( container, controller, options = {} ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const document = container.ownerDocument;
		const win = document.defaultView || global;
		const musicButton = root.querySelector( '[data-action="sound"]' );
		const effectsButton = root.querySelector( '[data-action="effects"]' );
		const audio = createPopupSiegeAudio070( {
			window: win,
			timerHost: win,
			engine: options.audioEngine,
			audioKit: options.audioKit,
			music: options.sound !== false && options.music !== false,
			effects: options.sound !== false && options.effects !== false,
			suspended: Boolean( document.hidden ),
		} );
		let disposed = false;
		let fallbackTimer = null;
		let unsubscribe = null;

		root.dataset.audioVersion = AUDIO_VERSION;
		root.dataset.music = MUSIC_ID;

		function updateButton( button, enabled, noun ) {
			if ( ! button ) {
				return;
			}
			button.setAttribute( 'aria-pressed', String( enabled ) );
			button.setAttribute(
				'aria-label',
				`${ noun } ${ enabled ? 'on' : 'off' }`
			);
			button.dataset.audioOwner = 'popup-siege-070';
			button.textContent = `${ noun } ${ enabled ? 'on' : 'off' }`;
		}

		function syncButtons() {
			updateButton( musicButton, audio.musicEnabled, 'Music' );
			updateButton( effectsButton, audio.effectsEnabled, 'Effects' );
		}

		function readState() {
			return typeof controller.getState === 'function'
				? controller.getState()
				: {};
		}

		function syncState( nextState ) {
			if ( disposed ) {
				return;
			}
			audio.sync( nextState || readState() );
		}

		function startFallbackSync() {
			const poll = () => {
				if ( disposed ) {
					return;
				}
				syncState( readState() );
				fallbackTimer = win.setTimeout( poll, FALLBACK_SYNC_MS );
			};
			fallbackTimer = win.setTimeout( poll, FALLBACK_SYNC_MS );
		}

		function eventAction( event ) {
			const target = event.target;
			if ( ! target || typeof target.closest !== 'function' ) {
				return null;
			}
			const button = target.closest( '[data-action]' );
			return button && root.contains( button ) ? button : null;
		}

		function onClickCapture( event ) {
			const button = eventAction( event );
			if ( ! button ) {
				return;
			}
			const action = button.dataset.action;
			if (
				action === 'start' ||
				action === 'resume' ||
				action === 'restart'
			) {
				audio.unlock();
			}
			if ( action !== 'sound' && action !== 'effects' ) {
				return;
			}

			// The ancestor capture point runs before the historical root handler.
			event.preventDefault();
			event.stopImmediatePropagation();
			audio.unlock();
			if ( action === 'sound' ) {
				audio.setMusicEnabled( ! audio.musicEnabled );
			} else {
				audio.setEffectsEnabled( ! audio.effectsEnabled );
			}
			syncButtons();
		}

		function onPointerStart( event ) {
			if ( event.target && root.contains( event.target ) ) {
				audio.unlock();
			}
		}

		function onKeyDownCapture( event ) {
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

		function onVisibilityChange() {
			syncState( readState() );
			audio.setEnvironmentSuspended( Boolean( document.hidden ) );
		}

		function onWindowBlur() {
			syncState( readState() );
			audio.setEnvironmentSuspended( true );
		}

		function onWindowFocus() {
			syncState( readState() );
			audio.setEnvironmentSuspended( Boolean( document.hidden ) );
		}

		container.addEventListener( 'click', onClickCapture, true );
		container.addEventListener( 'pointerdown', onPointerStart, true );
		container.addEventListener( 'touchstart', onPointerStart, {
			capture: true,
			passive: true,
		} );
		container.addEventListener( 'keydown', onKeyDownCapture, true );
		document.addEventListener( 'visibilitychange', onVisibilityChange );
		win.addEventListener( 'blur', onWindowBlur );
		win.addEventListener( 'focus', onWindowFocus );

		if ( typeof controller.subscribe === 'function' ) {
			const subscription = controller.subscribe( syncState );
			if ( typeof subscription === 'function' ) {
				unsubscribe = subscription;
			} else if (
				subscription &&
				typeof subscription.unsubscribe === 'function'
			) {
				unsubscribe = () => subscription.unsubscribe();
			}
		} else {
			startFallbackSync();
		}

		syncState( readState() );
		syncButtons();

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			if ( fallbackTimer !== null ) {
				win.clearTimeout( fallbackTimer );
				fallbackTimer = null;
			}
			if ( unsubscribe ) {
				unsubscribe();
				unsubscribe = null;
			}
			container.removeEventListener( 'click', onClickCapture, true );
			container.removeEventListener(
				'pointerdown',
				onPointerStart,
				true
			);
			container.removeEventListener(
				'touchstart',
				onPointerStart,
				true
			);
			container.removeEventListener(
				'keydown',
				onKeyDownCapture,
				true
			);
			document.removeEventListener(
				'visibilitychange',
				onVisibilityChange
			);
			win.removeEventListener( 'blur', onWindowBlur );
			win.removeEventListener( 'focus', onWindowFocus );
			delete root.dataset.audioVersion;
			delete root.dataset.music;
			if ( musicButton ) {
				delete musicButton.dataset.audioOwner;
			}
			if ( effectsButton ) {
				delete effectsButton.dataset.audioOwner;
			}
			audio.dispose();
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, {
			...options,
			sound: false,
			music: false,
			effects: false,
		} );
		const removeAudio = enhanceAudioInterface070(
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
		AUDIO_VERSION,
		MUSIC_ID,
		BPM,
		STEPS_PER_BEAT,
		STEPS_PER_BAR,
		FORM_BARS,
		FALLBACK_SYNC_MS,
		deriveAudioState070: derivePopupSiegeAudioState070,
		deriveMusicState: derivePopupSiegeAudioState070,
		derivePopupSiegeAudioState070,
		createPopupSiegeAudio: createPopupSiegeAudio070,
		createPopupSiegeAudio070,
		enhanceAudioInterface070,
		mount,
	} );
} );
