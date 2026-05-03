<?php
/**
 * Desktop Mode — Routines: AI "Describe it" generator.
 *
 * Plain-language → routine JSON via the OpenAI Responses API
 * with **structured output** (`text.format = json_schema, strict`).
 * The model is required to emit JSON conforming to the routine
 * schema; we still revalidate server-side via `wpdm_routine_validate_def`
 * before returning to the client (defence in depth — never trust
 * a model to honour a contract).
 *
 * The system prompt embeds the user-visible catalog (every
 * registered trigger + action + AI tool the current user is
 * allowed to see), so the model picks valid `trigger.id` /
 * action `id` values from the actual installed catalogue. No
 * hallucinated hook names.
 *
 * REST: `POST /wp-desktop/v1/routines/from-prompt` body
 *   `{ prompt: string }` →
 *   `{ def: RoutineDef, used_model: string, latency_ms: int }`.
 *
 * Reuses the existing AI Copilot's HTTP layer + key/provider
 * settings — works with whatever model + key the site's already
 * configured for the AI palette.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the REST route on `rest_api_init`.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_ai_rest_route() {
	register_rest_route(
		'wp-desktop/v1',
		'/routines/from-prompt',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'wpdm_routine_ai_rest_permission',
			'callback'            => 'wpdm_routine_rest_from_prompt',
			'args'                => array(
				'prompt' => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_textarea_field',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'wpdm_routine_register_ai_rest_route' );

/**
 * Permission gate. Requires manage_options + AI enabled for the
 * caller. Generation can hit a paid API and write a routine def
 * — both restricted to admins.
 *
 * @since 0.22.0
 *
 * @return bool|WP_Error
 */
