<?php
/**
 * Desktop Mode — Agents: runtime invocation via the Core AI Client.
 *
 * Given a `{ agent, message }` pair, this module:
 *
 *   1. Reads the agent's instructions + ability allowlist from user
 *      meta (store.php).
 *   2. Projects each allowlisted ability into a function declaration
 *      using its `input_schema` from Core's Abilities API.
 *   3. Generates through `desktop_mode_ai_client_generate()` (the
 *      AI Copilot's adapter over `wp_ai_client_prompt()`) with the
 *      agent's instructions as the system instruction.
 *   4. Loops: for every function call in the response, execute the
 *      matching `WP_Ability` (permission check + `execute()`), fold
 *      the call + result into a text transcript, generate again.
 *      Stops when the model emits no further function calls, or at
 *      the turn cap.
 *
 * The whole tool loop runs with the CURRENT USER SWITCHED TO THE
 * AGENT, so every ability's `permission_callback` evaluates against
 * the agent's role — an `author`-role agent can only touch what an
 * author could touch in wp-admin. The switch is restored in `finally`
 * and the REST response is composed as the human caller.
 *
 * Conversation history is kept as neutral rows and converted to SDK
 * message DTOs only at generate time, so the
 * `desktop_mode_agent_runner_generate` pre-filter can service a turn
 * without the WordPress 7.0 AI Client being present (PHPUnit, or an
 * alternative runtime shipped by a plugin).
 *
 * DELIBERATE: assistant function-call turns are never replayed to the
 * provider. Each generate turn sends ONE user message — the original
 * request plus a transcript of the tool calls already executed and
 * their results ({@see desktop_mode_agent_runner_compose_prompt()}).
 * Replaying `functionCall` message parts requires provider-specific
 * cryptographic signatures (Gemini's `thought_signature`, Anthropic's
 * thinking-block signature) that the current provider plugins do not
 * round-trip, and one missing signature 400s the whole request. A
 * text transcript carries the same information with no signature
 * requirement and no call/response pairing constraints, on every
 * provider.
 *
 * @package WPDesktopMode
 * @since   0.9.8
 */

defined( 'ABSPATH' ) || exit;

/**
 * Safety cap — refuse to loop more than this many generate turns so a
 * runaway agent can't burn through the site's API budget.
 *
 * @since 0.9.8
 */
const DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS = 8;

/**
 * User-meta key holding the invocation log for an agent, capped at
 * `DESKTOP_MODE_AGENT_RUNNER_LOG_CAP` rows — older entries roll off
 * the front as new ones are appended.
 *
 * @since 0.9.8
 */
const DESKTOP_MODE_AGENT_RUNNER_LOG_META = '_desktop_mode_agent_runs';
const DESKTOP_MODE_AGENT_RUNNER_LOG_CAP  = 50;

/**
 * Whether the runner can service an invocation right now: either the
 * Core AI Client stack is present, or a plugin (or the test suite)
 * hooked the `desktop_mode_agent_runner_generate` pre-filter to
 * provide generation another way.
 *
 * @since 0.9.8
 *
 * @return bool
 */
function desktop_mode_agent_runner_available() {
	if ( has_filter( 'desktop_mode_agent_runner_generate' ) ) {
		return true;
	}
	return function_exists( 'desktop_mode_ai_is_available' ) && desktop_mode_ai_is_available();
}

/**
 * Run one full agent invocation.
 *
 * @since 0.9.8
 *
 * @param int    $agent_user_id Agent's `wp_users.ID`.
 * @param string $message       Message for the agent.
 * @param array  $context       Optional invocation context — free-form,
 *                              passed through to the completed action.
 *                              Convention: `source` names the trigger
 *                              (`chat`, `send-to`, `hook`, …).
 * @return array|WP_Error `{ text: string, toolCalls: array, turns: int }` on success.
 */
