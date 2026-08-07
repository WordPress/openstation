<?php
/**
 * OpenStation — Code-registered desktop themes + payload builder.
 *
 * Two ways a theme reaches the shell:
 *
 *   - **Uploaded** — a ZIP installed through the REST route. Assets
 *     live in `uploads/desktop-mode-themes/<slug>/` and the compiled
 *     stylesheet is a real file, so the payload ships a `cssUrl`.
 *   - **Code-registered** — a plugin calls
 *     `openstation_register_desktop_theme()` with asset URLs it
 *     already publishes. There is no file to link, so the payload
 *     ships the compiled stylesheet as `cssText` and `cssUrl` is
 *     empty. PHP prints it via `wp_add_inline_style()` at boot; the
 *     shell injects a `<style>` for live switches.
 *
 * Both travel through the same sanitizer and the same compiler, so a
 * code theme is exactly as constrained as an uploaded one — a plugin
 * that wants arbitrary CSS should enqueue a stylesheet, not pretend
 * to be a theme.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Internal static store for code-registered themes. Same
 * `__unset__` sentinel idiom as the icon / wallpaper / widget
 * registries.
 *
 * @internal
 *
 * @param string $slug  Theme slug, or `''` to read the whole store.
 * @param mixed  $entry Entry to write, `'__unset__'` to remove, or
 *                      `null` to read.
 * @return array|null
 */
function openstation_desktop_theme_registry( $slug = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $slug ) {
		return $store;
	}
	if ( '__unset__' === $entry ) {
		unset( $store[ $slug ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $slug ] = $entry;
	}
	return isset( $store[ $slug ] ) ? $store[ $slug ] : null;
}

/**
 * Register a desktop theme from code.
 *
 * Every asset (`preview`, icon `path`s, texture `path`s) must be an
 * absolute http(s) URL the plugin already serves — there is no ZIP,
 * so there is nothing for us to host.
 *
 * ```php
 * openstation_register_desktop_theme( 'my-plugin/neon', array(
 *     'name'     => __( 'Neon', 'my-plugin' ),
 *     'version'  => '1.0.0',
 *     'preview'  => plugins_url( 'theme/preview.png', __FILE__ ),
 *     'tokens'   => array(
 *         '--os-window-radius'   => '14px',
 *         '--os-titlebar-bg'     => '#12122a',
 *     ),
 *     'icons'    => array(
 *         'WINDOW_CONTROL_CLOSE' => array(
 *             'type' => 'image',
 *             'path' => plugins_url( 'theme/close.svg', __FILE__ ),
 *         ),
 *     ),
 *     'textures' => array(
 *         'TITLEBAR' => array(
 *             'type'   => 'image',
 *             'path'   => plugins_url( 'theme/titlebar.png', __FILE__ ),
 *             'repeat' => 'repeat-x',
 *         ),
 *     ),
 *     'fonts'    => array(
 *         array(
 *             'family'  => 'Neon Grotesk',
 *             'weight'  => '400',
 *             'display' => 'swap',
 *             'src'     => array( plugins_url( 'theme/neon.woff2', __FILE__ ) ),
 *         ),
 *     ),
 * ) );
 * ```
 *
 * @param string $id   Theme id (`slug` or `vendor/slug`).
 * @param array  $args {
 *     @type string $name        Display name. Required.
 *     @type string $version     Version string. Optional.
 *     @type string $author      Author name. Optional.
 *     @type string $description Short description. Optional.
 *     @type string $preview     Absolute URL of a preview image.
 *     @type array  $tokens      Map of `--os-*` => value.
 *     @type string $iconColor   Default tint for every icon that does
 *                               not set its own `color`.
 *     @type array  $icons       Map of slot => icon descriptor.
 *     @type array  $textures    Map of slot => texture descriptor.
 *     @type array  $fonts       List of `@font-face` descriptors.
 *                               `src` entries are absolute URLs.
 *     @type array|string $wallpapers One absolute image URL, one
 *                               descriptor (`path` / `label` / `size`
 *                               / `repeat` / `position`), or a list or
 *                               map of either. Each becomes a pickable
 *                               wallpaper.
 *     @type array  $recommendedOsSettings Presentation preferences the
 *                               theme would like the user to wear
 *                               (`dockSize`, `desktopLayout`,
 *                               `windowRadius`, `dockRailRenderer`).
 *                               Applied once, the first time a user
 *                               activates the theme.
 * }
 * @return true|WP_Error
 */
