<?php
/**
 * Desktop Mode — Shell markup injection.
 *
 * Emits the `<div id="desktop-mode-shell">…</div>` skeleton at
 * `in_admin_header @ 5`. The shell floats on top of the classic
 * admin via `position: fixed`; the body class added by
 * `body-classes.php` triggers the CSS that hides classic chrome.
 *
 * Extracted from `render.php` during the architecture-0.8.1 PHP
 * slicing (phase 6).
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;


/**
 * Injects the desktop shell markup into the admin page.
 *
 * Runs on `in_admin_header` at priority 5 so the shell renders right
 * after the classic admin bar but before the page content. The shell
 * floats above the classic layout via `position: fixed` in CSS; the
 * classic sidebar, body, and footer are hidden with `body.desktop-mode-active`
 * selectors.
 *
 * @since 0.1.0
 */
function desktop_mode_render_shell() {
	if ( desktop_mode_is_chromeless_request() || ! desktop_mode_is_enabled() || desktop_mode_is_classic_request() ) {
		return;
	}

	/**
	 * Fires right before the desktop shell markup is rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_before' );

	// Stamp the user's admin color scheme onto the shell root so the
	// variables.css per-scheme selectors kick in before first paint —
	// doing this from JS on init() would show the default palette for a
	// frame before swapping.
	$scheme = sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' );
	?>
	<div id="desktop-mode-shell" class="desktop-mode-shell" data-desktop-mode-scheme="<?php echo esc_attr( $scheme ); ?>" role="application" aria-label="<?php esc_attr_e( 'Desktop shell', 'desktop-mode' ); ?>">
		<?php
		/*
		 * Wallpaper layer — sits behind both the dock and the desktop
		 * area so a translucent dock bleeds through to the wallpaper
		 * (macOS pattern). Canvas-driven wallpapers mount their own
		 * DOM into this element; static CSS wallpapers just inherit
		 * the `--desktop-mode-bg` custom property the shell sets at
		 * boot. Presentational only.
		 */
		?>
		<div id="desktop-mode-wallpaper" class="desktop-mode-wallpaper" aria-hidden="true"></div>
		<div class="desktop-mode-shell__body">
			<nav id="desktop-mode-dock" class="desktop-mode-dock" role="toolbar" aria-label="<?php esc_attr_e( 'Admin navigation', 'desktop-mode' ); ?>"></nav>
			<div id="desktop-mode-area" class="desktop-mode-area desktop-mode-area--with-dock">
				<?php
				/*
				 * Widget column — paints above the wallpaper but
				 * beneath windows (z-index 1 vs. windows at 100+).
				 * Hosted INSIDE `.desktop-mode-area` so scrolling the
				 * area (not that we do today) would scroll widgets
				 * with it, and so the dock naturally frames
				 * it. Empty on first render — JS (`WidgetLayer`)
				 * populates it on boot.
				 */
				?>
				<aside id="desktop-mode-widgets" class="desktop-mode-widgets" aria-label="<?php esc_attr_e( 'Widgets', 'desktop-mode' ); ?>"></aside>
			</div>
		</div>
	</div>
	<?php
	/**
	 * Fires right after the desktop shell markup has rendered.
	 *
	 * @since 0.1.0
	 */
	do_action( 'desktop_mode_shell_after' );
}
add_action( 'in_admin_header', 'desktop_mode_render_shell', 5 );

/**
 * Parent-shell counterpart to the chromeless bridge's stale-nonce
 * recovery (see `chromeless-bridge.php`).
 *
 * Core's `wp-auth-check.js` shows `#wp-auth-check-wrap` (the dark
 * backdrop + login iframe) when a heartbeat tick returns
 * `wp-auth-check: false`. It only dismisses the overlay when the
 * user re-authenticates inside *its own* sub-iframe — re-auth
 * happening anywhere else (a chromeless iframe inside our shell,
 * another browser tab, the classic admin in another window) leaves
 * the parent shell stuck behind an orphaned backdrop that no
 * F5 / Cmd-R can clear in practice because the script re-attaches
 * on every page load and the modal is already in DOM.
 *
 * Fix: subscribe to `heartbeat-tick` here and, on `false → true`,
 * dismiss the wrap manually — same pattern as the per-iframe
 * recovery, but the parent doesn't need to reload (it doesn't
 * hold per-page WP nonces; iframes do).
 *
 * @since 0.18.5
 */
