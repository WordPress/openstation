<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX = 'desktop-theme/';

function openstation_desktop_theme_wallpaper_css( $wallpaper, $base_url = '', $version = '' ) {
	if ( ! is_array( $wallpaper ) || empty( $wallpaper['path'] ) ) {
		return '';
	}
	$url = openstation_desktop_theme_asset_url( $wallpaper['path'], $base_url, $version );
	if ( '' === $url ) {
		return '';
	}

	$position = ! empty( $wallpaper['position'] ) ? (string) $wallpaper['position'] : 'center center';
	$size     = ! empty( $wallpaper['size'] ) ? (string) $wallpaper['size'] : 'cover';
	$repeat   = ! empty( $wallpaper['repeat'] ) ? (string) $wallpaper['repeat'] : 'no-repeat';

	return openstation_desktop_theme_css_url( $url ) . ' ' . $position . ' / ' . $size . ' ' . $repeat;
}

function openstation_desktop_theme_wallpaper_label( $name, $slug, $own_label = '' ) {
	$own_label = (string) $own_label;
	if ( '' === $own_label ) {
		$label = sprintf(

			__( '%s - (theme)', 'desktop-mode' ),
			$name
		);
	} else {
		$label = sprintf(

			__( '%1$s: %2$s - (theme)', 'desktop-mode' ),
			$name,
			$own_label
		);
	}

	return (string) apply_filters(
		'openstation_desktop_theme_wallpaper_label',
		$label,
		$name,
		$slug,
		$own_label
	);
}

function openstation_register_desktop_theme_wallpapers() {
	$sources = array();

	foreach ( openstation_desktop_theme_registry() as $slug => $entry ) {
		$sources[ $slug ] = array( $entry, '', '' );
	}

	foreach ( openstation_desktop_themes_index() as $slug => $entry ) {
		$installed_at     = isset( $entry['installedAt'] ) ? (int) $entry['installedAt'] : 0;
		$sources[ $slug ] = array(
			$entry,
			openstation_desktop_themes_url( $slug ),
			$installed_at > 0 ? (string) $installed_at : '',
		);
	}

	foreach ( $sources as $slug => $source ) {
		list( $entry, $base_url, $version ) = $source;
		if ( ! is_array( $entry ) || empty( $entry['manifest'] ) || ! is_array( $entry['manifest'] ) ) {
			continue;
		}
		$manifest = $entry['manifest'];
		if ( empty( $manifest['wallpapers'] ) || ! is_array( $manifest['wallpapers'] ) ) {
			continue;
		}
		$name = isset( $manifest['name'] ) ? (string) $manifest['name'] : $slug;

		foreach ( $manifest['wallpapers'] as $wallpaper ) {
			$value = openstation_desktop_theme_wallpaper_css( $wallpaper, $base_url, $version );
			if ( '' === $value ) {
				continue;
			}

			$id = OPENSTATION_DESKTOP_THEME_WALLPAPER_PREFIX . $slug . '/' . $wallpaper['id'];

			openstation_register_wallpaper(
				$id,
				array(
					'label'       => openstation_desktop_theme_wallpaper_label(
						$name,
						$slug,
						isset( $wallpaper['label'] ) ? (string) $wallpaper['label'] : ''
					),

					'preview'     => $value,
					'value'       => $value,
					'type'        => 'css',
					'description' => ! empty( $wallpaper['description'] )
						? (string) $wallpaper['description']
						: ( isset( $manifest['description'] ) ? (string) $manifest['description'] : '' ),
				)
			);
		}
	}
}
add_action( 'init', 'openstation_register_desktop_theme_wallpapers', 20 );
