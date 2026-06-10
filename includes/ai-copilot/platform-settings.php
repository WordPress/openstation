<?php
/**
 * Desktop Mode — AI Copilot platform-wide settings.
 *
 * Stores site-level AI configuration in `wp_options` so every user and
 * every background job (hooks, cron, WP-CLI) can use the same API key
 * without requiring each individual user to configure one.
 *
 * Priority when resolving which key to use:
 *   1. Per-user key (user meta) — personal override, takes precedence.
 *   2. Platform key (wp_options) — site-wide fallback.
 *
 * The REST endpoint is gated behind `manage_options` so only admins
 * can read or update the platform key.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** wp_options key for the platform-wide AI settings. */
const DESKTOP_MODE_AI_PLATFORM_OPTION = 'desktop_mode_ai_platform';

// ---------------------------------------------------------------------------
// Get / save
// ---------------------------------------------------------------------------

/**
 * Returns the platform AI settings, with defaults merged in.
 *
 * @since 0.5.0
 *
 * @return array{ enabled: bool, provider: string, apiKey: string, apiKeys: array<string,string> }
 */
function desktop_mode_ai_get_platform_settings() {
	$defaults = array(
		'enabled'  => false,
		'provider' => 'openai',
		'apiKey'   => '',     // Legacy — kept for backwards compat with 0.14–0.17 callers.
		'apiKeys'  => array(), // Per-provider keys.
	);

	$raw = get_option( DESKTOP_MODE_AI_PLATFORM_OPTION, array() );
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}

	$provider = $defaults['provider'];
	if ( isset( $raw['provider'] ) && is_string( $raw['provider'] ) ) {
		$slug = sanitize_key( $raw['provider'] );
		if ( '' !== $slug ) {
			$provider = $slug;
		}
	}

	$keys = array();
	if ( isset( $raw['apiKeys'] ) && is_array( $raw['apiKeys'] ) ) {
		foreach ( $raw['apiKeys'] as $pid => $val ) {
			if ( count( $keys ) >= 32 ) {
				break;
			}
			$slug = sanitize_key( (string) $pid );
			if ( '' === $slug || ! is_string( $val ) ) {
				continue;
			}
			$keys[ $slug ] = $val;
		}
	}

	return array(
		'enabled'  => ! empty( $raw['enabled'] ),
		'provider' => $provider,
		'apiKey'   => ( isset( $raw['apiKey'] ) && is_string( $raw['apiKey'] ) )
			? $raw['apiKey']
			: $defaults['apiKey'],
		'apiKeys'  => $keys,
	);
}

/**
 * Sanitizes and saves platform AI settings to `wp_options`.
 *
 * @since 0.5.0
 *
 * @param mixed $raw Incoming settings payload (from REST or direct call).
 * @return bool True on success.
 */
function desktop_mode_ai_save_platform_settings( $raw ) {
	if ( ! is_array( $raw ) ) {
		return false;
	}

	$provider = 'openai';
	if ( isset( $raw['provider'] ) && is_string( $raw['provider'] ) ) {
		$slug = sanitize_key( $raw['provider'] );
		if ( '' !== $slug ) {
			$provider = $slug;
		}
	}

	$keys = array();
	if ( isset( $raw['apiKeys'] ) && is_array( $raw['apiKeys'] ) ) {
		foreach ( $raw['apiKeys'] as $pid => $val ) {
			if ( count( $keys ) >= 32 ) {
				break;
			}
			$slug = sanitize_key( (string) $pid );
			if ( '' === $slug || ! is_string( $val ) ) {
				continue;
			}
			$keys[ $slug ] = substr( sanitize_text_field( $val ), 0, 512 );
		}
	}

	$clean = array(
		'enabled'  => ! empty( $raw['enabled'] ),
		'provider' => $provider,
		'apiKey'   => ( isset( $raw['apiKey'] ) && is_string( $raw['apiKey'] ) )
			? substr( sanitize_text_field( $raw['apiKey'] ), 0, 512 )
			: '',
		'apiKeys'  => $keys,
	);

	return update_option( DESKTOP_MODE_AI_PLATFORM_OPTION, $clean, false );
}

// ---------------------------------------------------------------------------
// REST endpoint
// ---------------------------------------------------------------------------

/**
 * Registers the platform settings REST route.
 *
 * @since 0.5.0
 */
function desktop_mode_register_ai_platform_settings_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/ai/platform-settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'desktop_mode_rest_get_ai_platform_settings',
				'permission_callback' => 'desktop_mode_rest_ai_platform_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'desktop_mode_rest_save_ai_platform_settings',
				'permission_callback' => 'desktop_mode_rest_ai_platform_permission',
				'args'                => array(
					'settings' => array(
						'required' => true,
						'type'     => 'object',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_ai_platform_settings_rest_route' );

/**
 * Permission: administrators only.
 *
 * @since 0.5.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_rest_ai_platform_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'desktop_mode_ai_forbidden',
			'Only administrators can manage platform AI settings.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /desktop-mode/v1/ai/platform-settings
 *
 * @since 0.5.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_rest_get_ai_platform_settings() {
	return rest_ensure_response( desktop_mode_ai_get_platform_settings() );
}

/**
 * POST /desktop-mode/v1/ai/platform-settings
 *
 * @since 0.5.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function desktop_mode_rest_save_ai_platform_settings( WP_REST_Request $request ) {
	$payload = $request->get_param( 'settings' );
	desktop_mode_ai_save_platform_settings( $payload );
	return rest_ensure_response( desktop_mode_ai_get_platform_settings() );
}
