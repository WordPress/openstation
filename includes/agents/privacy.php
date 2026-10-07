<?php

defined( 'ABSPATH' ) || exit;

function openstation_agents_register_personal_data_exporter( $exporters ) {
	$exporters['os-agents'] = array(
		'exporter_friendly_name' => __( 'OpenStation agents', 'desktop-mode' ),
		'callback'               => 'openstation_agents_personal_data_exporter',
	);
	return $exporters;
}
add_filter( 'wp_privacy_personal_data_exporters', 'openstation_agents_register_personal_data_exporter' );

function openstation_agents_personal_data_exporter( $email_address, $page = 1 ) {
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return array(
			'data' => array(),
			'done' => true,
		);
	}

	$role = is_array( $user->roles ) && ! empty( $user->roles )
		? (string) reset( $user->roles )
		: '';

	$rows = array(
		array(
			'name'  => __( 'Agent display name', 'desktop-mode' ),
			'value' => (string) $user->display_name,
		),
		array(
			'name'  => __( 'Agent user_login', 'desktop-mode' ),
			'value' => (string) $user->user_login,
		),
		array(
			'name'  => __( 'Role', 'desktop-mode' ),
			'value' => $role,
		),
		array(
			'name'  => __( 'Description', 'desktop-mode' ),
			'value' => openstation_agent_get_description( (int) $user->ID ),
		),
		array(
			'name'  => __( 'Instructions (system prompt)', 'desktop-mode' ),
			'value' => openstation_agent_get_instructions( (int) $user->ID ),
		),
	);

	$abilities = openstation_agent_get_abilities( (int) $user->ID );
	if ( ! empty( $abilities ) ) {
		$rows[] = array(
			'name'  => __( 'Enabled abilities', 'desktop-mode' ),
			'value' => implode( ', ', $abilities ),
		);
	}

	$triggers = openstation_agent_get_triggers( (int) $user->ID );
	if ( ! empty( $triggers ) ) {
		$rows[] = array(
			'name'  => __( 'Triggers (JSON)', 'desktop-mode' ),
			'value' => wp_json_encode( $triggers ),
		);
	}

	$model = openstation_agent_get_model( (int) $user->ID );
	if ( '' !== $model ) {
		$rows[] = array(
			'name'  => __( 'Model override', 'desktop-mode' ),
			'value' => $model,
		);
	}

	$rate_limit = openstation_agent_get_rate_limit( (int) $user->ID );
	if ( $rate_limit > 0 ) {
		$rows[] = array(
			'name'  => __( 'Rate limit (per hour)', 'desktop-mode' ),
			'value' => (string) $rate_limit,
		);
	}

	$vibes = openstation_agent_get_vibes( (int) $user->ID );
	if ( '' !== $vibes ) {
		$rows[] = array(
			'name'  => __( 'Voice', 'desktop-mode' ),
			'value' => $vibes,
		);
	}

	$face = (string) get_user_meta( (int) $user->ID, OPENSTATION_AGENT_FACE_META, true );
	if ( '' !== $face ) {
		$rows[] = array(
			'name'  => __( 'Face (JSON)', 'desktop-mode' ),
			'value' => $face,
		);
	}

	return array(
		'data' => array(
			array(
				'group_id'    => 'os-agents',
				'group_label' => __( 'OpenStation agents', 'desktop-mode' ),
				'item_id'     => 'agent-' . (int) $user->ID,
				'data'        => $rows,
			),
		),
		'done' => true,
	);
}

function openstation_agents_register_personal_data_eraser( $erasers ) {
	$erasers['os-agents'] = array(
		'eraser_friendly_name' => __( 'OpenStation agents', 'desktop-mode' ),
		'callback'             => 'openstation_agents_personal_data_eraser',
	);
	return $erasers;
}
add_filter( 'wp_privacy_personal_data_erasers', 'openstation_agents_register_personal_data_eraser' );

function openstation_agents_personal_data_eraser( $email_address, $page = 1 ) {
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return array(
			'items_removed'  => false,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);
	}

	$result = openstation_agent_delete( (int) $user->ID );
	if ( is_wp_error( $result ) ) {
		return array(
			'items_removed'  => false,
			'items_retained' => true,
			'messages'       => array( $result->get_error_message() ),
			'done'           => true,
		);
	}

	return array(
		'items_removed'  => true,
		'items_retained' => false,
		'messages'       => array(),
		'done'           => true,
	);
}
