<?php
/**
 * Desktop Mode — AI provider registry.
 *
 * Lets plugins register additional AI back-ends (OpenAI, Anthropic, Gemini,
 * local models) the AI Copilot can dispatch through. Each provider supplies
 * a small set of callables that fully encapsulate its wire format; the
 * shell drives the agentic loop and observability without knowing which
 * vendor is on the other end.
 *
 * Registration timing: hook `wp_desktop_ai_register_providers` (fires on
 * `init` at default priority). Plugins can also call
 * {@see wp_register_desktop_ai_provider()} at any time before the first
 * dispatch — the registry is just an in-memory map.
 *
 * Provider contract (every key is required unless noted):
 *
 *   array(
 *       'label'           => __( 'OpenAI', 'my-plugin' ),
 *       'description'     => __( 'OpenAI Responses API.', 'my-plugin' ),     // optional
 *       'api_key_label'   => __( 'OpenAI API key', 'my-plugin' ),            // optional
 *       'api_key_link'    => 'https://platform.openai.com/api-keys',         // optional
 *       'default_model'   => 'gpt-5.4-nano',                                 // optional
 *       'capabilities'    => array( 'tools', 'structured_output' ),          // optional, informational
 *
 *       // Required: opaque "turn input" factory. Two kinds:
 *       //   'user_message' — payload is the user's query (string)
 *       //   'tool_results' — payload is array of [{call_id, output (json string)}, ...]
 *       // Returns whatever the provider wants to receive in agentic_call().
 *       'make_turn_input' => 'my_provider_make_turn_input',
 *
 *       // Required: one turn of the agentic loop.
 *       // Returns array{ text: ?string, function_calls: array, next_state: mixed, raw: array }
 *       // or WP_Error. function_calls items: { name, call_id, arguments (json string) }.
 *       'agentic_call'    => 'my_provider_agentic_call',
 *
 *       // Required: single-shot structured-output request.
 *       // $messages are chat-style: [{role, content}, ...]. Returns parsed
 *       // array matching $schema, or WP_Error.
 *       'structured_request' => 'my_provider_structured_request',
 *   )
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

/** Default provider id when none is selected. */
const WPDM_AI_DEFAULT_PROVIDER = 'openai';

/** Required callback keys every registered provider must supply. */
const WPDM_AI_PROVIDER_REQUIRED_CALLBACKS = array(
	'make_turn_input',
	'agentic_call',
	'structured_request',
);

// ---------------------------------------------------------------------------
// Registry storage
// ---------------------------------------------------------------------------

/**
 * Internal registry accessor — process-scoped map of provider definitions.
 *
 * Acts as both reader and writer; we avoid a global by keeping the array
 * as a static inside this function. Pass an array action to mutate
 * (`set`, `unset`, `clear`); omit to read.
 *
 * @since 0.18.0
 *
 * @param string|null $action 'set' | 'unset' | 'clear' | null.
 * @param string      $id     Provider id.
 * @param array|null  $def    Provider definition (for 'set').
 * @return array Current registry snapshot.
 */
function wpdm_ai_providers_storage( $action = null, $id = '', $def = null ) {
	static $providers = array();

	if ( 'set' === $action ) {
		$providers[ $id ] = $def;
	} elseif ( 'unset' === $action ) {
		unset( $providers[ $id ] );
	} elseif ( 'clear' === $action ) {
		$providers = array();
	}

	return $providers;
}

// ---------------------------------------------------------------------------
// Public registration API
// ---------------------------------------------------------------------------

/**
 * Register an AI provider.
 *
 * @since 0.18.0
 *
 * @param string $id   Lowercase provider slug (e.g. 'openai', 'anthropic').
 *                     Validated with `sanitize_key()`.
 * @param array  $args Provider definition. See file header for the contract.
 * @return true|WP_Error True on success, WP_Error if the definition is invalid.
 */
