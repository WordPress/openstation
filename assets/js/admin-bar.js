( function() {

	var toggle = document.getElementById( 'wp-admin-bar-os-toggle' );
	if ( ! toggle ) {
		return;
	}
	var cfg = window.openStationAdminBar || {};
	toggle.addEventListener( 'click', function( e ) {
		e.preventDefault();

		var fallback = cfg.portalUrl;

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
