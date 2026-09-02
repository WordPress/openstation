<?php
/**
 * My WordPress — the Agents section: payload and actions.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. WP Explorer's Agents surface
 * on the app: the section config computed by the same helpers, the
 * cast through the same REST shaper, the catalogues settled with the
 * data, and the four mutations (draft / create / update / delete)
 * behind the same capability gates as the `/desktop-mode/v1/agents`
 * routes they mirror.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Whether the Agents framework is on. False when the module is absent.
 *
 * @return bool
 */
function agents_enabled() {
	return function_exists( 'openstation_agents_enabled' ) && openstation_agents_enabled();
}

/**
 * Whether the acting user may create / edit / delete agents.
 *
 * @return bool
 */
function agents_can_manage() {
	return function_exists( 'openstation_agents_user_can_manage' ) && openstation_agents_user_can_manage();
}

/**
 * The canonical shape of every agent on the site — the same rows the
 * `/desktop-mode/v1/agents` list route serves, through the same shaper.
 *
 * @return array<int,array<string,mixed>>
 */
function agents_list() {
	if ( ! function_exists( 'openstation_agent_get_agents' ) || ! function_exists( 'openstation_agents_rest_shape_user' ) ) {
		return array();
	}
	$out = array();
	foreach ( openstation_agent_get_agents() as $user ) {
		$shape = openstation_agents_rest_shape_user( $user );
		if ( $shape ) {
			// For "Open profile"'s iframe fallback — computed here so
			// the client never assembles an admin URL by hand.
			$shape['profileUrl'] = esc_url_raw( admin_url( 'user-edit.php?user_id=' . (int) $shape['id'] ) );
			$out[]               = $shape;
		}
	}
	return $out;
}

/**
 * Every role's translated label, keyed by slug — what the cast badges
 * read. Shipped for READERS too: a card resolving its role label out
 * of a manage-only catalogue would degrade to the raw slug in English
 * for everyone else, which is exactly what the preview cast's
 * `roleLabel` exists to avoid.
 *
 * @return array<string,string>
 */
function agents_role_labels() {
	$labels = array();
	foreach ( wp_roles()->get_names() as $slug => $name ) {
		$labels[ $slug ] = translate_user_role( $name );
	}
	return $labels;
}

/**
 * The full Agents payload the client view paints: WP Explorer's
 * section config (same keys, computed by the same helpers), the cast,
 * and — because a server view recomputes data on every interaction —
 * the catalogues the original fetched lazily over REST, settled here
 * once per render instead.
 *
 * @param Os    $os    Host handle.
 * @param State $state State.
 * @return array<string,mixed>
 */
function agents_payload( Os $os, State $state ) {
	$enabled      = agents_enabled();
	$can_manage   = agents_can_manage();
	$ai_available = function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available();
	// The live half of WP Explorer's `/ai/status` probe, answered
	// in-process: a text-generation provider is configured and usable.
	$ai_ready = $ai_available && (
		( function_exists( 'openstation_ai_assistant_provider_configured' ) && openstation_ai_assistant_provider_configured() )
		|| ( function_exists( 'openstation_ai_provider_configured' ) && openstation_ai_provider_configured() )
	);

	$payload = array(
		'enabled'       => $enabled,
		'canEnable'     => current_user_can( 'manage_options' ),
		'canManage'     => $can_manage,
		'canInvoke'     => function_exists( 'openstation_agents_user_can_invoke' ) && openstation_agents_user_can_invoke(),
		'aiAvailable'   => $ai_available,
		'aiReady'       => $ai_ready,
		'connectorsUrl' => esc_url_raw( admin_url( 'options-connectors.php' ) ),
		'runWindowId'   => 'desktop-mode-agent-run',
		// For the drop targets' dispatch engine (`agents-dispatch.ts`),
		// which posts to `/agents/:id/invoke` exactly as WP Explorer's.
		'restRoot'      => esc_url_raw( rest_url() ),
		'restNonce'     => wp_create_nonce( 'wp_rest' ),
		'list'          => $enabled ? agents_list() : array(),
		'roleLabels'    => agents_role_labels(),
		'abilities'     => $enabled && function_exists( 'openstation_agents_abilities_catalogue' )
			? array_values( openstation_agents_abilities_catalogue() )
			: array(),
		'triggerKinds'  => $enabled && function_exists( 'openstation_agent_trigger_kinds' )
			? array_values( openstation_agent_trigger_kinds() )
			: array(),
		'hooks'         => $enabled && function_exists( 'openstation_agent_hooks_catalogue' )
			? array_values( openstation_agent_hooks_catalogue() )
			: array(),
		// Assignable roles stay manage-only, like the `/agents/roles`
		// route: this is the PICKER's list, not the badges'.
		'roles'         => $enabled && $can_manage && function_exists( 'openstation_agent_allowed_roles' )
			? array_values(
				array_map(
					static function ( $slug ) {
						$names = wp_roles()->get_names();
						return array(
							'slug'  => $slug,
							'label' => isset( $names[ $slug ] ) ? translate_user_role( $names[ $slug ] ) : $slug,
						);
					},
					array_values( openstation_agent_allowed_roles() )
				)
			)
			: null,
	);

	// The cast this site WOULD be seeded with — only while off, which
	// is the only state that draws it.
	if ( ! $enabled && function_exists( 'openstation_agents_preview_cast' ) ) {
		$payload['preview'] = openstation_agents_preview_cast();
	}

	return $payload;
}

