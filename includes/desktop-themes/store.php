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
 *             theme.css        <- compiled by us: custom props +
 *                                 @font-face rules we generated
 *             icons/…  textures/…  fonts/…  preview.png
 *
 * The `.htaccess` here is deliberately NOT the deny-all one the
 * stored-files module drops: theme assets are `<img src>` / CSS
 * `url()` targets and MUST be servable. It turns the PHP engine off
 * and denies executable extensions instead. Belt and braces: the
 * installer only ever moves manifest-referenced files whose
 * extension is on the image or font allowlist, so nothing executable
 * lands in the first place.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Site option holding the installed-theme index. Autoload: no. */
const DESKTOP_MODE_DESKTOP_THEMES_OPTION = 'desktop_mode_desktop_themes';

/**
 * Absolute path of the desktop-themes base dir (no trailing slash),
 * or of one theme's dir when `$slug` is given. Pure path math —
 * nothing is created; see {@see desktop_mode_desktop_themes_ensure_dir()}.
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
	 * @param string $url Absolute URL, no trailing slash.
	 */
	$url  = (string) apply_filters( 'desktop_mode_desktop_themes_base_url', $url );
	$slug = sanitize_key( (string) $slug );
	return '' !== $slug ? $url . '/' . $slug : $url;
}

/**
 * Create (idempotently) the base dir and drop the protection files.
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
 * @return string
 */
function desktop_mode_desktop_theme_upload_capability() {
	/**
	 * Filters the capability required to manage the site's desktop
	 * theme library. Picking a theme is per-user and never gated.
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
	 * @param string[] $slots Slot names.
	 */
	return (array) apply_filters( 'desktop_mode_desktop_theme_icon_slots', $slots );
}

/**
 * The texture slots a manifest may address, each mapped to the
 * grammar the sanitizer enforces AND the custom property the
 * compiler writes it to.
 *
 * Four keys make up a slot definition:
 *
 *   - `type`      — the structural discriminator. `image` slots
 *                   become `background-image` custom properties;
 *                   `border-image` slots become the four
 *                   `border-image-*` properties.
 *   - `prop`      — the custom-property BASE name. An `image` slot
 *                   emits `<prop>`, `<prop>-repeat`, `<prop>-size`;
 *                   a `border-image` slot emits `<prop>-source`,
 *                   `-slice`, `-width`, `-repeat`.
 *   - `companions`— set to `false` when a slot is a variant of
 *                   another one and should inherit its `repeat` /
 *                   `size` rather than declare its own
 *                   (`TITLEBAR_FOCUSED`).
 *   - `sizeGroup` — custom property shared by a family of slots that
 *                   must render at one size (the four window
 *                   corners). First declared wins.
 *
 * **The compiler reads this table and nothing else.** That is what
 * makes `desktop_mode_desktop_theme_texture_slots` a complete
 * extension point: a plugin that adds an entry here, and writes one
 * CSS rule consuming `var( <prop>, none )`, has textured a surface
 * the framework never knew about — no core change, no compiler
 * change. See docs/desktop-themes.md § "Texturing your own surface".
 *
 * @return array<string,array{type:string,prop:string}>
 */
