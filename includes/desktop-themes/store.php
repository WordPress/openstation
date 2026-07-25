<?php
/**
 * Desktop Mode — Desktop-theme storage + accessors.
 *
 * Owns the uploads directory, the site option that indexes installed
 * themes, and every filterable knob the rest of the module reads
 * (upload capability, slot allowlists, ZIP caps).
 *
 * Storage layout:
 *
 *     uploads/desktop-mode-themes/
 *         index.php            <- silence
 *         .htaccess            <- exec-off, NOT deny-all
 *         <slug>/
 *             theme.json       <- the author's raw manifest
 *             theme.css        <- compiled by us, custom props only
 *             icons/…  textures/…  preview.png
 *
 * The `.htaccess` here is deliberately NOT the deny-all one the
 * stored-files module drops: theme assets are `<img src>` / CSS
 * `url()` targets and MUST be servable. It turns the PHP engine off
 * and denies executable extensions instead. Belt and braces: the
 * installer only ever moves manifest-referenced files whose
 * extension is on the image/JSON allowlist, so nothing executable
 * lands in the first place.
 *
 * @package WPDesktopMode
 * @since   0.9.7
 */

defined( 'ABSPATH' ) || exit;

/** Site option holding the installed-theme index. Autoload: no. */
const DESKTOP_MODE_DESKTOP_THEMES_OPTION = 'desktop_mode_desktop_themes';

/**
 * Absolute path of the desktop-themes base dir (no trailing slash),
 * or of one theme's dir when `$slug` is given. Pure path math —
 * nothing is created; see {@see desktop_mode_desktop_themes_ensure_dir()}.
 *
 * @since 0.9.7
 *
 * @param string $slug Optional. Theme slug.
 * @return string
 */
function desktop_mode_desktop_themes_dir( $slug = '' ) {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-themes';
	/**
	 * Filters the desktop-theme storage base directory.
	 *
	 * Whatever this points at must be web-servable — the compiled
	 * `theme.css` and every image are loaded by the browser.
	 *
	 * @since 0.9.7
	 *
	 * @param string $base Absolute path, no trailing slash.
	 */
	$base = (string) apply_filters( 'desktop_mode_desktop_themes_base_dir', $base );
	$slug = sanitize_key( (string) $slug );
	return '' !== $slug ? $base . '/' . $slug : $base;
}

/**
 * Public URL of the desktop-themes base dir (no trailing slash), or
 * of one theme's dir when `$slug` is given.
 *
 * @since 0.9.7
 *
 * @param string $slug Optional. Theme slug.
 * @return string
 */
function desktop_mode_desktop_themes_url( $slug = '' ) {
	$uploads = wp_get_upload_dir();
	$url     = untrailingslashit( $uploads['baseurl'] ) . '/desktop-mode-themes';
	/**
	 * Filters the desktop-theme storage base URL. Must resolve to the
	 * same bytes `desktop_mode_desktop_themes_base_dir` points at.
	 *
	 * @since 0.9.7
	 *
	 * @param string $url Absolute URL, no trailing slash.
	 */
	$url  = (string) apply_filters( 'desktop_mode_desktop_themes_base_url', $url );
	$slug = sanitize_key( (string) $slug );
	return '' !== $slug ? $url . '/' . $slug : $url;
}

/**
 * Create (idempotently) the base dir and drop the protection files.
 *
 * @since 0.9.7
 *
 * @return string|WP_Error Base dir path, or `WP_Error` when the
 *                         filesystem refuses.
 */
function desktop_mode_desktop_themes_ensure_dir() {
	$base = desktop_mode_desktop_themes_dir();
	if ( ! wp_mkdir_p( $base ) ) {
		return new WP_Error(
			'desktop_mode_desktop_theme_mkdir_failed',
			__( 'Could not create the desktop-themes directory.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$index = $base . '/index.php';
	if ( ! file_exists( $index ) ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $index, "<?php // Silence is golden.\n" );
	}

	// Exec-off, NOT deny-all — theme assets must stay servable. The
	// `mod_php` variants cover both the module names Apache has used;
	// the `FilesMatch` block is the fallback for FPM/CGI setups where
	// `php_flag` isn't available.
	$htaccess = $base . '/.htaccess';
	if ( ! file_exists( $htaccess ) ) {
		$rules = "Options -Indexes\n"
			. "<IfModule mod_php.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<IfModule mod_php7.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<FilesMatch \"\\.(?i:php|phtml|phar|php3|php4|php5|php7|php8|pht|phps|cgi|pl|asp|aspx|jsp|shtml|htaccess)$\">\n"
			. "\t<IfModule mod_authz_core.c>\n\t\tRequire all denied\n\t</IfModule>\n"
			. "\t<IfModule !mod_authz_core.c>\n\t\tOrder deny,allow\n\t\tDeny from all\n\t</IfModule>\n"
			. "</FilesMatch>\n";
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $htaccess, $rules );
	}

	return $base;
}

/**
 * Read the installed-theme index (map of slug => stored entry).
 *
 * @since 0.9.7
 *
 * @return array<string,array>
 */
function desktop_mode_desktop_themes_index() {
	$raw = get_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION, array() );
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$out = array();
	foreach ( $raw as $slug => $entry ) {
		if ( ! is_string( $slug ) || '' === $slug || ! is_array( $entry ) ) {
			continue;
		}
		$out[ $slug ] = $entry;
	}
	return $out;
}

