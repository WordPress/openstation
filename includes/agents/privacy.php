<?php
/**
 * Desktop Mode — Agents: Personal Data Export + Erasure hooks.
 *
 * Agents carry user-attributable data on their synthetic `wp_users`
 * row (display name, login, role) and in the definition meta
 * (description, instructions, abilities, triggers, model, rate limit,
 * invocation log). One exporter + one eraser, both keyed off the
 * target email: if it matches an agent's synthetic address, the whole
 * agent is returned / removed. Human users who created agents are NOT
 * considered owners for export/erasure purposes — agents are
 * admin-managed assets that survive a human-user erasure.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the personal-data exporter under the `desktop-mode-agents`
 * group.
 *
 * @param array $exporters Existing exporter registry.
 * @return array
 */
function desktop_mode_agents_register_personal_data_exporter( $exporters ) {
	$exporters['desktop-mode-agents'] = array(
		'exporter_friendly_name' => __( 'Desktop Mode agents', 'desktop-mode' ),
		'callback'               => 'desktop_mode_agents_personal_data_exporter',
	);
	return $exporters;
}
add_filter( 'wp_privacy_personal_data_exporters', 'desktop_mode_agents_register_personal_data_exporter' );

/**
 * Exporter callback.
 *
 * @param string $email_address Target user's email.
 * @param int    $page          1-indexed page (always done=true).
 * @return array
 */
function desktop_mode_agents_personal_data_exporter( $email_address, $page = 1 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
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
			'value' => desktop_mode_agent_get_description( (int) $user->ID ),
		),
		array(
			'name'  => __( 'Instructions (system prompt)', 'desktop-mode' ),
			'value' => desktop_mode_agent_get_instructions( (int) $user->ID ),
		),
	);

	$abilities = desktop_mode_agent_get_abilities( (int) $user->ID );
	if ( ! empty( $abilities ) ) {
		$rows[] = array(
			'name'  => __( 'Enabled abilities', 'desktop-mode' ),
			'value' => implode( ', ', $abilities ),
		);
	}

	$triggers = desktop_mode_agent_get_triggers( (int) $user->ID );
	if ( ! empty( $triggers ) ) {
		$rows[] = array(
			'name'  => __( 'Triggers (JSON)', 'desktop-mode' ),
			'value' => wp_json_encode( $triggers ),
		);
	}

	$model = desktop_mode_agent_get_model( (int) $user->ID );
	if ( '' !== $model ) {
		$rows[] = array(
			'name'  => __( 'Model override', 'desktop-mode' ),
			'value' => $model,
		);
	}

	$rate_limit = desktop_mode_agent_get_rate_limit( (int) $user->ID );
	if ( $rate_limit > 0 ) {
		$rows[] = array(
			'name'  => __( 'Rate limit (per hour)', 'desktop-mode' ),
			'value' => (string) $rate_limit,
		);
	}

	return array(
		'data' => array(
			array(
				'group_id'    => 'desktop-mode-agents',
				'group_label' => __( 'Desktop Mode agents', 'desktop-mode' ),
				'item_id'     => 'agent-' . (int) $user->ID,
				'data'        => $rows,
			),
		),
		'done' => true,
	);
}

/**
 * Register the personal-data eraser under the `desktop-mode-agents`
 * group.
 *
 * @param array $erasers Existing eraser registry.
 * @return array
 */
function desktop_mode_agents_register_personal_data_eraser( $erasers ) {
	$erasers['desktop-mode-agents'] = array(
		'eraser_friendly_name' => __( 'Desktop Mode agents', 'desktop-mode' ),
		'callback'             => 'desktop_mode_agents_personal_data_eraser',
	);
	return $erasers;
}
add_filter( 'wp_privacy_personal_data_erasers', 'desktop_mode_agents_register_personal_data_eraser' );

/**
 * Eraser callback. When the target email belongs to an agent, fully
 * delete it (the user row deletion removes every definition meta row).
 * Non-agent emails are a no-op.
 *
 * @param string $email_address Target user's email.
 * @param int    $page          1-indexed page (always done=true).
 * @return array
 */
function desktop_mode_agents_personal_data_eraser( $email_address, $page = 1 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return array(
			'items_removed'  => false,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);
	}

	$result = desktop_mode_agent_delete( (int) $user->ID );
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
