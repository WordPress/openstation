<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_DESKTOP_THEMES_OPTION = 'desktop_mode_desktop_themes';

function openstation_desktop_themes_dir( $slug = '' ) {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-themes';

	$base = (string) apply_filters( 'openstation_desktop_themes_base_dir', $base );
	$slug = sanitize_key( (string) $slug );
	return '' !== $slug ? $base . '/' . $slug : $base;
}

function openstation_desktop_themes_url( $slug = '' ) {
	$uploads = wp_get_upload_dir();
	$url     = untrailingslashit( $uploads['baseurl'] ) . '/desktop-mode-themes';

	$url  = (string) apply_filters( 'openstation_desktop_themes_base_url', $url );
	$slug = sanitize_key( (string) $slug );
	return '' !== $slug ? $url . '/' . $slug : $url;
}

function openstation_desktop_themes_ensure_dir() {
	$base = openstation_desktop_themes_dir();
	if ( ! wp_mkdir_p( $base ) ) {
		return new WP_Error(
			'openstation_desktop_theme_mkdir_failed',
			__( 'Could not create the desktop-themes directory.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$index = $base . '/index.php';
	if ( ! file_exists( $index ) ) {

		file_put_contents( $index, "<?php // Silence is golden.\n" );
	}

	$htaccess = $base . '/.htaccess';
	if ( ! file_exists( $htaccess ) ) {
		$rules = "Options -Indexes\n"
			. "<IfModule mod_php.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<IfModule mod_php7.c>\n\tphp_flag engine off\n</IfModule>\n"
			. "<FilesMatch \"\\.(?i:php|phtml|phar|php3|php4|php5|php7|php8|pht|phps|cgi|pl|asp|aspx|jsp|shtml|htaccess)$\">\n"
			. "\t<IfModule mod_authz_core.c>\n\t\tRequire all denied\n\t</IfModule>\n"
			. "\t<IfModule !mod_authz_core.c>\n\t\tOrder deny,allow\n\t\tDeny from all\n\t</IfModule>\n"
			. "</FilesMatch>\n";

		file_put_contents( $htaccess, $rules );
	}

	return $base;
}

function openstation_desktop_themes_index() {
	$raw = get_option( OPENSTATION_DESKTOP_THEMES_OPTION, array() );
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

function openstation_desktop_themes_put_index( $index ) {
	$index = is_array( $index ) ? $index : array();
	if ( false === get_option( OPENSTATION_DESKTOP_THEMES_OPTION, false ) ) {
		add_option( OPENSTATION_DESKTOP_THEMES_OPTION, $index, '', 'no' );
		return;
	}
	update_option( OPENSTATION_DESKTOP_THEMES_OPTION, $index, false );
}

function openstation_desktop_theme_get( $slug ) {
	$slug  = sanitize_key( (string) $slug );
	$index = openstation_desktop_themes_index();
	return isset( $index[ $slug ] ) ? $index[ $slug ] : null;
}

function openstation_desktop_theme_upload_capability() {

	return (string) apply_filters( 'openstation_desktop_theme_upload_capability', 'manage_options' );
}

function openstation_desktop_theme_slug_from_id( $id ) {
	return sanitize_key( str_replace( '/', '-', (string) $id ) );
}

function openstation_desktop_theme_icon_slots() {
	$slots = array(

		'WINDOW_CONTROL_MINIMIZE',
		'WINDOW_CONTROL_MAXIMIZE',
		'WINDOW_CONTROL_FULLSCREEN',
		'WINDOW_CONTROL_FULLSCREEN_EXIT',
		'WINDOW_CONTROL_CLOSE',
		'WINDOW_CONTROL_MENU',
		'WINDOW_CONTROL_RELOAD',
		'WINDOW_CONTROL_DETACH',

		'OS_SETTINGS',
		'RECYCLE_BIN',
		'BUG_REPORT',
		'EXIT_OPENSTATION',
		'PWA_INSTALL',

		'DEFAULT_APP_ICON',

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

		'RECYCLE_RESTORE',
		'RECYCLE_DELETE',
	);

	return (array) apply_filters( 'openstation_desktop_theme_icon_slots', $slots );
}

function openstation_desktop_theme_texture_slots() {
	$corner_size = '--os-window-corner-size';
	$slots       = array(

		'TITLEBAR'             => array(
			'type' => 'image',
			'prop' => '--os-titlebar-image',
		),
		'TITLEBAR_FOCUSED'     => array(
			'type'       => 'image',
			'prop'       => '--os-titlebar-image-focused',

			'companions' => false,
		),
		'WINDOW_FRAME'         => array(
			'type' => 'border-image',
			'prop' => '--os-window-border-image',
		),
		'WINDOW_FRAME_FOCUSED' => array(
			'type' => 'border-image',
			'prop' => '--os-window-border-image-focused',
		),
		'WINDOW_CORNER_NE'     => array(
			'type'      => 'image',
			'prop'      => '--os-window-corner-ne-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_NW'     => array(
			'type'      => 'image',
			'prop'      => '--os-window-corner-nw-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_SE'     => array(
			'type'      => 'image',
			'prop'      => '--os-window-corner-se-image',
			'sizeGroup' => $corner_size,
		),
		'WINDOW_CORNER_SW'     => array(
			'type'      => 'image',
			'prop'      => '--os-window-corner-sw-image',
			'sizeGroup' => $corner_size,
		),

		'TITLEBAR_CONTROLS'    => array(
			'type' => 'image',
			'prop' => '--os-titlebar-controls-image',
		),
		'TITLEBAR_BUTTON'      => array(
			'type' => 'image',
			'prop' => '--os-ui-btn-bg-image',
		),
		'WINDOW_BODY'          => array(
			'type' => 'image',
			'prop' => '--os-window-body-image',
		),
		'TABBAR'               => array(
			'type' => 'image',
			'prop' => '--os-tabs-image',
		),

		'DOCK'                 => array(
			'type' => 'image',
			'prop' => '--os-dock-bg-image',
		),
		'DOCK_ITEM'            => array(
			'type' => 'image',
			'prop' => '--os-dock-item-image',
		),
		'DESKTOP'              => array(
			'type' => 'image',
			'prop' => '--os-desktop-image',
		),
		'ICON_TILE'            => array(
			'type' => 'image',
			'prop' => '--os-tile-image',
		),
		'WIDGET'               => array(
			'type' => 'image',
			'prop' => '--os-widget-image',
		),

		'MENU'                 => array(
			'type' => 'image',
			'prop' => '--os-ui-menu-bg-image',
		),
		'DIALOG'               => array(
			'type' => 'image',
			'prop' => '--os-ui-dialog-bg-image',
		),
		'SCRIM'                => array(
			'type' => 'image',
			'prop' => '--os-ui-scrim-image',
		),
		'PANEL'                => array(
			'type' => 'image',
			'prop' => '--os-ui-panel-bg-image',
		),
		'TOAST'                => array(
			'type' => 'image',
			'prop' => '--os-ui-toast-bg-image',
		),
		'TABLE_HEADER'         => array(
			'type' => 'image',
			'prop' => '--os-ui-table-header-bg-image',
		),
		'BUTTON'               => array(
			'type' => 'image',
			'prop' => '--os-ui-button-bg-image',
		),
	);

	return (array) apply_filters( 'openstation_desktop_theme_texture_slots', $slots );
}

function openstation_desktop_theme_recommended_os_settings_schema() {
	$schema = array(
		'dockSize'             => array( 'enum' => OPENSTATION_OS_SETTINGS_DOCK_SIZES ),
		'desktopLayout'        => array( 'enum' => OPENSTATION_OS_SETTINGS_DESKTOP_LAYOUTS ),
		'dockPlacement'        => array( 'enum' => OPENSTATION_OS_SETTINGS_DOCK_PLACEMENTS ),
		'windowRadius'         => array( 'enum' => OPENSTATION_OS_SETTINGS_WINDOW_RADII ),
		'adminBarMode'         => array( 'enum' => OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES ),
		'dockRailRenderer'     => array( 'slug' => true ),
		'windowReveal'         => array( 'slug' => true ),

		'accent'               => array( 'slug' => true ),
		'windowRevealDuration' => array(
			'int' => array(
				'min' => OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN,
				'max' => OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MAX,
			),
		),
	);

	$schema = (array) apply_filters(
		'openstation_desktop_theme_recommended_os_settings_schema',
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
			continue;
		}
		if (
			! empty( $rule['int'] )
			&& is_array( $rule['int'] )
			&& isset( $rule['int']['min'], $rule['int']['max'] )
			&& is_numeric( $rule['int']['min'] )
			&& is_numeric( $rule['int']['max'] )
			&& (int) $rule['int']['min'] <= (int) $rule['int']['max']
		) {
			$out[ $key ] = array(
				'int' => array(
					'min' => (int) $rule['int']['min'],
					'max' => (int) $rule['int']['max'],
				),
			);
		}
	}
	return $out;
}

function openstation_desktop_theme_asset_extensions( $kind = 'image' ) {
	$kind = strtolower( trim( (string) $kind ) );
	$map  = array(
		'image' => array( 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg' ),
		'font'  => array( 'woff2', 'woff', 'ttf', 'otf' ),
	);

	$extensions = (array) apply_filters(
		'openstation_desktop_theme_asset_extensions',
		isset( $map[ $kind ] ) ? $map[ $kind ] : array(),
		$kind
	);

	return array_values(
		array_filter(
			array_map(
				static function ( $ext ) {
					return strtolower( trim( (string) $ext, ". \t\n\r\0\x0B" ) );
				},
				$extensions
			),
			'strlen'
		)
	);
}

function openstation_desktop_theme_font_caps() {

	$caps = (array) apply_filters(
		'openstation_desktop_theme_font_caps',
		array(

			'max_faces'   => 16,

			'max_sources' => 4,
		)
	);
	return array(
		'max_faces'   => max( 1, (int) ( $caps['max_faces'] ?? 16 ) ),
		'max_sources' => max( 1, (int) ( $caps['max_sources'] ?? 4 ) ),
	);
}

function openstation_desktop_theme_zip_caps() {
	$caps = array(

		'max_entries'      => 256,

		'max_uncompressed' => 32 * 1024 * 1024,

		'max_file'         => 8 * 1024 * 1024,

		'extensions'       => array_merge(
			array( 'json', 'txt', 'md' ),
			openstation_desktop_theme_asset_extensions( 'image' ),
			openstation_desktop_theme_asset_extensions( 'font' )
		),
	);

	$caps = (array) apply_filters( 'openstation_desktop_theme_zip_caps', $caps );

	return array(
		'max_entries'      => max( 1, (int) ( $caps['max_entries'] ?? 256 ) ),
		'max_uncompressed' => max( 1, (int) ( $caps['max_uncompressed'] ?? 33554432 ) ),
		'max_file'         => max( 1, (int) ( $caps['max_file'] ?? 8388608 ) ),
		'extensions'       => array_values(
			array_filter(
				array_map(
					static function ( $ext ) {
						return strtolower( trim( (string) $ext, ". \t\n\r\0\x0B" ) );
					},
					(array) ( $caps['extensions'] ?? array() )
				),
				'strlen'
			)
		),
	);
}

function openstation_desktop_themes_payload_cap() {

	return max( 1, (int) apply_filters( 'openstation_desktop_themes_payload_cap', 24 ) );
}
