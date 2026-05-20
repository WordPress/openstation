<?php
/**
 * Desktop Mode — Agents: runtime invocation via OpenAI.
 *
 * Given a `{ agent, message }` pair, this module:
 *
 *   1. Resolves the agent's `wp_guideline` post and reads its
 *      instructions (post_content) + enabled abilities meta.
 *   2. Projects each enabled ability into a Responses-API tool
 *      definition using its `input_schema` from Core's Abilities API.
 *   3. Calls the active AI provider (defaults to OpenAI via
 *      `desktop_mode_ai_openai_responses_call`) with the agent's
 *      instructions as `instructions`, the user message as `input`,
 *      and the projected tools.
 *   4. Loops: for every function_call in the response, execute the
 *      matching `WP_Ability` via Core's `execute()` method, feed the
 *      output back as `function_call_output`, call the API again.
 *      Stops when the model emits no further function calls (or hits
 *      a safety cap).
 *
 * Tool execution honours the standard WP capability checks the
 * ability declares — i.e. the agent runs the tool *as itself* (its
 * synthetic `wp_users` row), and Core's permission_callback gates
 * each call. This is what makes the runtime safe: an agent with the
 * `editor` role can only call `dm_update_post` on posts an editor
 * could update through wp-admin.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Safety cap — refuse to loop more than this many turns to avoid a
 * runaway agent burning through the API budget. Each round-trip
 * to OpenAI counts as one turn.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS = 8;

/**
 * Run one full agent invocation. Switches to the agent's identity
 * for the duration of the call so ability permission callbacks see
 * the agent (its role + caps), not the human admin who triggered
 * the request.
 *
 * @since 0.23.0
 *
 * @param int    $agent_user_id Agent's `wp_users.ID`.
 * @param string $message       User-supplied message to the agent.
 * @return array|WP_Error `{ text: string, toolCalls: array, turns: int }` on success.
 */
function desktop_mode_agent_invoke( $agent_user_id, $message ) {
	$user = get_userdata( (int) $agent_user_id );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agent_not_found',
			__( 'Agent not found.', 'desktop-mode' )
		);
	}
	if ( ! is_string( $message ) || '' === trim( $message ) ) {
		return new WP_Error(
			'desktop_mode_agent_empty_message',
			__( 'Message must be a non-empty string.', 'desktop-mode' )
		);
	}

	$guideline = desktop_mode_agents_get_guideline_for_user( $user->ID );
	if ( ! $guideline ) {
		return new WP_Error(
			'desktop_mode_agent_no_guideline',
			__( 'Agent has no linked behaviour guideline.', 'desktop-mode' )
		);
	}

	$instructions = (string) $guideline->post_content;
	$enabled      = desktop_mode_agents_get_abilities( $guideline->ID );
	$tools        = desktop_mode_agent_runner_build_tools( $enabled );

	$api_key = desktop_mode_agent_runner_resolve_openai_key();
	if ( is_wp_error( $api_key ) ) {
		return $api_key;
	}

	$model = function_exists( 'desktop_mode_agent_get_model' )
		? desktop_mode_agent_get_model( $user->ID )
		: '';
	if ( '' !== $model ) {
		add_filter(
			'desktop_mode_ai_model',
			static function ( $existing ) use ( $model ) {
				return $model;
			},
			99
		);
	}

	// Switch into the agent's identity so every ability's
	// `permission_callback` evaluates against the agent's role, not
	// the admin who hit the REST endpoint.
	$previous_user_id = get_current_user_id();
	wp_set_current_user( $user->ID );

	try {
		$result = desktop_mode_agent_runner_loop(
			$api_key,
			$instructions,
			$message,
			$tools
		);
	} finally {
		wp_set_current_user( $previous_user_id );
	}

	/**
	 * Fires after a successful invocation. Lets plugins log / audit
	 * each agent call. Errors don't fire this — they return up.
	 *
	 * @since 0.23.0
	 *
	 * @param int    $agent_user_id Agent user id.
	 * @param string $message       Submitted message.
	 * @param array  $result        `{ text, toolCalls, turns }`.
	 */
	if ( ! is_wp_error( $result ) ) {
		desktop_mode_agent_runner_log_invocation( (int) $user->ID, $message, $result );
		do_action( 'desktop_mode_agent_invoked', (int) $user->ID, $message, $result );
	} else {
		desktop_mode_agent_runner_log_invocation(
			(int) $user->ID,
			$message,
			array(
				'text'      => '',
				'toolCalls' => array(),
				'turns'     => 0,
			),
			$result->get_error_message()
		);
	}

	return $result;
}