function openstation_register_desktop_theme( $id, $args = array() ) {
	$args = wp_parse_args(
		is_array( $args ) ? $args : array(),
		array(
			'name'                  => '',
			'version'               => '',
			'author'                => '',
			'description'           => '',
			'preview'               => '',
			'tokens'                => array(),
			'iconColor'             => '',
			'icons'                 => array(),
			'textures'              => array(),
			'fonts'                 => array(),
			'wallpapers'            => array(),
			'recommendedOsSettings' => array(),
		)
	);

	$manifest = openstation_sanitize_desktop_theme_manifest(
		array(
			// Code registrations declare v2 unconditionally: the array
			// they hand over always HAS the recommendation key, empty
			// or not, so there is nothing for a version to disambiguate.
			'manifestVersion'       => 2,
			'id'                    => (string) $id,
			'name'                  => (string) $args['name'],
			'version'               => (string) $args['version'],
			'author'                => (string) $args['author'],
			'description'           => (string) $args['description'],
			'preview'               => (string) $args['preview'],
			'tokens'                => $args['tokens'],
			'iconColor'             => (string) $args['iconColor'],
			'icons'                 => $args['icons'],
			'textures'              => $args['textures'],
			'fonts'                 => $args['fonts'],
			'wallpapers'            => $args['wallpapers'],
			'recommendedOsSettings' => $args['recommendedOsSettings'],
		),
		openstation_desktop_theme_url_asset_resolver()
	);
	if ( is_wp_error( $manifest ) ) {
		return openstation_registration_error(
			$manifest->get_error_code(),
			$manifest->get_error_message(),
			array( 'id' => (string) $id )
		);
	}

	$slug  = (string) $manifest['slug'];
	$entry = array(
		'slug'     => $slug,
		'manifest' => $manifest,
		// Code themes carry absolute asset URLs already, so the
		// compiler needs no base to join against.
		'cssText'  => openstation_desktop_theme_compile_css( $manifest, $slug, '' ),
	);
	openstation_desktop_theme_registry( $slug, $entry );

	/**
	 * Fires after a desktop theme is registered from code.
	 *
	 * Does NOT fire when the registration returned a `WP_Error`.
	 *
	 * @param string $slug  Theme slug.
	 * @param array  $entry Stored registry entry.
	 */
	do_action( 'openstation_desktop_theme_registered', $slug, $entry );

	return true;
}

/**
 * Remove a code-registered desktop theme.
 *
 * Has no effect on uploaded themes — those are removed with
 * {@see openstation_desktop_theme_delete()}.
 *
 * @param string $id Theme id or slug.
 * @return void
 */
function openstation_unregister_desktop_theme( $id ) {
	$slug = openstation_desktop_theme_slug_from_id( $id );
	if ( '' === $slug ) {
		return;
	}
	openstation_desktop_theme_registry( $slug, '__unset__' );
}

/**
 * Shape one stored/registered entry into the payload entry the
 * shell consumes.
 *
 * @internal
 *
 * @param array  $entry  Stored entry (`slug`, `manifest`, …).
 * @param string $source `'upload'` or `'code'`.
 * @return array|null
 */
