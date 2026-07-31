( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.5.js' )
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
		throw new Error( 'Popup Siege 0.4.5 is required.' );
	}

	const ASSET_VERSION = '0.4.6';

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const root = container.querySelector( '.siege-game' );
		const brand = root?.querySelector( '.siege-brand strong' );
		const originalBrandText = brand?.textContent || 'POPUP SIEGE';

		if ( root ) {
			root.classList.add( 'siege-game--logo-046' );
			root.dataset.buildVersion = ASSET_VERSION;
			root.dataset.prototype = 'popup-siege-v0-4-6';
		}

		if ( brand ) {
			const document = brand.ownerDocument;
			const eyebrow = document.createElement( 'span' );
			const wordmark = document.createElement( 'span' );
			eyebrow.className = 'siege-brand__eyebrow';
			wordmark.className = 'siege-brand__wordmark';
			eyebrow.textContent = 'POPUP';
			wordmark.textContent = 'SIEGE';
			brand.replaceChildren( eyebrow, wordmark );
			brand.setAttribute( 'aria-label', 'Popup Siege' );
		}

		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				if ( brand ) {
					brand.replaceChildren( originalBrandText );
					brand.removeAttribute( 'aria-label' );
				}
				if ( root ) {
					root.classList.remove( 'siege-game--logo-046' );
					root.dataset.buildVersion = '0.4.5';
					root.dataset.prototype = 'popup-siege-v0-4-5';
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