/**
 * User-meta key holding the invocation log for an agent. Capped at
 * `DESKTOP_MODE_AGENT_RUNNER_LOG_CAP` rows — older entries roll off
 * the front as new ones are appended.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENT_RUNNER_LOG_META = '_desktop_mode_agent_runs';
const DESKTOP_MODE_AGENT_RUNNER_LOG_CAP  = 50;

/**
 * Append one invocation to the agent's persistent log. The dossier
 * REST route surfaces the most recent entries to the bundle's
 * Activity surface.
 *
 * @since 0.23.0
 *
 * @param int    $agent_user_id Agent user id.
 * @param string $message       Submitted message.
 * @param array  $result        `{ text, toolCalls, turns }`.
 * @param string $error_message Optional — non-empty when the run failed.
 * @return void
 */
function desktop_mode_agent_runner_log_invocation( $agent_user_id, $message, array $result, $error_message = '' ) {
	$tool_calls = isset( $result['toolCalls'] ) && is_array( $result['toolCalls'] )
		? $result['toolCalls']
		: array();
	$tool_names = array();
	foreach ( $tool_calls as $tc ) {
		if ( is_array( $tc ) && isset( $tc['name'] ) && is_string( $tc['name'] ) ) {
			$tool_names[] = $tc['name'];
		}
	}
	$entry = array(
		'time'           => time(),
		'userId'         => (int) get_current_user_id(),
		'userName'       => '',
		'message'        => mb_substr( (string) $message, 0, 600 ),
		'status'         => '' !== $error_message ? 'error' : 'done',
		'error'          => (string) $error_message,
		'text'           => '' !== $error_message
			? ''
			: mb_substr( isset( $result['text'] ) ? (string) $result['text'] : '', 0, 600 ),
		'turns'          => isset( $result['turns'] ) ? (int) $result['turns'] : 0,
		'toolCallsCount' => count( $tool_calls ),
		'toolNames'      => array_values( array_slice( $tool_names, 0, 12 ) ),
	);
	$caller = get_userdata( $entry['userId'] );
	if ( $caller instanceof WP_User ) {
		$entry['userName'] = (string) $caller->display_name;
	}

	$log = get_user_meta( (int) $agent_user_id, DESKTOP_MODE_AGENT_RUNNER_LOG_META, true );
	if ( ! is_array( $log ) ) {
		$log = array();
	}
	$log[] = $entry;
	if ( count( $log ) > DESKTOP_MODE_AGENT_RUNNER_LOG_CAP ) {
		$log = array_slice( $log, -DESKTOP_MODE_AGENT_RUNNER_LOG_CAP );
	}
	update_user_meta( (int) $agent_user_id, DESKTOP_MODE_AGENT_RUNNER_LOG_META, $log );
}

/**
 * Read the agent's invocation log (most-recent-first).
 *
 * @since 0.23.0
 *
 * @param int $agent_user_id Agent user id.
 * @return array
 */
function desktop_mode_agent_runner_get_log( $agent_user_id ) {
	$log = get_user_meta( (int) $agent_user_id, DESKTOP_MODE_AGENT_RUNNER_LOG_META, true );
	if ( ! is_array( $log ) ) {
		return array();
	}
	return array_values( array_reverse( $log ) );
}

/**
 * Project an array of ability slugs into the Responses-API tool
 * shape. Unknown / unregistered slugs are dropped silently —
 * better to call with a smaller-than-expected tool set than to
 * crash the whole invocation.
 *
 * @since 0.23.0
 *
 * @param string[] $ability_slugs Slugs enabled on the agent's guideline.
 * @return array Responses-API tool definitions.
 */
function desktop_mode_agent_runner_build_tools( array $ability_slugs ) {
	if ( ! function_exists( 'wp_get_ability' ) ) {
		return array();
	}

	$tools = array();
	foreach ( $ability_slugs as $slug ) {
		$ability = wp_get_ability( (string) $slug );
		if ( ! $ability ) {
			continue;
		}
		$schema = method_exists( $ability, 'get_input_schema' ) ? $ability->get_input_schema() : array();
		if ( ! is_array( $schema ) || empty( $schema ) ) {
			$schema = array( 'type' => 'object', 'properties' => (object) array() );
		}
		$tool_name = desktop_mode_agent_runner_normalize_tool_name( (string) $slug );
		$tools[]   = array(
			'type'        => 'function',
			'name'        => $tool_name,
			'description' => method_exists( $ability, 'get_description' )
				? (string) $ability->get_description()
				: (string) $slug,
			'parameters'  => $schema,
		);
	}
	return $tools;
}

