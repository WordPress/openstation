<?php

use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelConfig;
use WordPress\AiClient\Tools\DTO\FunctionCall;
use WordPress\AiClient\Tools\DTO\FunctionDeclaration;
use WordPress\AiClient\Tools\DTO\FunctionResponse;

defined( 'ABSPATH' ) || exit;

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

function openstation_ai_user_text_message( $text ) {
	return new UserMessage( array( new MessagePart( (string) $text ) ) );
}

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

const OPENSTATION_AI_DEFAULT_MAX_TOKENS = 16384;

function openstation_ai_result_is_truncated( $result ) {
	try {
		foreach ( $result->getCandidates() as $candidate ) {
			if ( $candidate->getFinishReason()->isLength() ) {
				return true;
			}
		}
	} catch ( \Throwable $e ) {
		return false;
	}
	return false;
}

function openstation_ai_output_truncated_error( $detail, $usage = null ) {
	return new WP_Error(
		'openstation_ai_output_truncated',
		__( 'The AI provider cut the reply short at the output-token limit.', 'desktop-mode' ),
		array(
			'status'            => 502,
			'detail'            => (string) $detail,
			'completion_tokens' => is_array( $usage ) && isset( $usage['completion'] ) ? (int) $usage['completion'] : null,
		)
	);
}

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

	$config = apply_filters( 'openstation_ai_model_config', array(), $context );
	if ( ! is_array( $config ) ) {
		$config = array();
	}

	$model_config = new ModelConfig();

	$max_tokens = OPENSTATION_AI_DEFAULT_MAX_TOKENS;
	if ( isset( $config['max_tokens'] ) && is_numeric( $config['max_tokens'] ) && (int) $config['max_tokens'] > 0 ) {
		$max_tokens = (int) $config['max_tokens'];
	}
	$model_config->setMaxTokens( $max_tokens );

	if ( isset( $config['temperature'] ) && is_numeric( $config['temperature'] )
		&& (float) $config['temperature'] >= 0.0 && (float) $config['temperature'] <= 2.0 ) {
		$model_config->setTemperature( (float) $config['temperature'] );
	}

	$custom_options = array();
	if ( isset( $config['custom_options'] ) && is_array( $config['custom_options'] ) ) {
		foreach ( $config['custom_options'] as $key => $value ) {

			if ( is_string( $key ) && '' !== $key ) {
				$custom_options[ $key ] = $value;
			}
		}
	}

	if ( ! empty( $custom_options ) ) {
		$model_config->setCustomOptions( $custom_options );
	}

	$builder = $builder->using_model_config( $model_config );

	$model = isset( $config['model'] ) ? $config['model'] : null;
	if ( $model instanceof ModelInterface ) {
		$builder = $builder->using_model( $model );
	} elseif ( is_string( $model ) && '' !== trim( $model ) ) {

		$builder = $builder->using_model_preference( trim( $model ) );
	}

	return $builder;
}

function openstation_ai_client_generate( $user_id, array $messages, array $tool_defs, $answer_schema, $instructions, array $context = array() ) {
	$builder = wp_ai_client_prompt( $messages );

	if ( is_string( $instructions ) && '' !== $instructions ) {
		$builder = $builder->using_system_instruction( $instructions );
	}

	$declarations = openstation_ai_build_function_declarations( $tool_defs );
	if ( ! empty( $declarations ) ) {
		$builder = $builder->using_function_declarations( ...$declarations );
	}

	if ( is_array( $answer_schema ) ) {

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

		if ( 'prompt_token_limit_reached' === $result->get_error_code() ) {
			return openstation_ai_output_truncated_error( $result->get_error_message() );
		}
		return $result;
	}

	$message        = $result->toMessage();
	$function_calls = array();
	$has_text       = false;
	foreach ( $message->getParts() as $part ) {
		if ( $part->getType()->isText() && ! $part->getChannel()->isThought() ) {
			$has_text = true;
		}
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

	if ( ( ! empty( $function_calls ) || $has_text ) && openstation_ai_result_is_truncated( $result ) ) {
		return openstation_ai_output_truncated_error(
			'The provider stopped at the output-token ceiling (finish reason: length).',
			openstation_ai_result_token_usage( $result )
		);
	}

	$text = null;
	if ( empty( $function_calls ) ) {

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
