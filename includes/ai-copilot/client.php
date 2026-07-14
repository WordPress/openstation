<?php
/**
 * Desktop Mode — AI Copilot: WordPress AI Client adapter.
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
 * through {@see desktop_mode_ai_is_available()}, so this file is inert (and
 * never resolves the classes) on older WordPress.
 *
 * @package WPDesktopMode
 */

use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;
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
 * @since 0.9.4
 *
 * @param array $tool_defs List of tool definitions.
 * @return FunctionDeclaration[]
 */
function desktop_mode_ai_build_function_declarations( array $tool_defs ) {
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
 * @since 0.9.4
 *
 * @param string $text
 * @return UserMessage
 */
function desktop_mode_ai_user_text_message( $text ) {
	return new UserMessage( array( new MessagePart( (string) $text ) ) );
}

/**
 * Wraps tool results as a user message of function-response parts.
 *
 * @since 0.9.4
 *
 * @param array $tool_outputs List of `{ call_id, name, response }` entries.
 * @return UserMessage
 */
function desktop_mode_ai_tool_result_message( array $tool_outputs ) {
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
 * Runs one generation turn through the AI Client.
 *
 * Rebuilds the prompt from the full ordered message list each turn (the
 * builder's `with_history()` prepends, so it can't append turns in a loop),
 * advertises the tools as function declarations, and constrains the final
 * answer to `$answer_schema` when given. Returns the assistant turn normalized
 * to the shape the loop consumes.
 *
 * @since 0.9.4
 *
 * @param int        $user_id       Requesting user id. Currently unused — the
 *                                  provider comes from Connectors and no
 *                                  per-user preference is applied; retained for
 *                                  signature stability and future attribution.
 * @param array      $messages      Ordered conversation as SDK Message objects.
 * @param array      $tool_defs     Tool definitions to advertise.
 * @param array|null $answer_schema JSON Schema for the final answer, or null.
 * @param string     $instructions  System instruction.
 * @return array{ text: ?string, function_calls: array, message: mixed, usage: ?array, model: ?array }|WP_Error
 */
function desktop_mode_ai_client_generate( $user_id, array $messages, array $tool_defs, $answer_schema, $instructions ) {
	$builder = wp_ai_client_prompt( $messages );

	if ( is_string( $instructions ) && '' !== $instructions ) {
		$builder = $builder->using_system_instruction( $instructions );
	}

	// Provider + model selection is delegated entirely to the Core AI Client
	// (Connector-backed); Desktop Mode pins neither.

	$declarations = desktop_mode_ai_build_function_declarations( $tool_defs );
	if ( ! empty( $declarations ) ) {
		$builder = $builder->using_function_declarations( ...$declarations );
	}

	if ( is_array( $answer_schema ) ) {
		$builder = $builder->as_json_response( $answer_schema );
	}

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
		try {
			$text = $result->toText();
		} catch ( \Throwable $e ) {
			$text = null;
		}
	}

	return array(
		'text'           => $text,
		'function_calls' => $function_calls,
		'message'        => $message,
		'usage'          => desktop_mode_ai_result_token_usage( $result ),
		'model'          => desktop_mode_ai_result_model_metadata( $result ),
	);
}

/**
 * Extracts normalized token usage from a generation result.
 *
 * @since 0.9.4
 *
 * @param mixed $result GenerativeAiResult.
 * @return array{ prompt: int, completion: int, total: int }|null
 */
function desktop_mode_ai_result_token_usage( $result ) {
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
 * @since 0.9.4
 *
 * @param mixed $result GenerativeAiResult.
 * @return array{ id: string, name: string }|null
 */
function desktop_mode_ai_result_model_metadata( $result ) {
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
