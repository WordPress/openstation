( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.3.0.js' )
				: null;
	const api = factory( global, base );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.PopupBreaker = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function (
	global,
	base
) {
	'use strict';

	if ( ! base ) {
		throw new Error( 'Popup Siege 0.3.0 is required.' );
	}

	const ASSET_VERSION = '0.4.0';

	function enhanceHeader( container, controller ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const document = container.ownerDocument;
		const win = document.defaultView || global;
		const kicker = root.querySelector( '.siege-brand__kicker' );
		const actions = root.querySelector( '.siege-actions' );
		const musicButton = actions?.querySelector( '[data-action="sound"]' );
		const effectsButton = actions?.querySelector( '[data-action="effects"]' );
		const closeButton = actions?.querySelector( '[data-action="close"]' );
		let frame = 0;
		let disposed = false;

		root.dataset.assetVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-4';
		if ( kicker ) {
			kicker.textContent = 'ARCHIVE RESCUE // MIRA 1999';
		}
		if ( actions ) {
			actions.setAttribute( 'aria-label', 'Game controls' );
		}
		if ( musicButton ) {
			musicButton.setAttribute( 'aria-label', 'Music on' );
		}
		if ( effectsButton ) {
			effectsButton.setAttribute( 'aria-label', 'Effects on' );
		}
		if ( closeButton ) {
			closeButton.setAttribute( 'aria-label', 'Close game' );
		}

		function sync() {
			if ( disposed ) {
				return;
			}
			root.dataset.assetVersion = ASSET_VERSION;
			frame = win.requestAnimationFrame( sync );
		}

		frame = win.requestAnimationFrame( sync );

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			win.cancelAnimationFrame( frame );
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const removeHeader = enhanceHeader( container, controller );
		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				removeHeader();
				controller.teardown();
			},
		} );
	}

	return Object.freeze( {
		...base,
		ASSET_VERSION,
		mount,
	} );
} );
