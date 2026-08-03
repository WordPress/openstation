<?php
/**
 * OpenStation — Agents: "Agent chat" native window.
 *
 * Lazy-loaded native window the Agents section opens to talk to an
 * agent (the chat trigger). The window is a shell — the dedicated
 * `agent-run-window` bundle registers the render callback on
 * `window.openStationNativeWindows['desktop-mode-agent-run']`,
 * subscribes to the cross-bundle `desktop-mode/agents-run` shared
 * store, and paints the conversation for whichever agent the opener
 * selected.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inline SVG bot icon — byte-identical to the agent avatar so the
 * motif is consistent everywhere agents appear.
 *
 * @return string Data URI.
 */
function open_station_agent_run_window_icon() {
	return open_station_agent_avatar_url();
}

/**
 * Register the bundle script + style handles. Lazy-loaded by the
 * native-window sync the first time the window opens, same as the
 * recycle-bin and posts-window modules.
 *
 * @return void
 */
function open_station_agent_run_register_assets() {
	$version = OPEN_STATION_VERSION;
	$suffix  = open_station_asset_suffix();

	$css_path = OPEN_STATION_DIR . 'assets/css/agents.css';
	wp_register_style(
		'desktop-mode-agent-run',
		OPEN_STATION_URL . 'assets/css/agents.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPEN_STATION_DIR . 'assets/js/agent-run-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-agent-run',
		OPEN_STATION_URL . 'assets/js/agent-run-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-agent-run',
		'desktop-mode',
		OPEN_STATION_DIR . 'languages'
	);
}
add_action( 'init', 'open_station_agent_run_register_assets', 5 );

/**
 * Static template rendered into the window body — the bundle mounts
 * its UI into `[data-os-agent-run-root]`.
 *
 * @return void
 */
function open_station_agent_run_render_template() {
	?>
	<div class="desktop-mode-agent-run" data-os-agent-run-root>
		<div class="os-agent-run__loading">
			<os-spinner></os-spinner>
		</div>
	</div>
	<?php
}

/**
 * Register the native window on `init` priority 25 — after the
 * registries boot.
 *
 * @return void
 */
function open_station_agent_run_window_register() {
	if ( ! function_exists( 'open_station_register_window' ) ) {
		return;
	}
	if ( ! open_station_agents_user_can_read() ) {
		return;
	}

	$registered = open_station_register_window(
		'desktop-mode-agent-run',
		array(
			'title'      => __( 'Agent chat', 'desktop-mode' ),
			'icon'       => open_station_agent_run_window_icon(),
			'template'   => 'open_station_agent_run_render_template',
			'script'     => 'desktop-mode-agent-run',
			'style'      => 'desktop-mode-agent-run',
			'width'      => 760,
			'height'     => 620,
			'min_width'  => 540,
			'min_height' => 380,
			'placement'  => 'none',
			// Chat invocations should always surface a visible window,
			// not race a focused window into the background.
			'autofocus'  => true,
			'config'     => array(
				'restRoot'    => esc_url_raw( rest_url() ),
				'restNonce'   => wp_create_nonce( 'wp_rest' ),
				'canManage'   => open_station_agents_user_can_manage(),
				// The viewer — the chat paints their avatar next to
				// their own messages, WhatsApp-style.
				'currentUser' => array(
					'id'        => (int) get_current_user_id(),
					'name'      => (string) wp_get_current_user()->display_name,
					'avatarUrl' => (string) get_avatar_url( get_current_user_id(), array( 'size' => 96 ) ),
				),
			),
		)
	);
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Agent chat window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'open_station_agent_run_window_register', 25 );
