<?php
/**
 * Desktop Mode — Body class tagging.
 *
 * Adds `desktop-mode-active` / `desktop-mode-chromeless` to the
 * admin body class so the shell CSS and the chromeless overrides
 * stylesheet can key off it, plus `desktop-mode-admin-bar-<mode>` for
 * the admin-bar presentation preference. Per-request
 * `?desktop_mode_classic=1` suppresses them for the detached-tab
 * workflow.
 *
 * Extracted from the 2,525-LOC `render.php` during the
 * architecture-0.8.1 PHP slicing (phase 6).
 *
 * @package Desktop_Mode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds body classes for desktop mode and chromeless iframes.
 *
 * The classes anchor all CSS in the shell and chromeless overrides
 * stylesheets — `.desktop-mode-active` hides classic chrome and reveals
 * the shell, `.desktop-mode-chromeless` reshapes the page inside iframes.
 *
 * @param string $classes Space-separated CSS class string.
 * @return string
 */
function desktop_mode_admin_body_classes( $classes ) {
	if ( desktop_mode_is_chromeless_request() ) {
		return ltrim( $classes . ' desktop-mode-chromeless' );
	}

	// Per-request classic override: don't tag the body as desktop-active so
	// the classic chrome isn't hidden by CSS for this one tab.
	if ( desktop_mode_is_classic_request() ) {
		return $classes;
	}

	if ( desktop_mode_is_enabled() ) {
		return ltrim(
			$classes . ' desktop-mode-active desktop-mode-admin-bar-'
				. desktop_mode_get_admin_bar_mode()
		);
	}

	return $classes;
}
add_filter( 'admin_body_class', 'desktop_mode_admin_body_classes' );

/**
 * Resolves the current user's admin-bar presentation mode.
 *
 * Emitted as a `desktop-mode-admin-bar-<mode>` body class so the very
 * first paint already has the right chrome — the shell's JS apply pass
 * re-writes the same class on every settings change, but it runs after
 * the admin bar has painted, which would flash a bar the user asked to
 * hide.
 *
 * @return string One of `static`, `dynamic`, `hidden`.
 */
function desktop_mode_get_admin_bar_mode() {
	$settings = desktop_mode_get_os_settings( get_current_user_id() );
	$mode     = isset( $settings['adminBarMode'] ) ? (string) $settings['adminBarMode'] : 'static';

	/**
	 * Filters the admin-bar presentation mode for the current request.
	 *
	 * Lets a plugin pin the mode regardless of the user's own OS
	 * Settings pick — forcing `static` for users who would otherwise
	 * lose their way out of the shell, say, or `hidden` on a kiosk.
	 *
	 * @param string $mode One of `static`, `dynamic`, `hidden`.
	 */
	$mode = apply_filters( 'desktop_mode_admin_bar_mode', $mode );

	// Fails closed, and deliberately without a `(string)` cast: a
	// filter returning an array would make that cast emit an
	// "Array to string conversion" warning on the way to failing
	// anyway. `static` is the safe landing — it is the only mode
	// that can't hide the user's way out of the shell.
	return is_string( $mode ) && in_array( $mode, DESKTOP_MODE_OS_SETTINGS_ADMIN_BAR_MODES, true )
		? $mode
		: 'static';
}
