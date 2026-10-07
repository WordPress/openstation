<?php

defined( 'ABSPATH' ) || exit;

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

		'cssText'  => openstation_desktop_theme_compile_css( $manifest, $slug, '' ),
	);
	openstation_desktop_theme_registry( $slug, $entry );

	do_action( 'openstation_desktop_theme_registered', $slug, $entry );

	return true;
}

function openstation_unregister_desktop_theme( $id ) {
	$slug = openstation_desktop_theme_slug_from_id( $id );
	if ( '' === $slug ) {
		return;
	}
	openstation_desktop_theme_registry( $slug, '__unset__' );
}

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

	$asset_version = $is_upload && $installed_at > 0 ? (string) $installed_at : '';

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

		'fonts'                 => $font_families,
		'icons'                 => $icons,
		'iconColors'            => $icon_colors,
		'recommendedOsSettings' => $recommended,
		'installedAt'           => $installed_at,
		'source'                => $is_upload ? 'upload' : 'code',
	);
}

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

	usort(
		$out,
		static function ( $a, $b ) {
			return strcasecmp( (string) $a['name'], (string) $b['name'] );
		}
	);

	return array_slice( $out, 0, openstation_desktop_themes_payload_cap() );
}
