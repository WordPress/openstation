<?php
/**
 * Divi compatibility — script dependency repair.
 *
 * Divi (both the theme and the standalone Divi Builder plugin)
 * registers its block-editor bundle `et-builder-gutenberg` with
 * only `[ 'jquery', 'wp-hooks' ]` as dependencies. The bundle
 * calls `wp.data.select( 'core/editor' ).isCleanNewPost` at
 * module-load time (top-level statement, not inside a function),
 * so it needs the `core/editor` data store to be registered before
 * it executes. Without `wp-editor` (which pulls in `wp-data` and
 * registers `core/editor`) in the dep array, WordPress doesn't
 * guarantee that ordering — and when the bundle wins the race the
 * `select( ... )` call returns `undefined` and the bundle throws:
 *
 *     Uncaught TypeError: Cannot read properties of undefined
 *     (reading 'isCleanNewPost')
 *
 * The rest of Divi's React integration never mounts: no `Use Divi
 * Builder` block on new posts, no `PluginSidebar`, no toggle. To
 * the user it looks like Divi simply doesn't work inside a desktop
 * window.
 *
 * We inject the missing deps onto the existing registration so the
 * script loader prints `wp-editor`'s graph first and the bundle
 * runs against a populated `wp.data`. The shim is idempotent: if
 * Divi later ships the fix upstream (or renames the handle), this
 * becomes a no-op.
 *
 * Reported to Elegant Themes. Remove this file when Divi ships
 * the fix upstream.
 *
 * @since   0.18.x
 * @package WP_Desktop_Mode\Compat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inject `wp-data` and `wp-editor` as dependencies on Divi's
 * `et-builder-gutenberg` script registration, and (inside a
 * chromeless iframe) override Divi's `window.et_gb` assignment so
 * the bundle's webpack externals resolve to the iframe's own
 * `wp.data`.
 *
 * Two problems on the same script registration:
 *
 *  1. **Missing deps.** Divi declares only `[ jquery, wp-hooks ]`
 *     but the bundle reads from `wp.data` at module-load time. We
 *     add `wp-data` + `wp-editor` so the loader prints them first.
 *
 *  2. **`window.et_gb` resolves to the wrong frame.** Divi's
 *     bundle is webpack-built with `@wordpress/data` externalised
 *     to `window.et_gb.wp.data` — not `window.wp.data`. The inline
 *     script Divi adds (`before` the bundle) sets `window.et_gb`
 *     via this expression:
 *
 *         window.et_gb = (window.top && window.top.Cypress && …)
 *             || window.top   // ← falls through to here
 *             || window;
 *
 *     In classic admin `window.top === window`, so `et_gb =
 *     window` and `et_gb.wp.data` is the page's own `wp.data`.
 *     Inside our chromeless iframe `window.top` is the desktop
 *     shell — a different document with no `wp.data` — so
 *     `et_gb.wp.data` is undefined and the bundle throws on first
 *     access (`Cannot read properties of undefined (reading
 *     'isCleanNewPost')`). The rest of Divi's React integration
 *     never mounts: no `Use Divi Builder` block on new posts, no
 *     `PluginSidebar`, no toggle.
 *
 *     Multiple `wp_add_inline_script( …, 'before' )` calls
 *     concatenate in registration order, so appending our own
 *     `window.et_gb = window;` after Divi's lets our assignment
 *     win. Scoped to chromeless requests because Divi's original
 *     intent (use `window.top` when the parent is a Cypress
 *     harness) is sensible in other iframe contexts.
 *
 * Hooked at `enqueue_block_editor_assets` priority 999 so it runs
 * after Divi's own enqueue (priority 4) but before the script
 * loader prints `<script>` tags.
 *
 * Reported to Elegant Themes. Remove this file when Divi ships
 * the fix upstream.
 *
 * @since 0.18.x
 *
 * @return void
 */
