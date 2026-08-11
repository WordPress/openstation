<?php
/**
 * OpenStation — AI Copilot: WordPress AI Client adapter.
 *
 * Thin wrappers around `wp_ai_client_prompt()` that the agentic search loop
 * and the comment-scoring job use to generate. Credentials are injected by
 * Core from the configured Connector — nothing here ever handles an API key.
 *
 * The search loop advertises its tools — built-in WordPress Abilities (see
 * abilities.php) plus client command tools — as function declarations, and
 * dispatches ability calls through `wp_get_ability()->execute()`.
 *
 * All SDK classes referenced here ship with WordPress 7.0+. The `use`
 * statements are compile-time aliases only; every call site is reached solely
 * through {@see openstation_ai_is_available()}, so this file is inert (and
 * never resolves the classes) on older WordPress.
 *
 * @package OpenStation
 */

use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelConfig;
use WordPress\AiClient\Tools\DTO\FunctionCall;
use WordPress\AiClient\Tools\DTO\FunctionDeclaration;
use WordPress\AiClient\Tools\DTO\FunctionResponse;

defined( 'ABSPATH' ) || exit;

/**
 * Builds SDK function declarations from the loop's tool definitions.
 *
 * Each definition is the neutral tool shape the registry already produces:
 * `{ type: 'function', name, description, parameters (JSON Schema) }`.
 *
 * @param array $tool_defs List of tool definitions.
 * @return FunctionDeclaration[]
 */
function openstation_ai_build_function_declarations( array $tool_defs ) {
	$declarations = array();
	foreach ( $tool_defs as $def ) {
		if ( ! is_array( $def ) ) {
			continue;
		}
		$name = isset( $def['name'] ) ? (string) $def['name'] : '';
		if ( '' === $name ) {
			continue;
		}
		$description = isset( $def['description'] ) ? (string) $def['description'] : '';
		$parameters  = isset( $def['parameters'] ) && is_array( $def['parameters'] ) ? $def['parameters'] : null;

		$declarations[] = new FunctionDeclaration( $name, $description, $parameters );
	}
	return $declarations;
}

/**
 * Wraps a user query as a text message for the conversation history.
 *
 * @param string $text
 * @return UserMessage
 */
function openstation_ai_user_text_message( $text ) {
	return new UserMessage( array( new MessagePart( (string) $text ) ) );
}

/**
 * Wraps tool results as a user message of function-response parts.
 *
 * @param array $tool_outputs List of `{ call_id, name, response }` entries.
 * @return UserMessage
 */
function openstation_ai_tool_result_message( array $tool_outputs ) {
	$parts = array();
	foreach ( $tool_outputs as $output ) {
		$parts[] = new MessagePart(
			new FunctionResponse(
				isset( $output['call_id'] ) && '' !== $output['call_id'] ? (string) $output['call_id'] : null,
				isset( $output['name'] ) && '' !== $output['name'] ? (string) $output['name'] : null,
				isset( $output['response'] ) ? $output['response'] : null
			)
		);
	}
	return new UserMessage( $parts );
}

/**
 * Strips thought-channel parts from a message before it re-enters history.
 *
 * Providers cannot reliably round-trip reasoning blocks: the Anthropic
 * provider drops the cryptographic `signature` when parsing a `thinking`
 * block, and the API rejects any replayed thinking block without one
 * (`thinking.signature: Field required`). Thought parts carry no information
 * the next turn needs — the model re-reasons from the visible conversation —
 * so the agentic loop replays assistant turns without them.
 *
 * If every part is a thought (no text, no function call), the message is
 * returned unchanged rather than emptied; the loop never replays such a
 * turn anyway.
 *
 * @param Message $message Assistant message as returned by the AI Client.
 * @return Message Message safe to append to the conversation history.
 */
function openstation_ai_strip_thought_parts( Message $message ) {
	$kept     = array();
	$stripped = false;
	foreach ( $message->getParts() as $part ) {
		if ( $part->getChannel()->isThought() ) {
			$stripped = true;
			continue;
		}
		$kept[] = $part;
	}

	if ( ! $stripped || empty( $kept ) ) {
		return $message;
	}

	return new Message( $message->getRole(), $kept );
}

