<?php

defined( 'ABSPATH' ) || exit;

function openstation_compat_divi_fix_gutenberg_deps() {
	global $wp_scripts;

	if ( ! ( $wp_scripts instanceof WP_Scripts ) ) {
		return;
	}

	if ( ! isset( $wp_scripts->registered['et-builder-gutenberg'] ) ) {
		return;
	}

	$registration = $wp_scripts->registered['et-builder-gutenberg'];
	$existing     = (array) $registration->deps;

	foreach ( array( 'wp-data', 'wp-editor' ) as $dep ) {
		if ( ! in_array( $dep, $existing, true ) ) {
			$registration->deps[] = $dep;
		}
	}

	if ( openstation_is_chromeless_request() ) {
		wp_add_inline_script(
			'et-builder-gutenberg',
			'window.et_gb = window;',
			'before'
		);
	}
}
add_action( 'enqueue_block_editor_assets', 'openstation_compat_divi_fix_gutenberg_deps', 999 );

function openstation_compat_divi_vb_iframe_signal() {
	if ( is_admin() ) {
		return;
	}
	if ( ! openstation_is_enabled() ) {
		return;
	}

	if ( ! openstation_compat_divi_is_active() ) {
		return;
	}

	$is_app_frame = isset( $_GET['app_window'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['app_window'] ) );
	?>
<script id="os-compat-divi-vb">
( function () {
	if ( window.top === window ) { return; }
	<?php if ( $is_app_frame ) : ?>

	if ( window.parent === window.top ) { return; }
	<?php endif; ?>
	try { window.top.__Cypress__ = window.top.__Cypress__ || true; } catch ( e ) {}
	<?php if ( ! $is_app_frame ) : ?>

	function clearLocalPreloader() {
		[ 'et-fb-app', 'et-fb-app-body-root' ].forEach( function ( id ) {
			var el = document.getElementById( id );
			if ( el ) { el.classList.remove( 'et-fb-page-preloading' ); }
		} );
	}
	function bridgeAppFrame( appFrame ) {
		var idoc = null;
		try { idoc = appFrame.contentDocument; } catch ( e ) {}
		if ( ! idoc ) {
			appFrame.addEventListener( 'load', function () { bridgeAppFrame( appFrame ); }, { once: true } );
			return;
		}
		function check() {
			var inner = idoc.getElementById( 'et-fb-app' ) || idoc.getElementById( 'et-fb-app-body-root' );
			if ( inner && ! inner.classList.contains( 'et-fb-page-preloading' ) ) {
				clearLocalPreloader();
				return true;
			}
			return false;
		}
		if ( check() ) { return; }
		var mo = new MutationObserver( function () { if ( check() ) { mo.disconnect(); } } );
		mo.observe( idoc.documentElement, { attributes: true, subtree: true, attributeFilter: [ 'class' ] } );
		setTimeout( function () { mo.disconnect(); clearLocalPreloader(); }, 30000 );
	}
	function hunt() {
		var f = document.getElementById( 'et-vb-app-frame' );
		if ( f ) { bridgeAppFrame( f ); return; }
		var bodyMo = new MutationObserver( function () {
			var found = document.getElementById( 'et-vb-app-frame' );
			if ( found ) { bodyMo.disconnect(); bridgeAppFrame( found ); }
		} );
		bodyMo.observe( document.documentElement, { childList: true, subtree: true } );
	}
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', hunt );
	} else {
		hunt();
	}
	<?php endif; ?>
} )();
</script>
	<?php
}
add_action( 'wp_head', 'openstation_compat_divi_vb_iframe_signal', 1 );

function openstation_compat_divi_eject_iframe_patch() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}
	if ( ! openstation_compat_divi_is_active() ) {
		return;
	}
	?>