/**
 * OpenAI restricts function names to `[a-zA-Z0-9_-]{1,64}`. Ability
 * slugs sometimes use `/` (e.g. `core/get-site-info`); convert those
 * to underscores so the API accepts them. We track the slug ↔ name
 * mapping at call time via a memoized inverse lookup
 * (`desktop_mode_agent_runner_denormalize_tool_name`).
 *
 * @since 0.23.0
 *
 * @param string $slug Ability slug.
 * @return string OpenAI-safe tool name.
 */
function desktop_mode_agent_runner_normalize_tool_name( $slug ) {
	$normalized = preg_replace( '/[^a-zA-Z0-9_-]/', '_', $slug );
	return substr( $normalized, 0, 64 );
}

/**
 * Reverse the slash-to-underscore normalization. We try the literal
 * normalized name first as an ability slug, then fall back to
 * replacing the first underscore with a slash (covers
 * `core_get-site-info` → `core/get-site-info`). For `dm_*` abilities
 * (no slash, already legal) the first branch hits.
 *
 * @since 0.23.0
 *
 * @param string $name OpenAI tool name as returned by a function_call.
 * @return string The ability slug to look up via `wp_get_ability()`.
 */
function desktop_mode_agent_runner_denormalize_tool_name( $name ) {
	if ( ! function_exists( 'wp_get_ability' ) ) {
		return $name;
	}
	if ( wp_get_ability( $name ) ) {
		return $name;
	}
	// Try replacing the first underscore with a slash.
	$with_slash = preg_replace( '/_/', '/', $name, 1 );
	if ( $with_slash && wp_get_ability( $with_slash ) ) {
		return $with_slash;
	}
	return $name;
}

/**
 * Inner loop — calls OpenAI, dispatches tool calls, repeats. Returns
 * `{ text, toolCalls, turns }` or WP_Error.
 *
 * @since 0.23.0
 *
 * @param string $api_key      OpenAI secret key.
 * @param string $instructions System prompt.
 * @param string $message      User message.
 * @param array  $tools        Responses-API tool definitions.
 * @return array|WP_Error
 */