function desktop_mode_desktop_theme_texture_slots() {
	$corner_size = '--desktop-mode-window-corner-size';
	$slots       = array(
		// --- Window chrome. ---
		'TITLEBAR'             => array(
			'type' => 'image',
			'prop' => '--desktop-mode-titlebar-image',
		),
		'TITLEBAR_FOCUSED'     => array(
			'type'       => 'image',
			'prop'       => '--desktop-mode-titlebar-image-focused',
			// Shares the base slot's repeat + size; only the image
			// differs, so a theme shipping one strip gets both states.
			'companions' => false,
		),
		'WINDOW_FRAME'         => array(
			'type' => 'border-image',
			'prop' => '--desktop-mode-window-border-image',
		),
		'WINDOW_FRAME_FOCUSED' => array(
			'type' => 'border-image',
			'prop' => '--desktop-mode-window-border-image-focused',
		),
		'WINDOW_CORNER_NE'     => array(
			'type'      => 'image',
			'prop'      => '--desktop-mode-window-corner-ne-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_NW'     => array(
			'type'      => 'image',
			'prop'      => '--desktop-mode-window-corner-nw-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_SE'     => array(
			'type'      => 'image',
			'prop'      => '--desktop-mode-window-corner-se-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_SW'     => array(
			'type'      => 'image',
			'prop'      => '--desktop-mode-window-corner-sw-image',
			'sizeGroup' => $corner_size,
		),
		// The control cluster and the individual control faces. Both
		// are TRANSPARENT by default, which is what lets a TITLEBAR
		// texture run edge to edge underneath them. A theme that wants
		// the controls to sit on a plate paints one here (and usually
		// sets `--desktop-mode-titlebar-controls-radius` +
		// `-padding` to give it a shape).
		'TITLEBAR_CONTROLS'    => array(
			'type' => 'image',
			'prop' => '--desktop-mode-titlebar-controls-image',
		),
		'TITLEBAR_BUTTON'      => array(
			'type' => 'image',
			'prop' => '--wpd-btn-bg-image',
		),
		'WINDOW_BODY'          => array(
			'type' => 'image',
			'prop' => '--desktop-mode-window-body-image',
		),
		'TABBAR'               => array(
			'type' => 'image',
			'prop' => '--desktop-mode-tabs-image',
		),
		// --- Shell surfaces. ---
		'DOCK'                 => array(
			'type' => 'image',
			'prop' => '--desktop-mode-dock-bg-image',
		),
		'DOCK_ITEM'            => array(
			'type' => 'image',
			'prop' => '--desktop-mode-dock-item-image',
		),
		'DESKTOP'              => array(
			'type' => 'image',
			'prop' => '--desktop-mode-desktop-image',
		),
		'ICON_TILE'            => array(
			'type' => 'image',
			'prop' => '--desktop-mode-tile-image',
		),
		'WIDGET'               => array(
			'type' => 'image',
			'prop' => '--desktop-mode-widget-image',
		),
		// --- Component-kit surfaces (window bodies + popovers). ---
		'MENU'                 => array(
			'type' => 'image',
			'prop' => '--wpd-menu-bg-image',
		),
		'DIALOG'               => array(
			'type' => 'image',
			'prop' => '--wpd-dialog-bg-image',
		),
		'SCRIM'                => array(
			'type' => 'image',
			'prop' => '--wpd-scrim-image',
		),
		'PANEL'                => array(
			'type' => 'image',
			'prop' => '--wpd-panel-bg-image',
		),
		'TOAST'                => array(
			'type' => 'image',
			'prop' => '--wpd-toast-bg-image',
		),
		'TABLE_HEADER'         => array(
			'type' => 'image',
			'prop' => '--wpd-table-header-bg-image',
		),
		'BUTTON'               => array(
			'type' => 'image',
			'prop' => '--wpd-button-bg-image',
		),
	);
	/**
	 * Filters the texture slots a desktop theme manifest may address.
	 *
	 * Each entry needs a `type` (`image` or `border-image`) and a
	 * `prop` — the custom-property base name the compiler writes to.
	 * With both present the slot is fully wired: the sanitizer accepts
	 * it and the compiler emits it. All that remains is a CSS rule
	 * that reads the property, which the plugin adding the slot ships
	 * in its own stylesheet.
	 *
	 * An entry with no `prop` is accepted by the sanitizer but emits
	 * nothing — that combination is a bug, not a feature.
	 *
	 * @param array<string,array> $slots Map of slot =>
	 *                                   `{ type, prop, companions?,
	 *                                   sizeGroup? }`.
	 */
	return (array) apply_filters( 'desktop_mode_desktop_theme_texture_slots', $slots );
}

/**
 * The OS-settings keys a manifest's `recommendedOsSettings` block may
 * address, each mapped to the grammar the sanitizer enforces.
 *
 * Two grammars, and the difference is not cosmetic:
 *
 *   - `enum`  — a closed list of core values. The whole set is known
 *               to PHP, so an unknown value is provably wrong and is
 *               dropped here.
 *   - `slug`  — a `sanitize_key()`-clean id whose validity only the
 *               JS registry knows (`dockRailRenderer` resolves against
 *               renderers registered at runtime, by core AND by
 *               plugins). PHP checks the charset; the shell drops the
 *               key at apply time when nothing is registered under
 *               that id, which is the same "resolve at use time"
 *               contract `desktop_mode_sanitize_os_settings()` already
 *               follows for the user's own `dockRailRenderer`.
 *
 * A key absent from this table is dropped from the manifest. That is
 * the point: a theme RECOMMENDS presentation, so it may only reach
 * the handful of layout preferences a user would plausibly want a
 * theme to arrange for them — never a feature toggle, a capability
 * gate, or anything that changes what the shell can do.
 *
 * @return array<string,array{enum?:string[],slug?:bool}>
 */
function desktop_mode_desktop_theme_recommended_os_settings_schema() {
	$schema = array(
		'dockSize'         => array( 'enum' => DESKTOP_MODE_OS_SETTINGS_DOCK_SIZES ),
		'desktopLayout'    => array( 'enum' => DESKTOP_MODE_OS_SETTINGS_DESKTOP_LAYOUTS ),
		'windowRadius'     => array( 'enum' => DESKTOP_MODE_OS_SETTINGS_WINDOW_RADII ),
		'adminBarMode'     => array( 'enum' => DESKTOP_MODE_OS_SETTINGS_ADMIN_BAR_MODES ),
		'dockRailRenderer' => array( 'slug' => true ),
	);
	/**
	 * Filters the OS-settings keys a desktop theme may recommend.
	 *
	 * A plugin that adds its own presentation preference to OS
	 * Settings can opt it into theme recommendations by adding an
	 * entry here — `array( 'enum' => array( … ) )` for a closed set,
	 * `array( 'slug' => true )` for a registry id resolved at apply
	 * time.
	 *
	 * Anything added is written into user meta the first time a user
	 * activates a theme that recommends it, so keep the list to
	 * presentation. Feature switches and capability-adjacent settings
	 * do not belong here.
	 *
	 * @param array<string,array> $schema Map of settings key =>
	 *                                    `{ enum }` or `{ slug }`.
	 */
	$schema = (array) apply_filters(
		'desktop_mode_desktop_theme_recommended_os_settings_schema',
		$schema
	);

	$out = array();
	foreach ( $schema as $key => $rule ) {
		if ( ! is_string( $key ) || '' === $key || ! is_array( $rule ) ) {
			continue;
		}
		if ( ! empty( $rule['enum'] ) && is_array( $rule['enum'] ) ) {
			$values = array();
			foreach ( $rule['enum'] as $value ) {
				if ( is_string( $value ) && '' !== $value ) {
					$values[] = $value;
				}
			}
			if ( ! empty( $values ) ) {
				$out[ $key ] = array( 'enum' => $values );
			}
			continue;
		}
		if ( ! empty( $rule['slug'] ) ) {
			$out[ $key ] = array( 'slug' => true );
		}
	}
	return $out;
}

/**
 * File extensions a theme asset may carry, per asset kind.
 *
 * Two kinds exist, and they are deliberately disjoint:
 *
 *   - `image` — icons, textures, the preview. Everything the
 *     compiler turns into a `url()` inside a `background-image` or
 *     an `<img src>`.
 *   - `font`  — files referenced from a generated `@font-face`.
 *     Binary containers parsed by the browser's font engine; unlike
 *     SVG they carry no script surface, which is why they can be
 *     accepted without a sanitizer pass of their own.
 *
 * A kind the caller doesn't recognise gets an EMPTY list, so a typo
 * fails closed.
 *
 * @param string $kind `'image'` or `'font'`.
 * @return string[] Lowercase extensions, no leading dot.
 */
function desktop_mode_desktop_theme_asset_extensions( $kind = 'image' ) {
	$kind = strtolower( trim( (string) $kind ) );
	$map  = array(
		'image' => array( 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg' ),
		'font'  => array( 'woff2', 'woff', 'ttf', 'otf' ),
	);
	/**
	 * Filters the extensions accepted for one kind of theme asset.
	 *
	 * Adding anything the browser parses as script (`css`, `js`,
	 * `html`, `xml`, `svgz`) or anything the server executes defeats
	 * the security model this whole feature rests on.
	 *
	 * @param string[] $extensions Lowercase extensions, no dot.
	 * @param string   $kind       `'image'` or `'font'`.
	 */
	$extensions = (array) apply_filters(
		'desktop_mode_desktop_theme_asset_extensions',
		isset( $map[ $kind ] ) ? $map[ $kind ] : array(),
		$kind
	);

	return array_values( array_filter( array_map(
		static function ( $ext ) {
			return strtolower( trim( (string) $ext, ". \t\n\r\0\x0B" ) );
		},
		$extensions
	), 'strlen' ) );
}

/**
 * Maximum number of `@font-face` rules one theme may declare, and
 * the maximum number of source files per face.
 *
 * @return array{max_faces:int,max_sources:int}
 */
function desktop_mode_desktop_theme_font_caps() {
	/**
	 * Filters the desktop-theme font caps.
	 *
	 * @param array $caps `{ max_faces, max_sources }`.
	 */
	$caps = (array) apply_filters(
		'desktop_mode_desktop_theme_font_caps',
		array(
			// A UI font at a few weights, a mono, a display face.
			'max_faces'   => 16,
			// woff2 + woff is the realistic ceiling in 2025; four
			// leaves room for a ttf/otf tail on ancient targets.
			'max_sources' => 4,
		)
	);
	return array(
		'max_faces'   => max( 1, (int) ( $caps['max_faces'] ?? 16 ) ),
		'max_sources' => max( 1, (int) ( $caps['max_sources'] ?? 4 ) ),
	);
}

/**
 * Hard caps applied while walking an uploaded ZIP.
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
		//
		// `txt` / `md` are here so an archive may carry the licence
		// notice its bundled fonts require. They are NOT referenceable
		// from any manifest field — every resolver demands an image or
		// font extension — so they are validated, never extracted into
		// the live directory, and discarded with the staging dir.
		'extensions'       => array_merge(
			array( 'json', 'txt', 'md' ),
			desktop_mode_desktop_theme_asset_extensions( 'image' ),
			desktop_mode_desktop_theme_asset_extensions( 'font' )
		),
	);
	/**
	 * Filters the caps enforced while validating an uploaded desktop
	 * theme ZIP.
	 *
	 * Widening `extensions` to anything executable or anything the
	 * browser parses as script (`css`, `js`, `html`, `xml`) defeats
	 * the whole security model of this feature.
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
 * @return int
 */
function desktop_mode_desktop_themes_payload_cap() {
	/**
	 * Filters how many desktop themes are announced to the shell.
	 *
	 * @param int $cap Default 24.
	 */
	return max( 1, (int) apply_filters( 'desktop_mode_desktop_themes_payload_cap', 24 ) );
}
