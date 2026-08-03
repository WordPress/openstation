( function() {
	var toggle = document.getElementById( 'wp-admin-bar-os-toggle' );
	if ( ! toggle ) {
		return;
	}
	var cfg = window.openStationAdminBar || {};
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
		body.set( 'action', 'save-openstation' );
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
			'#wp-admin-bar-desktop-layout-snap .os-layout-checkbox'
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
		return window.wp && window.wp.os && window.wp.os.windowManager;
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

		var snapItem = t.closest( '.os-layout-snap' );
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

		var actionLink = t.closest( '.os-layout-action > .ab-item, .os-layout-action' );
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
			// via wp.hooks.addAction( 'os.arrange.custom-action', ... ).
			var customId = id.id.replace( 'wp-admin-bar-desktop-layout-custom-', '' );
			var hooks = window.wp && window.wp.hooks;
			if ( hooks && typeof hooks.doAction === 'function' ) {
				hooks.doAction( 'os.arrange.custom-action', { id: customId } );
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
		// WP renders admin-bar items as `<a href="#">`, which HTML5
		// marks implicitly draggable. In browser fullscreen the button
		// sits at top:0 where cursor reveals (menu bar, exit
		// affordance) produce enough pointer jitter between mousedown
		// and mouseup that the browser commits to a native link-drag
		// instead of a click — the handler never runs and the user
		// sees a ghost flicker. Opt the element out of native drag so
		// the click always lands.
		if ( fsLink ) {
			fsLink.setAttribute( 'draggable', 'false' );
		}
		function paintFullscreen( on ) {
			// Body class drives the CSS that hides admin-bar items
			// which sit too close to the screen-corner reveal hot zones
			// in browser fullscreen — the OS / browser intercept clicks
			// in those bands. Hiding them shifts the Fullscreen button
			// further from the right edge so its own click lands.
			document.body.classList.toggle( 'os-browser-fs', !! on );
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
	// `os-open-bug-report`; the shell answers by opening the
	// Bug Report native window. Wired in `src/desktop.ts`.
	var bugBtn = document.getElementById( 'wp-admin-bar-desktop-bug-report' );
	if ( bugBtn ) {
		bugBtn.addEventListener( 'click', function( e ) {
			e.preventDefault();
			document.dispatchEvent( new CustomEvent( 'os-open-bug-report' ) );
		} );
	}

	// Keyboard Shortcuts button — toggles a floating popover anchored
	// under the button, styled like the Arrange submenu. Content is
	// passed in via `cfg.shortcuts` (translated server-side in PHP).
	wireShortcutsPopover( document.getElementById( 'wp-admin-bar-desktop-help' ), cfg.shortcuts );

	// Custom tooltips for the icon-only admin-bar buttons. The native
	// `title` attribute renders a slow, OS-styled tooltip that conflicts
	// with our dock-style custom tooltip; we swap each `title` to
	// `data-desktop-tooltip` + `aria-label` so screen readers still see
	// the label but the visual tooltip is fully ours.
	wireTooltipsFor( [
		'wp-admin-bar-desktop-fullscreen',
		'wp-admin-bar-desktop-help',
		'wp-admin-bar-desktop-bug-report',
		'wp-admin-bar-desktop-layout-menu',
	] );

	/**
	 * Re-anchors a native `title` attribute to a `data-desktop-tooltip`
	 * data attribute on the same node, plus mirrors it to `aria-label`
	 * so assistive tech keeps the description. Pure-CSS tooltip then
	 * renders from the data attribute via the `[data-desktop-tooltip]
	 * .ab-item::after` rule in admin-bar.php.
	 */
	function wireTooltipsFor( ids ) {
		for ( var i = 0; i < ids.length; i++ ) {
			var node = document.getElementById( ids[ i ] );
			if ( ! node ) continue;
			var link = node.querySelector( '.ab-item' );
			if ( ! link ) continue;
			var label = link.getAttribute( 'title' );
			if ( ! label ) continue;
			link.removeAttribute( 'title' );
			link.setAttribute( 'data-desktop-tooltip', label );
			if ( ! link.hasAttribute( 'aria-label' ) ) {
				link.setAttribute( 'aria-label', label );
			}
		}
	}

	function wireShortcutsPopover( btn, data ) {
		if ( ! btn || ! data ) {
			return;
		}
		var anchor = btn.querySelector( '.ab-item' ) || btn;
		var popover = buildShortcutsPopover( data );
		btn.appendChild( popover );

		var isOpen = false;
		function open() {
			if ( isOpen ) return;
			isOpen = true;
			popover.classList.add( 'is-open' );
			btn.classList.add( 'is-open' );
			document.addEventListener( 'mousedown', onDocMouseDown, true );
			document.addEventListener( 'keydown', onKey, true );
		}
		function close() {
			if ( ! isOpen ) return;
			isOpen = false;
			popover.classList.remove( 'is-open' );
			btn.classList.remove( 'is-open' );
			document.removeEventListener( 'mousedown', onDocMouseDown, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
		function onDocMouseDown( e ) {
			if ( btn.contains( e.target ) ) return;
			close();
		}
		function onKey( e ) {
			if ( e.key === 'Escape' ) {
				e.stopPropagation();
				close();
			}
		}

		anchor.addEventListener( 'click', function( e ) {
			e.preventDefault();
			e.stopPropagation();
			isOpen ? close() : open();
		} );
		// Swallow stray clicks inside the popover so they don't bubble
		// up to admin-bar handlers (and so the popover stays open while
		// the user reads it).
		popover.addEventListener( 'mousedown', function( e ) {
			e.stopPropagation();
		} );
		popover.addEventListener( 'click', function( e ) {
			e.stopPropagation();
		} );
	}

	function buildShortcutsPopover( data ) {
		var root = document.createElement( 'div' );
		root.className = 'os-shortcuts-popover';
		root.setAttribute( 'role', 'dialog' );
		if ( data.title ) {
			root.setAttribute( 'aria-label', data.title );
		}

		if ( data.contextual ) {
			root.appendChild( buildShortcutsTable( data.contextual ) );
		}
		if ( data.general ) {
			root.appendChild( buildShortcutsList( data.general ) );
		}
		return root;
	}

	function buildShortcutsTable( section ) {
		var wrap = document.createElement( 'section' );
		wrap.className = 'os-shortcuts-popover__section';

		if ( section.heading ) {
			var h = document.createElement( 'h3' );
			h.className = 'os-shortcuts-popover__heading';
			h.textContent = section.heading;
			wrap.appendChild( h );
		}

		var table = document.createElement( 'table' );
		table.className = 'os-shortcuts-popover__table';

		var thead = document.createElement( 'thead' );
		var headRow = document.createElement( 'tr' );
		[ 'key', 'outside', 'inside', 'showDesktop' ].forEach( function( col ) {
			var th = document.createElement( 'th' );
			th.scope = 'col';
			th.textContent = section.headers && section.headers[ col ] ? section.headers[ col ] : '';
			headRow.appendChild( th );
		} );
		thead.appendChild( headRow );
		table.appendChild( thead );

		var tbody = document.createElement( 'tbody' );
		( section.rows || [] ).forEach( function( row ) {
			var tr = document.createElement( 'tr' );

			var keyCell = document.createElement( 'td' );
			keyCell.className = 'os-shortcuts-popover__key-cell';
			keyCell.appendChild( renderKeys( row.keys || [] ) );
			if ( row.note ) {
				var note = document.createElement( 'span' );
				note.className = 'os-shortcuts-popover__note';
				note.textContent = ' ' + row.note;
				keyCell.appendChild( note );
			}
			tr.appendChild( keyCell );

			[ 'outside', 'inside', 'showDesktop' ].forEach( function( col ) {
				var td = document.createElement( 'td' );
				td.textContent = row[ col ] || '—';
				tr.appendChild( td );
			} );

			tbody.appendChild( tr );
		} );
		table.appendChild( tbody );
		wrap.appendChild( table );

		return wrap;
	}

	function buildShortcutsList( section ) {
		var wrap = document.createElement( 'section' );
		wrap.className = 'os-shortcuts-popover__section';

		if ( section.heading ) {
			var h = document.createElement( 'h3' );
			h.className = 'os-shortcuts-popover__heading';
			h.textContent = section.heading;
			wrap.appendChild( h );
		}

		var list = document.createElement( 'ul' );
		list.className = 'os-shortcuts-popover__list';
		( section.items || [] ).forEach( function( item ) {
			var li = document.createElement( 'li' );
			li.className = 'os-shortcuts-popover__item';
			li.appendChild( renderKeys( item.keys || [] ) );
			var desc = document.createElement( 'span' );
			desc.className = 'os-shortcuts-popover__description';
			desc.textContent = item.description || '';
			li.appendChild( desc );
			list.appendChild( li );
		} );
		wrap.appendChild( list );

		return wrap;
	}

	function renderKeys( keys ) {
		var span = document.createElement( 'span' );
		span.className = 'os-shortcuts-popover__keys';
		keys.forEach( function( key, idx ) {
			if ( idx > 0 ) {
				var plus = document.createElement( 'span' );
				plus.className = 'os-shortcuts-popover__plus';
				plus.textContent = '+';
				plus.setAttribute( 'aria-hidden', 'true' );
				span.appendChild( plus );
			}
			var kbd = document.createElement( 'kbd' );
			kbd.className = 'os-shortcuts-popover__kbd';
			kbd.textContent = key;
			span.appendChild( kbd );
		} );
		return span;
	}
} )();