function desktop_mode_agent_runner_loop( $api_key, $instructions, $message, array $tools ) {
	$turn_input = desktop_mode_ai_openai_make_turn_input( 'user_message', $message );
	$tool_trace = array();
	$previous_response_id = null;

	for ( $turn = 1; $turn <= DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS; $turn++ ) {
		$response = desktop_mode_ai_openai_responses_call(
			$api_key,
			$turn_input,
			$tools,
			null,
			$instructions,
			$previous_response_id
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$previous_response_id = isset( $response['id'] ) ? (string) $response['id'] : null;
		$function_calls       = desktop_mode_ai_extract_function_calls( $response );

		if ( empty( $function_calls ) ) {
			$text = desktop_mode_ai_extract_text( $response );
			return array(
				'text'      => is_string( $text ) ? $text : '',
				'toolCalls' => $tool_trace,
				'turns'     => $turn,
			);
		}

		// Run every function call the model requested in this turn,
		// then feed all the outputs back together (Responses API
		// expects one `function_call_output` per `call_id`).
		$results = array();
		foreach ( $function_calls as $call ) {
			$call_id = isset( $call['call_id'] ) ? (string) $call['call_id'] : '';
			$name    = isset( $call['name'] ) ? (string) $call['name'] : '';
			$args    = isset( $call['arguments'] ) ? $call['arguments'] : '{}';
			if ( is_string( $args ) ) {
				$decoded = json_decode( $args, true );
				$args    = is_array( $decoded ) ? $decoded : array();
			}
			if ( ! is_array( $args ) ) {
				$args = array();
			}

			$slug    = desktop_mode_agent_runner_denormalize_tool_name( $name );
			$output  = desktop_mode_agent_runner_dispatch_tool( $slug, $args );
			$encoded = is_wp_error( $output )
				? wp_json_encode( array( 'error' => $output->get_error_message() ) )
				: wp_json_encode( $output );

			$tool_trace[] = array(
				'callId' => $call_id,
				'name'   => $slug,
				'args'   => $args,
				'output' => is_wp_error( $output ) ? null : $output,
				'error'  => is_wp_error( $output ) ? $output->get_error_message() : null,
			);
			$results[]    = array(
				'call_id' => $call_id,
				'output'  => is_string( $encoded ) ? $encoded : '""',
			);
		}

		$turn_input = desktop_mode_ai_openai_make_turn_input( 'tool_results', $results );
	}

	return new WP_Error(
		'desktop_mode_agent_runner_max_turns',
		sprintf(
			/* translators: %d is the max-turn cap. */
			__( 'Agent stopped after %d turns without a final answer.', 'desktop-mode' ),
			DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS
		)
	);
}

/**
 * Execute one ability call. Looks the ability up by slug, runs its
 * standard `check_permissions` + `execute` lifecycle. Returns the
 * raw output or a WP_Error that the loop wraps for the model.
 *
 * @since 0.23.0
 *
 * @param string $slug Ability slug.
 * @param array  $args Arguments from the function call.
 * @return mixed
 */
function desktop_mode_agent_runner_dispatch_tool( $slug, array $args ) {
	if ( ! function_exists( 'wp_get_ability' ) ) {
		return new WP_Error(
			'desktop_mode_agent_no_abilities_api',
			__( 'Abilities API is not available on this site.', 'desktop-mode' )
		);
	}
	$ability = wp_get_ability( $slug );
	if ( ! $ability ) {
		return new WP_Error(
			'desktop_mode_agent_unknown_ability',
			sprintf(
				/* translators: %s is the ability slug. */
				__( 'Ability "%s" is not registered on this site.', 'desktop-mode' ),
				$slug
			)
		);
	}
	if ( method_exists( $ability, 'check_permissions' ) && ! $ability->check_permissions( $args ) ) {
		return new WP_Error(
			'desktop_mode_agent_ability_forbidden',
			sprintf(
				/* translators: %s is the ability slug. */
				__( 'Agent does not have permission to run "%s".', 'desktop-mode' ),
				$slug
			)
		);
	}
	if ( ! method_exists( $ability, 'execute' ) ) {
		return new WP_Error(
			'desktop_mode_agent_ability_no_execute',
			__( 'Ability has no execute() method on this site.', 'desktop-mode' )
		);
	}
	return $ability->execute( $args );
}

/**
 * Resolve the OpenAI API key from Desktop Mode's AI platform
 * settings. Returns a WP_Error when the platform isn't configured —
 * the REST endpoint surfaces that as a 412 so the bundle can paint
 * a "Configure your OpenAI key in OS Settings" hint.
 *
 * @since 0.23.0
 *
 * @return string|WP_Error
 */
function desktop_mode_agent_runner_resolve_openai_key() {
	$user_id = get_current_user_id();

	// Resolve in the same order `desktop_mode_ai_is_enabled` and the
	// AI Copilot search endpoint do:
	//   1. Platform-wide key (`wp_options.desktop_mode_ai_platform`)
	//   2. Per-user OS-Settings key (`user_meta`, via
	//      `desktop_mode_ai_get_settings`)
	//
	// The Send-To dispatcher's `runInvocation` switches into the
	// agent's identity for ability dispatch, but key resolution
	// runs as the human caller — they're the one who configured the
	// key. Same flow the AI Copilot search uses.

	if ( ! function_exists( 'desktop_mode_ai_resolve_key_for_provider' ) ) {
		return new WP_Error(
			'desktop_mode_agent_no_ai_platform',
			__( 'AI Platform settings are not available on this site.', 'desktop-mode' )
		);
	}

	if ( function_exists( 'desktop_mode_ai_get_platform_settings' ) ) {
		$platform = desktop_mode_ai_get_platform_settings();
		if ( is_array( $platform ) ) {
			$key = desktop_mode_ai_resolve_key_for_provider( $platform, 'openai' );
			if ( '' !== trim( (string) $key ) ) {
				return trim( (string) $key );
			}
		}
	}

	if ( $user_id > 0 && function_exists( 'desktop_mode_ai_get_settings' ) ) {
		$user_ai = desktop_mode_ai_get_settings( $user_id );
		if ( is_array( $user_ai ) ) {
			$key = desktop_mode_ai_resolve_key_for_provider( $user_ai, 'openai' );
			if ( '' !== trim( (string) $key ) ) {
				return trim( (string) $key );
			}
		}
	}

	return new WP_Error(
		'desktop_mode_agent_no_openai_key',
		__(
			'Configure an OpenAI API key in OS Settings → AI before running agents.',
			'desktop-mode'
		)
	);
}
