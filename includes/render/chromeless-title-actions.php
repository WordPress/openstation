<?php

defined( 'ABSPATH' ) || exit;

function openstation_chromeless_submenu_tab_urls() {
	global $submenu, $parent_file;

	$parent = is_string( $parent_file ) ? $parent_file : '';

	if ( '' === $parent || empty( $submenu[ $parent ] ) || ! is_array( $submenu[ $parent ] ) ) {
		return array();
	}

	$urls = array();

	foreach ( $submenu[ $parent ] as $sub_item ) {
		if ( empty( $sub_item[2] ) ) {
			continue;
		}
		if ( ! empty( $sub_item[1] ) && ! current_user_can( $sub_item[1] ) ) {
			continue;
		}

		if ( '' === openstation_menu_item_title( $sub_item[0] ?? '' ) ) {
			continue;
		}

		$url = openstation_menu_item_url( (string) $sub_item[2] );
		if ( '' !== $url ) {
			$urls[] = $url;
		}
	}

	return array_values( array_unique( $urls ) );
}

function openstation_chromeless_title_action_toggle_classes() {
	return array( 'aria-button-if-js', 'upload-view-toggle' );
}

function openstation_chromeless_css_attr_value( $url ) {
	$url = preg_replace( '/[\r\n<>]/', '', (string) $url );

	return str_replace( array( '\\', '"' ), array( '\\\\', '\\"' ), $url );
}

function openstation_chromeless_title_action_css( $tab_urls ) {
	if ( empty( $tab_urls ) ) {
		return '';
	}

	$admin_base = admin_url();
	$selectors  = array();

	$exclusions = '';
	foreach ( openstation_chromeless_title_action_toggle_classes() as $class ) {
		$exclusions .= ':not( .' . $class . ' )';
	}

	foreach ( $tab_urls as $url ) {
		$hrefs = array( $url );

		if ( str_starts_with( $url, $admin_base ) ) {
			$relative = substr( $url, strlen( $admin_base ) );
			if ( '' !== $relative ) {
				$hrefs[] = $relative;
			}
		}

		foreach ( $hrefs as $href ) {
			$selectors[] = '.os-chromeless .wrap .page-title-action[href="'
				. openstation_chromeless_css_attr_value( $href ) . '"]' . $exclusions;
		}
	}

	$selectors = array_values( array_unique( $selectors ) );

	return implode( ",\n", $selectors ) . " {\n\tdisplay: none;\n}\n";
}

function openstation_chromeless_title_action_styles() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$css = openstation_chromeless_title_action_css(
		openstation_chromeless_submenu_tab_urls()
	);

	if ( '' === $css ) {
		return;
	}

	wp_add_inline_style( 'os-chromeless', $css );
}
add_action( 'openstation_chromeless_styles', 'openstation_chromeless_title_action_styles' );
