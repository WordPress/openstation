<?php
/**
 * Desktop Mode — Agents module bootstrap.
 *
 * Agents are durable workers that live on the site as real WordPress
 * users and act through the WordPress Abilities API under their own
 * role and capabilities. Two layers:
 *
 *  - Identity   — a synthetic `wp_users` row with every login path
 *                 blocked → identity.php
 *  - Definition — everything else (system prompt, description, ability
 *                 allowlist, triggers, model override, rate limit) as
 *                 user meta on that row → store.php
 *
 * Plus the abilities bridge + runner (runner.php), a REST surface at
 * `/desktop-mode/v1/agents` (rest.php), privacy hooks (privacy.php),
 * the "Agent chat" native window (run-window.php), and the Agents
 * section inside My WordPress (my-wordpress.php).
 *
 * The whole module is opt-in behind the `agents` extended option —
 * while off, none of these files load: no user-meta registration, no
 * REST routes, no window, no My WordPress entity.
 *
 * @package WPDesktopMode
 * @since   0.9.8
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the Agents framework is enabled site-wide.
 *
 * Backed by the `agents` key of the extended options bundle
 * (`desktop_mode_get_extended_options()`), default off — opt-in.
 *
 * @since 0.9.8
 *
 * @return bool
 */
function desktop_mode_agents_enabled() {
	$options = desktop_mode_get_extended_options();
	$enabled = ! empty( $options['agents'] );

	/**
	 * Filters whether the Agents framework is enabled site-wide.
	 *
	 * Runs on `plugins_loaded` (priority 5) to decide whether the
	 * agents module loads at all, and again at runtime wherever the
	 * enabled state is consulted.
	 *
	 * @since 0.9.8
	 *
	 * @param bool $enabled Whether the Agents framework is enabled.
	 */
	return (bool) apply_filters( 'desktop_mode_agents_enabled', $enabled );
}

/**
 * Loads the agents module when the framework is enabled.
 *
 * @since 0.9.8
 *
 * @access private
 */
function desktop_mode_agents_load() {
	if ( ! desktop_mode_agents_enabled() ) {
		return;
	}

	require_once DESKTOP_MODE_DIR . 'includes/agents/store.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/identity.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/abilities.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/runner.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/rest.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/privacy.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/run-window.php';
	require_once DESKTOP_MODE_DIR . 'includes/agents/my-wordpress.php';
}
add_action( 'plugins_loaded', 'desktop_mode_agents_load', 5 );