/**
 * Builds the error for a final turn that produced no answer text.
 *
 * Observed live with the Anthropic provider under agent runs: a hard task
 * spends the entire `max_tokens` budget inside a thinking block
 * (`stop_reason: "max_tokens"`, a single text-less thought part), so the
 * turn carries neither function calls nor extractable text. Callers that
 * can meaningfully degrade instead (the command follow-up turn) match on
 * this code and keep their own fallback.
 *
 * @param string $detail Underlying extraction failure, preserved for logs.
 * @return WP_Error
 */
function openstation_ai_empty_answer_error( $detail ) {
	return new WP_Error(
		'openstation_ai_empty_answer',
		__( 'The AI provider returned no answer text.', 'desktop-mode' ),
		array(
			'status' => 502,
			'detail' => (string) $detail,
		)
	);
}

/**
 * Applies the site's model config to a prompt builder.
 *
 * @param mixed $builder WP_AI_Client_Prompt_Builder.
 * @param array $context Partial filter context; missing keys are defaulted.
 * @return mixed
 */
function openstation_ai_apply_model_config( $builder, array $context ) {
	$context = array_merge(
		array(
			'user_id'    => 0,
			'request_id' => '',
			'source'     => '',
			'has_tools'  => false,
			'has_schema' => false,
		),
		$context
	);

	/**
	 * Filters the model config for one AI turn.
	 *
	 * Defaults to empty. Recipe: `docs/examples/ai-model-config.md`.
	 *
	 * @param array $config  { model?: string|ModelInterface, max_tokens?: int, temperature?: float, custom_options?: array<string, mixed> }.
	 * @param array $context { user_id, request_id, source, has_tools, has_schema }.
	 */
	$config = apply_filters( 'openstation_ai_model_config', array(), $context );
	if ( ! is_array( $config ) ) {
		return $builder;
	}

	$model_config = new ModelConfig();

	if ( isset( $config['max_tokens'] ) && is_numeric( $config['max_tokens'] ) && (int) $config['max_tokens'] > 0 ) {
		$model_config->setMaxTokens( (int) $config['max_tokens'] );
	}

	// Unlike max_tokens, 0.0 is a legitimate temperature (deterministic).
	if ( isset( $config['temperature'] ) && is_numeric( $config['temperature'] ) && (float) $config['temperature'] >= 0.0 ) {
		$model_config->setTemperature( (float) $config['temperature'] );
	}

	$custom_options = array();
	if ( isset( $config['custom_options'] ) && is_array( $config['custom_options'] ) ) {
		foreach ( $config['custom_options'] as $key => $value ) {
			// A list would reach the provider as parameters named `0`, `1`, ….
			if ( is_string( $key ) && '' !== $key ) {
				$custom_options[ $key ] = $value;
			}
		}
	}

	if ( ! empty( $custom_options ) ) {
		$model_config->setCustomOptions( $custom_options );
	}

	$builder = $builder->using_model_config( $model_config );

	// After the config: `using_model()` merges the model's own defaults under
	// whatever the builder already carries, so ours has to land first.
	if ( isset( $config['model'] ) ) {
		// `using_model()` needs a ModelInterface; a bare model id has to go
		// through `using_model_preference()`.
		$builder = $config['model'] instanceof ModelInterface
			? $builder->using_model( $config['model'] )
			: $builder->using_model_preference( $config['model'] );
	}

	return $builder;
}

/**
 * Runs one generation turn through the AI Client.
 *
 * Rebuilds the prompt from the full ordered message list each turn (the
 * builder's `with_history()` prepends, so it can't append turns in a loop),
 * advertises the tools as function declarations, and constrains the final
 * answer to `$answer_schema` when given. Returns the assistant turn normalized
 * to the shape the loop consumes; `message` has thought-channel parts stripped
 * ({@see openstation_ai_strip_thought_parts()}) so it is safe to replay.
 *
 * @param int        $user_id       Requesting user id.
 * @param array      $messages      Ordered conversation as SDK Message objects.
 * @param array      $tool_defs     Tool definitions to advertise.
 * @param array|null $answer_schema JSON Schema for the final answer, or null.
 * @param string     $instructions  System instruction.
 * @param array      $context       Optional. `{ source?: string, request_id?: string }`
 *                                  for the model-config filter.
 * @return array{ text: ?string, function_calls: array, message: mixed, usage: ?array, model: ?array }|WP_Error
 */
