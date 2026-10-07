<?php

defined( 'ABSPATH' ) || exit;

function openstation_recycle_bin_icon_svg( $full = false ) {

	$lid_transform = $full
		? ' transform="translate(0 -4) rotate(12 52 21.5)"'
		: '';

	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<g' . $lid_transform . '>'

		. '<path d="M25 19v-2.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5V19" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'

		. '<rect x="10" y="19" width="44" height="5" rx="2.5" fill="currentColor"/>'
		. '</g>'

		. '<path d="M15.5 28.5h33l-1.2 24a3.5 3.5 0 0 1-3.5 3H20.2a3.5 3.5 0 0 1-3.5-3z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';

	if ( $full ) {

		$svg .= '<path d="M29.7 38 27.4 39.5 24.7 39.6 23.6 37.1 24.1 34.4 26.8 34.1 29.2 35.1'
			. 'ZM39.4 44.1 36.7 43.5 34.8 41.6 35.8 39.1 38.1 37.6 40.2 39.3 41.1 41.8'
			. 'ZM28.1 50.4 27 47.9 27.4 45.2 30 44.6 32.6 45.6 32.4 48.3 31 50.5Z"'
			. ' fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';

		$svg .= '<path d="M30 26 27.3 30 22.7 31.7 19.5 28.2 18.6 23.4 22.8 20.7 27.6 21.6Z"'
			. ' fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
	}

	return $svg . '</svg>';
}

function openstation_recycle_bin_icon_uris() {
	return array(
		'empty' => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( false ) ),
		'full'  => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( true ) ),
	);
}

function openstation_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_use', $can );
}

function openstation_recycle_bin_enqueue_style() {
	if ( ! openstation_recycle_bin_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-recycle-bin' );
}
add_action( 'admin_enqueue_scripts', 'openstation_recycle_bin_enqueue_style', 5 );

function openstation_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$icons = openstation_recycle_bin_icon_uris();

	$config['recycleBinCount']     = openstation_recycle_bin_count();
	$config['recycleBinCountUrl']  = esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) );
	$config['recycleBinPostTypes'] = openstation_recycle_bin_capture_post_types();
	$config['recycleBinIconEmpty'] = $icons['empty'];
	$config['recycleBinIconFull']  = $icons['full'];
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_recycle_bin_inject_shell_config', 20 );
