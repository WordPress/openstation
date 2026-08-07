( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.0.js' )
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
		throw new Error( 'Popup Siege 0.4.0 is required.' );
	}

	const ASSET_VERSION = '0.4.1';

	function enhanceControlDeck( container ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const kicker = root.querySelector( '.siege-brand__kicker' );

		root.classList.add( 'siege-game--control-deck-041' );
		root.dataset.buildVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-4-1';
		if ( kicker ) {
			kicker.textContent = 'ARCHIVE RESCUE';
		}

		return () => {
			root.classList.remove( 'siege-game--control-deck-041' );
			delete root.dataset.buildVersion;
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const removeControlDeck = enhanceControlDeck( container );
		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				removeControlDeck();
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
