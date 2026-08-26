( function ( global, factory ) {
	'use strict';

	const api = factory( global );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.OpenStationAudioKit = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function ( global ) {
	'use strict';

	const VERSION = '0.1.0';

	function clamp( value, minimum, maximum ) {
		return Math.max( minimum, Math.min( maximum, value ) );
	}

	function midiToFrequency( midi ) {
		return 440 * Math.pow( 2, ( Number( midi ) - 69 ) / 12 );
	}

	function createAudioEngine( options = {} ) {
		const win = options.window || global;
		const timerHost = options.timerHost || win || global;
		const sequencers = new Set();
		const voices = new Set();
		let context = null;
		let master = null;
		let music = null;
		let sfx = null;
		let delayInput = null;
		let noiseBuffer = null;
		let enabled = options.enabled !== false;
		let disposed = false;
		let musicLevel = clamp( Number( options.musicGain ) || 0.1, 0, 1 );
		let sfxLevel = clamp( Number( options.sfxGain ) || 0.24, 0, 1 );

		function setParam( param, value, time ) {
			if ( ! param ) {
				return;
			}
			if ( typeof param.cancelScheduledValues === 'function' ) {
				param.cancelScheduledValues( time );
			}
			if ( typeof param.setValueAtTime === 'function' ) {
				param.setValueAtTime( value, time );
			} else {
				param.value = value;
			}
		}

		function rampParam( param, value, time ) {
			if ( ! param ) {
				return;
			}
			if ( typeof param.linearRampToValueAtTime === 'function' ) {
				param.linearRampToValueAtTime( value, time );
			} else {
				param.value = value;
			}
		}

		function buildGraph() {
			if ( ! context || master ) {
				return;
			}
			master = context.createGain();
			music = context.createGain();
			sfx = context.createGain();
			setParam( master.gain, enabled ? 1 : 0.0001, context.currentTime );
			setParam( music.gain, musicLevel, context.currentTime );
			setParam( sfx.gain, sfxLevel, context.currentTime );

			const compressor =
				typeof context.createDynamicsCompressor === 'function'
					? context.createDynamicsCompressor()
					: null;
			if ( compressor ) {
				if ( compressor.threshold ) {
					compressor.threshold.value = -18;
				}
				if ( compressor.knee ) {
					compressor.knee.value = 12;
				}
				if ( compressor.ratio ) {
					compressor.ratio.value = 5;
				}
				if ( compressor.attack ) {
					compressor.attack.value = 0.003;
				}
				if ( compressor.release ) {
					compressor.release.value = 0.18;
				}
				master.connect( compressor );
				compressor.connect( context.destination );
			} else {
				master.connect( context.destination );
			}
			music.connect( master );
			sfx.connect( master );

			if (
				typeof context.createDelay === 'function' &&
				typeof context.createGain === 'function'
			) {
				delayInput = context.createGain();
				const delay = context.createDelay( 1 );
				const feedback = context.createGain();
				const wet = context.createGain();
				delay.delayTime.value = Number( options.delaySeconds ) || 0.205;
				feedback.gain.value = 0.22;
				wet.gain.value = 0.2;
				delayInput.connect( delay );
				delay.connect( feedback );
				feedback.connect( delay );
				delay.connect( wet );
				wet.connect( master );
			}
		}

		function ensureContext() {
			if ( disposed || ! enabled || ! win ) {
				return null;
			}
			const AudioContextClass = win.AudioContext || win.webkitAudioContext;
			if ( typeof AudioContextClass !== 'function' ) {
				return null;
			}
			if ( ! context ) {
				context = new AudioContextClass();
				buildGraph();
			}
			if (
				context.state === 'suspended' &&
				typeof context.resume === 'function'
			) {
				context.resume().catch( () => {} );
			}
			return context;
		}

		function connectVoice( node, bus, send = 0 ) {
			const destination = bus === 'music' ? music : sfx;
			node.connect( destination );
			if ( delayInput && send > 0 ) {
				const sendGain = context.createGain();
				sendGain.gain.value = clamp( send, 0, 1 );
				node.connect( sendGain );
				sendGain.connect( delayInput );
			}
		}

		function ownVoice( source ) {
			voices.add( source );
			source.onended = () => voices.delete( source );
			return source;
		}

		function tone( specification = {} ) {
			const audio = ensureContext();
			if ( ! audio ) {
				return false;
			}
			const now = audio.currentTime;
			const time = Math.max( now, Number( specification.time ) || now );
			const duration = Math.max(
				0.02,
				Number( specification.duration ) || 0.08
			);
			const attack = clamp(
				Number( specification.attack ) || 0.004,
				0.001,
				duration
			);
			const release = Math.max(
				0.015,
				Number( specification.release ) || 0.06
			);
			const peak = clamp(
				Number( specification.gain ) || 0.05,
				0.0001,
				1
			);
			const oscillator = ownVoice( audio.createOscillator() );
			const envelope = audio.createGain();
			const frequency = Number.isFinite( Number( specification.midi ) )
				? midiToFrequency( specification.midi )
				: Math.max( 20, Number( specification.frequency ) || 440 );
			oscillator.type = specification.type || 'square';
			oscillator.frequency.setValueAtTime( frequency, time );
			if (
				Number.isFinite( Number( specification.slideTo ) ) &&
				typeof oscillator.frequency.exponentialRampToValueAtTime ===
					'function'
			) {
				oscillator.frequency.exponentialRampToValueAtTime(
					Math.max( 20, Number( specification.slideTo ) ),
					time + duration
				);
			}
			if (
				oscillator.detune &&
				Number.isFinite( Number( specification.detune ) )
			) {
				oscillator.detune.setValueAtTime(
					Number( specification.detune ),
					time
				);
			}
			setParam( envelope.gain, 0.0001, time );
			rampParam( envelope.gain, peak, time + attack );
			if ( typeof envelope.gain.setValueAtTime === 'function' ) {
				envelope.gain.setValueAtTime( peak, time + duration );
			}
			if (
				typeof envelope.gain.exponentialRampToValueAtTime === 'function'
			) {
				envelope.gain.exponentialRampToValueAtTime(
					0.0001,
					time + duration + release
				);
			} else {
				rampParam(
					envelope.gain,
					0.0001,
					time + duration + release
				);
			}

			let output = envelope;
			if (
				Number( specification.filter ) > 0 &&
				typeof audio.createBiquadFilter === 'function'
			) {
				const filter = audio.createBiquadFilter();
				filter.type = specification.filterType || 'lowpass';
				filter.frequency.value = Number( specification.filter );
				filter.Q.value = Number( specification.resonance ) || 0.7;
				envelope.connect( filter );
				output = filter;
			}
			if (
				Number.isFinite( Number( specification.pan ) ) &&
				typeof audio.createStereoPanner === 'function'
			) {
				const panner = audio.createStereoPanner();
				panner.pan.value = clamp( Number( specification.pan ), -1, 1 );
				output.connect( panner );
				output = panner;
			}
			oscillator.connect( envelope );
			connectVoice(
				output,
				specification.bus || 'sfx',
				Number( specification.send ) || 0
			);
			oscillator.start( time );
			oscillator.stop( time + duration + release + 0.02 );
			return true;
		}

		function createNoiseBuffer() {
			if ( noiseBuffer || ! context ) {
				return noiseBuffer;
			}
			const length = Math.max( 1, Math.floor( context.sampleRate * 0.5 ) );
			noiseBuffer = context.createBuffer( 1, length, context.sampleRate );
			const channel = noiseBuffer.getChannelData( 0 );
			let seed = 0x4f50454e;
			for ( let index = 0; index < length; index += 1 ) {
				seed ^= seed << 13;
				seed ^= seed >>> 17;
				seed ^= seed << 5;
				channel[ index ] = ( ( seed >>> 0 ) / 0xffffffff ) * 2 - 1;
			}
			return noiseBuffer;
		}

		function noise( specification = {} ) {
			const audio = ensureContext();
			if (
				! audio ||
				typeof audio.createBufferSource !== 'function' ||
				typeof audio.createBuffer !== 'function'
			) {
				return false;
			}
			const now = audio.currentTime;
			const time = Math.max( now, Number( specification.time ) || now );
			const duration = Math.max(
				0.015,
				Number( specification.duration ) || 0.04
			);
			const release = Math.max(
				0.01,
				Number( specification.release ) || 0.035
			);
			const source = ownVoice( audio.createBufferSource() );
			const envelope = audio.createGain();
			const filter = audio.createBiquadFilter();
			source.buffer = createNoiseBuffer();
			filter.type = specification.filterType || 'highpass';
			filter.frequency.value = Number( specification.filter ) || 4800;
			filter.Q.value = Number( specification.resonance ) || 0.6;
			setParam(
				envelope.gain,
				clamp( Number( specification.gain ) || 0.035, 0.0001, 1 ),
				time
			);
			if (
				typeof envelope.gain.exponentialRampToValueAtTime === 'function'
			) {
				envelope.gain.exponentialRampToValueAtTime(
					0.0001,
					time + duration + release
				);
			}
			source.connect( filter );
			filter.connect( envelope );
			connectVoice(
				envelope,
				specification.bus || 'sfx',
				Number( specification.send ) || 0
			);
			source.start( time );
			source.stop( time + duration + release + 0.02 );
			return true;
		}

		function kick( specification = {} ) {
			const audio = ensureContext();
			if ( ! audio ) {
				return false;
			}
			const now = audio.currentTime;
			const time = Math.max( now, Number( specification.time ) || now );
			const oscillator = ownVoice( audio.createOscillator() );
			const envelope = audio.createGain();
			const gain = clamp(
				Number( specification.gain ) || 0.13,
				0.0001,
				1
			);
			oscillator.type = 'sine';
			oscillator.frequency.setValueAtTime( 145, time );
			oscillator.frequency.exponentialRampToValueAtTime( 46, time + 0.11 );
			setParam( envelope.gain, gain, time );
			envelope.gain.exponentialRampToValueAtTime( 0.0001, time + 0.18 );
			oscillator.connect( envelope );
			connectVoice( envelope, specification.bus || 'music', 0 );
			oscillator.start( time );
			oscillator.stop( time + 0.2 );
			return true;
		}

		function setEnabled( nextEnabled ) {
			enabled = Boolean( nextEnabled );
			if ( ! context || ! master ) {
				return enabled;
			}
			const now = context.currentTime;
			setParam( master.gain, master.gain.value || 0.0001, now );
			rampParam( master.gain, enabled ? 1 : 0.0001, now + 0.035 );
			if ( enabled && context.state === 'suspended' ) {
				context.resume().catch( () => {} );
			}
			return enabled;
		}

		function setLevels( levels = {} ) {
			if ( Number.isFinite( Number( levels.music ) ) ) {
				musicLevel = clamp( Number( levels.music ), 0, 1 );
			}
			if ( Number.isFinite( Number( levels.sfx ) ) ) {
				sfxLevel = clamp( Number( levels.sfx ), 0, 1 );
			}
			if ( context && music && sfx ) {
				const now = context.currentTime;
				setParam( music.gain, music.gain.value, now );
				rampParam( music.gain, musicLevel, now + 0.06 );
				setParam( sfx.gain, sfx.gain.value, now );
				rampParam( sfx.gain, sfxLevel, now + 0.06 );
			}
		}

		function duckMusic( amount = 0.45, duration = 0.18 ) {
			if ( ! context || ! music || ! enabled ) {
				return;
			}
			const now = context.currentTime;
			const low = musicLevel * clamp( amount, 0.05, 1 );
			setParam( music.gain, music.gain.value, now );
			rampParam( music.gain, low, now + 0.015 );
			rampParam(
				music.gain,
				musicLevel,
				now + Math.max( 0.06, Number( duration ) || 0.18 )
			);
		}

		function createSequencer( configuration = {} ) {
			const bpm = clamp( Number( configuration.bpm ) || 120, 30, 260 );
			const stepsPerBeat = clamp(
				Math.round( Number( configuration.stepsPerBeat ) || 4 ),
				1,
				16
			);
			const lookahead = clamp(
				Number( configuration.lookaheadMs ) || 45,
				20,
				200
			);
			const scheduleAhead = clamp(
				Number( configuration.scheduleAheadSeconds ) || 0.16,
				0.05,
				0.5
			);
			let step = 0;
			let nextTime = 0;
			let timer = null;
			let running = false;
			let sequenceDisposed = false;

			function clearTimer() {
				if (
					timer !== null &&
					timerHost &&
					typeof timerHost.clearInterval === 'function'
				) {
					timerHost.clearInterval( timer );
				}
				timer = null;
			}

			function tick() {
				if ( ! running || sequenceDisposed || ! context ) {
					return;
				}
				const secondsPerStep = 60 / bpm / stepsPerBeat;
				while ( nextTime < context.currentTime + scheduleAhead ) {
					if ( typeof configuration.onStep === 'function' ) {
						configuration.onStep( {
							step,
							time: nextTime,
							bpm,
							stepsPerBeat,
							tone,
							noise,
							kick,
						} );
					}
					step += 1;
					nextTime += secondsPerStep;
				}
			}

			function start( reset = false ) {
				if ( sequenceDisposed || disposed || ! enabled ) {
					return false;
				}
				const audio = ensureContext();
				if ( ! audio ) {
					return false;
				}
				if ( reset ) {
					step = 0;
				}
				running = true;
				nextTime = audio.currentTime + 0.035;
				clearTimer();
				tick();
				if (
					timerHost &&
					typeof timerHost.setInterval === 'function'
				) {
					timer = timerHost.setInterval( tick, lookahead );
				}
				return true;
			}

			function pause() {
				if ( ! running ) {
					return;
				}
				running = false;
				clearTimer();
				if ( context && music ) {
					const now = context.currentTime;
					setParam( music.gain, music.gain.value, now );
					rampParam( music.gain, 0.0001, now + 0.035 );
				}
			}

			function resume() {
				if ( sequenceDisposed || running ) {
					return running;
				}
				if ( context && music ) {
					const now = context.currentTime;
					setParam( music.gain, music.gain.value || 0.0001, now );
					rampParam( music.gain, musicLevel, now + 0.06 );
				}
				return start( false );
			}

			function stop() {
				pause();
				step = 0;
				nextTime = 0;
			}

			function disposeSequencer() {
				if ( sequenceDisposed ) {
					return;
				}
				sequenceDisposed = true;
				stop();
				sequencers.delete( api );
			}

			const api = Object.freeze( {
				start,
				pause,
				resume,
				stop,
				dispose: disposeSequencer,
				get running() {
					return running;
				},
				get step() {
					return step;
				},
			} );
			sequencers.add( api );
			return api;
		}

		function dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			for ( const sequencer of [ ...sequencers ] ) {
				sequencer.dispose();
			}
			for ( const voice of voices ) {
				try {
					voice.stop();
				} catch ( error ) {
					// A voice that has already ended is already clean.
				}
			}
			voices.clear();
			if ( context && typeof context.close === 'function' ) {
				context.close().catch( () => {} );
			}
			context = null;
			master = null;
			music = null;
			sfx = null;
			delayInput = null;
			noiseBuffer = null;
		}

		return Object.freeze( {
			ensureContext,
			tone,
			noise,
			kick,
			setEnabled,
			setLevels,
			duckMusic,
			createSequencer,
			dispose,
			get context() {
				return context;
			},
			get enabled() {
				return enabled;
			},
			get disposed() {
				return disposed;
			},
			get activeVoiceCount() {
				return voices.size;
			},
		} );
	}

	return Object.freeze( {
		VERSION,
		clamp,
		midiToFrequency,
		createAudioEngine,
	} );
} );
