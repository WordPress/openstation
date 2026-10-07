<?php

class Tests_OpenStation_AiModelConfig extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_ai_model_config' );
		parent::tear_down();
	}

	private function builder() {
		return new class() {
			public $model_config = null;
			public $preference   = null;

			public function using_model_config( $config ) {
				$this->model_config = $config;
				return $this;
			}

			public function using_model_preference( ...$models ) {
				$this->preference = $models;
				return $this;
			}
		};
	}

	private function filter_returns( $config ) {
		add_filter(
			'openstation_ai_model_config',
			static function () use ( $config ) {
				return $config;
			}
		);
	}

	public function set_up() {
		parent::set_up();
		if ( ! class_exists( 'WordPress\AiClient\Providers\Models\DTO\ModelConfig' ) ) {
			$this->markTestSkipped( 'AI Client SDK not available (requires WordPress 7.0+).' );
		}
	}

	public function test_default_config_is_only_the_output_ceiling() {
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( OPENSTATION_AI_DEFAULT_MAX_TOKENS, $builder->model_config->getMaxTokens() );
		$this->assertNull( $builder->model_config->getTemperature() );
		$this->assertNull( $builder->preference );
		$this->assertSame(
			array( 'maxTokens' => OPENSTATION_AI_DEFAULT_MAX_TOKENS ),
			$builder->model_config->toArray()
		);
	}

	public function test_non_array_filter_result_still_gets_the_ceiling() {
		$this->filter_returns( false );
		$builder = $this->builder();

		$this->assertSame( $builder, openstation_ai_apply_model_config( $builder, array() ) );
		$this->assertSame( OPENSTATION_AI_DEFAULT_MAX_TOKENS, $builder->model_config->getMaxTokens() );
		$this->assertNull( $builder->preference );
	}

	public function test_max_tokens_and_temperature_are_coerced() {
		$this->filter_returns(
			array(
				'max_tokens'  => '6144',
				'temperature' => '0.2',
			)
		);
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( 6144, $builder->model_config->getMaxTokens() );
		$this->assertSame( 0.2, $builder->model_config->getTemperature() );
	}

	public function test_zero_temperature_is_kept() {
		$this->filter_returns( array( 'temperature' => 0.0 ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( 0.0, $builder->model_config->getTemperature() );
	}

	public function test_unusable_config_is_ignored( $config ) {
		$this->filter_returns( $config );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame(
			array( 'maxTokens' => OPENSTATION_AI_DEFAULT_MAX_TOKENS ),
			$builder->model_config->toArray(),
			'An unusable value falls back to the default, never to the provider\'s own.'
		);
	}

	public function data_unusable_config() {
		return array(
			'zero ceiling'            => array( array( 'max_tokens' => 0 ) ),
			'negative ceiling'        => array( array( 'max_tokens' => -1 ) ),
			'non-numeric ceiling'     => array( array( 'max_tokens' => 'lots' ) ),
			'negative temperature'    => array( array( 'temperature' => -1 ) ),
			'over-max temperature'    => array( array( 'temperature' => 47 ) ),
			'non-numeric temperature' => array( array( 'temperature' => 'hot' ) ),
			'empty options'           => array( array( 'custom_options' => array() ) ),
			'non-array options'       => array( array( 'custom_options' => 'thinking' ) ),

			'top-level provider key'  => array( array( 'thinking' => array( 'type' => 'adaptive' ) ) ),
		);
	}

	public function test_custom_options_reach_the_model_config() {
		$options = array(
			'thinking'      => array( 'type' => 'adaptive' ),
			'output_config' => array( 'effort' => 'low' ),
		);
		$this->filter_returns( array( 'custom_options' => $options ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( $options, $builder->model_config->getCustomOptions() );
	}

	public function test_model_id_routes_through_model_preference() {
		$this->filter_returns( array( 'model' => 'claude-sonnet-5' ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( array( 'claude-sonnet-5' ), $builder->preference );
	}

	public function test_unusable_model_is_ignored( $model ) {
		$this->filter_returns( array( 'model' => $model ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertNull( $builder->preference );
	}

	public function data_unusable_model() {
		return array(
			'empty string'    => array( '' ),
			'whitespace only' => array( "  \t " ),
			'integer'         => array( 0 ),
			'null'            => array( null ),

			'tuple'           => array( array( 'anthropic', 'claude-sonnet-5' ) ),
		);
	}

	public function test_config_is_applied_before_the_model() {
		$this->filter_returns(
			array(
				'model'      => 'claude-sonnet-5',
				'max_tokens' => 6144,
			)
		);
		$builder = new class() {
			public $order = array();

			public function using_model_config( $config ) {
				$this->order[] = 'config';
				return $this;
			}

			public function using_model_preference( ...$models ) {
				$this->order[] = 'model';
				return $this;
			}
		};

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( array( 'config', 'model' ), $builder->order );
	}

	public function test_non_string_option_keys_are_dropped() {
		$this->filter_returns(
			array(
				'custom_options' => array(
					'thinking' => array( 'type' => 'adaptive' ),
					'stray',
				),
			)
		);
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame(
			array( 'thinking' => array( 'type' => 'adaptive' ) ),
			$builder->model_config->getCustomOptions()
		);
	}

	public function test_context_is_filled_with_defaults() {
		$seen = null;
		add_filter(
			'openstation_ai_model_config',
			static function ( $config, $context ) use ( &$seen ) {
				$seen = $context;
				return $config;
			},
			10,
			2
		);

		openstation_ai_apply_model_config( $this->builder(), array( 'source' => 'agents/runner' ) );

		$this->assertSame(
			array(
				'user_id'    => 0,
				'request_id' => '',
				'source'     => 'agents/runner',
				'has_tools'  => false,
				'has_schema' => false,
			),
			$seen
		);
	}

	private function capture_source() {
		$capture = new stdClass();
		$capture->source = null;

		add_filter(
			'openstation_ai_model_config',
			static function ( $config, $context ) use ( $capture ) {
				$capture->source = $context['source'];
				return $config;
			},
			10,
			2
		);

		return $capture;
	}

	public function test_client_generate_forwards_the_callers_source() {
		$capture = $this->capture_source();

		openstation_ai_client_generate(
			1,
			array( openstation_ai_user_text_message( 'hello' ) ),
			array(),
			null,
			'',
			array( 'source' => 'agents/runner' )
		);

		$this->assertSame( 'agents/runner', $capture->source );
	}

	public function test_followup_reports_its_source() {
		$capture = $this->capture_source();

		openstation_ai_run_followup( 'turn on the light', array( 'slug' => 'noop' ), array( 'ok' => true ) );

		$this->assertSame( 'ai-copilot/followup', $capture->source );
	}

	public function test_comment_analysis_reports_its_source() {
		$capture    = $this->capture_source();
		$comment_id = self::factory()->comment->create( array( 'comment_content' => 'Nice post!' ) );

		openstation_ai_analyze_comment_now( get_comment( $comment_id ), 1 );

		$this->assertSame( 'ai-copilot/comment-analysis', $capture->source );
	}

	public function test_draft_suggestions_report_their_source() {
		$capture = $this->capture_source();
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/draft-suggestions' );
		$request->set_param( 'post_id', $post_id );
		openstation_rest_draft_suggestions( $request );

		$this->assertSame( 'widgets/drafts-suggestions', $capture->source );
	}

	private function result_with_finish_reason( $reason ) {
		$message = new \WordPress\AiClient\Messages\DTO\Message(
			\WordPress\AiClient\Messages\Enums\MessageRoleEnum::model(),
			array( new \WordPress\AiClient\Messages\DTO\MessagePart( '{"title":"[ES]' ) )
		);
		return new \WordPress\AiClient\Results\DTO\GenerativeAiResult(
			'result-1',
			array( new \WordPress\AiClient\Results\DTO\Candidate( $message, $reason ) ),
			new \WordPress\AiClient\Results\DTO\TokenUsage( 10, 4096, 4106 ),
			new \WordPress\AiClient\Providers\DTO\ProviderMetadata(
				'test',
				'Test',
				\WordPress\AiClient\Providers\Enums\ProviderTypeEnum::cloud()
			),
			new \WordPress\AiClient\Providers\Models\DTO\ModelMetadata( 'model-1', 'Model', array(), array() )
		);
	}

	public function test_length_finish_reason_is_truncation() {
		$this->assertTrue(
			openstation_ai_result_is_truncated(
				$this->result_with_finish_reason( \WordPress\AiClient\Results\Enums\FinishReasonEnum::length() )
			)
		);
		$this->assertFalse(
			openstation_ai_result_is_truncated(
				$this->result_with_finish_reason( \WordPress\AiClient\Results\Enums\FinishReasonEnum::toolCalls() )
			)
		);
		$this->assertFalse( openstation_ai_result_is_truncated( new stdClass() ), 'No candidates is not truncation.' );
	}

	public function test_truncated_error_carries_the_usage() {
		$error = openstation_ai_output_truncated_error( 'finish reason: length', array( 'completion' => 4096 ) );

		$this->assertSame( 'openstation_ai_output_truncated', $error->get_error_code() );
		$this->assertSame( 502, $error->get_error_data()['status'] );
		$this->assertSame( 4096, $error->get_error_data()['completion_tokens'] );
		$this->assertNull( openstation_ai_output_truncated_error( 'x' )->get_error_data()['completion_tokens'] );
	}
}