/**
 * Persist the installed-theme index.
 *
 * Uses `add_option( …, '', 'no' )` on first write so the option is
 * never autoloaded — the index carries whole manifests and has no
 * business on every single page load.
 *
 * @since 0.9.7
 *
 * @param array<string,array> $index Map of slug => stored entry.
 * @return void
 */
function desktop_mode_desktop_themes_put_index( $index ) {
	$index = is_array( $index ) ? $index : array();
	if ( false === get_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION, false ) ) {
		add_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION, $index, '', 'no' );
		return;
	}
	update_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION, $index, false );
}

/**
 * Fetch one installed theme's stored entry.
 *
 * @since 0.9.7
 *
 * @param string $slug Theme slug.
 * @return array|null Stored entry, or `null` when not installed.
 */
function desktop_mode_desktop_theme_get( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = desktop_mode_desktop_themes_index();
	return isset( $index[ $slug ] ) ? $index[ $slug ] : null;
}

/**
 * Capability required to upload / delete desktop themes.
 *
 * @since 0.9.7
 *
 * @return string
 */
function desktop_mode_desktop_theme_upload_capability() {
	/**
	 * Filters the capability required to manage the site's desktop
	 * theme library. Picking a theme is per-user and never gated.
	 *
	 * @since 0.9.7
	 *
	 * @param string $capability Default `manage_options`.
	 */
	return (string) apply_filters( 'desktop_mode_desktop_theme_upload_capability', 'manage_options' );
}

/**
 * Derive the storage slug from a manifest `id`.
 *
 * Manifest ids may be namespaced (`vendor/neon-glass`); the slug
 * flattens the slash so it is a legal single directory name.
 *
 * @since 0.9.7
 *
 * @param string $id Manifest id.
 * @return string Slug, or `''` when the id yields nothing usable.
 */
function desktop_mode_desktop_theme_slug_from_id( $id ) {
	return sanitize_key( str_replace( '/', '-', (string) $id ) );
}

/**
 * The icon slots a manifest may address.
 *
 * Single source of truth for the PHP side; must stay equal to the
 * `DESKTOP_THEME_SLOTS` constants in `src/desktop-themes/slots.ts`.
 * `APP:<slug>` entries are matched by pattern, not by this list.
 *
 * @since 0.9.7
 *
 * @return string[]
 */
function desktop_mode_desktop_theme_icon_slots() {
	$slots = array(
		// Window controls — one per `<wpd-window-button>` key.
		'WINDOW_CONTROL_MINIMIZE',
		'WINDOW_CONTROL_MAXIMIZE',
		'WINDOW_CONTROL_FULLSCREEN',
		'WINDOW_CONTROL_FULLSCREEN_EXIT',
		'WINDOW_CONTROL_CLOSE',
		'WINDOW_CONTROL_MENU',
		'WINDOW_CONTROL_RELOAD',
		'WINDOW_CONTROL_DETACH',
		// System tiles.
		'OS_SETTINGS',
		'RECYCLE_BIN',
		'BUG_REPORT',
		'EXIT_DESKTOP_MODE',
		'PWA_INSTALL',
		// Apps.
		'DEFAULT_APP_ICON',
		// Desktop files.
		'FOLDER',
		'FILE_SHORTCUT',
		'FILE_POST',
		'FILE_ATTACHMENT',
		'FILE_UPLOAD',
		'FILE_USER',
		'FILE_TERM',
		'FILE_COMMENT',
		'FILE_BOOKMARK',
		'FILE_LINK',
		'FILE_EMBED',
		// Recycle-bin row actions.
		'RECYCLE_RESTORE',
		'RECYCLE_DELETE',
	);
	/**
	 * Filters the icon slots a desktop theme manifest may address.
	 *
	 * Entries not on this list (and not matching the `APP:<slug>`
	 * pattern) are dropped from the manifest during sanitization.
	 *
	 * @since 0.9.7
	 *
	 * @param string[] $slots Slot names.
	 */
	return (array) apply_filters( 'desktop_mode_desktop_theme_icon_slots', $slots );
}