function wpdm_routine_ai_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Sorry, you must be logged in.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	if ( ! wpdm_routine_user_can_manage() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage routines.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! function_exists( 'desktop_mode_ai_is_enabled' )
		|| ! desktop_mode_ai_is_enabled( get_current_user_id() ) ) {
		return new WP_Error(
			'desktop_mode_ai_disabled',
			__( 'AI features are not enabled. Enable them in OS Settings → AI.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * REST handler.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_from_prompt( $request ) {
	$prompt = (string) $request->get_param( 'prompt' );
	if ( '' === trim( $prompt ) ) {
		return new WP_Error(
			'wpdm_routine_ai_empty_prompt',
			__( 'Please describe the routine you want to build.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$user_id = get_current_user_id();
	$api_key = function_exists( 'desktop_mode_ai_get_api_key' )
		? (string) desktop_mode_ai_get_api_key( $user_id )
		: '';
	if ( '' === $api_key ) {
		return new WP_Error(
			'desktop_mode_ai_no_key',
			__( 'No OpenAI API key configured. Add one in OS Settings → AI.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$started = microtime( true );
	$result  = wpdm_routine_ai_generate( $api_key, $prompt, $user_id );
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response(
		array(
			'def'        => $result['def'],
			'used_model' => $result['model'],
			'latency_ms' => (int) round( ( microtime( true ) - $started ) * 1000 ),
		)
	);
}

/**
 * Build the request, call OpenAI Responses with strict JSON
 * schema, validate the response.
 *
 * @since 0.22.0
 *
 * @param string $api_key OpenAI key.
 * @param string $prompt  User prompt.
 * @param int    $user_id Acting user.
 * @return array|WP_Error `{ def, model }` on success.
 */
function wpdm_routine_ai_generate( $api_key, $prompt, $user_id ) {
	$catalog = wpdm_routine_ai_build_catalog( $user_id );
	$schema  = wpdm_routine_ai_def_schema();
	// Generation is harder than classification — the model has to
	// pick the right trigger out of dozens, structure nested
	// if/then/else branches, and emit JSON-encoded args strings
	// without dropping placeholders. Bump the default to `mini`
	// for this path; the classify step stays on `nano` (cheap,
	// fast, single-enum output). Filterable as always:
	// `add_filter( 'desktop_mode_ai_model', fn( $m, $ctx ) =>
	// $ctx === 'routines' ? 'gpt-5.4' : $m, 10, 2 );`
	$model = (string) apply_filters(
		'desktop_mode_ai_model',
		'gpt-5.4-mini',
		'routines'
	);

	$instructions = wpdm_routine_ai_build_instructions( $catalog );

	/**
	 * Filter the system prompt sent to the model. Plugins can
	 * tighten / extend the instructions (e.g. site-specific tone,
	 * disallowed actions). The catalogue text is appended after
	 * the filter — keep your additions BEFORE the catalog block
	 * by treating the input as the lead-in, not the whole prompt.
	 *
	 * @since 0.22.0
	 *
	 * @param string $instructions Default instructions (catalog included).
	 * @param array  $catalog      Resolved catalogue array.
	 * @param string $prompt       User's natural-language prompt.
	 */
	$instructions = (string) apply_filters(
		'wp_desktop_routine_ai_prompt',
		$instructions,
		$catalog,
		$prompt
	);

	$body = array(
		'model'        => $model,
		'instructions' => $instructions,
		'input'        => array(
			array(
				'role'    => 'user',
				'content' => $prompt,
			),
		),
		// Structured output: the model is constrained to emit
		// JSON conforming to the schema. We still revalidate
		// server-side via `wpdm_routine_validate_def` after — the
		// strict flag is reliable but not infallible across model
		// versions, and the client never sees raw model output.
		'text'         => array(
			'format' => array(
				'type'   => 'json_schema',
				'name'   => 'routine_def',
				'strict' => true,
				'schema' => $schema,
			),
		),
	);

	$response = desktop_mode_ai_do_request( $api_key, $body );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$json = wpdm_routine_ai_extract_json( $response );
	if ( is_wp_error( $json ) ) {
		return $json;
	}

	// Decode the AI-emitted shape into the validator's native
	// shape: `step.args` arrives as a JSON string (strict-mode
	// constraint — see schema doc), turn it back into an array.
	$json = wpdm_routine_ai_postprocess_def( $json );

	$validated = wpdm_routine_validate_def( $json );
	if ( is_wp_error( $validated ) ) {
		// Surface the validation error with the raw def so
		// callers can debug — the AI got close but missed.
		$validated->add_data(
			array( 'raw_def' => $json ),
			$validated->get_error_code()
		);
		return $validated;
	}

	/**
	 * Fires after a routine def is successfully generated by AI.
	 *
	 * @since 0.22.0
	 *
	 * @param array  $validated Validated routine def.
	 * @param string $prompt    Original user prompt.
	 * @param int    $user_id   Acting user.
	 */
	do_action( 'wp_desktop_routine_ai_generated', $validated, $prompt, $user_id );

	return array(
		'def'   => $validated,
		'model' => $model,
	);
}

/**
 * Build the catalog block fed to the model — every trigger /
 * action / AI tool the current user is allowed to use.
 *
 * @since 0.22.0
 *
 * @param int $user_id User whose visibility filters the catalog.
 * @return array { triggers, actions, ai_tools }
 */
function wpdm_routine_ai_build_catalog( $user_id ) {
	$triggers = array();
	foreach ( (array) wpdm_routine_trigger_registry() as $entry ) {
		$triggers[] = array(
			'id'             => $entry['id'],
			'label'          => $entry['label'],
			'group'          => $entry['group'],
			'kind'           => $entry['kind'],
			'payload_schema' => $entry['payload_schema'],
			'sample_payload' => $entry['sample_payload'],
		);
	}

	$actions = array();
	foreach ( (array) wpdm_routine_action_registry() as $entry ) {
		$actions[] = array(
			'id'          => $entry['id'],
			'label'       => $entry['label'],
			'description' => $entry['description'],
			'group'       => $entry['group'],
			'capability'  => $entry['capability'],
			'args_schema' => $entry['args_schema'],
		);
	}

	$ai_tools = array();
	if ( function_exists( 'desktop_mode_get_registered_ai_tools_for_user' ) ) {
		foreach (
			(array) desktop_mode_get_registered_ai_tools_for_user( $user_id )
			as $entry
		) {
			$ai_tools[] = array(
				'name'        => (string) $entry['name'],
				'description' => (string) $entry['description'],
				'parameters'  => $entry['parameters'],
			);
		}
	}

	return array(
		'triggers' => $triggers,
		'actions'  => $actions,
		'ai_tools' => $ai_tools,
	);
}

/**
 * Build the system instructions: behavioural rules + catalog
 * dump. The catalog ids are the only valid identifiers; the
 * model picks from this set.
 *
 * @since 0.22.0
 *
 * @param array $catalog Resolved catalog.
 * @return string
 */
function wpdm_routine_ai_build_instructions( array $catalog ) {
	$lines = array();
	$lines[] = "You are a routine builder for the WordPress Desktop Mode plugin. The user describes an automation in plain language; you emit a single JSON object conforming to the supplied schema.";
	$lines[] = '';
	$lines[] = 'Hard rules:';
	$lines[] = '  - Pick `trigger.id` from the AVAILABLE TRIGGERS list below. Never invent hooks.';
	$lines[] = '  - For `step.kind = "action"`, pick `step.id` from AVAILABLE ACTIONS. For `ai_tool`, pick from AVAILABLE AI TOOLS. For `command`, only emit if the user explicitly references a slash-command.';
	$lines[] = '  - Use `payload.<path>` placeholders inside step args / conditions, drawn from the trigger\'s payload_schema.';
	$lines[] = '  - For comparisons in `condition` blocks, prefer `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `matches` (regex), `in`. Use `matches` for word-list filters (e.g. spam keywords).';
	$lines[] = '  - When the routine should mutate other users\' data (e.g. trash a comment posted by anyone), set `run_as: "system"`.';
	$lines[] = '  - Default `settings.timeout_ms` to 5000, `settings.stop_on_error` to true. `rate_limit.max` to 0 (no limit) unless the user asks.';
	$lines[] = '  - Steps that produce values useful downstream should set a short `id` (snake_case). Reference them via `vars.<id>`.';
	$lines[] = '  - Built-in step kinds: log, email, http, wait, set_var, stop, if, action, ai_tool, command. The `if` kind requires `condition`, `then`, `else`. `then` and `else` are step arrays; both must be present (use `[]` for empty).';
	$lines[] = '  - `step.args` is a JSON-ENCODED STRING (the schema requires it). Example: `"args": "{\\"message\\": \\"hi {{payload.name}}\\"}"`. Use `"{}"` for steps that take no args. The server will JSON-parse it.';
	$lines[] = '  - The `classify` step kind sorts a piece of text into one of N user-defined buckets. Args shape: `{"input":"{{payload.comment.content}}","buckets":[{"id":"spam","description":"Spammy / promotional"},{"id":"ham","description":"Legitimate"}],"instructions":""}`. Use it whenever the user asks to "decide / route / categorise" text and then act differently per category. The result is `vars.<step.id>.bucket_id` — branch on it with an `if` step downstream.';
	$lines[] = '  - For non-`if` steps, still emit `condition`, `then`, `else` placeholders (the schema requires them). Use `{"left": "", "op": "eq", "right": ""}` and empty arrays.';
	$lines[] = '  - The `http` step\'s host MUST be in the site\'s allowlist; if the user asks for an outbound webhook, include the step but warn them in `log` that the site admin must allow the host.';
	$lines[] = '';
	$lines[] = 'AVAILABLE TRIGGERS (id — label — group — kind):';
	if ( empty( $catalog['triggers'] ) ) {
		$lines[] = '  (none registered — fall back to a `hook`-kind trigger only if the user explicitly names a WP hook)';
	} else {
		foreach ( $catalog['triggers'] as $t ) {
			$payload = isset( $t['sample_payload'] )
				? wp_json_encode( $t['sample_payload'] )
				: '{}';
			$lines[] = sprintf(
				'  - %s — %s — %s — %s — sample_payload: %s',
				$t['id'],
				$t['label'],
				$t['group'] ?: '—',
				$t['kind'],
				$payload
			);
		}
	}
	$lines[] = '';
	$lines[] = 'AVAILABLE ACTIONS (id — label — args_schema):';
	if ( empty( $catalog['actions'] ) ) {
		$lines[] = '  (none registered)';
	} else {
		foreach ( $catalog['actions'] as $a ) {
			$lines[] = sprintf(
				'  - %s — %s — args: %s',
				$a['id'],
				$a['label'],
				wp_json_encode( $a['args_schema'] )
			);
		}
	}
	$lines[] = '';
	$lines[] = 'AVAILABLE AI TOOLS (name — description):';
	if ( empty( $catalog['ai_tools'] ) ) {
		$lines[] = '  (none registered)';
	} else {
		foreach ( $catalog['ai_tools'] as $tool ) {
			$lines[] = sprintf( '  - %s — %s', $tool['name'], $tool['description'] );
		}
	}
	$lines[] = '';
	$lines[] = 'Emit ONLY the routine def JSON — no commentary, no markdown fence.';
	return implode( "\n", $lines );
}

/**
 * Pull the JSON object out of an OpenAI Responses API result.
 * The Responses API returns the structured output as the first
 * `output_text` block when `text.format = json_schema`.
 *
 * @since 0.22.0
 *
 * @param array $response Decoded response array.
 * @return array|WP_Error
 */
function wpdm_routine_ai_extract_json( array $response ) {
	$text = '';

	// Preferred: `output_text` direct accessor (newer SDK shape).
	if ( isset( $response['output_text'] ) && is_string( $response['output_text'] ) ) {
		$text = $response['output_text'];
	}

	// Fallback: walk `output[].content[]` for `output_text` parts.
	if ( '' === $text && isset( $response['output'] ) && is_array( $response['output'] ) ) {
		foreach ( $response['output'] as $part ) {
			if ( ! is_array( $part ) || ! isset( $part['content'] ) ) {
				continue;
			}
			foreach ( (array) $part['content'] as $c ) {
				if (
					is_array( $c )
					&& isset( $c['type'] )
					&& 'output_text' === $c['type']
					&& isset( $c['text'] )
				) {
					$text = (string) $c['text'];
					break 2;
				}
			}
		}
	}

	if ( '' === $text ) {
		return new WP_Error(
			'wpdm_routine_ai_no_output',
			__( 'AI response did not contain any text output.', 'desktop-mode' ),
			array( 'response' => $response )
		);
	}

	$json = json_decode( $text, true );
	if ( ! is_array( $json ) ) {
		return new WP_Error(
			'wpdm_routine_ai_bad_json',
			__( 'AI response was not valid JSON.', 'desktop-mode' ),
			array( 'raw' => $text )
		);
	}

	return $json;
}

/**
 * JSON schema fed to OpenAI's `text.format.json_schema` (strict).
 *
 * **Strict-mode constraints we have to honour:**
 *
 *   - Every property listed in `properties` MUST also appear in
 *     `required`. (No optional fields.)
 *   - Every object MUST have `additionalProperties: false`. No
 *     free-form maps with arbitrary keys.
 *   - `type` cannot be a union of disparate types like
 *     `["string", "number", "boolean"]`. The only union strict
 *     accepts is `["X", "null"]` for nullability.
 *   - No `format`, `if/then/else`, `not`. (Schema-level if/else,
 *     not the routine's. Our `if` step kind is fine — it's
 *     application-level, not schema-level.)
 *
 * **Two design adaptations** dictated by those rules:
 *
 *   - `step.args` is a JSON-encoded STRING the model emits, then
 *     `wpdm_routine_ai_postprocess_def()` json_decodes it before
 *     the validator runs. This keeps args' real structure (an
 *     object whose shape varies per step kind) reachable without
 *     listing every possible arg key in the schema.
 *   - `condition.left` / `condition.right` are strings only —
 *     we'd love `string|number|boolean` but strict refuses. The
 *     PHP comparator already coerces numeric strings, so this
 *     loses nothing.
 *
 * @since 0.22.0
 *
 * @return array
 */
function wpdm_routine_ai_def_schema() {
	$operators = wpdm_routine_known_operators();
	$kinds     = wpdm_routine_known_step_kinds();

	$condition = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'left', 'op', 'right' ),
		'properties'           => array(
			'left'  => array(
				'type'        => 'string',
				'description' => 'Left operand. Use `{{payload.…}}` / `{{vars.…}}` placeholders or a literal value as a string.',
			),
			'op'    => array( 'type' => 'string', 'enum' => $operators ),
			'right' => array(
				'type'        => 'string',
				'description' => 'Right operand. Use a literal as a string; numbers and booleans are coerced server-side.',
			),
		),
	);

	$step_ref = array( '$ref' => '#/$defs/Step' );

	return array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array(
			'version',
			'trigger',
			'conditions',
			'steps',
			'run_as',
			'settings',
		),
		'properties'           => array(
			'version'    => array( 'type' => 'integer' ),
			'trigger'    => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'kind', 'id', 'priority' ),
				'properties'           => array(
					'kind'     => array( 'type' => 'string', 'enum' => array( 'hook', 'broadcast' ) ),
					'id'       => array( 'type' => 'string' ),
					'priority' => array( 'type' => 'integer' ),
				),
			),
			'conditions' => array(
				'type'  => 'array',
				'items' => $condition,
			),
			'steps'      => array(
				'type'  => 'array',
				'items' => $step_ref,
			),
			'run_as'     => array( 'type' => 'string', 'enum' => array( 'author', 'system' ) ),
			'settings'   => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'rate_limit', 'timeout_ms', 'stop_on_error' ),
				'properties'           => array(
					'rate_limit'    => array(
						'type'                 => 'object',
						'additionalProperties' => false,
						'required'             => array( 'max', 'per_seconds' ),
						'properties'           => array(
							'max'         => array( 'type' => 'integer' ),
							'per_seconds' => array( 'type' => 'integer' ),
						),
					),
					'timeout_ms'    => array( 'type' => 'integer' ),
					'stop_on_error' => array( 'type' => 'boolean' ),
				),
			),
		),
		'$defs'                => array(
			'Step' => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'kind', 'id', 'args', 'condition', 'then', 'else' ),
				'properties'           => array(
					'kind'      => array( 'type' => 'string', 'enum' => $kinds ),
					'id'        => array( 'type' => 'string' ),
					// Args as a JSON-encoded string. The server
					// json_decodes it before validation; the model
					// thus has full freedom to express any shape
					// of args without us having to enumerate every
					// arg key in the schema.
					'args'      => array(
						'type'        => 'string',
						'description' => 'A JSON-encoded object of step arguments. Example: `{"to": "{{payload.user.email}}", "subject": "Hi"}`. The empty case is `{}`.',
					),
					// Required by strict mode but only meaningful
					// for `kind: if`. For other kinds the model
					// still emits the placeholder shape.
					'condition' => $condition,
					'then'      => array(
						'type'  => 'array',
						'items' => $step_ref,
					),
					'else'      => array(
						'type'  => 'array',
						'items' => $step_ref,
					),
				),
			),
		),
	);
}