/**
 * The wizard's draft, read out of the state slot as a clean array.
 *
 * @param State $state State.
 * @return array<string,mixed>
 */
function agents_cast_of( State $state ) {
	$cast = $state->get( 'cast' );
	return is_array( $cast ) ? $cast : array();
}

/**
 * `agent-draft`: one AI generate call with a strict answer schema,
 * filtered against the site's catalogues on the server. Creates
 * nothing; a failure keeps the user on Describe with the reason under
 * the brief.
 *
 * @param State $state State.
 * @return void
 */
function agent_draft_action( State $state ) {
	if ( ! agents_enabled() || ! agents_can_manage() || ! function_exists( 'openstation_agent_draft' ) ) {
		return;
	}
	$cast = agents_cast_of( $state );
	// The client raised `drafting` when it dispatched; every way
	// out of this action lowers it in the state it returns.
	$cast['drafting'] = false;
	$state->set( 'cast', $cast );
	$brief = trim( (string) ( $cast['brief'] ?? '' ) );
	if ( '' === $brief ) {
		$state->set( 'briefError', __( 'Describe the agent first. A sentence is enough.', 'desktop-mode' ) );
		return;
	}
	$draft = openstation_agent_draft( $brief, get_current_user_id() );
	if ( is_wp_error( $draft ) ) {
		$state->set( 'briefError', $draft->get_error_message() );
		return;
	}
	// Fold the draft into the cast: an empty answer for a field
	// keeps whatever was there. The role and the abilities come
	// back already filtered against the catalogues ('' / dropped
	// when the model's pick is not one the site allows).
	foreach ( array( 'name', 'description', 'instructions' ) as $field ) {
		if ( '' !== trim( (string) ( $draft[ $field ] ?? '' ) ) ) {
			$cast[ $field ] = trim( (string) $draft[ $field ] );
		}
	}
	if ( '' !== trim( (string) ( $draft['vibes'] ?? '' ) ) ) {
		$cast['vibes'] = mb_substr( trim( (string) $draft['vibes'] ), 0, 120 );
	}
	if ( '' !== (string) ( $draft['role'] ?? '' ) ) {
		$cast['role'] = (string) $draft['role'];
	}
	if ( isset( $draft['abilities'] ) && is_array( $draft['abilities'] ) ) {
		$cast['abilities'] = array_values( array_map( 'strval', $draft['abilities'] ) );
	}
	// Filled in, Meet is a review.
	$state->set( 'cast', $cast )->set( 'wstep', 1 )->set( 'briefError', '' );
}

/**
 * `agent-create`: one request, the whole definition — abilities and
 * triggers included, so an agent is never briefly on the site in a
 * half-configured state.
 *
 * @param State $state State.
 * @param Os    $os    Host handle.
 * @return void
 */