/**
 * The texture slots a manifest may address, each mapped to the
 * grammar the sanitizer enforces.
 *
 * `type` is the only structural discriminator: `image` slots become
 * `background-image` custom properties; `border-image` slots become
 * the four `border-image-*` properties.
 *
 * @since 0.9.7
 *
 * @return array<string,array{type:string}>
 */
function desktop_mode_desktop_theme_texture_slots() {
	$slots = array(
		'TITLEBAR'          => array( 'type' => 'image' ),
		'TITLEBAR_FOCUSED'  => array( 'type' => 'image' ),
		'WINDOW_FRAME'      => array( 'type' => 'border-image' ),
		'WINDOW_CORNER_NE'  => array( 'type' => 'image' ),
		'WINDOW_CORNER_NW'  => array( 'type' => 'image' ),
		'WINDOW_CORNER_SE'  => array( 'type' => 'image' ),
		'WINDOW_CORNER_SW'  => array( 'type' => 'image' ),
		'DOCK'              => array( 'type' => 'image' ),
		'DESKTOP'           => array( 'type' => 'image' ),
	);
	/**
	 * Filters the texture slots a desktop theme manifest may address.
	 *
	 * Adding a slot here only makes the sanitizer accept it — the
	 * compiler ({@see desktop_mode_desktop_theme_compile_css()}) must
	 * also know how to turn it into custom properties, and some CSS
	 * rule must consume them.
	 *
	 * @since 0.9.7
	 *
	 * @param array<string,array> $slots Map of slot => `{ type }`.
	 */
	return (array) apply_filters( 'desktop_mode_desktop_theme_texture_slots', $slots );
}

/**
 * Hard caps applied while walking an uploaded ZIP.
 *
 * @since 0.9.7
 *
 * @return array{max_entries:int,max_uncompressed:int,max_file:int,extensions:string[]}
 */
function desktop_mode_desktop_theme_zip_caps() {
	$caps = array(
		// Entry count — a theme is a manifest plus a couple of dozen
		// images; anything past this is a zip bomb or a mistake.
		'max_entries'      => 256,
		// Total uncompressed bytes across every entry (32 MB).
		'max_uncompressed' => 32 * 1024 * 1024,
		// Single-entry uncompressed cap (8 MB).
		'max_file'         => 8 * 1024 * 1024,
		// Everything else is refused outright. No CSS, no JS, ever.
		'extensions'       => array( 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg' ),
	);
	/**
	 * Filters the caps enforced while validating an uploaded desktop
	 * theme ZIP.
	 *
	 * Widening `extensions` to anything executable or anything the
	 * browser parses as script (`css`, `js`, `html`, `xml`) defeats
	 * the whole security model of this feature.
	 *
	 * @since 0.9.7
	 *
	 * @param array $caps See the return shape above.
	 */
	$caps = (array) apply_filters( 'desktop_mode_desktop_theme_zip_caps', $caps );

	return array(
		'max_entries'      => max( 1, (int) ( $caps['max_entries'] ?? 256 ) ),
		'max_uncompressed' => max( 1, (int) ( $caps['max_uncompressed'] ?? 33554432 ) ),
		'max_file'         => max( 1, (int) ( $caps['max_file'] ?? 8388608 ) ),
		'extensions'       => array_values( array_filter( array_map(
			static function ( $ext ) {
				return strtolower( trim( (string) $ext, ". \t\n\r\0\x0B" ) );
			},
			(array) ( $caps['extensions'] ?? array() )
		), 'strlen' ) ),
	);
}

/**
 * Maximum number of themes the payload ships to the shell.
 *
 * @since 0.9.7
 *
 * @return int
 */
function desktop_mode_desktop_themes_payload_cap() {
	/**
	 * Filters how many desktop themes are announced to the shell.
	 *
	 * @since 0.9.7
	 *
	 * @param int $cap Default 24.
	 */
	return max( 1, (int) apply_filters( 'desktop_mode_desktop_themes_payload_cap', 24 ) );
}
