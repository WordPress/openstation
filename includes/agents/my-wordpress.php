<?php
/**
 * Desktop Mode — Agents: My WordPress integration.
 *
 * Adds the "Agents" entity to the My WordPress window (via the
 * `desktop_mode_my_wordpress_entities` filter) and ships the agents
 * section config on the window's `config` payload (via
 * `desktop_mode_my_wordpress_window_args`). The bundle side registers
 * the `agent` entity-kind renderer.
 *
 * @package WPDesktopMode
 * @since   0.9.8
 */

defined( 'ABSPATH' ) || exit;

/**
 * Append the Agents entity to the My WordPress entity list.
 *
 * @since 0.9.8
 *
 * @param array $entities Existing entity descriptors.
 * @return array
 */
function desktop_mode_agents_my_wordpress_entity( $entities ) {
	if ( ! is_array( $entities ) || ! desktop_mode_agents_user_can_read() ) {
		return $entities;
	}

	$entities[] = array(
		'id'       => 'agents',
		'label'    => __( 'Agents', 'desktop-mode' ),
		'icon'     => desktop_mode_agent_avatar_data_uri(),
		'restPath' => 'desktop-mode/v1/agents',
		'kind'     => 'agent',
	);

	return $entities;
}
add_filter( 'desktop_mode_my_wordpress_entities', 'desktop_mode_agents_my_wordpress_entity' );

/**
 * Ship the agents section config on the My WordPress window config.
 *
 * `aiAvailable` is the cheap structural check (WP 7.0 AI Client +
 * Abilities API present); whether a connector is actually configured
 * is probed live by the renderer against `aiStatusUrl`, mirroring the
 * OS Settings Features tab, so a freshly configured connector is
 * picked up without a reload.
 *
 * @since 0.9.8
 *
 * @param array $window_args Args passed to `desktop_mode_register_window()`.
 * @return array
 */
function desktop_mode_agents_my_wordpress_window_args( $window_args ) {
	if ( ! is_array( $window_args ) || ! desktop_mode_agents_user_can_read() ) {
		return $window_args;
	}

	if ( ! isset( $window_args['config'] ) || ! is_array( $window_args['config'] ) ) {
		$window_args['config'] = array();
	}

	$window_args['config']['agents'] = array(
		'canManage'     => desktop_mode_agents_user_can_manage(),
		'canInvoke'     => desktop_mode_agents_user_can_invoke(),
		'aiAvailable'   => function_exists( 'desktop_mode_ai_is_available' ) && desktop_mode_ai_is_available(),
		'aiStatusUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/status' ) ),
		'connectorsUrl' => esc_url_raw( admin_url( 'options-connectors.php' ) ),
		'runWindowId'   => 'desktop-mode-agent-run',
	);

	return $window_args;
}
add_filter( 'desktop_mode_my_wordpress_window_args', 'desktop_mode_agents_my_wordpress_window_args' );
