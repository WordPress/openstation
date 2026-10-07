<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function agents_enabled() {
	return function_exists( 'openstation_agents_enabled' ) && openstation_agents_enabled();
}

function agents_can_manage() {
	return function_exists( 'openstation_agents_user_can_manage' ) && openstation_agents_user_can_manage();
}

function agents_list() {
	if ( ! function_exists( 'openstation_agent_get_agents' ) || ! function_exists( 'openstation_agents_rest_shape_user' ) ) {
		return array();
	}
	$out = array();
	foreach ( openstation_agent_get_agents() as $user ) {
		$shape = openstation_agents_rest_shape_user( $user );
		if ( $shape ) {

			$shape['profileUrl'] = esc_url_raw( admin_url( 'user-edit.php?user_id=' . (int) $shape['id'] ) );
			$out[]               = $shape;
		}
	}
	return $out;
}

function agents_role_labels() {
	$labels = array();
	foreach ( wp_roles()->get_names() as $slug => $name ) {
		$labels[ $slug ] = translate_user_role( $name );
	}
	return $labels;
}

function agents_payload( Os $os, State $state ) {
	$enabled      = agents_enabled();
	$can_manage   = agents_can_manage();
	$ai_available = function_exists( 'openstation_ai_is_available' ) && openstation_ai_is_available();

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

	if ( ! $enabled && function_exists( 'openstation_agents_preview_cast' ) ) {
		$payload['preview'] = openstation_agents_preview_cast();
	}

	return $payload;
}

function agents_cast_of( State $state ) {
	$cast = $state->get( 'cast' );
	return is_array( $cast ) ? $cast : array();
}

function agent_draft_action( State $state ) {
	if ( ! agents_enabled() || ! agents_can_manage() || ! function_exists( 'openstation_agent_draft' ) ) {
		return;
	}
	$cast = agents_cast_of( $state );

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

	if ( '' !== (string) ( $cast['instructions'] ?? '' ) ) {
		$cast['brief'] = (string) $cast['instructions'];
	}

	$state->set( 'cast', $cast )->set( 'wstep', 1 )->set( 'briefError', '' );
}

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

	if ( array_key_exists( 'abilities', $fields ) ) {
		$state->set( 'agentNotice', __( 'Abilities saved.', 'desktop-mode' ) );
	} elseif ( array_key_exists( 'triggers', $fields ) ) {
		$state->set( 'agentNotice', __( 'Triggers saved.', 'desktop-mode' ) );
	} elseif ( ! array_key_exists( 'face', $fields ) ) {
		$state->set( 'agentNotice', __( 'Agent saved.', 'desktop-mode' ) );
	}
	$os->announce( 'user', 'updated', $id );
}

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
