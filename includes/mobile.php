<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_MODE_MOBILE_MAX_WIDTH = 767;

const OPENSTATION_MODE_TABLET_MAX_WIDTH = 1024;

function openstation_mode_preference( $user_id = null ) {
	$user_id  = null === $user_id ? get_current_user_id() : (int) $user_id;
	$settings = openstation_get_os_settings( $user_id );
	$saved    = isset( $settings['mobileLayout'] ) ? (string) $settings['mobileLayout'] : 'auto';

	$preference = apply_filters( 'openstation_mode_preference', $saved, $user_id );

	return in_array( $preference, OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS, true )
		? $preference
		: $saved;
}

function openstation_mode_breakpoints() {
	$defaults = array(
		'mobile' => OPENSTATION_MODE_MOBILE_MAX_WIDTH,
		'tablet' => OPENSTATION_MODE_TABLET_MAX_WIDTH,
	);

	$raw = apply_filters( 'openstation_mode_breakpoints', $defaults );
	$raw = is_array( $raw ) ? $raw : array();

	$mobile = isset( $raw['mobile'] ) && is_numeric( $raw['mobile'] ) && (int) $raw['mobile'] > 0
		? (int) $raw['mobile']
		: $defaults['mobile'];
	$tablet = isset( $raw['tablet'] ) && is_numeric( $raw['tablet'] ) && (int) $raw['tablet'] > 0
		? (int) $raw['tablet']
		: $defaults['tablet'];

	return array(
		'mobile' => $mobile,
		'tablet' => max( $mobile + 1, $tablet ),
	);
}

function openstation_mobile_tab_bar() {
	$defaults = array( 'menu-posts', 'menu-media', 'menu-comments' );

	$ids = apply_filters( 'openstation_mobile_tab_bar', $defaults );
	if ( ! is_array( $ids ) ) {
		return $defaults;
	}

	$out  = array();
	$seen = array();
	foreach ( $ids as $id ) {
		if ( ! is_string( $id ) || '' === $id ) {
			continue;
		}
		$slug = sanitize_key( openstation_canonical_nav_id( $id ) );
		if ( '' === $slug || isset( $seen[ $slug ] ) ) {
			continue;
		}
		$seen[ $slug ] = true;
		$out[]         = $slug;
		if ( count( $out ) >= OPENSTATION_OS_SETTINGS_MOBILE_TABS_MAX ) {
			break;
		}
	}
	return $out;
}

function openstation_mode_config( $user_id = null ) {
	return array(
		'preference'  => openstation_mode_preference( $user_id ),
		'breakpoints' => openstation_mode_breakpoints(),
		'tabBar'      => openstation_mobile_tab_bar(),
	);
}

function openstation_mode_hint_is_mobile( $user_id = null ) {
	$preference = openstation_mode_preference( $user_id );
	if ( 'mobile' === $preference ) {
		return true;
	}
	if ( 'desktop' === $preference ) {
		return false;
	}
	return function_exists( 'wp_is_mobile' ) && wp_is_mobile();
}

function openstation_mode_stamp_script( $preference, $breakpoints ) {
	$preference = in_array( $preference, OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS, true )
		? $preference
		: 'auto';
	$mobile     = (int) $breakpoints['mobile'];
	$tablet     = (int) $breakpoints['tablet'];

	return '(function(){var p=' . wp_json_encode( $preference ) . ','
		. 'w=window.innerWidth||0,'
		. 'm=p==="mobile"?"mobile":p==="desktop"?"desktop":'
		. 'w<=' . $mobile . '?"mobile":w<=' . $tablet . '?"tablet":"desktop",'
		. 'd=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)'
		. '||navigator.standalone===true?"standalone":"browser",'
		. 'h=document.documentElement;'
		. 'h.setAttribute("data-os-mode",m);h.setAttribute("data-os-display",d);})();';
}

function openstation_print_mode_stamp() {
	if ( ! function_exists( 'openstation_is_shell_request' ) || ! openstation_is_shell_request() ) {
		return;
	}
	$script = openstation_mode_stamp_script(
		openstation_mode_preference(),
		openstation_mode_breakpoints()
	);
	if ( function_exists( 'wp_print_inline_script_tag' ) ) {
		wp_print_inline_script_tag( $script, array( 'id' => 'os-mode-stamp' ) );
		return;
	}

	echo '<script id="os-mode-stamp">' . $script . '</script>' . "\n";
}
add_action( 'admin_head', 'openstation_print_mode_stamp', 0 );

function openstation_mode_viewport_meta( $meta ) {
	if ( ! function_exists( 'openstation_is_shell_request' ) || ! openstation_is_shell_request() ) {
		return $meta;
	}
	$meta = (string) $meta;
	if ( false === strpos( $meta, 'viewport-fit' ) ) {
		$meta .= ',viewport-fit=cover';
	}
	if ( false === strpos( $meta, 'interactive-widget' ) ) {
		$meta .= ',interactive-widget=resizes-content';
	}
	if ( false === strpos( $meta, 'maximum-scale' ) ) {
		$meta .= ',maximum-scale=1';
	}
	if ( false === strpos( $meta, 'user-scalable' ) ) {
		$meta .= ',user-scalable=no';
	}
	return $meta;
}
add_filter( 'admin_viewport_meta', 'openstation_mode_viewport_meta' );