function desktop_mode_compat_divi_fix_gutenberg_deps() {
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

	if ( desktop_mode_is_chromeless_request() ) {
		wp_add_inline_script(
			'et-builder-gutenberg',
			'window.et_gb = window;',
			'before'
		);
	}
}
add_action( 'enqueue_block_editor_assets', 'desktop_mode_compat_divi_fix_gutenberg_deps', 999 );

/**
 * Signal Divi's Visual Builder frame-helpers that the iframe context
 * is "top-level-equivalent" so its `top_window` export resolves to
 * the iframe's own `window` instead of the desktop shell.
 *
 * The VB front-end bundle includes a helper module
 * (`frontend-builder/build/frame-helpers.js`) whose `top_window`
 * resolver does roughly this at load time:
 *
 *     try { u = !!window.top.document && window.top; }
 *     catch ( _ ) { u = false; }
 *     if ( u && u.__Cypress__ ) {
 *         top_window = ( window.parent === u ) ? window : window.parent;
 *         is_iframe  = ( window.parent !== u );
 *     } else if ( u ) {
 *         top_window = u;                  // ← falls through to here
 *         is_iframe  = ( u !== window.self );
 *     }
 *
 * Inside a chromeless iframe `window.top` is the desktop shell, so
 * the `else if ( u )` branch fires: `top_window = window.top` (the
 * shell), `is_iframe = true`. The rest of Divi's VB then routes
 * REST nonces, builder state, and DOM ops through a window that
 * has none of those things — VB sits permanently on its
 * "et-fb-page-preloading" loader because the state it's waiting
 * for will never arrive.
 *
 * Setting `__Cypress__` on `window.top` (our shell) makes Divi take
 * the Cypress branch instead. Since we're a single-level iframe
 * (`window.parent === window.top`), that branch resolves
 * `top_window = window` (the iframe itself), `is_iframe = false`
 * — exactly the classic-admin behavior. The flag costs nothing
 * outside Divi (no other code in the WP stack reads `__Cypress__`)
 * and is idempotent (we OR with the existing value).
 *
 * Scope: only when the current user has desktop mode enabled AND
 * the rendered document is loaded inside an iframe (`window.top !==
 * window`). The inline script is a few-byte no-op everywhere else.
 * Front-end only — admin pages use `et_gb` (see above) and route
 * through a different compat path.
 *
 * Reported to Elegant Themes. Remove this hook when Divi makes
 * `top_window` iframe-aware upstream.
 *
 * @since 0.18.x
 *
 * @return void
 */