function desktop_mode_agent_invoke( $agent_user_id, $message, $context = array() ) {
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
	if ( ! desktop_mode_agent_runner_available() ) {
		return new WP_Error(
			'desktop_mode_agent_ai_unavailable',
			__( 'The WordPress AI Client is not available on this site. Configure an AI connector to run agents.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}

	$rate = desktop_mode_agent_runner_check_rate_limit( (int) $user->ID );
	if ( is_wp_error( $rate ) ) {
		return $rate;
	}

	$instructions = desktop_mode_agent_get_instructions( $user->ID );
	$abilities    = desktop_mode_agent_get_abilities( $user->ID );

	list( $tool_defs, $slug_by_name ) = desktop_mode_agent_runner_build_tools( $abilities );

	// Switch into the agent's identity so every ability's
	// `permission_callback` evaluates against the agent's role, not
	// the human (or hook context) that triggered the invocation.
	$previous_user_id = get_current_user_id();
	wp_set_current_user( $user->ID );

	try {
		$result = desktop_mode_agent_runner_loop(
			(int) $user->ID,
			$instructions,
			$message,
			$tool_defs,
			$slug_by_name
		);
	} finally {
		wp_set_current_user( $previous_user_id );
	}

	if ( is_wp_error( $result ) ) {
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
		return $result;
	}

	desktop_mode_agent_runner_log_invocation( (int) $user->ID, $message, $result );

	/**
	 * Fires after a successful agent invocation.
	 *
	 * The audit + chaining seam: logging plugins persist the run,
	 * and the (Phase C) agent-to-agent trigger consumes it to feed
	 * one agent's output into another.
	 *
	 * @since 0.9.8
	 *
	 * @param int    $agent_user_id Agent user id.
	 * @param string $message       Submitted message.
	 * @param array  $result        `{ text, toolCalls, turns }`.
	 * @param array  $context       Invocation context passed to
	 *                              `desktop_mode_agent_invoke()`.
	 */
	do_action( 'desktop_mode_agent_completed', (int) $user->ID, $message, $result, (array) $context );

	return $result;
}

/**
 * Enforce the per-agent invocation rate limit.
 *
 * Counter lives in a transient bucketed by the current UTC hour. The
 * effective limit is the agent's meta override when set, else the
 * filterable platform default.
 *
 * @since 0.9.8
 *
 * @param int $agent_user_id Agent user id.
 * @return true|WP_Error
 */
function desktop_mode_agent_runner_check_rate_limit( $agent_user_id ) {
	$limit = desktop_mode_agent_get_rate_limit( $agent_user_id );
	if ( $limit <= 0 ) {
		/**
		 * Filter the default per-agent invocations-per-hour limit,
		 * applied when the agent has no per-agent override.
		 *
		 * @since 0.9.8
		 *
		 * @param int $limit         Default limit (60).
		 * @param int $agent_user_id Agent user id.
		 */
		$limit = (int) apply_filters( 'desktop_mode_agent_default_rate_limit', 60, $agent_user_id );
	}
	if ( $limit <= 0 ) {
		return true;
	}

	$bucket = gmdate( 'YmdH' );
	$key    = 'desktop_mode_agent_rate_' . (int) $agent_user_id . '_' . $bucket;
	$count  = (int) get_transient( $key );
	if ( $count >= $limit ) {
		return new WP_Error(
			'desktop_mode_agent_rate_limited',
			sprintf(
				/* translators: %d is the hourly invocation cap. */
				__( 'This agent reached its limit of %d runs this hour. Try again later.', 'desktop-mode' ),
				$limit
			),
			array( 'status' => 429 )
		);
	}
	set_transient( $key, $count + 1, HOUR_IN_SECONDS );
	return true;
}

/**
 * Project ability slugs into neutral tool definitions plus the
 * model-name → ability-slug map used to route function calls back.
 *
 * Unknown / unregistered slugs are dropped silently — better to run
 * with a smaller tool set than to fail the whole invocation because
 * one plugin deactivated.
 *
 * @since 0.9.8
 *
 * @param string[] $ability_slugs Allowlisted ability slugs.
 * @return array{0: array, 1: array<string,string>} Tool definitions + name map.
 */
function desktop_mode_agent_runner_build_tools( array $ability_slugs ) {
	if ( ! function_exists( 'wp_get_ability' ) ) {
		return array( array(), array() );
	}

	$tools        = array();
	$slug_by_name = array();
	foreach ( $ability_slugs as $slug ) {
		$ability = wp_get_ability( (string) $slug );
		if ( ! $ability ) {
			continue;
		}
		// Project the ability's schema onto the provider-supported
		// subset — same reshaping the Copilot applies. Providers
		// reject the WHOLE request over one tool with a top-level
		// `oneOf`/`anyOf`/`allOf` or a `type` union, and abilities in
		// the wild use both. `WP_Ability::execute()` still validates
		// against the real schema, so nothing loses enforcement.
		$schema = desktop_mode_ai_normalize_tool_schema( $ability->get_input_schema() );
		$name   = desktop_mode_ai_ability_tool_name( (string) $slug );
		if ( isset( $slug_by_name[ $name ] ) ) {
			// Two namespaces mangling to the same tool name — keep the
			// first, drop the collision.
			continue;
		}
		$slug_by_name[ $name ] = (string) $slug;

		$tools[] = array(
			'type'        => 'function',
			'name'        => $name,
			'description' => (string) $ability->get_description(),
			'parameters'  => $schema,
		);
	}
	return array( $tools, $slug_by_name );
}

/**
 * Inner loop — generate, dispatch tool calls, repeat.
 *
 * @since 0.9.8
 *
 * @param int    $agent_user_id Agent user id (current user at this point).
 * @param string $instructions  System prompt from the agent definition.
 * @param string $message       User message.
 * @param array  $tool_defs     Neutral tool definitions.
 * @param array  $slug_by_name  Tool-name → ability-slug map.
 * @return array|WP_Error `{ text, toolCalls, turns }`.
 */
function desktop_mode_agent_runner_loop( $agent_user_id, $instructions, $message, array $tool_defs, array $slug_by_name ) {
	// Neutral history rows: { type: 'user_text'|'assistant'|'tool_results', ... }.
	$history = array(
		array(
			'type' => 'user_text',
			'text' => (string) $message,
		),
	);
	$tool_trace = array();

	for ( $turn = 1; $turn <= DESKTOP_MODE_AGENT_RUNNER_MAX_TURNS; $turn++ ) {
		$generated = desktop_mode_agent_runner_generate( $agent_user_id, $history, $tool_defs, $instructions );
		if ( is_wp_error( $generated ) ) {
			return $generated;
		}

		$function_calls = isset( $generated['function_calls'] ) && is_array( $generated['function_calls'] )
			? $generated['function_calls']
			: array();

		if ( empty( $function_calls ) ) {
			return array(
				'text'      => isset( $generated['text'] ) && is_string( $generated['text'] ) ? $generated['text'] : '',
				'toolCalls' => $tool_trace,
				'turns'     => $turn,
			);
		}

		$history[] = array(
			'type'    => 'assistant',
			'message' => isset( $generated['message'] ) ? $generated['message'] : null,
		);

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

			$slug   = isset( $slug_by_name[ $name ] ) ? $slug_by_name[ $name ] : '';
			$output = '' === $slug
				? new WP_Error(
					'desktop_mode_agent_unknown_tool',
					sprintf(
						/* translators: %s is the tool name the model called. */
						__( 'Tool "%s" is not on this agent\'s allowlist.', 'desktop-mode' ),
						$name
					)
				)
				: desktop_mode_agent_runner_dispatch_tool( $slug, $args );

			if ( ! is_wp_error( $output ) ) {
				/**
				 * Filter one tool result before it re-enters the LLM
				 * context and before it lands in the invocation trace.
				 * The sanitization seam — strip fields the model has
				 * no business seeing.
				 *
				 * @since 0.9.8
				 *
				 * @param mixed  $output        Raw ability output.
				 * @param string $slug          Ability slug.
				 * @param array  $args          Call arguments.
				 * @param int    $agent_user_id Agent user id.
				 */
				$output = apply_filters( 'desktop_mode_agent_tool_result', $output, $slug, $args, $agent_user_id );
			}

			$tool_trace[] = array(
				'callId' => $call_id,
				'name'   => '' !== $slug ? $slug : $name,
				'args'   => $args,
				'output' => is_wp_error( $output ) ? null : $output,
				'error'  => is_wp_error( $output ) ? $output->get_error_message() : null,
			);
			$results[]    = array(
				'call_id'  => $call_id,
				'name'     => $name,
				'args'     => $args,
				'response' => is_wp_error( $output )
					? array( 'error' => $output->get_error_message() )
					: $output,
			);
		}

		$history[] = array(
			'type'    => 'tool_results',
			'results' => $results,
		);
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
 * One generate turn: pre-filter first (tests / alternative runtimes),
 * then the Core AI Client via the Copilot's adapter.
 *
 * @since 0.9.8
 *
 * @param int    $agent_user_id Agent user id.
 * @param array  $history       Neutral history rows.
 * @param array  $tool_defs     Neutral tool definitions.
 * @param string $instructions  System instruction.
 * @return array|WP_Error `{ text, function_calls, message }` — the
 *                        subset of `desktop_mode_ai_client_generate()`'s
 *                        shape the loop consumes.
 */
function desktop_mode_agent_runner_generate( $agent_user_id, array $history, array $tool_defs, $instructions ) {
	/**
	 * Pre-filter one generation turn. Return a non-null
	 * `{ text, function_calls, message }` array (or a WP_Error) to
	 * short-circuit the Core AI Client — the seam PHPUnit and
	 * alternative runtimes plug into.
	 *
	 * @since 0.9.8
	 *
	 * @param array|WP_Error|null $generated     Null to proceed with the AI Client.
	 * @param array               $history       Neutral history rows.
	 * @param array               $tool_defs     Neutral tool definitions.
	 * @param string              $instructions  System instruction.
	 * @param int                 $agent_user_id Agent user id.
	 */
	$generated = apply_filters( 'desktop_mode_agent_runner_generate', null, $history, $tool_defs, $instructions, $agent_user_id );
	if ( null !== $generated ) {
		return $generated;
	}

	if ( ! function_exists( 'desktop_mode_ai_client_generate' ) || ! desktop_mode_ai_is_available() ) {
		return new WP_Error(
			'desktop_mode_agent_ai_unavailable',
			__( 'The WordPress AI Client is not available on this site.', 'desktop-mode' )
		);
	}

	// One user message per turn — original request + tool transcript.
	// See the file-level docblock for why history is never replayed as
	// functionCall/functionResponse message parts.
	$messages = array(
		desktop_mode_ai_user_text_message( desktop_mode_agent_runner_compose_prompt( $history ) ),
	);

	return desktop_mode_ai_client_generate( $agent_user_id, $messages, $tool_defs, null, (string) $instructions );
}

/**
 * Flattens the neutral history rows into the single user-message text
 * sent to the provider each turn: the original request, then a
 * transcript of every tool call already executed with its JSON result.
 *
 * Pure string builder (no SDK types) so it is unit-testable without
 * the AI Client.
 *
 * @since 0.9.8
 *
 * @param array $history Neutral history rows.
 * @return string
 */
function desktop_mode_agent_runner_compose_prompt( array $history ) {
	$base       = '';
	$transcript = array();

	foreach ( $history as $row ) {
		if ( ! is_array( $row ) ) {
			continue;
		}
		$type = isset( $row['type'] ) ? $row['type'] : '';
		if ( 'user_text' === $type && '' === $base ) {
			$base = isset( $row['text'] ) ? (string) $row['text'] : '';
			continue;
		}
		if ( 'tool_results' !== $type || ! isset( $row['results'] ) || ! is_array( $row['results'] ) ) {
			continue;
		}
		foreach ( $row['results'] as $result ) {
			if ( ! is_array( $result ) ) {
				continue;
			}
			$transcript[] = sprintf(
				'- %s(%s) -> %s',
				isset( $result['name'] ) ? (string) $result['name'] : '',
				wp_json_encode( isset( $result['args'] ) ? $result['args'] : array() ),
				wp_json_encode( isset( $result['response'] ) ? $result['response'] : null )
			);
		}
	}

	if ( empty( $transcript ) ) {
		return $base;
	}

	return $base
		. "\n\n"
		. "Tool calls you already executed for this request, with their results. Use them — do not repeat an identical call:\n"
		. implode( "\n", $transcript );
}

/**
 * Execute one ability call: standard `check_permissions` + `execute`
 * lifecycle, as the current (agent) user.
 *
 * @since 0.9.8
 *
 * @param string $slug Ability slug.
 * @param array  $args Arguments from the function call.
 * @return mixed Output or WP_Error.
 */
function desktop_mode_agent_runner_dispatch_tool( $slug, array $args ) {
	if ( ! function_exists( 'wp_get_ability' ) ) {
		return new WP_Error(
			'desktop_mode_agent_no_abilities_api',
			__( 'The Abilities API is not available on this site.', 'desktop-mode' )
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
	// `execute()` runs the ability's own permission callback + schema
	// validation; a failed permission check comes back as WP_Error.
	return $ability->execute( $args );
}

/**
 * Append one invocation to the agent's persistent log. Most-recent
 * entries surface in the chat window's history strip.
 *
 * @since 0.9.8
 *
 * @param int    $agent_user_id Agent user id.
 * @param string $message       Submitted message.
 * @param array  $result        `{ text, toolCalls, turns }`.
 * @param string $error_message Optional — non-empty when the run failed.
 * @return void
 */
function desktop_mode_agent_runner_log_invocation( $agent_user_id, $message, array $result, $error_message = '' ) {
	$tool_calls = isset( $result['toolCalls'] ) && is_array( $result['toolCalls'] ) ? $result['toolCalls'] : array();
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
 * @since 0.9.8
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
