<?php
/**
 * Desktop Mode — Body class tagging.
 *
 * Adds `desktop-mode-active` / `desktop-mode-chromeless` to the
 * admin body class so the shell CSS and the chromeless overrides
 * stylesheet can key off it. Per-request `?desktop_mode_classic=1`
 * suppresses both classes for the detached-tab workflow.
 *
 * Extracted from the 2,525-LOC `render.php` during the
 * architecture-0.8.1 PHP slicing (phase 6).
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds body classes for desktop mode and chromeless iframes.
 *
 * The classes anchor all CSS in the shell and chromeless overrides
 * stylesheets — `.desktop-mode-active` hides classic chrome and reveals
 * the shell, `.desktop-mode-chromeless` reshapes the page inside iframes.
 *
 * @since 0.1.0
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
		$classes = ltrim( $classes . ' desktop-mode-active' );

		// Initial state for the "Ask AI" admin-bar button. The shell toggles
		// this class live when the user flips the assistant setting or a
		// provider is (dis)connected, so the button appears/disappears without
		// a reload. Requires a function-calling-capable provider (what the
		// agentic assistant needs) as well as the per-user toggle.
		if ( function_exists( 'desktop_mode_ai_is_available' ) && desktop_mode_ai_is_available()
			&& function_exists( 'desktop_mode_ai_assistant_provider_configured' ) && desktop_mode_ai_assistant_provider_configured()
			&& function_exists( 'desktop_mode_ai_is_enabled' ) && desktop_mode_ai_is_enabled( get_current_user_id() ) ) {
			$classes .= ' desktop-mode-ai-enabled';
		}

		return $classes;
	}

	return $classes;
}
add_filter( 'admin_body_class', 'desktop_mode_admin_body_classes' );