function openstation_ai_client_generate( $user_id, array $messages, array $tool_defs, $answer_schema, $instructions, array $context = array() ) {
	$builder = wp_ai_client_prompt( $messages );

	if ( is_string( $instructions ) && '' !== $instructions ) {
		$builder = $builder->using_system_instruction( $instructions );
	}

	// Provider + model selection is delegated entirely to the Core AI Client
	// (Connector-backed); OpenStation pins neither.

	$declarations = openstation_ai_build_function_declarations( $tool_defs );
	if ( ! empty( $declarations ) ) {
		$builder = $builder->using_function_declarations( ...$declarations );
	}

	if ( is_array( $answer_schema ) ) {
		// Strict structured output: providers reject an object subschema that
		// doesn't set `additionalProperties: false`, and one such node 400s the
		// whole turn. Normalize here so no schema author has to know that.
		$builder = $builder->as_json_response( openstation_ai_normalize_response_schema( $answer_schema ) );
	}

	$builder = openstation_ai_apply_model_config(
		$builder,
		array_merge(
			$context,
			array(
				'user_id'    => (int) $user_id,
				'has_tools'  => ! empty( $declarations ),
				'has_schema' => is_array( $answer_schema ),
			)
		)
	);

	$result = $builder->generate_result();
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	$message        = $result->toMessage();
	$function_calls = array();
	foreach ( $message->getParts() as $part ) {
		if ( ! $part->getType()->isFunctionCall() ) {
			continue;
		}
		$call = $part->getFunctionCall();
		if ( ! $call instanceof FunctionCall ) {
			continue;
		}
		$args             = $call->getArgs();
		$function_calls[] = array(
			'name'      => (string) $call->getName(),
			'call_id'   => (string) $call->getId(),
			'arguments' => wp_json_encode( is_array( $args ) ? $args : array() ),
		);
	}

	$text = null;
	if ( empty( $function_calls ) ) {
		// A turn with no function calls IS the final answer, so failing to
		// extract its text is a failed generation, not a valid empty one.
		// Swallowing it here used to surface as a "successful" run with an
		// empty answer, invisible to the retry and error paths alike.
		try {
			$text = $result->toText();
		} catch ( \Throwable $e ) {
			return openstation_ai_empty_answer_error( $e->getMessage() );
		}
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return openstation_ai_empty_answer_error( 'The provider response contains no text part.' );
		}
	}

	return array(
		'text'           => $text,
		'function_calls' => $function_calls,
		'message'        => openstation_ai_strip_thought_parts( $message ),
		'usage'          => openstation_ai_result_token_usage( $result ),
		'model'          => openstation_ai_result_model_metadata( $result ),
	);
}

/**
 * Extracts normalized token usage from a generation result.
 *
 * @param mixed $result GenerativeAiResult.
 * @return array{ prompt: int, completion: int, total: int }|null
 */
function openstation_ai_result_token_usage( $result ) {
	try {
		$usage = $result->getTokenUsage();
		return array(
			'prompt'     => (int) $usage->getPromptTokens(),
			'completion' => (int) $usage->getCompletionTokens(),
			'total'      => (int) $usage->getTotalTokens(),
		);
	} catch ( \Throwable $e ) {
		return null;
	}
}

/**
 * Extracts the resolved model's id + name from a generation result.
 *
 * @param mixed $result GenerativeAiResult.
 * @return array{ id: string, name: string }|null
 */
function openstation_ai_result_model_metadata( $result ) {
	try {
		$model = $result->getModelMetadata();
		return array(
			'id'   => (string) $model->getId(),
			'name' => (string) $model->getName(),
		);
	} catch ( \Throwable $e ) {
		return null;
	}
}