function desktop_mode_compat_divi_vb_iframe_signal() {
	if ( is_admin() ) {
		return;
	}
	if ( ! desktop_mode_is_enabled() ) {
		return;
	}
	// `app_window=1` flags the inner VB iframe Divi spawns inside the
	// `/?p=N&et_fb=1` page. The outer ("VB-top") frame is what hosts
	// the visible preloader the user sees; the inner is where Divi
	// mounts its React app. We only need the preloader bridge on the
	// VB-top — the inner frame's `__Cypress__` signal is enough.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only flag set by Divi itself when constructing the inner iframe.
	$is_app_frame = isset( $_GET['app_window'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['app_window'] ) );
	?>
<script id="desktop-mode-compat-divi-vb">
( function () {
	if ( window.top === window ) { return; }
	<?php if ( $is_app_frame ) : ?>
	// Inside Divi's own inner builder iframe. We only want to
	// taint window.top with the Cypress flag when DM is wrapping
	// the whole stack (3 frames deep: shell, chromeless,
	// builder). At top-level VB flow (2 frames deep: builder-top,
	// builder) window.parent === window.top AND window.top is
	// the actual builder-top frame. Tainting it there would
	// mistrain Divi's frame-helpers: it would hit the Cypress
	// branch, see parent equals top, and resolve top_window =
	// window (the inner self) instead of the parent. Divi then
	// can't communicate inner-to-top and the preloader sits up
	// forever. Bail before doing anything in this case.
	if ( window.parent === window.top ) { return; }
	<?php endif; ?>
	try { window.top.__Cypress__ = window.top.__Cypress__ || true; } catch ( e ) {}
	<?php if ( ! $is_app_frame ) : ?>
	/*
	 * VB-top preloader bridge.
	 *
	 * Divi's `visual-builder/build/root.js` clears the preloader by
	 * removing the `et-fb-page-preloading` class from `#et-fb-app`
	 * and `#et-fb-app-body-root` in two places: its own document AND
	 * `window.top.document`. The intent is "and also clear it on the
	 * outer VB-top frame I'm rendered into." In classic admin
	 * `window.top` IS the VB-top, so that works.
	 *
	 * In a Desktop Mode chromeless iframe, the nesting is one deeper
	 * — the inner React app's `window.top` is the desktop shell,
	 * which has no Divi elements. Root.js cleans its own doc and
	 * no-ops on the shell, leaving THIS document's preloader stuck
	 * forever.
	 *
	 * Mirror the removal here: once the inner app-frame's
	 * `#et-fb-app` loses the preloading class (the canonical signal
	 * that Divi finished mounting), strip it from this document's
	 * `#et-fb-app` / `#et-fb-app-body-root`. Same-origin gives us
	 * direct access to the child iframe's document, so a
	 * MutationObserver on the child suffices. A 30s watchdog
	 * timeout strips the preloader even if the observer never fires
	 * (e.g. Divi's React errors out silently inside the inner
	 * frame) — better a broken builder visible than an invisible
	 * spinner forever.
	 */
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
add_action( 'wp_head', 'desktop_mode_compat_divi_vb_iframe_signal', 1 );

/**
 * Iframe-side: hijack clicks on Divi's "Use Divi Builder" /
 * "Edit With The Divi Builder" buttons and links, and hand the
 * navigation off to the parent shell so the user can opt into a
 * top-level browser tab for the editing session.
 *
 * Why we hijack instead of letting Divi navigate:
 *
 * Divi's Visual Builder fundamentally doesn't behave well inside
 * Desktop Mode's nested iframe chain (shell -> chromeless iframe
 * -> Divi's inner app-frame). Earlier attempts to transparently
 * eject mid-navigation hit a chain of subtle race conditions —
 * Divi captures `Location.prototype` references early, makes its
 * REST save through a path our `fetch`/`XHR` wraps don't reach,
 * and the page-leave tears down our console before any diagnostic
 * we add survives the navigation. The honest fix is to ask the
 * user, explicitly, whether they want to leave Desktop Mode for
 * this edit session.
 *
 * Detection is by visible text content on the clicked element
 * rather than by selector — Divi changes the button class across
 * versions but the user-facing label has been stable for years.
 * We match: "Use Divi Builder", "Use The Divi Builder", "Edit
 * With The Divi Builder", "Edit With Divi" (case-insensitive,
 * trimmed). The "Use Default Editor" sibling button is not in the
 * match set, so users can still keep editing in Gutenberg.
 *
 * Scope: chromeless requests only, and only when Divi is active.
 * The handler also walks every same-origin nested iframe so the
 * Gutenberg editor canvas (when Gutenberg keeps it for non-Divi
 * blocks) is covered.
 *
 * @since 0.18.x
 *
 * @return void
 */
function desktop_mode_compat_divi_eject_iframe_patch() {
	if ( ! desktop_mode_is_chromeless_request() ) {
		return;
	}
	if ( ! desktop_mode_compat_divi_is_active() ) {
		return;
	}
	?>
<script id="desktop-mode-compat-divi-vb-handoff">
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
				{ type: 'desktop-mode-divi-vb-handoff', url: String( currentUrl ) },
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
			if ( doc.__desktopModeDiviHandoffAttached ) { return; }
			doc.__desktopModeDiviHandoffAttached = true;
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
			if ( iframe.__desktopModeDiviHandoffHooked ) { return; }
			iframe.__desktopModeDiviHandoffHooked = true;
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
add_action( 'admin_head', 'desktop_mode_compat_divi_eject_iframe_patch', 0 );
add_action( 'admin_footer', 'desktop_mode_compat_divi_eject_iframe_patch', 999 );

/**
 * Parent-shell side: receive the handoff message, ask the user
 * to confirm via `wp.desktop.confirm()`, and on accept navigate
 * `window.top.location.href` to the iframe's current URL — which
 * is the post-edit page. The user lands at top level on the same
 * post they were editing, clicks "Use Divi Builder" again with a
 * single browser tab, and Divi runs in its native single-frame
 * environment.
 *
 * Two clicks total to enter VB, but each is deliberate. No
 * detection magic, no race conditions, no transparent eject.
 *
 * Same-origin guards: the message event must originate from our
 * own origin AND the URL we navigate to must parse back to the
 * same origin. Foreign frames can't trigger the handoff.
 *
 * @since 0.18.x
 *
 * @return void
 */
function desktop_mode_compat_divi_eject_parent_listener() {
	if ( ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( desktop_mode_is_chromeless_request() || desktop_mode_is_classic_request() ) {
		return;
	}
	if ( ! desktop_mode_compat_divi_is_active() ) {
		return;
	}
	?>
<script id="desktop-mode-compat-divi-vb-handoff-parent">
( function () {
	// Reshape the iframe's URL into a top-level classic-admin URL.
	// The iframe carries `desktop_mode_chromeless=1`, which would
	// keep the chromeless render alive even at top level — leaving
	// the user on what looks like the same headless Gutenberg they
	// already had inside the window. We want a normal wp-admin page
	// instead, so strip that flag and add `desktop_mode_classic=1`
	// so our own `desktop_mode_redirect_plain_admin_to_portal()` in
	// `includes/portal.php` skips its portal-bounce for this load.
	function handoffUrl( raw ) {
		try {
			var parsed = new URL( String( raw || '' ), window.location.href );
			if ( parsed.origin !== window.location.origin ) { return null; }
			parsed.searchParams.delete( 'desktop_mode_chromeless' );
			parsed.searchParams.set( 'desktop_mode_classic', '1' );
			return parsed.toString();
		} catch ( e ) { return null; }
	}
	window.addEventListener( 'message', function ( ev ) {
		if ( ev.origin !== window.location.origin ) { return; }
		if ( ! ev.data || ev.data.type !== 'desktop-mode-divi-vb-handoff' ) { return; }
		var url = handoffUrl( ev.data.url );
		if ( ! url ) { return; }
		var promptUser;
		if ( window.wp && window.wp.desktop && typeof window.wp.desktop.confirm === 'function' ) {
			promptUser = window.wp.desktop.confirm( {
				title: 'Divi needs its own browser tab',
				message: 'Divi\u2019s Visual Builder cannot run inside a Desktop Mode window \u2014 it needs the full browser tab to render and save correctly. There is no workaround on our side; Divi simply doesn\u2019t support being nested.',
				confirmLabel: 'Open Divi in this tab',
				hideCancel: true,
				dismissable: true,
			} );
		} else {
			promptUser = Promise.resolve(
				window.confirm(
					'Divi cannot run inside Desktop Mode. Click OK to open Divi in this browser tab (Desktop Mode will resume on your next wp-admin visit).'
				)
			);
		}
		Promise.resolve( promptUser ).then( function ( ok ) {
			if ( ok ) { window.top.location.href = url; }
		} );
	} );
} )();
</script>
	<?php
}
add_action( 'admin_footer', 'desktop_mode_compat_divi_eject_parent_listener', 1 );


/**
 * Detect whether Divi (theme or standalone Divi Builder plugin)
 * is active. Used to gate both the iframe-side patcher and the
 * parent-side listener — both no-ops on non-Divi sites.
 *
 * @since 0.18.x
 *
 * @return bool True when the Divi theme is active OR the Divi
 *              Builder plugin is active.
 */
function desktop_mode_compat_divi_is_active() {
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
