<?php

defined( 'ABSPATH' ) || exit;

function openstation_desktop_theme_asset_url( $ref, $base_url, $version = '' ) {
	$ref = (string) $ref;
	if ( '' === $ref ) {
		return '';
	}
	if ( preg_match( '~^https?://~i', $ref ) ) {
		return $ref;
	}
	$base = untrailingslashit( (string) $base_url );
	if ( '' === $base ) {
		return '';
	}
	$segments = array_map( 'rawurlencode', explode( '/', $ref ) );
	$url      = $base . '/' . implode( '/', $segments );
	$version  = (string) $version;
	return '' !== $version ? $url . '?ver=' . rawurlencode( $version ) : $url;
}

function openstation_desktop_theme_css_url( $url ) {
	return 'url("' . $url . '")';
}

function openstation_desktop_theme_compile_css( $manifest, $slug, $base_url = '', $version = '' ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug || ! is_array( $manifest ) ) {
		return '';
	}

	$declarations = array();

	$tokens = isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] )
		? $manifest['tokens']
		: array();
	ksort( $tokens );
	foreach ( $tokens as $property => $value ) {
		$declarations[] = "\t{$property}: {$value};";
	}

	$textures = isset( $manifest['textures'] ) && is_array( $manifest['textures'] )
		? $manifest['textures']
		: array();
	ksort( $textures );

	$slots = openstation_desktop_theme_texture_slots();

	$size_groups = array();

	foreach ( $textures as $slot => $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['path'] ) ) {
			continue;
		}
		$definition = isset( $slots[ $slot ] ) && is_array( $slots[ $slot ] ) ? $slots[ $slot ] : null;
		$prop       = $definition && ! empty( $definition['prop'] ) ? (string) $definition['prop'] : '';
		if ( '' === $prop ) {

			continue;
		}
		$url = openstation_desktop_theme_asset_url( $entry['path'], $base_url, $version );
		if ( '' === $url ) {
			continue;
		}
		$css_url = openstation_desktop_theme_css_url( $url );
		$type    = isset( $definition['type'] ) ? (string) $definition['type'] : 'image';

		if ( 'border-image' === $type ) {
			$declarations[] = "\t{$prop}-source: {$css_url};";
			foreach ( array( 'slice', 'width', 'repeat' ) as $key ) {
				if ( ! empty( $entry[ $key ] ) ) {
					$declarations[] = "\t{$prop}-{$key}: {$entry[ $key ]};";
				}
			}
			continue;
		}

		$declarations[] = "\t{$prop}: {$css_url};";

		$size_group = ! empty( $definition['sizeGroup'] ) ? (string) $definition['sizeGroup'] : '';
		if ( '' !== $size_group ) {
			if ( ! isset( $size_groups[ $size_group ] ) && ! empty( $entry['size'] ) ) {
				$size_groups[ $size_group ] = (string) $entry['size'];
			}
			continue;
		}

		if ( isset( $definition['companions'] ) && false === $definition['companions'] ) {
			continue;
		}
		if ( ! empty( $entry['repeat'] ) ) {
			$declarations[] = "\t{$prop}-repeat: {$entry['repeat']};";
		}
		if ( ! empty( $entry['size'] ) ) {
			$declarations[] = "\t{$prop}-size: {$entry['size']};";
		}
		if ( ! empty( $entry['position'] ) ) {
			$declarations[] = "\t{$prop}-position: {$entry['position']};";
		}
	}

	foreach ( $size_groups as $property => $value ) {
		$declarations[] = "\t{$property}: {$value};";
	}

	$font_faces = openstation_desktop_theme_compile_font_faces( $manifest, $base_url, $version );

	if ( empty( $declarations ) ) {
		return '' === $font_faces
			? ''
			: "" . $font_faces;
	}

	sort( $declarations, SORT_STRING );

	$selector = '.os-shell[data-os-desktop-theme="' . $slug . '"],' . "\n"
		. 'body.os-desktop-theme-' . $slug;

	return ""
		. $font_faces
		. $selector . " {\n"
		. implode( "\n", $declarations ) . "\n"
		. "}\n";
}

function openstation_desktop_theme_compile_font_faces( $manifest, $base_url = '', $version = '' ) {
	$fonts = isset( $manifest['fonts'] ) && is_array( $manifest['fonts'] )
		? $manifest['fonts']
		: array();
	if ( empty( $fonts ) ) {
		return '';
	}

	$rules = array();
	foreach ( $fonts as $face ) {
		if ( ! is_array( $face ) || empty( $face['family'] ) || empty( $face['src'] ) || ! is_array( $face['src'] ) ) {
			continue;
		}

		$sources = array();
		foreach ( $face['src'] as $source ) {
			if ( ! is_array( $source ) || empty( $source['path'] ) || empty( $source['format'] ) ) {
				continue;
			}
			$url = openstation_desktop_theme_asset_url( $source['path'], $base_url, $version );
			if ( '' === $url ) {
				continue;
			}
			$sources[] = openstation_desktop_theme_css_url( $url )
				. ' format("' . $source['format'] . '")';
		}
		if ( empty( $sources ) ) {
			continue;
		}

		$lines = array( "\tfont-family: \"{$face['family']}\";" );
		foreach ( array(
			'style'        => 'font-style',
			'weight'       => 'font-weight',
			'stretch'      => 'font-stretch',
			'display'      => 'font-display',
			'unicodeRange' => 'unicode-range',
		) as $key => $descriptor ) {
			if ( ! empty( $face[ $key ] ) ) {
				$lines[] = "\t{$descriptor}: {$face[ $key ]};";
			}
		}
		$lines[] = "\tsrc: " . implode( ",\n\t\t", $sources ) . ';';

		$rules[] = "@font-face {\n" . implode( "\n", $lines ) . "\n}\n";
	}

	return empty( $rules ) ? '' : implode( '', $rules );
}
