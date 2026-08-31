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

/**
 * Ship the agents section config on the WP Explorer window config.
 *
 * `enabled` mirrors the `agents` extended option. When it is false the
 * section still renders — every control disabled, nothing fetched —
 * and offers `canEnable` users a way into the Features tab that turns
 * the framework on. `canManage` / `canInvoke` stay the raw capability
 * answers so that shell renders the same controls it would when the
 * flag is on, just inert; the real gate is that the REST routes do not
 * exist while off.
 *
 * `aiAvailable` is the cheap structural check (WP 7.0 AI Client +
 * Abilities API present); whether a connector is actually configured
 * is probed live by the renderer against `aiStatusUrl`, mirroring the
 * OS Settings Features tab, so a freshly configured connector is
 * picked up without a reload.
 *
 * `preview` is only sent while the flag is off, which is the only
 * state that draws it: once Agents is on, the real cast has been
 * seeded and the grid renders that instead.
 *
 * @param array $window_args Args passed to `openstation_register_window()`.
 * @return array
 */
function openstation_agents_my_wordpress_window_args( $window_args ) {
	if ( ! is_array( $window_args ) || ! openstation_agents_user_can_read() ) {
		return $window_args;
	}

	if ( ! isset( $window_args['config'] ) || ! is_array( $window_args['config'] ) ) {
		$window_args['config'] = array();
	}

	$enabled = openstation_agents_enabled();

	$window_args['config']['agents'] = array(
		'enabled'       => $enabled,
		'canEnable'     => current_user_can( 'manage_options' ),
		'canManage'     => openstation_agents_user_can_manage(),
		'canUpload'     => current_user_can( 'upload_files' ),
		'canInvoke'     => openstation_agents_user_can_invoke(),
		'aiAvailable'   => function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available(),
		'aiStatusUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/status' ) ),
		'connectorsUrl' => esc_url_raw( admin_url( 'options-connectors.php' ) ),
		'runWindowId'   => 'desktop-mode-agent-run',
	);

	if ( ! $enabled ) {
		$window_args['config']['agents']['preview'] = openstation_agents_preview_cast();
	}

	return $window_args;
}
add_filter( 'openstation_my_wordpress_window_args', 'openstation_agents_my_wordpress_window_args' );
