<?php

defined( 'ABSPATH' ) || exit;

require_once OPENSTATION_DIR . 'includes/agents/guard.php';

function openstation_agent_avatar_url( $user_id = 0 ) {

	if ( $user_id > 0 && function_exists( 'openstation_agent_face_url' ) ) {
		$face = openstation_agent_face_url( (int) $user_id );
		if ( '' !== $face ) {
			return $face;
		}
	}
	return OPENSTATION_URL . 'assets/images/agent-avatar.svg';
}

function openstation_agents_user_can_read() {

	return (bool) apply_filters( 'openstation_agents_user_can_read', current_user_can( 'edit_posts' ) );
}

function openstation_agents_user_can_manage() {

	return (bool) apply_filters( 'openstation_agents_user_can_manage', current_user_can( 'edit_users' ) );
}

function openstation_agents_user_can_invoke() {

	return (bool) apply_filters( 'openstation_agents_user_can_invoke', current_user_can( 'edit_posts' ) );
}

function openstation_agents_enabled() {
	$options = openstation_get_extended_options();
	$enabled = ! empty( $options['agents'] );

	return (bool) apply_filters( 'openstation_agents_enabled', $enabled );
}

require_once OPENSTATION_DIR . 'includes/agents/my-wordpress.php';

require_once OPENSTATION_DIR . 'includes/agents/jobs.php';

function openstation_agents_load() {
	if ( ! openstation_agents_enabled() ) {
		return;
	}

	require_once OPENSTATION_DIR . 'includes/agents/store.php';
	require_once OPENSTATION_DIR . 'includes/agents/defaults.php';
	require_once OPENSTATION_DIR . 'includes/agents/identity.php';
	require_once OPENSTATION_DIR . 'includes/agents/face.php';
	require_once OPENSTATION_DIR . 'includes/agents/abilities.php';
	require_once OPENSTATION_DIR . 'includes/agents/runner.php';
	require_once OPENSTATION_DIR . 'includes/agents/draft.php';
	require_once OPENSTATION_DIR . 'includes/agents/rest.php';
	require_once OPENSTATION_DIR . 'includes/agents/conversations.php';
	require_once OPENSTATION_DIR . 'includes/agents/privacy.php';
	require_once OPENSTATION_DIR . 'includes/agents/run-window.php';
}
add_action( 'plugins_loaded', 'openstation_agents_load', 5 );
