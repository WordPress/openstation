<?php
defined( 'ABSPATH' ) || exit;
/**
 * Desktop Mode — AI tool registration API.
 *
 * Third-party plugins register server-side tools the AI Copilot can
 * invoke during a `/ai/search` call. Mirrors every other
 * registration API in this plugin (`desktop_mode_register_window`,
 * `desktop_mode_register_wallpaper`, `desktop_mode_register_widget`).
 *
 * Tools registered here are *PHP-dispatched* — the tool's `handler`
 * runs on the server, returns a JSON-serialisable array, and the
 * result is fed straight back to the provider agent loop. This is the
 * right home for integrations that are inherently server-side:
 * site-health checks, WooCommerce lookups, WP-CLI wrappers, any
 * database-heavy query.
 *
 * JS-owned tools (plugin slash-commands) take a different path — the
 * shell harvests the command registry client-side, passes metadata
 * to the AI as tools, receives a `tool_call` answer_type back, and
 * invokes the command's `run()` locally. See `src/ai/ask.ts`.
 *
 * Example:
 *
 * ```php
 * desktop_mode_register_ai_tool( array(
 *     'name'             => 'list_recent_orders',
 *     'description'      => 'List the site\'s most recent WooCommerce orders.',
 *     'parameters'       => array(
 *         'type'       => 'object',
 *         'properties' => array(
 *             'limit'  => array( 'type' => 'integer' ),
 *             'status' => array( 'type' => 'string', 'enum' => array( 'processing', 'completed' ) ),
 *         ),
 *         'required'   => array( 'limit' ),
 *     ),
 *     'handler'          => 'my_plugin_list_orders',
 *     'capability'       => 'manage_woocommerce',
 *     'progress_message' => 'Checking recent orders…',
 * ) );
 * ```
 *
 * Handlers receive `( array $args, int $user_id )` and return
 * `array|WP_Error`. A thrown exception is caught, reported via the
 * `desktop_mode_ai_search_error` action, and relayed to the model as a
 * structured `{ error: ... }` tool result; a `WP_Error` return is
 * relayed to the model the same way (without firing the action) so the
 * agent can decide whether to try another tool.
 *
 * @since 0.5.1
 * @package WPDesktopMode
 */

/**
 * Register a server-side AI tool.
 *
 * @since 0.5.1
 *
 * @param array $args {
 *     @type string   $name             Unique tool name, `[a-z0-9_]+` (1-64 chars).
 *                                       Namespace with your plugin prefix — e.g. `woocommerce_list_orders`.
 *                                       Required.
 *     @type string   $description      One-line description shown to the model as part of the tool spec.
 *                                       Required.
 *     @type array    $parameters       JSON-Schema object describing the tool's arguments. Follow the
 *                                       the provider function-calling shape — `{ type: "object", properties: {...},
 *                                       required: [...] }`. Default `{ type: "object", properties: {} }`
 *                                       for tools that take no arguments (in PHP, use `(object) array()` or
 *                                       `new stdClass()` for `properties` so it JSON-encodes as an object,
 *                                       not an array).
 *     @type callable $handler          `function( array $args, int $user_id ): array|WP_Error`. Return
 *                                       value is JSON-encoded and passed back to the model. Required.
 *     @type string   $capability       WordPress capability the current user must hold for the tool to
 *                                       be visible to the model. Checked BEFORE the tool is included in
 *                                       the request — unauthorised users never even see it exists.
 *                                       Default empty (visible to all logged-in users with AI enabled).
 *     @type string   $progress_message Short phrase shown to the user while the tool runs (SSE progress
 *                                       events). Falls back to a generic "Working…" when empty.
 * }
 * @return true|WP_Error `true` on success, `WP_Error` on validation failure.
 */
