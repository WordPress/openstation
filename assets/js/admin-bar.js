( function() {
	// The "Switch to OpenStation" node only renders in classic admin —
	// PHP skips it once the user is viewing the shell, where the
	// "Exit OpenStation" dock tile is the way back out. So this handler
	// only ever enables.
	var toggle = document.getElementById( 'wp-admin-bar-os-toggle' );
	if ( ! toggle ) {
		return;
	}
	var cfg = window.openStationAdminBar || {};
	toggle.addEventListener( 'click', function( e ) {
		e.preventDefault();
		// Fallback target if the server response is missing a `redirect`
		// field (shouldn't happen, but keep the click functional either
		// way): the portal URL, so the shell takes over.
		var fallback = cfg.portalUrl;
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
		body.set( 'enabled', '1' );
		// Tells the handler which admin this click came from; see the
		// note in `includes/ajax.php`.
		if ( cfg.network ) {
			body.set( 'network', '1' );
		}
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
} )();
