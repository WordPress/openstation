<?php
/**
 * Desktop Mode — AI Copilot settings helpers.
 *
 * Thin wrappers around `desktop_mode_get_os_settings()` scoped to the AI block.
 * All other copilot modules call these instead of reading user meta
 * directly so the key path is one place to change.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the AI settings block for a given user.
 *
 * @since 0.14.0
 *
 * @param int $user_id
 * @return array{ enabled: bool, provider: string, apiKey: string }
 */
function desktop_mode_ai_get_settings( $user_id ) {
	$os = desktop_mode_get_os_settings( (int) $user_id );
	$defaults = array(
		'enabled'  => false,
		'provider' => 'openai',
		'apiKey'   => '',
		'apiKeys'  => array(),
	);
	$ai = isset( $os['ai'] ) && is_array( $os['ai'] ) ? $os['ai'] : array();
	return array_merge( $defaults, $ai );
}

/**
 * Whether AI processing is active — checks platform settings first,
 * then falls back to the user's personal settings.
 *
 * Priority:
 *   1. Platform-wide settings (wp_options) — enabled by any admin.
 *   2. Per-user settings (user meta) — personal override.
 *
 * @since 0.14.0
 *
 * @param int $user_id
 * @return bool
 */
function desktop_mode_ai_is_enabled( $user_id ) {
	$user_id  = (int) $user_id;
	$platform = desktop_mode_ai_get_platform_settings();
	$active   = function_exists( 'desktop_mode_ai_get_active_provider_id' )
		? desktop_mode_ai_get_active_provider_id( $user_id )
		: 'openai';

	// 1. Platform key — works for any user, including anonymous contexts.
	// Resolve via the per-provider map first, then fall back to the
	// legacy single `apiKey` field (which is treated as the openai key).
	if ( ! empty( $platform['enabled'] ) && '' !== desktop_mode_ai_resolve_key_for_provider( $platform, $active ) ) {
		return true;
	}

	// 2. Per-user override.
	$ai = desktop_mode_ai_get_settings( $user_id );
	if ( empty( $ai['enabled'] ) ) {
		return false;
	}
	if ( '' === desktop_mode_ai_resolve_key_for_provider( $ai, $active ) ) {
		return false;
	}

	return true;
}

/**
 * Resolve which key — from a settings block — applies to a given provider.
 *
 * Order: explicit `apiKeys[provider]` → legacy `apiKey` (only when the
 * provider is `openai`, since that's what the legacy field meant) → ''.
 *
 * @since 0.18.0
 *
 * @param array  $settings    `apiKeys` and `apiKey` carrying settings block.
 * @param string $provider_id Provider id to resolve for.
 * @return string Trimmed API key, or '' if none.
 */
function desktop_mode_ai_resolve_key_for_provider( array $settings, $provider_id ) {
	$provider_id = (string) $provider_id;
	$keys        = isset( $settings['apiKeys'] ) && is_array( $settings['apiKeys'] ) ? $settings['apiKeys'] : array();

	if ( isset( $keys[ $provider_id ] ) && is_string( $keys[ $provider_id ] ) && '' !== $keys[ $provider_id ] ) {
		return (string) $keys[ $provider_id ];
	}

	if ( 'openai' === $provider_id && isset( $settings['apiKey'] ) && is_string( $settings['apiKey'] ) && '' !== $settings['apiKey'] ) {
		return (string) $settings['apiKey'];
	}

	return '';
}

/**
 * Returns the API key to use for a given user.
 *
 * Per-user key takes precedence (personal override); falls back to the
 * platform-wide key so anonymous contexts (cron, WP-CLI, anonymous
 * comments) always have a key available when the admin has configured one.
 *
 * @since 0.14.0
 *
 * @param int $user_id
 * @return string API key, or empty string if none configured.
 */
function desktop_mode_ai_get_api_key( $user_id ) {
	$user_id = (int) $user_id;
	$active  = function_exists( 'desktop_mode_ai_get_active_provider_id' )
		? desktop_mode_ai_get_active_provider_id( $user_id )
		: 'openai';

	// Per-user override takes precedence.
	$ai  = desktop_mode_ai_get_settings( $user_id );
	$key = desktop_mode_ai_resolve_key_for_provider( $ai, $active );
	if ( '' !== $key ) {
		return $key;
	}

	// Fall back to platform key.
	$platform = desktop_mode_ai_get_platform_settings();
	return desktop_mode_ai_resolve_key_for_provider( $platform, $active );
}
