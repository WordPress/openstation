<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION = 'desktop_mode_agents_defaults_seeded';

require_once __DIR__ . '/default-definitions.php';

function openstation_agents_seed_defaults() {
	if ( get_option( OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION ) ) {
		return;
	}

	$existing = openstation_agent_get_agents();
	if ( ! empty( $existing ) ) {
		update_option( OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION, '1', false );
		return;
	}

	foreach ( openstation_agents_default_definitions() as $definition ) {
		$user = openstation_agent_create(
			array(
				'name'         => $definition['name'],
				'role'         => $definition['role'],
				'description'  => $definition['description'],
				'instructions' => $definition['instructions'],
				'abilities'    => $definition['abilities'],
				'vibes'        => $definition['vibes'],
				'face'         => $definition['face'],
				'faceSeed'     => $definition['faceSeed'],
			)
		);
		if ( is_wp_error( $user ) ) {

			error_log( '[openstation] Default agent "' . $definition['name'] . '" failed to seed: ' . $user->get_error_message() );
			continue;
		}
		openstation_agent_update( $user->ID, array( 'triggers' => $definition['triggers'] ) );
	}

	update_option( OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION, '1', false );
}

function openstation_agents_maybe_seed_defaults() {
	if ( ! is_admin() || ! current_user_can( 'edit_users' ) ) {
		return;
	}
	openstation_agents_seed_defaults();
}
add_action( 'admin_init', 'openstation_agents_maybe_seed_defaults' );
