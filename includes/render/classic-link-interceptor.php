<?php
/**
 * OpenStation — Classic-tab link interceptor.
 *
 * Runs only inside detached "classic override" tabs (the ones
 * opened by the Detach window-chrome action with
 * `?desktop_mode_classic=1`). Re-stamps the flag onto every
 * same-origin `/wp-admin/` `<a href>` and `<form action>` so
 * navigations within the tab stay classic — server-side
 * redirects are handled by
 * `openstation_classic_preserve_redirect()` in routing.php.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Outputs a same-origin admin link/form rewriter for detached ("classic
 * override") tabs.
 *
 * Without this, the first navigation after a detach drops the
 * `desktop_mode_classic=1` flag and the next page falls back to the
 * desktop shell — because the user meta is still `'1'` and the
 * `admin_init` portal redirect kicks in. The JS here re-stamps the flag
 * on every same-origin `/wp-admin/` `<a href>` and `<form action>` so
 * navigations within the tab stay classic. Server-side redirects are
 * covered by {@see openstation_classic_preserve_redirect}.
 *
 * Narrowly scoped: only runs when the current request itself carries
 * the classic flag. Skips modifier-clicks (cmd/ctrl/shift/alt), targets
 * other than `_self`, downloads, anchors, and non-http schemes so we
 * don't break "open in new tab" or mailto links.
 */
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
} )();
";

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'openstation_classic_link_interceptor' );