/**
 * Translate the AI-emitted shape into the validator's native
 * shape. Currently a single transform: each `step.args` arrives
 * as a JSON-encoded string (strict-mode constraint — see schema
 * doc) and gets json_decoded back into an associative array.
 *
 * Recursive — applies to `if` step branches too.
 *
 * @since 0.22.0
 *
 * @param mixed $def Raw decoded def from the AI.
 * @return mixed Same def with args fields decoded.
 */
function wpdm_routine_ai_postprocess_def( $def ) {
	if ( ! is_array( $def ) ) {
		return $def;
	}
	if ( isset( $def['steps'] ) && is_array( $def['steps'] ) ) {
		$def['steps'] = wpdm_routine_ai_decode_step_args( $def['steps'] );
	}
	return $def;
}

/**
 * @since 0.22.0
 * @internal
 *
 * @param array $steps Array of step entries to walk.
 * @return array
 */
function wpdm_routine_ai_decode_step_args( array $steps ) {
	$out = array();
	foreach ( $steps as $step ) {
		if ( ! is_array( $step ) ) {
			$out[] = $step;
			continue;
		}
		if ( isset( $step['args'] ) && is_string( $step['args'] ) ) {
			$decoded = json_decode( $step['args'], true );
			$step['args'] = is_array( $decoded ) ? $decoded : array();
		}
		if ( isset( $step['then'] ) && is_array( $step['then'] ) ) {
			$step['then'] = wpdm_routine_ai_decode_step_args( $step['then'] );
		}
		if ( isset( $step['else'] ) && is_array( $step['else'] ) ) {
			$step['else'] = wpdm_routine_ai_decode_step_args( $step['else'] );
		}
		$out[] = $step;
	}
	return $out;
}