function openstation_shape_desktop_theme_payload_entry( $entry, $source ) {
	if ( ! is_array( $entry ) || empty( $entry['manifest'] ) || ! is_array( $entry['manifest'] ) ) {
		return null;
	}
	$manifest = $entry['manifest'];
	$slug     = isset( $entry['slug'] ) ? sanitize_key( (string) $entry['slug'] ) : '';
	if ( '' === $slug ) {
		return null;
	}

	$is_upload    = 'upload' === $source;
	$base_url     = $is_upload ? openstation_desktop_themes_url( $slug ) : '';
	$installed_at = isset( $entry['installedAt'] ) ? (int) $entry['installedAt'] : 0;
	// Every generated asset URL carries the install timestamp so a
	// re-upload (which reuses the same paths by design) cannot be
	// served from the browser's cache. Without it an author fixes
	// their artwork, re-uploads, and sees the old files.
	$asset_version = $is_upload && $installed_at > 0 ? (string) $installed_at : '';

	// Icon map — the shell only ever needs a paintable string per
	// slot: a dashicon class or an absolute URL.
	//
	// Tints ride in a PARALLEL map rather than turning `icons` into a
	// map of objects. That keeps `resolveIcon()` returning a paintable
	// string (its documented contract, and what the
	// `os.desktop-theme.icon` filter is typed against) and
	// keeps the resolver's hot path a single lookup. A slot with no
	// tint is simply absent from `iconColors`, which is also the
	// "paint it the way you always did" signal.
	$icons       = array();
	$icon_colors = array();
	if ( ! empty( $manifest['icons'] ) && is_array( $manifest['icons'] ) ) {
		foreach ( $manifest['icons'] as $slot => $icon ) {
			if ( ! is_array( $icon ) ) {
				continue;
			}
			if ( 'dashicon' === $icon['type'] ) {
				$icons[ $slot ] = (string) $icon['name'];
			} else {
				$url = openstation_desktop_theme_asset_url( $icon['path'], $base_url, $asset_version );
				if ( '' === $url ) {
					continue;
				}
				$icons[ $slot ] = $url;
			}
			if ( ! empty( $icon['color'] ) ) {
				$icon_colors[ $slot ] = (string) $icon['color'];
			}
		}
	}

	// Distinct family names, in declaration order. A family declared at
	// four weights is one entry, which is what a UI wants to show.
	$font_families = array();
	if ( ! empty( $manifest['fonts'] ) && is_array( $manifest['fonts'] ) ) {
		foreach ( $manifest['fonts'] as $face ) {
			if ( ! is_array( $face ) || empty( $face['family'] ) ) {
				continue;
			}
			$family = (string) $face['family'];
			if ( ! in_array( $family, $font_families, true ) ) {
				$font_families[] = $family;
			}
		}
	}

	$preview_url = '';
	if ( ! empty( $manifest['preview'] ) ) {
		$preview_url = openstation_desktop_theme_asset_url( $manifest['preview'], $base_url, $asset_version );
	}

	$css_url  = '';
	$css_text = '';
	if ( $is_upload ) {
		$css_url = add_query_arg(
			'ver',
			(string) $installed_at,
			openstation_desktop_themes_url( $slug ) . '/theme.css'
		);
	} else {
		$css_text = isset( $entry['cssText'] ) ? (string) $entry['cssText'] : '';
	}

	// Recommendations are re-sanitized on the way OUT, not just on the
	// way in. A stored manifest can predate a schema change (an enum
	// value core dropped, a key a plugin stopped offering), and the
	// shell must never be handed a value the current build no longer
	// understands.
	$recommended = openstation_sanitize_desktop_theme_recommended_os_settings(
		isset( $manifest['recommendedOsSettings'] ) ? $manifest['recommendedOsSettings'] : null
	);

	return array(
		'id'                    => isset( $manifest['id'] ) ? (string) $manifest['id'] : $slug,
		'slug'                  => $slug,
		'name'                  => isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug,
		'version'               => isset( $manifest['version'] ) ? (string) $manifest['version'] : '',
		'author'                => isset( $manifest['author'] ) ? (string) $manifest['author'] : '',
		'description'           => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
		'previewUrl'            => $preview_url,
		'cssUrl'                => $css_url,
		'cssText'               => $css_text,
		'tokens'                => isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] )
			? $manifest['tokens']
			: array(),
		// Informational, like `tokens`: the compiled stylesheet is what
		// actually loads the faces. Shipped so `desktopThemes.list()`
		// can tell a UI which families a theme brings with it without
		// parsing CSS.
		'fonts'                 => $font_families,
		'icons'                 => $icons,
		'iconColors'            => $icon_colors,
		'recommendedOsSettings' => $recommended,
		'installedAt'           => $installed_at,
		'source'                => $is_upload ? 'upload' : 'code',
	);
}

/**
 * Build the desktop-theme library for the shell payload.
 *
 * Uploaded themes win on a slug collision — a site admin who
 * installed a theme by hand outranks a plugin that later registers
 * the same slug from code.
 *
 * @return array[]
 */
function openstation_build_desktop_themes_payload() {
	$entries = array();

	foreach ( openstation_desktop_theme_registry() as $slug => $entry ) {
		$shaped = openstation_shape_desktop_theme_payload_entry( $entry, 'code' );
		if ( $shaped ) {
			$entries[ $slug ] = $shaped;
		}
	}
	foreach ( openstation_desktop_themes_index() as $slug => $entry ) {
		$shaped = openstation_shape_desktop_theme_payload_entry( $entry, 'upload' );
		if ( $shaped ) {
			$entries[ $slug ] = $shaped;
		}
	}

	/**
	 * Filters the desktop-theme library before it ships to the shell.
	 *
	 * Keyed by slug. Entries carry the shape documented in
	 * `docs/desktop-themes.md`; removing one hides it from the
	 * picker without touching the stored files.
	 *
	 * @param array[] $entries Map of slug => payload entry.
	 */
	$entries = apply_filters( 'openstation_desktop_themes', $entries );
	if ( ! is_array( $entries ) ) {
		return array();
	}

	$out = array();
	foreach ( $entries as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['slug'] ) ) {
			continue;
		}
		$out[] = $entry;
	}

	// Stable, human-sensible order for the picker grid.
	usort(
		$out,
		static function ( $a, $b ) {
			return strcasecmp( (string) $a['name'], (string) $b['name'] );
		}
	);

	return array_slice( $out, 0, openstation_desktop_themes_payload_cap() );
}
