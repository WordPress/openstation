<?php

defined( 'ABSPATH' ) || exit;

function openstation_games_style_handles( $set = null ) {
	static $handles = array();
	if ( null !== $set ) {
		$handles = array_values( array_unique( array_filter( array_map( 'strval', (array) $set ) ) ) );
	}
	return $handles;
}

function openstation_games_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'

		. '<path d="M21 21h22a13 13 0 0 1 12.6 9.8l2.8 11.2a7.5 7.5 0 0 1-13.6 5.8L40.5 41h-17l-4.3 6.8A7.5 7.5 0 0 1 5.6 42l2.8-11.2A13 13 0 0 1 21 21z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'

		. '<rect x="14" y="28.5" width="14" height="4.6" rx="2.3" fill="currentColor"/>'
		. '<rect x="18.7" y="23.8" width="4.6" height="14" rx="2.3" fill="currentColor"/>'

		. '<circle cx="40.5" cy="34" r="3.1" fill="currentColor"/>'
		. '<circle cx="47.5" cy="28.5" r="3.1" fill="currentColor"/>'
		. '</svg>';
}

function openstation_games_user_can_use() {
	$can = is_user_logged_in() && current_user_can( 'read' );

	return (bool) apply_filters( 'openstation_games_user_can_use', $can );
}

function openstation_games_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-games" data-os-games-root>
		<div class="os-games__library">
			<div class="os-games__grid" data-os-games-grid role="listbox" aria-label="<?php esc_attr_e( 'Games', 'desktop-mode' ); ?>"></div>
			<div class="os-games__detail" data-os-games-detail hidden></div>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	$filtered = (string) apply_filters( 'openstation_games_template_html', $html );
	echo wp_kses( $filtered, openstation_native_window_allowed_html() );
}

function openstation_games_register_window() {
	if ( ! openstation_games_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( openstation_games_icon_svg() );

	$window_args = array(
		'title'      => __( 'Games', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'openstation_games_render_template',
		'script'     => 'desktop-mode-games',

		'styles'     => array( 'desktop-mode-games' ),
		'width'      => 900,
		'height'     => 600,
		'min_width'  => 560,
		'min_height' => 400,

		'placement'  => 'none',
	);

	$window_args = (array) apply_filters( 'openstation_games_window_args', $window_args );

	openstation_games_style_handles( $window_args['styles'] );

	$registered = openstation_register_window( 'desktop-mode-games', $window_args );
	if ( is_wp_error( $registered ) ) {

		error_log( '[openstation] Games window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Games', 'desktop-mode' ),
		'icon_svg' => openstation_games_icon_svg(),
		'window'   => 'desktop-mode-games',
		'position' => 85,
	);

	$icon_args = (array) apply_filters( 'openstation_games_icon_args', $icon_args );

	openstation_register_icon( 'desktop-mode-games', $icon_args );
}
add_action( 'init', 'openstation_games_register_window', 20 );

function openstation_games_localize_config() {
	if ( ! openstation_games_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-games',
		'openStationGamesConfig',
		array(
			'restNonce'      => wp_create_nonce( 'wp_rest' ),
			'gamesUrlBase'   => esc_url_raw( rest_url( 'desktop-mode/v1/games' ) ),
			'challengesUrl'  => esc_url_raw( rest_url( 'desktop-mode/v1/games/challenges' ) ),
			'usersSearchUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/games/users/search' ) ),
		)
	);
}

add_action( 'admin_enqueue_scripts', 'openstation_games_localize_config', 5 );
