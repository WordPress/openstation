( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.4.2.js' )
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
		throw new Error( 'Popup Siege 0.4.2 is required.' );
	}

	const ASSET_VERSION = '0.4.3';

	function installBrowserMedic( container ) {
		const root = container.querySelector( '.siege-game' );
		const header = root && root.querySelector( '.siege-header' );
		const browser = root && root.querySelector( '.siege-browser' );
		const chassis =
			header && header.querySelector( '.siege-header__chassis' );
		const wordmark = header && header.querySelector( '.siege-brand strong' );
		const kicker =
			header && header.querySelector( '.siege-brand__kicker' );
		const actions = header && header.querySelector( '.siege-actions' );
		if (
			! root ||
			! header ||
			! browser ||
			! chassis ||
			! wordmark ||
			! kicker ||
			! actions
		) {
			return () => {};
		}

		const document = header.ownerDocument;
		const originalParent = header.parentNode;
		const originalNextSibling = header.nextSibling;
		const originalWordmark = wordmark.textContent;
		const originalWordmarkLabel = wordmark.getAttribute( 'aria-label' );
		const originalKicker = kicker.textContent;

		wordmark.replaceChildren();
		wordmark.setAttribute( 'aria-label', 'Popup Siege' );
		for ( const word of [ 'POPUP', 'SIEGE' ] ) {
			const span = document.createElement( 'span' );
			span.className = 'siege-brand__word';
			span.setAttribute( 'aria-hidden', 'true' );
			span.textContent = word;
			wordmark.append( span );
		}
		const pauseHint = document.createElement( 'span' );
		pauseHint.className = 'siege-actions__pause-slot';
		pauseHint.setAttribute( 'aria-hidden', 'true' );
		pauseHint.textContent = 'P · PAUSE';
		actions.append( pauseHint );

		browser.insertBefore( header, browser.firstChild );
		kicker.textContent = 'BROWSER MEDIC 99';
		root.classList.add( 'siege-game--browser-medic-043' );
		root.dataset.buildVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-4-3';
		chassis.dataset.headerRole = 'browser-medic-console';

		return () => {
			if ( header.parentNode === browser ) {
				originalParent.insertBefore( header, originalNextSibling );
			}
			pauseHint.remove();
			wordmark.textContent = originalWordmark;
			if ( originalWordmarkLabel === null ) {
				wordmark.removeAttribute( 'aria-label' );
			} else {
				wordmark.setAttribute( 'aria-label', originalWordmarkLabel );
			}
			kicker.textContent = originalKicker;
			chassis.dataset.headerRole = 'control-deck';
			root.classList.remove( 'siege-game--browser-medic-043' );
			delete root.dataset.buildVersion;
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const removeBrowserMedic = installBrowserMedic( container );
		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				removeBrowserMedic();
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