function wp_register_desktop_ai_provider( $id, array $args ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return new WP_Error( 'wpdm_ai_provider_id', 'Provider id cannot be empty.' );
	}

	foreach ( WPDM_AI_PROVIDER_REQUIRED_CALLBACKS as $key ) {
		if ( ! isset( $args[ $key ] ) || ! is_callable( $args[ $key ] ) ) {
			return new WP_Error(
				'wpdm_ai_provider_callback',
				sprintf( 'Provider "%s" is missing required callable "%s".', $id, $key )
			);
		}
	}

	$def = array(
		'id'                 => $id,
		'label'              => isset( $args['label'] ) ? (string) $args['label'] : ucfirst( $id ),
		'description'        => isset( $args['description'] ) ? (string) $args['description'] : '',
		'api_key_label'      => isset( $args['api_key_label'] ) ? (string) $args['api_key_label'] : 'API key',
		'api_key_link'       => isset( $args['api_key_link'] ) ? esc_url_raw( (string) $args['api_key_link'] ) : '',
		'default_model'      => isset( $args['default_model'] ) ? (string) $args['default_model'] : '',
		'capabilities'       => isset( $args['capabilities'] ) && is_array( $args['capabilities'] )
			? array_values( array_filter( array_map( 'strval', $args['capabilities'] ) ) )
			: array(),
		'make_turn_input'    => $args['make_turn_input'],
		'agentic_call'       => $args['agentic_call'],
		'structured_request' => $args['structured_request'],
	);

	wpdm_ai_providers_storage( 'set', $id, $def );

	/**
	 * Fires after a provider has been registered. Useful for telemetry.
	 *
	 * @since 0.18.0
	 *
	 * @param string $id  Provider id.
	 * @param array  $def Stored provider definition.
	 */
	do_action( 'wp_desktop_ai_provider_registered', $id, $def );

	return true;
}

/**
 * Unregister a provider.
 *
 * @since 0.18.0
 *
 * @param string $id Provider id.
 * @return bool True if a provider was removed.
 */
function wp_unregister_desktop_ai_provider( $id ) {
	$id      = sanitize_key( (string) $id );
	$before  = wpdm_ai_providers_storage();
	if ( ! isset( $before[ $id ] ) ) {
		return false;
	}
	wpdm_ai_providers_storage( 'unset', $id );
	return true;
}

// ---------------------------------------------------------------------------
// Lazy-loading hook
// ---------------------------------------------------------------------------

/**
 * Fires the registration action exactly once per request.
 *
 * Plugins should hook `wp_desktop_ai_register_providers` to register their
 * providers. We fire it lazily on first lookup so registration order
 * doesn't depend on plugin load order.
 *
 * @since 0.18.0
 */
