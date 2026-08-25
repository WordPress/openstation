<?php
/**
 * OpenStation — Agents: default agent definitions.
 *
 * Five ready-to-use agents seeded ONCE, and only on sites that have
 * no agents at all — an install that already built its own roster is
 * never touched (the seeded flag is set without creating anything).
 * Definitions are complete: role, ability allowlist, chat + send-to +
 * drag triggers, and full system prompts, so a fresh site can talk to
 * an agent the moment the feature flag turns on and a connector is
 * configured. Abilities that aren't registered on the site (the ai/*
 * family ships with the AI experiments plugin) are skipped by the
 * runner at tool-build time — allowlisting them here costs nothing
 * and lights them up when the provider plugin lands.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Option flag: defaults were seeded (or deliberately skipped).
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION = 'desktop_mode_agents_defaults_seeded';

require_once __DIR__ . '/default-definitions.php';

/**
 * Seed the default agents. Runs once per site: the option flag is set
 * whether or not anything was created, and sites that already have
 * agents are left exactly as they are.
 *
 * @return void
 */
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
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( '[openstation] Default agent "' . $definition['name'] . '" failed to seed: ' . $user->get_error_message() );
			continue;
		}
		openstation_agent_update( $user->ID, array( 'triggers' => $definition['triggers'] ) );
	}

	update_option( OPENSTATION_AGENTS_DEFAULTS_SEEDED_OPTION, '1', false );
}
/**
 * Hook wrapper — seed only on wp-admin requests by a user who could
 * create agents anyway. Keeps the seeder out of front-end requests,
 * cron, and the PHPUnit bootstrap (tests call the pure function).
 *
 * @return void
 */
function openstation_agents_maybe_seed_defaults() {
	if ( ! is_admin() || ! current_user_can( 'edit_users' ) ) {
		return;
	}
	openstation_agents_seed_defaults();
}
add_action( 'admin_init', 'openstation_agents_maybe_seed_defaults' );
