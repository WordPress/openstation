<?php

defined( 'ABSPATH' ) || exit;

function openstation_classic_link_interceptor() {
	if ( ! openstation_is_classic_request() ) {
		return;
	}

	$flag_literal = wp_json_encode( OPENSTATION_CLASSIC_FLAG );

	$js = "
( function () {
	var FLAG = {$flag_literal};

	function rewriteAdminUrl( href, base ) {
		if ( ! href || href.charAt( 0 ) === '#' ) {
			return null;
		}
		if ( /^(mailto:|tel:|javascript:|data:)/i.test( href ) ) {
			return null;
		}
		var url;
		try {
			url = new URL( href, base );
		} catch ( err ) {
			return null;
		}
		if ( url.origin !== window.location.origin ) {
			return null;
		}
		if ( url.pathname.indexOf( '/wp-admin/' ) === -1 ) {
			return null;
		}
		if ( url.searchParams.has( FLAG ) ) {
			return null;
		}
		url.searchParams.set( FLAG, '1' );
		return url.toString();
	}

	document.addEventListener( 'click', function ( e ) {
		if ( e.defaultPrevented ) {
			return;
		}
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}
		var link = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
		if ( ! link ) {
			return;
		}
		if ( link.target && link.target !== '' && link.target !== '_self' ) {
			return;
		}
		if ( link.hasAttribute( 'download' ) ) {
			return;
		}
		var rewritten = rewriteAdminUrl( link.getAttribute( 'href' ), window.location.href );
		if ( rewritten ) {
			link.setAttribute( 'href', rewritten );
		}
	}, true );

	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || form.tagName !== 'FORM' ) {
			return;
		}
		var action = form.getAttribute( 'action' );
		var rewritten = rewriteAdminUrl( action || window.location.href, window.location.href );
		if ( rewritten ) {
			form.setAttribute( 'action', rewritten );
		}
	}, true );


	[ 'pushState', 'replaceState' ].forEach( function ( method ) {
		var original = window.history[ method ];
		if ( typeof original !== 'function' ) {
			return;
		}
		window.history[ method ] = function ( state, title, url ) {
			var rewritten = null;
			if ( typeof url === 'string' || url instanceof URL ) {
				rewritten = rewriteAdminUrl( String( url ), window.location.href );
			}
			return original.call( window.history, state, title, rewritten || url );
		};
	} );
} )();
";

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'openstation_classic_link_interceptor' );