function wpdm_ai_ensure_providers_registered() {
	static $fired = false;
	if ( $fired ) {
		return;
	}
	$fired = true;

	/**
	 * Provider registration action — register any custom providers here.
	 *
	 * @since 0.18.0
	 */
	do_action( 'wp_desktop_ai_register_providers' );
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Returns the registered providers in a JS-safe shape (no callables).
 *
 * Used by `wp_desktop_shell_config` to populate the OS Settings provider
 * picker so the dropdown reflects whatever any plugin has registered.
 *
 * @since 0.18.0
 *
 * @return array<int, array{ id:string, label:string, description:string, api_key_label:string, api_key_link:string, capabilities:array }>
 */
function wpdm_ai_get_providers_for_config() {
	$out = array();
	foreach ( wp_desktop_ai_get_providers() as $id => $def ) {
		$out[] = array(
			'id'            => (string) $id,
			'label'         => (string) $def['label'],
			'description'   => (string) $def['description'],
			'api_key_label' => (string) $def['api_key_label'],
			'api_key_link'  => (string) $def['api_key_link'],
			'capabilities'  => (array) $def['capabilities'],
		);
	}
	return $out;
}

/**
 * Returns all currently-registered providers.
 *
 * @since 0.18.0
 *
 * @return array<string, array> Map of provider id → definition.
 */
function wp_desktop_ai_get_providers() {
	wpdm_ai_ensure_providers_registered();
	return wpdm_ai_providers_storage();
}

/**
 * Returns a single provider by id.
 *
 * @since 0.18.0
 *
 * @param string $id Provider id.
 * @return array|null Provider definition, or null if unregistered.
 */
function wp_desktop_ai_get_provider( $id ) {
	$id        = sanitize_key( (string) $id );
	$providers = wp_desktop_ai_get_providers();
	return $providers[ $id ] ?? null;
}

/**
 * Returns the active provider id for a given user.
 *
 * Resolution order:
 *   1. Per-user OS Settings 'provider' field (if it points at a registered
 *      provider).
 *   2. Platform settings 'provider' field (same check).
 *   3. WPDM_AI_DEFAULT_PROVIDER ('openai').
 *
 * The `wp_desktop_ai_active_provider` filter wraps the resolved value so
 * a plugin can pin a specific provider per-request (e.g., based on
 * request_id, query content, or admin capability).
 *
 * @since 0.18.0
 *
 * @param int $user_id User id (0 for anonymous contexts).
 * @return string Provider id. Always a string; may not point at a
 *                registered provider if every fallback misses.
 */
function wp_desktop_ai_get_active_provider_id( $user_id ) {
	$user_id   = (int) $user_id;
	$providers = wp_desktop_ai_get_providers();

	$candidate = '';
	if ( $user_id > 0 && function_exists( 'wpdm_ai_get_settings' ) ) {
		$ai = wpdm_ai_get_settings( $user_id );
		if ( ! empty( $ai['provider'] ) && isset( $providers[ $ai['provider'] ] ) ) {
			$candidate = (string) $ai['provider'];
		}
	}

	if ( '' === $candidate && function_exists( 'wpdm_ai_get_platform_settings' ) ) {
		$platform = wpdm_ai_get_platform_settings();
		if ( ! empty( $platform['provider'] ) && isset( $providers[ $platform['provider'] ] ) ) {
			$candidate = (string) $platform['provider'];
		}
	}

	if ( '' === $candidate ) {
		$candidate = WPDM_AI_DEFAULT_PROVIDER;
	}

	/**
	 * Filter the resolved active-provider id.
	 *
	 * @since 0.18.0
	 *
	 * @param string $candidate Resolved provider id.
	 * @param int    $user_id   User id (0 for anonymous).
	 */
	return (string) apply_filters( 'wp_desktop_ai_active_provider', $candidate, $user_id );
}

/**
 * Returns the active provider definition for a given user, or WP_Error.
 *
 * @since 0.18.0
 *
 * @param int $user_id
 * @return array|WP_Error
 */
function wp_desktop_ai_get_active_provider( $user_id ) {
	$id  = wp_desktop_ai_get_active_provider_id( $user_id );
	$def = wp_desktop_ai_get_provider( $id );
	if ( null === $def ) {
		return new WP_Error(
			'wpdm_ai_no_provider',
			sprintf( 'AI provider "%s" is not registered.', $id ),
			array( 'provider' => $id )
		);
	}
	return $def;
}

// ---------------------------------------------------------------------------
// Dispatch helpers — the shell calls these instead of touching providers
// directly. Each one resolves the active provider and forwards.
// ---------------------------------------------------------------------------

/**
 * Build an opaque turn-input object via the active provider.
 *
 * @since 0.18.0
 *
 * @param int    $user_id User id (used to resolve active provider).
 * @param string $kind    'user_message' | 'tool_results'.
 * @param mixed  $payload Kind-specific payload (see file header).
 * @return mixed|WP_Error Turn-input opaque value, or WP_Error.
 */
function wpdm_ai_provider_make_turn_input( $user_id, $kind, $payload ) {
	$provider = wp_desktop_ai_get_active_provider( $user_id );
	if ( is_wp_error( $provider ) ) {
		return $provider;
	}
	return call_user_func( $provider['make_turn_input'], (string) $kind, $payload );
}

/**
 * Run one turn of the agentic loop via the active provider.
 *
 * @since 0.18.0
 *
 * @param int        $user_id      User id.
 * @param string     $api_key      Provider API key.
 * @param mixed      $turn_input   Opaque value from {@see wpdm_ai_provider_make_turn_input}.
 * @param array      $tools        Tool definitions (provider format).
 * @param array|null $text_format  Optional structured-output schema (provider format).
 * @param string     $instructions System prompt.
 * @param mixed      $state        Provider-specific continuation state, or null on first turn.
 * @return array|WP_Error Normalized turn result or WP_Error.
 */
function wpdm_ai_provider_agentic_call(
	$user_id,
	$api_key,
	$turn_input,
	array $tools,
	$text_format,
	$instructions,
	$state = null
) {
	$provider = wp_desktop_ai_get_active_provider( $user_id );
	if ( is_wp_error( $provider ) ) {
		return $provider;
	}

	$result = call_user_func(
		$provider['agentic_call'],
		(string) $api_key,
		$turn_input,
		$tools,
		$text_format,
		(string) $instructions,
		$state
	);

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	if ( ! is_array( $result ) ) {
		return new WP_Error(
			'wpdm_ai_provider_shape',
			sprintf( 'Provider "%s" agentic_call returned a non-array.', $provider['id'] )
		);
	}

	return wp_parse_args(
		$result,
		array(
			'text'           => null,
			'function_calls' => array(),
			'next_state'     => null,
			'raw'            => null,
		)
	);
}

/**
 * Run a single-shot structured-output request via the active provider.
 *
 * @since 0.18.0
 *
 * @param int    $user_id     User id.
 * @param string $api_key     Provider API key.
 * @param array  $messages    Chat-style messages.
 * @param array  $schema      JSON schema.
 * @param string $schema_name Identifier for the schema.
 * @param string $model       Optional model override; '' lets the provider pick its default.
 * @return array|WP_Error
 */
function wpdm_ai_provider_structured_request(
	$user_id,
	$api_key,
	array $messages,
	array $schema,
	$schema_name,
	$model = ''
) {
	$provider = wp_desktop_ai_get_active_provider( $user_id );
	if ( is_wp_error( $provider ) ) {
		return $provider;
	}

	return call_user_func(
		$provider['structured_request'],
		(string) $api_key,
		$messages,
		$schema,
		(string) $schema_name,
		(string) $model
	);
}
