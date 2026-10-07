<?php

defined( 'ABSPATH' ) || exit;

function openstation_ai_get_settings( $user_id ) {
	$os = openstation_get_os_settings( (int) $user_id );
	$ai = isset( $os['ai'] ) && is_array( $os['ai'] ) ? $os['ai'] : array();
	return array(
		'enabled' => isset( $ai['enabled'] ) ? (bool) $ai['enabled'] : false,
	);
}

function openstation_ai_is_available() {
	return function_exists( 'wp_ai_client_prompt' )
		&& function_exists( 'wp_get_connectors' )
		&& function_exists( 'wp_register_ability' )
		&& function_exists( 'wp_supports_ai' )
		&& wp_supports_ai();
}

function openstation_ai_provider_configured() {
	if ( ! openstation_ai_is_available() ) {
		return false;
	}
	return (bool) wp_ai_client_prompt( 'test' )->is_supported_for_text_generation();
}

function openstation_ai_assistant_provider_configured() {
	if ( ! openstation_ai_is_available() ) {
		return false;
	}

	$probe = openstation_ai_capability_probe_declaration();
	if ( ! $probe ) {
		return openstation_ai_provider_configured();
	}

	return (bool) wp_ai_client_prompt( 'test' )
		->using_function_declarations( $probe )
		->is_supported_for_text_generation();
}

function openstation_ai_capability_probe_declaration() {
	$class = '\WordPress\AiClient\Tools\DTO\FunctionDeclaration';
	if ( ! class_exists( $class ) ) {
		return null;
	}
	try {
		return new $class(
			'capability_probe',
			'Feature-detection probe; never invoked.',
			null
		);
	} catch ( \Throwable $e ) {
		return null;
	}
}

function openstation_ai_is_enabled( $user_id ) {
	$ai = openstation_ai_get_settings( (int) $user_id );
	return ! empty( $ai['enabled'] );
}

function openstation_ai_assistant_config( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$connectors_url = admin_url( 'options-connectors.php' );

	if ( ! openstation_ai_is_available() ) {
		return array(
			'available'                   => false,
			'providerConfigured'          => false,
			'assistantProviderConfigured' => false,
			'enabled'                     => false,
			'connectorsUrl'               => $connectors_url,
		);
	}

	$ai = openstation_ai_get_settings( $user_id );

	return array(
		'available'                   => true,
		'providerConfigured'          => openstation_ai_provider_configured(),
		'assistantProviderConfigured' => openstation_ai_assistant_provider_configured(),
		'enabled'                     => (bool) $ai['enabled'],
		'connectorsUrl'               => $connectors_url,
	);
}

function openstation_register_ai_status_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/ai/status',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_rest_ai_status',
			'permission_callback' => static function () {
				return is_user_logged_in() && current_user_can( 'read' );
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_ai_status_rest_route' );

function openstation_rest_ai_status() {
	return rest_ensure_response( openstation_ai_assistant_config() );
}
