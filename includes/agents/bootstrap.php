<?php
/**
 * OpenStation — Agents module bootstrap.
 *
 * Agents are durable workers that live on the site as real WordPress
 * users and act through the WordPress Abilities API under their own
 * role and capabilities. Three layers:
 *
 *  - Guard      — the marker meta, the agent test, and every login /
 *                 session block → guard.php (ALWAYS loaded)
 *  - Identity   — the synthetic `wp_users` row itself → identity.php
 *  - Definition — everything else (system prompt, description, ability
 *                 allowlist, triggers, model override, rate limit) as
 *                 user meta on that row → store.php
 *
 * Plus the abilities bridge + runner (runner.php), a REST surface at
 * `/desktop-mode/v1/agents` (rest.php), privacy hooks (privacy.php),
 * the "Agent chat" native window (run-window.php), and the Agents
 * section inside WP Explorer (my-wordpress.php).
 *
 * The module is opt-in behind the `agents` extended option — while
 * off, no user-meta registration, no REST routes and no chat window.
 * Two files load regardless of the flag: guard.php and
 * my-wordpress.php. See below for why.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The authentication guard loads unconditionally, ahead of the feature
 * flag. Disabling the Agents framework does not delete the agent user
 * rows, and an agent row whose login blocks unloaded with the feature
 * would accept application passwords and password resets again. The
 * blocks are a property of the rows, not of the feature.
 */
require_once OPENSTATION_DIR . 'includes/agents/guard.php';

// ---------------------------------------------------------------------------
// Always-available helpers
//
// The capability helpers and the avatar URL live here rather than in
// rest.php / identity.php because the WP Explorer integration needs
// all four to build its entity descriptor, and it now loads while the
// feature flag is off — when neither of those files is loaded.
// ---------------------------------------------------------------------------

/**
 * URL of the bot avatar as a real static file.
 *
 * The avatar MUST be a file URL, not the data URI: consumers routinely
 * run avatar URLs through `esc_url()` (wp-admin's `get_avatar()`, the
 * desktop user-tile renderer), and `data` is not in
 * `wp_allowed_protocols()` — the data URI silently becomes an empty
 * string and the avatar renders broken.
 *
 * With an agent id, this is that agent's profile picture (with its
 * permanent AGENT ribbon) or Mio portrait when one has been written.
 * Without one, or before the face file exists, it is the shipped robot
 * glyph, which is what every agent wore before faces.
 *
 * @param int $user_id Agent user id, or 0 for the generic glyph.
 * @return string
 */
function openstation_agent_avatar_url( $user_id = 0 ) {
	// Called with no argument for the generic case: the WP Explorer
	// section icon, and the fallback for an agent that has no face yet.
	// A section icon wearing one agent's face would be wrong.
	if ( $user_id > 0 && function_exists( 'openstation_agent_face_url' ) ) {
		$face = openstation_agent_face_url( (int) $user_id );
		if ( '' !== $face ) {
			return $face;
		}
	}
	return OPENSTATION_URL . 'assets/images/agent-avatar.svg';
}

/**
 * Whether the current user can see agents.
 *
 * @return bool
 */
function openstation_agents_user_can_read() {
	/**
	 * Filter whether the current user can read OpenStation agents.
	 *
	 * @param bool $can Default: `edit_posts` capability.
	 */
	return (bool) apply_filters( 'openstation_agents_user_can_read', current_user_can( 'edit_posts' ) );
}

/**
 * Whether the current user can create / edit / delete agents.
 *
 * @return bool
 */
function openstation_agents_user_can_manage() {
	/**
	 * Filter whether the current user can manage OpenStation agents.
	 *
	 * @param bool $can Default: `edit_users` capability.
	 */
	return (bool) apply_filters( 'openstation_agents_user_can_manage', current_user_can( 'edit_users' ) );
}

/**
 * Whether the current user can invoke agents.
 *
 * @return bool
 */
function openstation_agents_user_can_invoke() {
	/**
	 * Filter whether the current user can invoke OpenStation agents.
	 *
	 * @param bool $can Default: `edit_posts` capability.
	 */
	return (bool) apply_filters( 'openstation_agents_user_can_invoke', current_user_can( 'edit_posts' ) );
}

/**
 * Whether the Agents framework is enabled site-wide.
 *
 * Backed by the `agents` key of the extended options bundle
 * (`openstation_get_extended_options()`), default off — opt-in.
 *
 * @return bool
 */
function openstation_agents_enabled() {
	$options = openstation_get_extended_options();
	$enabled = ! empty( $options['agents'] );

	/**
	 * Filters whether the Agents framework is enabled site-wide.
	 *
	 * Runs on `plugins_loaded` (priority 5) to decide whether the
	 * agents module loads at all, and again at runtime wherever the
	 * enabled state is consulted.
	 *
	 * @param bool $enabled Whether the Agents framework is enabled.
	 */
	return (bool) apply_filters( 'openstation_agents_enabled', $enabled );
}

/**
 * The WP Explorer integration also loads unconditionally, so the Agents
 * section is always discoverable: a site that has never turned the
 * framework on still shows the tile, and the section explains how to
 * switch it on instead of hiding the feature from the one person who
 * could enable it. Everything inside renders inert while the flag is
 * off — `openstation_agents_my_wordpress_window_args()` ships
 * `enabled => false`, and the renderer disables every control and skips
 * every fetch (the REST routes genuinely do not exist while off).
 *
 * Loaded after the helpers above, which it needs to build the entity
 * descriptor and the section config.
 */
require_once OPENSTATION_DIR . 'includes/agents/my-wordpress.php';

/**
 * Loads the agents module when the framework is enabled.
 *
 * @access private
 */
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
