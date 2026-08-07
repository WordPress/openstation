( function ( global, factory ) {
	'use strict';

	const api = factory( global );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.OpenStationGameKit = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function ( global ) {
	'use strict';

	const VERSION = '0.1.0';

	function clamp( value, minimum, maximum ) {
		return Math.max( minimum, Math.min( maximum, value ) );
	}

	function createLifecycle() {
		const disposers = [];
		let disposed = false;

		function add( disposer ) {
			if ( typeof disposer !== 'function' ) {
				return disposer;
			}
			if ( disposed ) {
				disposer();
				return disposer;
			}
			disposers.push( disposer );
			return disposer;
		}

		function listen( target, type, listener, options ) {
			if ( ! target || typeof target.addEventListener !== 'function' ) {
				return listener;
			}
			target.addEventListener( type, listener, options );
			add( () => target.removeEventListener( type, listener, options ) );
			return listener;
		}

		function observeResize( target, callback, ResizeObserverClass ) {
			const Observer =
				ResizeObserverClass ||
				( global && global.ResizeObserver );
			if ( ! target || typeof Observer !== 'function' ) {
				return null;
			}
			const observer = new Observer( callback );
			observer.observe( target );
			add( () => observer.disconnect() );
			return observer;
		}

		function guard( callback ) {
			return function guardedCallback( ...args ) {
				if ( disposed ) {
					return undefined;
				}
				return callback.apply( this, args );
			};
		}

		function timeout( callback, delay, timerHost = global ) {
			if (
				! timerHost ||
				typeof timerHost.setTimeout !== 'function' ||
				typeof timerHost.clearTimeout !== 'function'
			) {
				return null;
			}
			const timerId = timerHost.setTimeout(
				guard( callback ),
				Math.max( 0, Number( delay ) || 0 )
			);
			add( () => timerHost.clearTimeout( timerId ) );
			return timerId;
		}

		function dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			while ( disposers.length ) {
				const disposer = disposers.pop();
				try {
					disposer();
				} catch ( error ) {
					// Teardown must continue even if one optional surface failed.
				}
			}
		}

		return Object.freeze( {
			add,
			listen,
			observeResize,
			guard,
			timeout,
			dispose,
			get disposed() {
				return disposed;
			},
		} );
	}

	function createFixedStepLoop( options = {} ) {
		const win = options.window || global;
		const step = Number( options.step ) > 0 ? Number( options.step ) : 1 / 120;
		const maxDelta = clamp( Number( options.maxDelta ) || 0.05, step, 0.25 );
		const update =
			typeof options.update === 'function' ? options.update : () => {};
		const render =
			typeof options.render === 'function' ? options.render : () => {};
		let running = false;
		let disposed = false;
		let frameId = null;
		let previousTime = null;
		let accumulator = 0;

		function cancelFrame() {
			if (
				frameId !== null &&
				win &&
				typeof win.cancelAnimationFrame === 'function'
			) {
				win.cancelAnimationFrame( frameId );
			}
			frameId = null;
		}

		function frame( timestamp ) {
			if ( ! running || disposed ) {
				return;
			}
			if ( previousTime === null ) {
				previousTime = timestamp;
			}
			const elapsed = clamp(
				( timestamp - previousTime ) / 1000,
				0,
				maxDelta
			);
			previousTime = timestamp;
			accumulator += elapsed;

			while ( accumulator >= step ) {
				update( step );
				accumulator -= step;
			}
			render( clamp( accumulator / step, 0, 1 ), elapsed );
			frameId = win.requestAnimationFrame( frame );
		}

		function start() {
			if (
				running ||
				disposed ||
				! win ||
				typeof win.requestAnimationFrame !== 'function'
			) {
				return;
			}
			running = true;
			previousTime = null;
			frameId = win.requestAnimationFrame( frame );
		}

		function pause() {
			if ( ! running ) {
				return;
			}
			running = false;
			cancelFrame();
			previousTime = null;
		}

		function resume() {
			start();
		}

		function advance( seconds ) {
			let remaining = Math.max( 0, Number( seconds ) || 0 );
			while ( remaining >= step ) {
				update( step );
				remaining -= step;
			}
			if ( remaining > 0 ) {
				accumulator = remaining;
			}
			render( clamp( accumulator / step, 0, 1 ), seconds );
		}

		function dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			running = false;
			cancelFrame();
			previousTime = null;
			accumulator = 0;
		}

		return Object.freeze( {
			start,
			pause,
			resume,
			advance,
			dispose,
			get running() {
				return running;
			},
			get disposed() {
				return disposed;
			},
		} );
	}

	async function loadPixi( options = {} ) {
		const host = options.window || global;
		if ( host && host.PIXI ) {
			return host.PIXI;
		}
		const loader =
			host &&
			host.wp &&
			host.wp.os &&
			host.wp.os.loadModules;
		if ( typeof loader === 'function' ) {
			await loader.call( host.wp.os, [ 'pixijs' ] );
		}
		if ( ! host || ! host.PIXI ) {
			throw new Error( 'OpenStation Game Kit could not load shared PixiJS.' );
		}
		return host.PIXI;
	}

	async function createPixiStage( container, options = {} ) {
		if ( ! container ) {
			throw new Error( 'createPixiStage requires a container.' );
		}
		const win = options.window || global;
		const PIXI = options.PIXI || await loadPixi( { window: win } );
		const width = Math.max( 1, Number( options.width ) || 480 );
		const height = Math.max( 1, Number( options.height ) || 560 );
		const cap = clamp( Number( options.resolutionCap ) || 2, 1, 3 );
		const resolution = clamp(
			Number( win && win.devicePixelRatio ) || 1,
			1,
			cap
		);
		const app = new PIXI.Application();
		await app.init( {
			width,
			height,
			resolution,
			autoDensity: true,
			antialias: options.antialias !== false,
			background: options.background || '#071226',
			backgroundAlpha:
				Number.isFinite( options.backgroundAlpha )
					? options.backgroundAlpha
					: 1,
			sharedTicker: false,
			autoStart: false,
			preference: options.preference || 'webgl',
		} );

		const canvas = app.canvas;
		canvas.classList.add( 'os-game-canvas' );
		canvas.setAttribute( 'aria-hidden', 'true' );
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.display = 'block';
		container.replaceChildren( canvas );

		function mapPointer( event ) {
			const bounds = canvas.getBoundingClientRect();
			return {
				x: clamp(
					( ( event.clientX - bounds.left ) / Math.max( 1, bounds.width ) ) *
						width,
					0,
					width
				),
				y: clamp(
					( ( event.clientY - bounds.top ) / Math.max( 1, bounds.height ) ) *
						height,
					0,
					height
				),
			};
		}

		let destroyed = false;
		function render() {
			if ( ! destroyed ) {
				app.renderer.render( app.stage );
			}
		}

		function destroy() {
			if ( destroyed ) {
				return;
			}
			destroyed = true;
			app.destroy(
				{ removeView: true },
				{ children: true, texture: false, textureSource: false }
			);
			if ( canvas.parentNode ) {
				canvas.remove();
			}
		}

		return Object.freeze( {
			PIXI,
			app,
			canvas,
			width,
			height,
			resolution,
			mapPointer,
			render,
			destroy,
			get destroyed() {
				return destroyed;
			},
		} );
	}

	function createAudioBus( options = {} ) {
		const win = options.window || global;
		let enabled = options.enabled !== false;
		let context = null;
		let disposed = false;

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
			}
			if ( context.state === 'suspended' ) {
				context.resume().catch( () => {} );
			}
			return context;
		}

		function tone( frequency = 440, duration = 0.04, gain = 0.025, type = 'square' ) {
			const audio = ensureContext();
			if ( ! audio ) {
				return;
			}
			const oscillator = audio.createOscillator();
			const volume = audio.createGain();
			const now = audio.currentTime;
			oscillator.type = type;
			oscillator.frequency.setValueAtTime( frequency, now );
			volume.gain.setValueAtTime( Math.max( 0, gain ), now );
			volume.gain.exponentialRampToValueAtTime(
				0.0001,
				now + Math.max( 0.01, duration )
			);
			oscillator.connect( volume );
			volume.connect( audio.destination );
			oscillator.start( now );
			oscillator.stop( now + Math.max( 0.01, duration ) );
		}

		function setEnabled( nextEnabled ) {
			enabled = Boolean( nextEnabled );
			if ( ! enabled && context && context.state === 'running' ) {
				context.suspend().catch( () => {} );
			}
			return enabled;
		}

		function dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			if ( context ) {
				context.close().catch( () => {} );
				context = null;
			}
		}

		return Object.freeze( {
			tone,
			setEnabled,
			dispose,
			get enabled() {
				return enabled;
			},
			get disposed() {
				return disposed;
			},
		} );
	}

	function createScoreSession( submitScore ) {
		let payload = null;
		let submission = null;
		let abandoned = false;

		function complete( nextPayload ) {
			if ( abandoned ) {
				throw new Error( 'An abandoned score session cannot complete.' );
			}
			if ( ! payload ) {
				payload = Object.freeze( {
					...nextPayload,
					meta: nextPayload && nextPayload.meta
						? Object.freeze( { ...nextPayload.meta } )
						: undefined,
				} );
			}
			return payload;
		}

		function submit() {
			if ( abandoned || ! payload || typeof submitScore !== 'function' ) {
				return Promise.resolve( null );
			}
			if ( ! submission ) {
				submission = Promise.resolve().then( () => submitScore( payload ) );
			}
			return submission;
		}

		function abandon() {
			if ( payload || submission ) {
				return false;
			}
			abandoned = true;
			return true;
		}

		return Object.freeze( {
			complete,
			submit,
			abandon,
			get payload() {
				return payload;
			},
			get abandoned() {
				return abandoned;
			},
		} );
	}

	return Object.freeze( {
		VERSION,
		clamp,
		createLifecycle,
		createFixedStepLoop,
		loadPixi,
		createPixiStage,
		createAudioBus,
		createScoreSession,
	} );
} );
