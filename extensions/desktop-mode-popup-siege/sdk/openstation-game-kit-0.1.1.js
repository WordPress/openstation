( function ( global, factory ) {
	'use strict';

	const base =
		global && global.OpenStationGameKit
			? global.OpenStationGameKit
			: typeof module === 'object' && module.exports
				? require( './openstation-game-kit-0.1.0.js' )
				: null;
	const api = factory( global, base );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.OpenStationGameKit = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function (
	global,
	base
) {
	'use strict';

	if ( ! base || base.VERSION !== '0.1.0' ) {
		throw new Error( 'OpenStation Game Kit 0.1.0 is required.' );
	}

	const VERSION = '0.1.1';

	function createFixedStepLoop( options = {} ) {
		const win = options.window || global;
		const step =
			Number( options.step ) > 0 ? Number( options.step ) : 1 / 120;
		const maxDelta = base.clamp(
			Number( options.maxDelta ) || 0.05,
			step,
			0.25
		);
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
			const elapsed = base.clamp(
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
			render( base.clamp( accumulator / step, 0, 1 ), elapsed );
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

		function advance( seconds ) {
			const elapsed = Math.max( 0, Number( seconds ) || 0 );
			accumulator += elapsed;
			while ( accumulator >= step ) {
				update( step );
				accumulator -= step;
			}
			render( base.clamp( accumulator / step, 0, 1 ), elapsed );
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
			resume: start,
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

	return Object.freeze( {
		...base,
		VERSION,
		createFixedStepLoop,
	} );
} );
