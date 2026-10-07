<?php

defined( 'ABSPATH' ) || exit;

function openstation_agent_run_window_icon() {
	return openstation_agent_avatar_url();
}

function openstation_agent_run_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/agents.css';
	wp_register_style(
		'desktop-mode-agent-run',
		OPENSTATION_URL . 'assets/css/agents.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPENSTATION_DIR . 'assets/js/agent-run-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-agent-run',
		OPENSTATION_URL . 'assets/js/agent-run-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-agent-run',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_agent_run_register_assets', 5 );

function openstation_agent_run_render_template() {
	?>
	<div class="desktop-mode-agent-run" data-os-agent-run-root>
		<div class="os-agent-run__loading">
			<os-spinner></os-spinner>
		</div>
	</div>
	<?php
}

function openstation_agent_run_window_register() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}
	if ( ! openstation_agents_user_can_read() ) {
		return;
	}

	$registered = openstation_register_window(
		'desktop-mode-agent-run',
		array(
			'title'      => __( 'Agent chat', 'desktop-mode' ),
			'icon'       => openstation_agent_run_window_icon(),
			'template'   => 'openstation_agent_run_render_template',
			'script'     => 'desktop-mode-agent-run',
			'styles'     => array( 'desktop-mode-agent-run' ),
			'width'      => 760,
			'height'     => 620,
			'min_width'  => 540,
			'min_height' => 380,
			'placement'  => 'none',

			'autofocus'  => true,
			'config'     => array(
				'restRoot'    => esc_url_raw( rest_url() ),
				'restNonce'   => wp_create_nonce( 'wp_rest' ),
				'canManage'   => openstation_agents_user_can_manage(),

				'currentUser' => array(
					'id'        => (int) get_current_user_id(),
					'name'      => openstation_plain_text_title( wp_get_current_user()->display_name ),
					'avatarUrl' => (string) get_avatar_url( get_current_user_id(), array( 'size' => 96 ) ),
				),
			),
		)
	);
	if ( is_wp_error( $registered ) ) {

		error_log( '[openstation] Agent chat window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_agent_run_window_register', 25 );
