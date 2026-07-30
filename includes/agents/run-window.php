<?php
/**
 * Desktop Mode — Agents: "Agent chat" native window.
 *
 * Lazy-loaded native window the Agents section opens to talk to an
 * agent (the chat trigger). The window is a shell — the dedicated
 * `agent-run-window` bundle registers the render callback on
 * `window.desktopModeNativeWindows['desktop-mode-agent-run']`,
 * subscribes to the cross-bundle `desktop-mode/agents-run` shared
 * store, and paints the conversation for whichever agent the opener
 * selected.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inline SVG bot icon — byte-identical to the agent avatar so the
 * motif is consistent everywhere agents appear.
 *
 * @return string Data URI.
 */
function desktop_mode_agent_run_window_icon() {
	return desktop_mode_agent_avatar_url();
}

/**
 * Register the bundle script + style handles. Lazy-loaded by the
 * native-window sync the first time the window opens, same as the
 * recycle-bin and posts-window modules.
 *
 * @return void
 */
function desktop_mode_agent_run_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = desktop_mode_asset_suffix();

	$css_path = DESKTOP_MODE_DIR . 'assets/css/agents.css';
	wp_register_style(
		'desktop-mode-agent-run',
		DESKTOP_MODE_URL . 'assets/css/agents.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = DESKTOP_MODE_DIR . 'assets/js/agent-run-window' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-agent-run',
		DESKTOP_MODE_URL . 'assets/js/agent-run-window' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-agent-run',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_agent_run_register_assets', 5 );

/**
 * Static template rendered into the window body — the bundle mounts
 * its UI into `[data-desktop-mode-agent-run-root]`.
 *
 * @return void
 */
function desktop_mode_agent_run_render_template() {
	?>
	<div class="desktop-mode-agent-run" data-desktop-mode-agent-run-root>
		<div class="desktop-mode-agent-run__loading">
			<wpd-spinner></wpd-spinner>
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
function desktop_mode_agent_run_window_register() {
	if ( ! function_exists( 'desktop_mode_register_window' ) ) {
		return;
	}
	if ( ! desktop_mode_agents_user_can_read() ) {
		return;
	}

	$registered = desktop_mode_register_window(
		'desktop-mode-agent-run',
		array(
			'title'      => __( 'Agent chat', 'desktop-mode' ),
			'icon'       => desktop_mode_agent_run_window_icon(),
			'template'   => 'desktop_mode_agent_run_render_template',
			'script'     => 'desktop-mode-agent-run',
			'style'      => 'desktop-mode-agent-run',
			'width'      => 520,
			'height'     => 620,
			'min_width'  => 360,
			'min_height' => 380,
			'placement'  => 'none',
			// Chat invocations should always surface a visible window,
			// not race a focused window into the background.
			'autofocus'  => true,
			'config'     => array(
				'restRoot'    => esc_url_raw( rest_url() ),
				'restNonce'   => wp_create_nonce( 'wp_rest' ),
				'canManage'   => desktop_mode_agents_user_can_manage(),
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
		error_log( '[desktop-mode] Agent chat window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'desktop_mode_agent_run_window_register', 25 );
