( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.8.js' )
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
		throw new Error( 'Popup Siege 0.4.8 is required.' );
	}

	const ASSET_VERSION = '0.5.0';

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const root = container.querySelector( '.siege-game' );
		const pauseButton = root?.querySelector( '[data-action="pause"]' );
		const MutationObserverClass =
			root?.ownerDocument.defaultView?.MutationObserver;
		const syncControlState = () => {
			if ( pauseButton && root ) {
				pauseButton.dataset.controlMode =
					root.dataset.phase === 'paused' ? 'resume' : 'pause';
			}
		};
		const observer =
			root && MutationObserverClass
				? new MutationObserverClass( syncControlState )
				: null;

		if ( root ) {
			root.classList.add( 'siege-game--design-system-050' );
			root.dataset.buildVersion = ASSET_VERSION;
			root.dataset.prototype = 'popup-siege-v0-5-0';
			root.dataset.uiSystem = 'popup-siege-0.5.0';
			syncControlState();
			observer?.observe( root, {
				attributes: true,
				attributeFilter: [ 'data-phase' ],
			} );
		}

		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				observer?.disconnect();
				if ( pauseButton ) {
					delete pauseButton.dataset.controlMode;
				}
				if ( root ) {
					root.classList.remove( 'siege-game--design-system-050' );
					root.dataset.buildVersion = '0.4.8';
					root.dataset.prototype = 'popup-siege-v0-4-8';
					delete root.dataset.uiSystem;
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