function desktop_mode_register_ai_tool( $args ) {
	$defaults = array(
		'name'             => '',
		'description'      => '',
		'parameters'       => array(
			'type'       => 'object',
			'properties' => (object) array(),
		),
		'handler'          => null,
		'capability'       => '',
		'progress_message' => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$name = (string) $args['name'];
	if ( '' === $name || ! preg_match( '/^[a-z0-9_]{1,64}$/', $name ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_ai_tool_invalid_name',
			__( 'AI tool registration requires a `name` matching [a-z0-9_]{1,64}.', 'desktop-mode' ),
			array( 'name' => $name )
		);
	}
	if ( '' === (string) $args['description'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_ai_tool_missing_description',
			__( 'AI tool registration requires a non-empty `description`.', 'desktop-mode' ),
			array( 'name' => $name )
		);
	}
	if ( ! is_callable( $args['handler'] ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_ai_tool_invalid_handler',
			__( 'AI tool registration requires a callable `handler`.', 'desktop-mode' ),
			array( 'name' => $name )
		);
	}
	if ( ! is_array( $args['parameters'] ) && ! is_object( $args['parameters'] ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_ai_tool_invalid_parameters',
			__( 'AI tool `parameters` must be a JSON-Schema object.', 'desktop-mode' ),
			array( 'name' => $name )
		);
	}

	$entry = array(
		'name'             => $name,
		'description'      => (string) $args['description'],
		'parameters'       => $args['parameters'],
		'handler'          => $args['handler'],
		'capability'       => (string) $args['capability'],
		'progress_message' => (string) $args['progress_message'],
	);
	desktop_mode_desktop_ai_tool_registry( $name, $entry );

	/**
	 * Fires after a desktop AI tool is successfully registered.
	 *
	 * @since 0.5.1
	 *
	 * @param string $name  The tool name.
	 * @param array  $entry The stored registry entry (handler included).
	 */
	do_action( 'desktop_mode_ai_tool_registered', $name, $entry );

	return true;
}

/**
 * Internal module-level registry for AI tools declared via
 * {@see desktop_mode_register_ai_tool()}.
 *
 * @since 0.5.1
 * @internal
 *
 * @param string     $name  Tool name to read or write.
 * @param array|null $entry Entry to store, or `null` to read.
 * @return array|null|array<string,array>
 */
function desktop_mode_desktop_ai_tool_registry( $name = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $name ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $name ] = $entry;
	}
	return isset( $store[ (string) $name ] ) ? $store[ (string) $name ] : null;
}

/**
 * Capability-filtered list of registered AI tools for the current user.
 *
 * Walks the registry and drops any tool whose `capability` the current
 * user doesn't hold. The caller (the agent loop in search.php) later
 * merges the result with the built-in and command tools and runs the
 * combined list through the `desktop_mode_ai_tools` filter.
 *
 * @since 0.5.1
 *
 * @param int $user_id User whose capabilities gate visibility.
 * @return array[] List of tool entries with `handler` still attached —
 *                 the caller is expected to strip `handler` before
 *                 sending the definitions to the provider.
 */
function desktop_mode_get_registered_ai_tools_for_user( $user_id ) {
	$registry = desktop_mode_desktop_ai_tool_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$user = $user_id > 0 ? get_user_by( 'id', $user_id ) : null;
	$out  = array();
	foreach ( $registry as $entry ) {
		$cap = (string) ( $entry['capability'] ?? '' );
		if ( '' !== $cap && ( ! $user || ! user_can( $user, $cap ) ) ) {
			continue;
		}
		$out[] = $entry;
	}
	return $out;
}

/**
 * Project a registered tool entry into the provider function-calling
 * tool definition shape. Strips the handler + internal metadata.
 *
 * @since 0.5.1
 *
 * @param array $entry Registry entry.
 * @return array the provider tool definition.
 */
function desktop_mode_ai_tool_entry_to_definition( array $entry ) {
	return array(
		'type'        => 'function',
		'name'        => (string) $entry['name'],
		'description' => (string) $entry['description'],
		'parameters'  => $entry['parameters'],
	);
}

/**
 * Invoke a registered tool's handler, translating exceptions and
 * `WP_Error` returns into a structured error payload the model can
 * reason about without aborting the run.
 *
 * @since 0.5.1
 *
 * @param array $entry   Registry entry (must include `handler`).
 * @param array $args    Decoded arguments from the model's tool call.
 * @param int   $user_id Current user (forwarded to the handler).
 * @return array JSON-serialisable payload (error envelope on failure).
 */
function desktop_mode_ai_invoke_registered_tool( array $entry, array $args, $user_id ) {
	$name = (string) ( $entry['name'] ?? '' );
	try {
		$result = call_user_func( $entry['handler'], $args, (int) $user_id );
	} catch ( \Throwable $e ) {
		/**
		 * Fires when an AI tool handler throws.
		 *
		 * @since 0.5.1
		 *
		 * @param array     $error { code, message, data } scrubbed of
		 *                           exception internals.
		 * @param string    $name  Tool name that threw.
		 * @param \Throwable $e     The caught exception.
		 */
		do_action(
			'desktop_mode_ai_search_error',
			array(
				'code'    => 'desktop_mode_ai_tool_exception',
				'message' => 'Tool handler threw.',
				'data'    => array( 'tool' => $name ),
			),
			$name,
			$e
		);
		return array(
			'error'   => 'tool_exception',
			'tool'    => $name,
			'message' => 'The tool failed. Try a different approach.',
		);
	}

	if ( is_wp_error( $result ) ) {
		return array(
			'error'   => $result->get_error_code(),
			'tool'    => $name,
			'message' => $result->get_error_message(),
		);
	}
	if ( ! is_array( $result ) ) {
		return array(
			'error'   => 'tool_bad_return',
			'tool'    => $name,
			'message' => 'Handler did not return an array.',
		);
	}
	return $result;
}