function agent_create_action( State $state, Os $os ) {
	if ( ! agents_enabled() || ! agents_can_manage() || ! function_exists( 'openstation_agent_create' ) ) {
		return;
	}
	$cast = agents_cast_of( $state );
	if ( '' === trim( (string) ( $cast['name'] ?? '' ) ) ) {
		$state->set( 'agentNotice', __( 'Agent name is required.', 'desktop-mode' ) )->set( 'wstep', 1 );
		return;
	}
	$user = openstation_agent_create(
		array(
			'name'         => trim( (string) ( $cast['name'] ?? '' ) ),
			'role'         => (string) ( $cast['role'] ?? '' ),
			'description'  => trim( (string) ( $cast['description'] ?? '' ) ),
			'instructions' => (string) ( $cast['instructions'] ?? '' ),
			'abilities'    => (array) ( $cast['abilities'] ?? array() ),
			'triggers'     => (array) ( $cast['triggers'] ?? array() ),
			'vibes'        => trim( (string) ( $cast['vibes'] ?? '' ) ),
			'face'         => $cast['face'] ?? null,
			'faceSeed'     => (int) ( $cast['faceSeed'] ?? 0 ),
		)
	);
	if ( is_wp_error( $user ) ) {
		$state->set( 'agentNotice', $user->get_error_message() );
		return;
	}
	$state->set( 'casting', false )->set( 'wstep', 0 )->reset( 'cast' )
		->set( 'item', (int) $user->ID )->set( 'pane', 'define' )
		->set( 'agentNotice', '' )->set( 'briefError', '' );
	$os->announce( 'user', 'created', (int) $user->ID );
}

/**
 * `agent-update`: any subset of the definition fields, like the
 * PATCH route.
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function agent_update_action( State $state, Os $os, array $args ) {
	if ( ! agents_enabled() || ! agents_can_manage() || ! function_exists( 'openstation_agent_update' ) ) {
		return;
	}
	$id     = (int) ( $args['id'] ?? 0 );
	$fields = array();
	foreach ( array( 'name', 'role', 'description', 'instructions', 'abilities', 'triggers', 'vibes', 'face', 'faceSeed' ) as $field ) {
		if ( array_key_exists( $field, $args ) ) {
			$fields[ $field ] = $args[ $field ];
		}
	}
	$updated = openstation_agent_update( $id, $fields );
	if ( is_wp_error( $updated ) ) {
		$state->set( 'agentNotice', $updated->get_error_message() );
		return;
	}
	// The face backfill is a courtesy write and stays silent;
	// everything else confirms in the words the original used.
	if ( array_key_exists( 'abilities', $fields ) ) {
		$state->set( 'agentNotice', __( 'Abilities saved.', 'desktop-mode' ) );
	} elseif ( array_key_exists( 'triggers', $fields ) ) {
		$state->set( 'agentNotice', __( 'Triggers saved.', 'desktop-mode' ) );
	} elseif ( ! array_key_exists( 'face', $fields ) ) {
		$state->set( 'agentNotice', __( 'Agent saved.', 'desktop-mode' ) );
	}
	$os->announce( 'user', 'updated', $id );
}

/**
 * `agent-delete`: delete the agent user (agents only — a plain user
 * is refused by the store).
 *
 * @param State               $state State.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  Trigger args.
 * @return void
 */
function agent_delete_action( State $state, Os $os, array $args ) {
	if ( ! agents_enabled() || ! agents_can_manage() || ! function_exists( 'openstation_agent_delete' ) ) {
		return;
	}
	$id     = (int) ( $args['id'] ?? 0 );
	$result = openstation_agent_delete( $id );
	if ( is_wp_error( $result ) ) {
		$state->set( 'agentNotice', $result->get_error_message() );
		return;
	}
	if ( $id === (int) $state->get( 'item' ) ) {
		$state->set( 'item', 0 );
	}
	$state->set( 'agentNotice', '' );
	$os->announce( 'user', 'deleted', $id );
}
