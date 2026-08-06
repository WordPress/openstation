<?php
/**
 * OpenStation — Agents: WP Explorer integration.
 *
 * Adds the "Agents" entity to the WP Explorer window (via the
 * `openstation_my_wordpress_entities` filter) and ships the agents
 * section config on the window's `config` payload (via
 * `openstation_my_wordpress_window_args`). The bundle side registers
 * the `agent` entity-kind renderer.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Append the Agents entity to WP Explorer's entity list.
 *
 * @param array $entities Existing entity descriptors.
 * @return array
 */
function openstation_agents_my_wordpress_entity( $entities ) {
	if ( ! is_array( $entities ) || ! openstation_agents_user_can_read() ) {
		return $entities;
	}

	$entities[] = array(
		'id'       => 'agents',
		'label'    => __( 'Agents', 'desktop-mode' ),
		'icon'     => openstation_agent_avatar_url(),
		'restPath' => 'desktop-mode/v1/agents',
		'kind'     => 'agent',
	);

	return $entities;
}
add_filter( 'openstation_my_wordpress_entities', 'openstation_agents_my_wordpress_entity' );

/**
 * Ship the agents section config on the WP Explorer window config.
 *
 * `aiAvailable` is the cheap structural check (WP 7.0 AI Client +
 * Abilities API present); whether a connector is actually configured
 * is probed live by the renderer against `aiStatusUrl`, mirroring the
 * OS Settings Features tab, so a freshly configured connector is
 * picked up without a reload.
 *
 * @param array $window_args Args passed to `openstation_register_window()`.
 * @return array
 */
function openstation_agents_my_wordpress_window_args( $window_args ) {
	if ( ! is_array( $window_args ) || ! openstation_agents_user_can_read() ) {
		return $window_args;
	}

	if ( ! isset( $window_args['config'] ) || ! is_array( $window_args['config'] ) ) {
		$window_args['config'] = array();
	}

	$window_args['config']['agents'] = array(
		'canManage'     => openstation_agents_user_can_manage(),
		'canInvoke'     => openstation_agents_user_can_invoke(),
		'aiAvailable'   => function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available(),
		'aiStatusUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/status' ) ),
		'connectorsUrl' => esc_url_raw( admin_url( 'options-connectors.php' ) ),
		'runWindowId'   => 'desktop-mode-agent-run',
	);

	return $window_args;
}
add_filter( 'openstation_my_wordpress_window_args', 'openstation_agents_my_wordpress_window_args' );
