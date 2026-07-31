( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.6.0.js' )
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

	if ( ! base || base.ASSET_VERSION !== '0.6.0' ) {
		throw new Error( 'Popup Siege 0.6.0 is required.' );
	}

	const ASSET_VERSION = '0.6.1';

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const root = container.querySelector( '.siege-game' );

		if ( root ) {
			root.classList.add( 'siege-game--legible-console-061' );
			root.dataset.buildVersion = ASSET_VERSION;
			root.dataset.prototype = 'popup-siege-v0-6-1';
			root.dataset.uiSystem = 'popup-siege-0.6.1';
		}

		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				root?.classList.remove( 'siege-game--legible-console-061' );
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
