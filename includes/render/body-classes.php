<?php
/**
 * OpenStation — Body class tagging.
 *
 * Adds `os-active` / `os-chromeless` to the
 * admin body class so the shell CSS and the chromeless overrides
 * stylesheet can key off it, plus `os-admin-bar-<mode>` for
 * the admin-bar presentation preference. Per-request
 * `?desktop_mode_classic=1` suppresses them for the detached-tab
 * workflow.
 *
 * Extracted from the 2,525-LOC `render.php` during the
 * architecture-0.8.1 PHP slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds body classes for OpenStation and chromeless iframes.
 *
 * The classes anchor all CSS in the shell and chromeless overrides
 * stylesheets — `.os-active` hides classic chrome and reveals
 * the shell, `.os-chromeless` reshapes the page inside iframes.
 *
 * @param string $classes Space-separated CSS class string.
 * @return string
 */
function openstation_admin_body_classes( $classes ) {
	if ( openstation_is_chromeless_request() ) {
		return ltrim( $classes . ' os-chromeless' );
	}

	// Per-request classic override: don't tag the body as desktop-active so
	// the classic chrome isn't hidden by CSS for this one tab.
	if ( openstation_is_classic_request() ) {
		return $classes;
	}

	if ( openstation_is_enabled() ) {
		$classes = ltrim(
			$classes . ' os-active os-admin-bar-'
				. openstation_get_admin_bar_mode()
		);

		// Solo mode — one window freed onto the real desktop by the
		// native host. Still `os-active`: the palette, every component
		// and every registry are scoped to that class, and solo mode
		// is the same shell with everything but one window hidden.
		if ( openstation_is_solo_request() ) {
			$classes .= ' os-solo';
		}

		return $classes;
	}

	return $classes;
}
add_filter( 'admin_body_class', 'openstation_admin_body_classes' );

/**
 * Resolves the current user's admin-bar presentation mode.
 *
 * Emitted as a `os-admin-bar-<mode>` body class so the very
 * first paint already has the right chrome — the shell's JS apply pass
 * re-writes the same class on every settings change, but it runs after
 * the admin bar has painted, which would flash a bar the user asked to
 * hide.
 *
 * @return string One of `static`, `dynamic`, `hidden`.
 */
function openstation_get_admin_bar_mode() {
	$settings = openstation_get_os_settings( get_current_user_id() );
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
	$mode = apply_filters( 'openstation_admin_bar_mode', $mode );

	// Fails closed, and deliberately without a `(string)` cast: a
	// filter returning an array would make that cast emit an
	// "Array to string conversion" warning on the way to failing
	// anyway. `static` is the safe landing — it is the only mode
	// that can't hide the user's way out of the shell.
	return is_string( $mode ) && in_array( $mode, OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES, true )
		? $mode
		: 'static';
}

/**
 * Resolves the current user's behavior for the dock — the single rail
 * in the Unified layout, the bottom dock in Split. (The Split sidebar
 * has its own `sideDockBehavior`, but it is synthesised by JS and
 * needs no first-paint answer from PHP.)
 *
 * Emitted as `data-os-dock-behavior` on `#os-dock` by the shell
 * template so the very first paint already folds (or doesn't) the
 * rail — the shell's JS apply pass re-writes the same attribute on
 * every settings change, but it runs after the dock has painted,
 * which would flash a rail the user asked to keep out of the way.
 *
 * @return string One of `static`, `dynamic`.
 */
function openstation_get_dock_behavior() {
	$settings = openstation_get_os_settings( get_current_user_id() );
	$behavior = isset( $settings['dockBehavior'] ) ? (string) $settings['dockBehavior'] : 'static';

	/**
	 * Filters the dock behavior for the current request.
	 *
	 * Lets a plugin pin the behavior regardless of the user's own
	 * OpenStation Preferences pick — keeping the rail always on
	 * screen for users who would otherwise not find it, say.
	 *
	 * @param string $behavior One of `static`, `dynamic`.
	 */
	$behavior = apply_filters( 'openstation_dock_behavior', $behavior );

	// Fails closed, same as the admin-bar mode: `static` is the one
	// behavior that can't hide the rail from a user who doesn't know
	// where to point.
	return is_string( $behavior ) && in_array( $behavior, OPENSTATION_OS_SETTINGS_DOCK_BEHAVIORS, true )
		? $behavior
		: 'static';
}
