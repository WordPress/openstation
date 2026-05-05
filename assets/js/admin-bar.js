( function() {
	var toggle = document.getElementById( 'wp-admin-bar-desktop-mode-toggle' );
	if ( ! toggle ) {
		return;
	}
	var cfg = window.desktopModeAdminBar || {};
	toggle.addEventListener( 'click', function( e ) {
		e.preventDefault();
		var isActive = !! cfg.active;
		var newValue = isActive ? '' : '1';
		// Fallback targets if the server response is missing a `redirect`
		// field (shouldn't happen, but keep the click functional either
		// way). Disabling -> classic admin (NOT the portal, which would
		// auto-re-enable); enabling -> portal URL so the shell takes over.
		var fallback = isActive ? cfg.classicUrl : cfg.portalUrl;
		// The toggle lives in an admin bar that may be rendered either in
		// the top window (classic) or — today it's suppressed in iframes,
		// but a plugin could surface it — inside a chromeless iframe. In
		// either case we want the ENTIRE browser tab to navigate, so we
		// hit `window.top` and fall back to `window` if cross-origin
		// security blocks access.
		function navigate( url ) {
			try {
				window.top.location.href = url;
			} catch ( err ) {
				window.location.href = url;
			}
		}
		var body = new URLSearchParams();
		body.set( 'action', 'save-desktop-mode' );
		body.set( 'nonce', cfg.nonce );
		body.set( 'enabled', newValue );
		var xhr = new XMLHttpRequest();
		xhr.open( 'POST', cfg.ajaxUrl, true );
		xhr.setRequestHeader( 'Content-Type', 'application/x-www-form-urlencoded' );
		xhr.onload = function() {
			if ( xhr.status !== 200 ) {
				return;
			}
			var target = fallback;
			try {
				var resp = JSON.parse( xhr.responseText );
				if ( resp && resp.success && resp.data && resp.data.redirect ) {
					target = resp.data.redirect;
				}
			} catch ( parseErr ) {}
			navigate( target );
		};
		xhr.send( body.toString() );
	} );

	// Layout menu — each child item calls a WindowManager method on
	// the public shell API. We bind one delegated click listener on
	// the parent submenu so adding more layouts in the future
	// (split, full-width, etc.) is a matter of adding nodes in PHP,
	// not new JS. `href=#` is set server-side; we preventDefault +
	// intercept.
	//
	// The snap-to-grid checkbox is special: clicking it toggles the
	// preference AND repaints the box without dismissing the menu
	// (default WP behaviour would close the submenu on any click,
	// breaking the "set it and forget it" feel of a checkbox).
	var layoutMenu = document.getElementById( 'wp-admin-bar-desktop-layout-menu' );
	if ( ! layoutMenu ) return;

	function paintSnapCheckbox( enabled ) {
		var node = document.querySelector(
			'#wp-admin-bar-desktop-layout-snap .desktop-mode-layout-checkbox'
		);
		if ( ! node ) return;
		node.textContent = enabled ? '☑' : '☐'; // ☑ / ☐
		var item = document.getElementById( 'wp-admin-bar-desktop-layout-snap' );
		if ( item ) {
			item.setAttribute( 'aria-checked', enabled ? 'true' : 'false' );
			item.setAttribute( 'role', 'menuitemcheckbox' );
		}
	}

	function getManager() {
		return window.wp && window.wp.desktop && window.wp.desktop.windowManager;
	}

	// Initial paint — wait for the shell to publish the manager,
	// then mirror the persisted snap preference. Polled rather than
	// hooked because the inline script ships with the admin bar
	// (loads early) and the shell's WindowManager arrives later.
	function initFromManager() {
		var wm = getManager();
		if ( ! wm || typeof wm.isSnapEnabled !== 'function' ) {
			window.setTimeout( initFromManager, 60 );
			return;
		}
		paintSnapCheckbox( wm.isSnapEnabled() );
	}
	initFromManager();

	layoutMenu.addEventListener( 'click', function( e ) {
		var t = e.target;
		if ( ! t || ! t.closest ) return;

		var snapItem = t.closest( '.desktop-mode-layout-snap' );
		if ( snapItem ) {
			// Stop propagation so WP's own "click closes submenu"
			// chain never fires. preventDefault keeps the `#` href
			// from scrolling the page to top.
			e.preventDefault();
			e.stopPropagation();
			var wm = getManager();
			if ( ! wm || typeof wm.setSnapEnabled !== 'function' ) return;
			var next = ! wm.isSnapEnabled();
			wm.setSnapEnabled( next );
			paintSnapCheckbox( next );
			return;
		}

		var actionLink = t.closest( '.desktop-mode-layout-action > .ab-item, .desktop-mode-layout-action' );
		if ( ! actionLink ) return;
		e.preventDefault();
		var id = actionLink.closest( '[id^="wp-admin-bar-desktop-layout-"]' );
		if ( ! id ) return;
		var manager = getManager();
		if ( ! manager ) return;
		if ( id.id === 'wp-admin-bar-desktop-layout-cascade' && typeof manager.cascade === 'function' ) {
			manager.cascade();
		} else if ( id.id === 'wp-admin-bar-desktop-layout-overview' && typeof manager.enterOverview === 'function' ) {
			manager.enterOverview();
		} else if ( id.id === 'wp-admin-bar-desktop-layout-tile' && typeof manager.tile === 'function' ) {
			manager.tile();
		} else if ( id.id.indexOf( 'wp-admin-bar-desktop-layout-custom-' ) === 0 ) {
			// Plugin-registered custom item. Strip the shared prefix to
			// recover the `id` the plugin supplied via the PHP filter,
			// then dispatch the public JS action. Plugins subscribe
			// via wp.hooks.addAction( 'desktop-mode.arrange.custom-action', ... ).
			var customId = id.id.replace( 'wp-admin-bar-desktop-layout-custom-', '' );
			var hooks = window.wp && window.wp.hooks;
			if ( hooks && typeof hooks.doAction === 'function' ) {
				hooks.doAction( 'desktop-mode.arrange.custom-action', { id: customId } );
			}
		}
		// After running an action, dismiss the submenu so the user
		// lands in the newly arranged desktop instead of the menu
		// hanging open on top. WP's admin bar toggles visibility via
		// a `.hover` class on the parent `li.menupop` — we remove it
		// AND blur the active element so a re-hover is required for
		// the next open. The snap checkbox stays open by design
		// (it's handled by the earlier branch and never reaches
		// this close path).
		layoutMenu.classList.remove( 'hover' );
		if ( document.activeElement && typeof document.activeElement.blur === 'function' ) {
			document.activeElement.blur();
		}
	} );

	// AI Assistant button — dispatches the `desktop-mode-open-ai` event that
	// the AiAssistant class listens for. Using an event instead of a direct
	// call decouples the admin-bar inline script (which runs early, before
	// the desktop shell has initialised) from the AiAssistant instance.
	var aiBtn = document.getElementById( 'wp-admin-bar-desktop-ai-assistant' );
	if ( aiBtn ) {
		aiBtn.addEventListener( 'click', function( e ) {
			e.preventDefault();
			document.dispatchEvent( new CustomEvent( 'desktop-mode-open-ai' ) );
		} );
	}

	// Fullscreen button — toggles browser fullscreen on the document
	// element so the shell occupies the whole screen with no browser
	// chrome. The click counts as a user gesture, which is required by
	// the Fullscreen API. We listen for `fullscreenchange` instead of
	// flipping state inside the click handler because the user can also
	// exit via Esc or the OS, and we want the icon/label to stay in sync
	// in those cases too.
	var fsBtn = document.getElementById( 'wp-admin-bar-desktop-fullscreen' );
	if ( fsBtn ) {
		var fsLink = fsBtn.querySelector( '.ab-item' );
		var fsLabel = fsBtn.querySelector( '.ab-label' );
		var fsI18n = ( cfg && cfg.i18n ) || {};
		function paintFullscreen( on ) {
			if ( on ) {
				fsBtn.classList.add( 'is-fullscreen' );
				if ( fsLabel ) fsLabel.textContent = fsI18n.exitFullscreen || 'Exit fullscreen';
				if ( fsLink ) fsLink.setAttribute( 'title', fsI18n.exitTitle || 'Exit fullscreen' );
			} else {
				fsBtn.classList.remove( 'is-fullscreen' );
				if ( fsLabel ) fsLabel.textContent = fsI18n.enterFullscreen || 'Fullscreen';
				if ( fsLink ) fsLink.setAttribute( 'title', fsI18n.enterTitle || 'Enter fullscreen' );
			}
		}
		fsBtn.addEventListener( 'click', function( e ) {
			e.preventDefault();
			// `window.top` so the whole tab goes fullscreen even when the
			// admin bar happens to be rendered inside an iframe (today
			// it's suppressed there, but a plugin could surface it). Fall
			// back to the current document if cross-origin blocks access.
			var doc;
			try {
				doc = window.top.document;
			} catch ( err ) {
				doc = document;
			}
			if ( doc.fullscreenElement ) {
				if ( doc.exitFullscreen ) {
					doc.exitFullscreen();
				}
			} else if ( doc.documentElement && doc.documentElement.requestFullscreen ) {
				doc.documentElement.requestFullscreen();
			}
		} );
		// Listen on whichever document we're driving so OS/Esc exits
		// repaint the button too. Bound on both to cover the iframe edge
		// case without extra branching.
		document.addEventListener( 'fullscreenchange', function() {
			paintFullscreen( !! document.fullscreenElement );
		} );
		try {
			if ( window.top.document !== document ) {
				window.top.document.addEventListener( 'fullscreenchange', function() {
					paintFullscreen( !! window.top.document.fullscreenElement );
				} );
			}
		} catch ( err ) {}
	}

	// Bug Report button — same decoupling pattern as Ask AI. Dispatches
	// `desktop-mode-open-bug-report`; the shell answers by opening the
	// Bug Report native window. Wired in `src/desktop.ts`.
	var bugBtn = document.getElementById( 'wp-admin-bar-desktop-bug-report' );
	if ( bugBtn ) {
		bugBtn.addEventListener( 'click', function( e ) {
			e.preventDefault();
			document.dispatchEvent( new CustomEvent( 'desktop-mode-open-bug-report' ) );
		} );
	}
} )();
