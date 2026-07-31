( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.6.js' )
				: null;
	const api = factory( base );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.PopupBreaker = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function ( base ) {
	'use strict';

	if ( ! base ) {
		throw new Error( 'Popup Siege 0.4.6 is required.' );
	}

	const ASSET_VERSION = '0.4.7';

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const root = container.querySelector( '.siege-game' );

		if ( root ) {
			root.classList.add( 'siege-game--side-console-047' );
			root.dataset.buildVersion = ASSET_VERSION;
			root.dataset.prototype = 'popup-siege-v0-4-7';
			root.dataset.consolePlacement = 'side';
		}

		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				if ( root ) {
					root.classList.remove( 'siege-game--side-console-047' );
					root.dataset.buildVersion = '0.4.6';
					root.dataset.prototype = 'popup-siege-v0-4-6';
					delete root.dataset.consolePlacement;
				}
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