<script id="os-compat-divi-vb-handoff">
( function () {
	var BTN_TEXTS = [
		'use divi builder',
		'use the divi builder',
		'edit with the divi builder',
		'edit with divi',
	];
	function matchesDiviVbButton( el ) {
		if ( ! el || ! el.tagName ) { return false; }
		var tag = el.tagName;
		if ( tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT' && tag !== 'SPAN' ) { return false; }
		var raw = ( el.textContent || el.value || el.getAttribute( 'aria-label' ) || '' );
		var text = String( raw ).replace( /\s+/g, ' ' ).trim().toLowerCase();
		return BTN_TEXTS.indexOf( text ) !== -1;
	}
	function postHandoff( currentUrl ) {
		try {
			window.top.postMessage(
				{ type: 'os-divi-vb-handoff', url: String( currentUrl ) },
				window.location.origin
			);
		} catch ( e ) {}
	}
	function onClick( e ) {
		if ( e.defaultPrevented ) { return; }
		if ( e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) { return; }
		var el = e.target;
		var match = null;
		while ( el && el.nodeType === 1 ) {
			if ( matchesDiviVbButton( el ) ) { match = el; break; }
			el = el.parentNode;
		}
		if ( ! match ) { return; }
		e.preventDefault();
		e.stopPropagation();
		if ( typeof e.stopImmediatePropagation === 'function' ) {
			e.stopImmediatePropagation();
		}
		postHandoff( window.location.href );
	}
	function attachClickListener( doc ) {
		try {
			if ( doc.__openStationDiviHandoffAttached ) { return; }
			doc.__openStationDiviHandoffAttached = true;
			doc.addEventListener( 'click', onClick, true );
		} catch ( e ) {}
	}
	function walkAndAttach( root ) {
		attachClickListener( root );
		var frames;
		try { frames = root.querySelectorAll( 'iframe' ); }
		catch ( e ) { return; }
		frames.forEach( function ( iframe ) {
			try {
				if ( iframe.contentDocument ) { walkAndAttach( iframe.contentDocument ); }
			} catch ( e ) {}
			if ( iframe.__openStationDiviHandoffHooked ) { return; }
			iframe.__openStationDiviHandoffHooked = true;
			iframe.addEventListener( 'load', function () {
				try { if ( iframe.contentDocument ) { walkAndAttach( iframe.contentDocument ); } } catch ( e ) {}
			} );
		} );
	}
	function bootstrap() {
		walkAndAttach( document );
		new MutationObserver( function () { walkAndAttach( document ); } )
			.observe( document.documentElement, { subtree: true, childList: true } );
	}
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', bootstrap );
	} else {
		bootstrap();
	}
} )();
</script>
	<?php
}
add_action( 'admin_head', 'openstation_compat_divi_eject_iframe_patch', 0 );

function openstation_compat_divi_eject_parent_listener() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}
	if ( ! openstation_compat_divi_is_active() ) {
		return;
	}
	?>
<script id="os-compat-divi-vb-handoff-parent">
( function () {

	function handoffUrl( raw ) {
		try {
			var parsed = new URL( String( raw || '' ), window.location.href );
			if ( parsed.origin !== window.location.origin ) { return null; }
			parsed.searchParams.delete( 'openstation_chromeless' );
			parsed.searchParams.set( 'desktop_mode_classic', '1' );
			return parsed.toString();
		} catch ( e ) { return null; }
	}
	window.addEventListener( 'message', function ( ev ) {
		if ( ev.origin !== window.location.origin ) { return; }
		if ( ! ev.data || ev.data.type !== 'os-divi-vb-handoff' ) { return; }
		var url = handoffUrl( ev.data.url );
		if ( ! url ) { return; }
		var promptUser;
		if ( window.wp && window.wp.os && typeof window.wp.os.confirm === 'function' ) {
			promptUser = window.wp.os.confirm( {
				title: 'Divi needs its own browser tab',
				message: 'Divi\u2019s Visual Builder cannot run inside a OpenStation window \u2014 it needs the full browser tab to render and save correctly. There is no workaround on our side; Divi simply doesn\u2019t support being nested.',
				confirmLabel: 'Open Divi in this tab',
				hideCancel: true,
				dismissable: true,
			} );
		} else {

			promptUser = Promise.resolve( false );
		}
		Promise.resolve( promptUser ).then( function ( ok ) {
			if ( ok ) { window.top.location.href = url; }
		} );
	} );
} )();
</script>
	<?php
}
add_action( 'admin_footer', 'openstation_compat_divi_eject_parent_listener', 1 );

function openstation_compat_divi_is_active() {
	$theme = wp_get_theme();
	if ( $theme instanceof WP_Theme ) {
		$name     = (string) $theme->get( 'Name' );
		$template = (string) $theme->get_template();
		if ( 'Divi' === $name || 'Divi' === $template ) {
			return true;
		}
	}
	if ( function_exists( 'is_plugin_active' ) && is_plugin_active( 'divi-builder/divi-builder.php' ) ) {
		return true;
	}
	return false;
}
