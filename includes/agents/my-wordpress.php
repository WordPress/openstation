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
 * This file loads regardless of the `agents` extended option (see
 * bootstrap.php) so the section is always discoverable. While the flag
 * is off the config carries `enabled => false` and the renderer paints
 * the section read-only — no REST call is attempted, because the
 * routes are not registered. It also carries `preview`, the cast the
 * site would get, read straight from `default-definitions.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The roster as data. Deliberately not `defaults.php`, which registers
 * a seeder at file scope and needs the whole agents module behind it:
 * this file runs with the feature flag off, where none of that exists.
 */
require_once __DIR__ . '/default-definitions.php';

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
		// The section is listed even with the feature off, so it can
		// render its own "disabled" preview and say how to enable it.
		// The REST route is NOT registered in that state, so anything
		// that probes `restPath` gets a 404 — and because the count
		// probe is a tracked fetch attributed to the window, the title
		// bar painted it as "Not saved. Request failed (HTTP 404)" on
		// every open, in the default install state. Clients skip the
		// probe when this is false.
		'enabled'  => openstation_agents_enabled(),
	);

	return $entities;
}
add_filter( 'openstation_my_wordpress_entities', 'openstation_agents_my_wordpress_entity' );

/**
 * The cast a site would get, for the flag-off state.
 *
 * A site that has never switched Agents on has no agents: `defaults.php`
 * only loads inside the flag, so the seeder has never run. That used to
 * make the off-state a paragraph of explanatory text, which is a weak
 * argument for turning something on. These are the same five cards the
 * grid draws once the flag is on, greyed and inert above the button
 * that flips it. Seeing who you would get is the argument.
 *
 * Only what a card draws: a name, a voice, what it is good for, and a
 * face. The instructions and the abilities are the bulk of a
 * definition and none of them are on screen here, so they stay out of
 * a payload that ships on every WP Explorer window open.
 *
 * Faces go through `openstation_mio_narrow_look()`, the same narrowing
 * the store applies when an agent saves one, so a preview cannot show
 * a face the seeder would then clamp into a different one.
 *
 * The role arrives already translated. A real card reads its label out
 * of the `/agents/roles` catalogue, and that route does not exist while
 * the flag is off — left to the client the badge would fall back to the
 * raw slug and five preview cards would say "editor" in English on a
 * Spanish site.
 *
 * @return array<int, array<string, mixed>>
 */
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

// (The legacy explorer window's config injection is gone with the
// window itself. The explorer APP builds the same section config in
// `apps/my-wordpress/parts/agents.php`, over the same
// `openstation_agents_*` helpers — `openstation_agents_preview_cast()`
// above included.)