function desktop_mode_parent_auth_check_recovery_script() {
	if (
		desktop_mode_is_chromeless_request()
		|| ! desktop_mode_is_enabled()
		|| desktop_mode_is_classic_request()
	) {
		return;
	}
	$js = <<<'JS'
//# sourceURL=desktop-mode-parent-auth-recovery.js
( function () {
	var sawLoggedOut = false;

	/* -----------------------------------------------------------------
	 * Fast-path auth-check: on 401/403 from any same-origin admin
	 * request, force `wp.heartbeat.connectNow()` instead of waiting
	 * up to 60s for the next regular tick. Same logic ships
	 * inside chromeless iframes via the bridge — this is the
	 * parent-shell counterpart for the shell's own fetches
	 * (session-save, REST registries, etc.).
	 *
	 * Debounced (5s) so a burst of failed requests doesn't fire a
	 * storm of heartbeats. URL gate skips heartbeat itself and
	 * wp-login.php so the recovery can't loop on the very request
	 * the modal authenticates with.
	 * ----------------------------------------------------------------- */
	var authCooldownUntil = 0;
	function maybeForceAuthCheck( status, url ) {
		if ( status !== 401 && status !== 403 ) {
			return;
		}
		try {
			var resolved = new URL( String( url || '' ), window.location.href );
			if ( resolved.origin !== window.location.origin ) {
				return;
			}
			if (
				resolved.pathname.indexOf( '/wp-admin/admin-ajax.php' ) !== -1
				&& /(?:^|&|\?)action=heartbeat(?:&|$)/.test( resolved.search )
			) {
				return;
			}
			if ( resolved.pathname.indexOf( '/wp-login.php' ) !== -1 ) {
				return;
			}
		} catch ( _err ) {
			return;
		}
		var now = Date.now();
		if ( now < authCooldownUntil ) {
			return;
		}
		authCooldownUntil = now + 5000;
		try {
			if (
				window.wp
				&& window.wp.heartbeat
				&& typeof window.wp.heartbeat.connectNow === 'function'
			) {
				window.wp.heartbeat.connectNow();
			}
		} catch ( _err ) { /* swallow */ }
	}

	if ( typeof window.fetch === 'function' ) {
		var origFetch = window.fetch;
		window.fetch = function ( input, init ) {
			var url = '';
			if ( typeof input === 'string' ) {
				url = input;
			} else if ( input && typeof input === 'object' ) {
				url = input.url || '';
			}
			var p;
			try {
				p = origFetch.apply( this, arguments );
			} catch ( sync ) {
				throw sync;
			}
			return p.then( function ( res ) {
				try { maybeForceAuthCheck( res.status, url ); } catch ( _e ) {}
				return res;
			} );
		};
	}
	if ( typeof XMLHttpRequest !== 'undefined' ) {
		var origOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function ( method, url ) {
			try { this.__wpdAuthUrl = url; } catch ( _e ) {}
			return origOpen.apply( this, arguments );
		};
		var origSend = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.send = function () {
			var xhr = this;
			try {
				xhr.addEventListener( 'loadend', function () {
					try { maybeForceAuthCheck( xhr.status, xhr.__wpdAuthUrl ); } catch ( _e ) {}
				} );
			} catch ( _e ) {}
			return origSend.apply( this, arguments );
		};
	}

	function dismissAuthCheckOverlay() {
		try {
			var wrap = document.getElementById( 'wp-auth-check-wrap' );
			if ( wrap && wrap.parentNode ) {
				wrap.parentNode.removeChild( wrap );
			}
			// Core toggles these to lock scrolling + signal the
			// "show" state; strip them both so the shell becomes
			// interactive again.
			document.documentElement.classList.remove( 'wp-auth-check-show' );
			document.body.classList.remove( 'modal-open' );
		} catch ( _err ) { /* DOM gone — nothing useful to do */ }
	}
	function attach() {
		if ( ! window.jQuery ) {
			return false;
		}
		window.jQuery( document ).on( 'heartbeat-tick.wpdParentAuthRecover', function ( ev, data ) {
			if ( ! data || typeof data !== 'object' || ! ( 'wp-auth-check' in data ) ) {
				return;
			}
			if ( data[ 'wp-auth-check' ] === false ) {
				sawLoggedOut = true;
				return;
			}
			if ( sawLoggedOut && data[ 'wp-auth-check' ] === true ) {
				sawLoggedOut = false;
				dismissAuthCheckOverlay();
			}
		} );
		return true;
	}
	if ( ! attach() ) {
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', attach, { once: true } );
		}
		window.addEventListener( 'load', attach, { once: true } );
	}
} )();
JS;
	wp_print_inline_script_tag( $js );
}
add_action( 'admin_footer', 'desktop_mode_parent_auth_check_recovery_script' );
