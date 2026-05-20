<?php
/**
 * Desktop Mode — Agents: Personal Data Export + Erasure hooks.
 *
 * Aligned with the WordPress Core memory-store vision (Gutenberg PR
 * #78296 + tracking issue #77230): "A memory written for a user is
 * personal data the moment it's written, and the request to export
 * or erase it should reach the memory store the same way it reaches
 * posts and comments."
 *
 * Agents (skill-tagged `wp_guideline` posts paired with synthetic
 * `wp_users` rows) carry user-attributable data in two places:
 *
 *   1. The synthetic user row's display name / email / role.
 *   2. The guideline post's title / excerpt / content / meta.
 *
 * We register one exporter + one eraser, both keyed off the target
 * email. If the email matches an agent's synthetic address, the
 * whole agent is returned / removed. Human users authoring agents
 * are NOT considered owners for export/erasure purposes — agents
 * are admin-managed assets that survive a human-user erasure
 * cascading through any of their authored content.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the personal-data exporter under the
 * `desktop-mode-agents` group.
 *
 * @since 0.23.0
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
 * Exporter callback. WordPress core calls this with the requester
 * email and a page number; we return the agent shape if the email
 * is the synthetic address of an agent on this site.
 *
 * @since 0.23.0
 *
 * @param string $email_address Target user's email.
 * @param int    $page          1-indexed page (we always return done=true).
 * @return array
 */
function desktop_mode_agents_personal_data_exporter( $email_address, $page = 1 ) {
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return array(
			'data' => array(),
			'done' => true,
		);
	}

	$guideline = function_exists( 'desktop_mode_agents_get_guideline_for_user' )
		? desktop_mode_agents_get_guideline_for_user( $user->ID )
		: null;
	$role = is_array( $user->roles ) && ! empty( $user->roles )
		? (string) reset( $user->roles )
		: '';
	$abilities = ( $guideline instanceof WP_Post && function_exists( 'desktop_mode_agents_get_abilities' ) )
		? desktop_mode_agents_get_abilities( $guideline->ID )
		: array();
	$triggers = function_exists( 'desktop_mode_agent_get_triggers' )
		? desktop_mode_agent_get_triggers( $user->ID )
		: array();
	$model = function_exists( 'desktop_mode_agent_get_model' )
		? desktop_mode_agent_get_model( $user->ID )
		: '';
	$rate_limit = function_exists( 'desktop_mode_agent_get_rate_limit' )
		? desktop_mode_agent_get_rate_limit( $user->ID )
		: 0;

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
	);

	if ( $guideline instanceof WP_Post ) {
		$rows[] = array(
			'name'  => __( 'Description', 'desktop-mode' ),
			'value' => (string) $guideline->post_excerpt,
		);
		$rows[] = array(
			'name'  => __( 'Instructions (system prompt)', 'desktop-mode' ),
			'value' => (string) $guideline->post_content,
		);
		$rows[] = array(
			'name'  => __( 'Status', 'desktop-mode' ),
			'value' => (string) $guideline->post_status,
		);
	}

	if ( ! empty( $abilities ) ) {
		$rows[] = array(
			'name'  => __( 'Enabled abilities', 'desktop-mode' ),
			'value' => implode( ', ', $abilities ),
		);
	}

	if ( ! empty( $triggers ) ) {
		$rows[] = array(
			'name'  => __( 'Triggers (JSON)', 'desktop-mode' ),
			'value' => wp_json_encode( $triggers ),
		);
	}

	if ( '' !== $model ) {
		$rows[] = array(
			'name'  => __( 'Model override', 'desktop-mode' ),
			'value' => $model,
		);
	}

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
 * @since 0.23.0
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
 * Eraser callback. When the target email belongs to a synthetic
 * agent user, fully delete the agent (user + linked guideline +
 * abilities meta + triggers / bindings user-meta). Non-agent emails
 * are a no-op.
 *
 * @since 0.23.0
 *
 * @param string $email_address Target user's email.
 * @param int    $page          1-indexed page (we always return done=true).
 * @return array
 */
function desktop_mode_agents_personal_data_eraser( $email_address, $page = 1 ) {
	$user = get_user_by( 'email', $email_address );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return array(
			'items_removed'  => false,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);
	}

	$result = function_exists( 'desktop_mode_agent_delete' )
		? desktop_mode_agent_delete( (int) $user->ID )
		: new WP_Error( 'desktop_mode_agent_delete_unavailable', '' );

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
