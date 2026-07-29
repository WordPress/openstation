( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.1.js' )
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
		throw new Error( 'Popup Siege 0.4.1 is required.' );
	}

	const ASSET_VERSION = '0.4.2';

	function unifyControlDeck( container ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const header = root.querySelector( '.siege-header' );
		const brand = header && header.querySelector( '.siege-brand' );
		const hud = header && header.querySelector( '.siege-hud' );
		const actions = header && header.querySelector( '.siege-actions' );
		const kicker = root.querySelector( '.siege-brand__kicker' );
		if ( ! header || ! brand || ! hud || ! actions ) {
			return () => {};
		}
		const chassis = header.ownerDocument.createElement( 'div' );
		const zones = [ brand, hud, actions ];

		chassis.className = 'siege-header__chassis';
		chassis.dataset.headerRole = 'control-deck';
		header.insertBefore( chassis, brand );
		chassis.append( ...zones );

		root.classList.add( 'siege-game--control-deck-042' );
		root.dataset.buildVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-4-2';
		if ( kicker ) {
			kicker.textContent = 'ARCHIVE RESCUE';
		}

		return () => {
			if ( chassis.parentNode === header ) {
				for ( const zone of zones ) {
					if ( zone.parentNode === chassis ) {
						header.insertBefore( zone, chassis );
					}
				}
				chassis.remove();
			}
			root.classList.remove( 'siege-game--control-deck-042' );
			delete root.dataset.buildVersion;
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const removeControlDeck = unifyControlDeck( container );
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
