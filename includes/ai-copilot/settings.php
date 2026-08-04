<?php
/**
 * OpenStation — AI Copilot settings + capability helpers.
 *
 * The Copilot no longer stores credentials of its own. WordPress 7.0 owns
 * provider credentials (Settings → Connectors) and model routing
 * (`wp_ai_client_prompt()`, which injects the configured key automatically).
 * These helpers therefore only carry the per-user "AI assistant" toggle
 * (`ai.enabled`) and expose the Core capability signals the shell uses to
 * decide whether to surface the assistant at all. Provider + model selection
 * is delegated entirely to the Core AI Client — nothing is persisted here.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the AI settings block for a given user.
 *
 * `enabled` defaults to `false`: the assistant is opt-in, turned on from
 * OS Settings → Features (and only enable-able once a provider is configured).
 * Provider + model selection is left entirely to the Core AI Client.
 *
 * @param int $user_id
 * @return array{ enabled: bool }
 */
function openstation_ai_get_settings( $user_id ) {
	$os = openstation_get_os_settings( (int) $user_id );
	$ai = isset( $os['ai'] ) && is_array( $os['ai'] ) ? $os['ai'] : array();
	return array(
		'enabled' => isset( $ai['enabled'] ) ? (bool) $ai['enabled'] : false,
	);
}

/**
 * Whether the Core AI primitives the Copilot depends on are present.
 *
 * The assistant is built on the AI Client (generation), the Connectors API
 * (credentials) and the Abilities API (tools, adopted in a follow-up). When
 * any of these is missing — e.g. WordPress < 7.0, or AI disabled site-wide
 * via `wp_supports_ai()` — the shell hides the assistant entirely.
 *
 * @return bool
 */
function openstation_ai_is_available() {
	return function_exists( 'wp_ai_client_prompt' )
		&& function_exists( 'wp_get_connectors' )
		&& function_exists( 'wp_register_ability' )
		&& function_exists( 'wp_supports_ai' )
		&& wp_supports_ai();
}

/**
 * Whether a text-generation provider is configured and usable.
 *
 * The baseline capability gate: a no-network, deterministic
 * `is_supported_for_text_generation()` probe against the AI Client registry
 * (which Core populates from the configured Connectors). This is what plain
 * text-generation features — e.g. comment scoring, which only needs structured
 * text output — gate on. The agentic assistant needs more; see
 * {@see openstation_ai_assistant_provider_configured()}.
 *
 * Credentials are supplied by Core from the configured Connector; no API request
 * is made.
 *
 * @return bool
 */
function openstation_ai_provider_configured() {
	if ( ! openstation_ai_is_available() ) {
		return false;
	}
	return (bool) wp_ai_client_prompt( 'test' )->is_supported_for_text_generation();
}

/**
 * Whether a provider that can actually run the agentic assistant is configured.
 *
 * Follows the AI Client feature-detection guidance: rather than probing a bare
 * builder, we configure it the way the assistant actually calls the client —
 * with a function declaration — before the (no-network, deterministic)
 * `is_supported_for_text_generation()` check. `ModelRequirements::fromPromptData()`
 * turns the attached declaration into a `functionDeclarations` requirement, so
 * the check passes only when an available model supports text generation *and*
 * function calling — the two capabilities the tool loop depends on.
 *
 * Falls back to the plain text-generation gate when the SDK's FunctionDeclaration
 * class isn't present (e.g. older WordPress).
 *
 * @return bool
 */
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

/**
 * Builds a throwaway function declaration used only for capability detection.
 *
 * Mirrors the shape of the Copilot's real tool declarations so the AI Client's
 * support check additionally requires function-calling capability. Returns null
 * when the SDK class isn't available, letting the caller fall back to a plain
 * text-generation check.
 *
 * @return object|null A `FunctionDeclaration`, or null.
 */
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

/**
 * Whether the AI assistant is active for a given user.
 *
 * This is purely the per-user toggle (default off, opt-in). Availability of the Core
 * APIs and whether a provider key is set are separate, orthogonal checks
 * ({@see openstation_ai_is_available()} / {@see openstation_ai_provider_configured()})
 * so callers can distinguish "user turned it off" from "not set up yet".
 *
 * @param int $user_id
 * @return bool
 */
function openstation_ai_is_enabled( $user_id ) {
	$ai = openstation_ai_get_settings( (int) $user_id );
	return ! empty( $ai['enabled'] );
}

/**
 * Builds the `aiAssistant` shell-config payload for a user.
 *
 * The client uses this to decide whether to surface the Cmd+K assistant and
 * its admin-bar icon at all (`available`) and the user's own on/off toggle
 * (`enabled`). Two capability gates are reported separately:
 *
 * - `assistantProviderConfigured` — a provider that supports text generation
 *   *and* function calling (what the agentic assistant needs). Gates the Cmd+K
 *   assistant, its admin-bar icon, and the "AI assistant" toggle in Features.
 * - `providerConfigured` — the baseline text-generation gate. Comment scoring
 *   (which only needs text output) gates on this; the client uses it for the
 *   "Score new comments with AI" mirror.
 *
 * Provider + model selection is delegated to the Core AI Client, so there is no
 * per-user preference to carry here.
 *
 * @param int|null $user_id Defaults to the current user.
 * @return array{ available: bool, providerConfigured: bool, assistantProviderConfigured: bool, enabled: bool, connectorsUrl: string }
 */
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

/**
 * REST: GET `desktop-mode/v1/ai/status`.
 *
 * Returns the current {@see openstation_ai_assistant_config()} so the shell
 * can re-check provider availability without a page reload — e.g. after the
 * user configures an AI provider in Settings → Connectors.
 */
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

/**
 * REST handler for the AI status probe.
 *
 * @return WP_REST_Response
 */
function openstation_rest_ai_status() {
	return rest_ensure_response( openstation_ai_assistant_config() );
}
