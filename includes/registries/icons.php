<?php
/**
 * Desktop Mode — Desktop-icons registry.
 *
 * Owns the registration API + payload builder for the wallpaper-
 * surface app icons (`wp.desktop.icons`). The dock has its own
 * rail; this is the second surface — clickable shortcuts that
 * sit on the desktop wallpaper itself, registered via
 * `desktop_mode_register_icon()` and rendered by
 * `src/desktop-icons.ts`.
 *
 * Extracted from the 2,101-LOC `components.php` during the
 * architecture-0.8.1 PHP slicing (phase 6). Behaviour is
 * unchanged: every function name, every WP filter, every error
 * code is identical. PHP looks function references up by name at
 * hook-fire time, so existing call sites resolve from any module.
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;


/**
 * Register a desktop icon — a clickable shortcut tile that sits on
 * the wallpaper (think macOS desktop icons / phone home screen apps)
 * and opens a native window or a URL on click.
 *
 * Icons are distinct from dock tiles: the dock rail is for
 * top-level admin pages, the desktop surface is for quick shortcuts
 * a user or theme wants front-and-centre. A single plugin can
 * register a window AND an icon that opens it — the two surfaces
 * are orthogonal.
 *
 * Example — the classic Jorvy recipe:
 *
 * ```php
 * desktop_mode_register_window( 'jorvy', array( …window args… ) );
 * desktop_mode_register_icon( 'jorvy', array(
 *     'title'    => __( 'Jorvy', 'jorvy' ),
 *     'icon'     => 'dashicons-star-filled',
 *     'window'   => 'jorvy',
 *     'position' => 10,
 * ) );
 * ```
 *
 * @since 0.11.0
 *
 * @param string $id   Icon id. Must be a kebab-case-ish slug.
 * @param array  $args {
 *     Icon registration options.
 *
 *     @type string   $title        Display label shown under the icon. Required.
 *     @type string   $icon         Dashicons class (`dashicons-*`), http(s)
 *                                  URL to an image, or `data:image/svg+xml`
 *                                  URI (`;base64,` or URL-encoded). Runs
 *                                  through the same sanitizer as dock icons
 *                                  — `javascript:` and other `data:` schemes
 *                                  are rejected. Required unless `icon_svg`
 *                                  is provided.
 *     @type string   $icon_svg     Raw SVG markup (e.g. `'<svg …>…</svg>'`).
 *                                  Convenience shorthand: the framework
 *                                  base64-encodes it into a `data:image/svg+xml;base64,…`
 *                                  URI and routes the result through the
 *                                  same sanitizer as `icon`. Wins over
 *                                  `icon` when both are supplied. Markup
 *                                  containing a `<script>` tag is rejected
 *                                  with `desktop_mode_invalid_icon_svg`.
 *                                  @since 0.8.2
 *     @type string   $window       Id of a registered native window to
 *                                  open on click. Mutually exclusive
 *                                  with `url`.
 *     @type string   $url          URL to open on click (admin URLs
 *                                  open as a new window in the shell;
 *                                  off-site URLs open in a new tab).
 *                                  Mutually exclusive with `window`.
 *     @type int      $position     Sort order; lower renders earlier
 *                                  (top-left on the grid). Default 100.
 *     @type bool     $pinned       When `true`, the icon renders before
 *                                  any unpinned icon regardless of
 *                                  `position`, and is never user-
 *                                  draggable. Reserved for built-in
 *                                  shortcuts like "My WordPress".
 *                                  Default `false`. @since 0.8.0
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error desktop_mode_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function desktop_mode_register_icon( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_id',
			__( 'Desktop icon id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'        => '',
		'icon'         => 'dashicons-admin-generic',
		'icon_svg'     => '',
		'window'       => '',
		'url'          => '',
		'position'     => 100,
		'pinned'       => false,
		'capabilities' => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	$svg = trim( (string) $args['icon_svg'] );
	if ( '' !== $svg ) {
		// Reject markup that contains a script tag outright. The data
		// URI is consumed via `<img src=…>` in the browser (which
		// sandboxes scripts inside SVG), but defence-in-depth catches
		// callers who paste an SVG harvested from an untrusted source.
		if ( false !== stripos( $svg, '<script' ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_invalid_icon_svg',
				__( 'Desktop icon `icon_svg` must not contain a <script> tag.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		if ( 0 !== stripos( ltrim( $svg ), '<svg' ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_invalid_icon_svg',
				__( 'Desktop icon `icon_svg` must start with a <svg> root element.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		$args['icon'] = 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return desktop_mode_registration_error(
				'desktop_mode_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this desktop icon.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}

	if ( '' === (string) $args['title'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_title',
			__( 'Desktop icon registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$window = sanitize_key( (string) $args['window'] );
	$url    = (string) $args['url'];
	if ( '' !== $window && '' !== $url ) {
		return desktop_mode_registration_error(
			'desktop_mode_conflicting_target',
			__( 'Desktop icon cannot declare both `window` and `url`; pick one target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === $window && '' === $url ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_target',
			__( 'Desktop icon must declare a `window` id or a `url` target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' !== $url ) {
		// Accept any http(s) URL. Same-origin admin URLs open in a
		// desktop window; off-site URLs open in a new browser tab at
		// click time (shell decides).
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $url ) {
			return desktop_mode_registration_error(
				'desktop_mode_invalid_url',
				__( 'Desktop icon `url` must be a valid http(s) URL.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
	}

	$entry = array(
		'id'       => $id,
		'title'    => (string) $args['title'],
		'icon'     => desktop_mode_sanitize_dock_icon( (string) $args['icon'] ),
		'window'   => $window,
		'url'      => $url,
		'position' => (int) $args['position'],
		'pinned'   => (bool) $args['pinned'],
	);
	desktop_mode_desktop_icon_registry( $id, $entry );

	/**
	 * Fires after a desktop icon is successfully registered.
	 *
	 * Does NOT fire when `desktop_mode_register_icon()` returns a
	 * `WP_Error`.
	 *
	 * @since 0.11.0
	 *
	 * @param string $id    The icon id.
	 * @param array  $entry The stored registry entry (id, title,
	 *                      icon, window, url, position).
	 */
	do_action( 'desktop_mode_icon_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for desktop icons registered via
 * {@see desktop_mode_register_icon()}. Same static-store pattern as
 * the widget + native-window + wallpaper registries.
 *
 * @since 0.11.0
 * @internal
 */
function desktop_mode_desktop_icon_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	// Sentinel write: passing the literal string `__unset__` removes
	// the entry. Used by `desktop_mode_unregister_icon()` and by
	// PHPUnit teardowns; lets us clear test-only registrations
	// without exposing the static `$store` directly.
	if ( '__unset__' === $entry ) {
		unset( $store[ $id ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Remove a previously registered desktop icon from the static
 * registry. Mirror of `desktop_mode_register_icon()` — handy for
 * plugins that register icons conditionally and need to drop them
 * mid-request, and for PHPUnit teardowns that shouldn't leak
 * registrations into other tests.
 *
 * @since 0.8.0
 *
 * @param string $id Icon id passed to `desktop_mode_register_icon()`.
 * @return void
 */
function desktop_mode_unregister_icon( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return;
	}
	desktop_mode_desktop_icon_registry( $id, '__unset__' );
}

/**
 * Build the desktop-icon list for the shell payload. Applies a
 * `desktop_mode_icons` filter so plugins can hide / reorder / rename
 * entries registered by others — mirrors the wallpaper payload
 * builder's filter discipline.
 *
 * @since 0.11.0
 *
 * @return array[]
 */
function desktop_mode_build_desktop_icons_payload() {
	$registry = desktop_mode_desktop_icon_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	/**
	 * Filters the full desktop-icon registry before it ships to the
	 * shell. Each entry is the shape stored by
	 * `desktop_mode_register_icon()` (`id`, `title`, `icon`, `window`,
	 * `url`, `position`). Return a reordered / filtered array.
	 *
	 * @since 0.11.0
	 *
	 * @param array[] $registry The registered icon entries.
	 */
	$registry = apply_filters( 'desktop_mode_icons', $registry );
	if ( ! is_array( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$out[] = array(
			'id'       => (string) $entry['id'],
			'title'    => isset( $entry['title'] ) ? (string) $entry['title'] : '',
			'icon'     => isset( $entry['icon'] ) ? (string) $entry['icon'] : 'dashicons-admin-generic',
			'window'   => isset( $entry['window'] ) ? (string) $entry['window'] : '',
			'url'      => isset( $entry['url'] ) ? (string) $entry['url'] : '',
			'position' => isset( $entry['position'] ) ? (int) $entry['position'] : 100,
			'pinned'   => ! empty( $entry['pinned'] ),
		);
	}

	// Pinned icons first; then by position. Ties break on insertion order.
	usort( $out, static function ( $a, $b ) {
		$ap = ! empty( $a['pinned'] ) ? 0 : 1;
		$bp = ! empty( $b['pinned'] ) ? 0 : 1;
		if ( $ap !== $bp ) {
			return $ap - $bp;
		}
		if ( $a['position'] === $b['position'] ) {
			return 0;
		}
		return $a['position'] < $b['position'] ? -1 : 1;
	} );

	return $out;
}
