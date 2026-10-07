<?php

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/default-definitions.php';

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

		'enabled'  => openstation_agents_enabled(),
	);

	return $entities;
}
add_filter( 'openstation_my_wordpress_entities', 'openstation_agents_my_wordpress_entity' );

function openstation_agents_preview_cast() {
	$names = wp_roles()->get_names();
	$cast  = array();

	foreach ( openstation_agents_default_definitions() as $definition ) {
		$role = $definition['role'];

		$cast[] = array(
			'name'        => $definition['name'],
			'vibes'       => $definition['vibes'],
			'description' => $definition['description'],
			'role'        => $role,
			'roleLabel'   => isset( $names[ $role ] ) ? translate_user_role( $names[ $role ] ) : $role,
			'face'        => openstation_mio_narrow_look( $definition['face'] ),
		);
	}

	return $cast;
}
