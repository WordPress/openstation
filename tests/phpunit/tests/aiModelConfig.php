<?php
/**
 * Tests for the model-config opt-in.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */

class Tests_OpenStation_AiModelConfig extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_ai_model_config' );
		parent::tear_down();
	}

	/**
	 * Records the setter calls the config makes on a prompt builder.
	 */
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

	/**
	 * The default is nothing: a site that adds no filter sends exactly what it
	 * sent before. This is what keeps the plugin provider-agnostic.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
	public function test_default_config_is_empty() {
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( array(), $builder->model_config->toArray() );
	}

	/**
	 * @covers ::openstation_ai_apply_model_config
	 */
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

	/**
	 * Unlike max_tokens, 0.0 is a legitimate temperature.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
	public function test_zero_temperature_is_kept() {
		$this->filter_returns( array( 'temperature' => 0.0 ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( 0.0, $builder->model_config->getTemperature() );
	}

	/**
	 * @dataProvider data_unusable_config
	 * @covers ::openstation_ai_apply_model_config
	 *
	 * @param mixed $config Filter return value.
	 */
	public function test_unusable_config_is_ignored( $config ) {
		$this->filter_returns( $config );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( array(), $builder->model_config->toArray() );
	}

	/**
	 * @return array<string, array{0: mixed}>
	 */
	public function data_unusable_config() {
		return array(
			'zero ceiling'           => array( array( 'max_tokens' => 0 ) ),
			'negative ceiling'       => array( array( 'max_tokens' => -1 ) ),
			'non-numeric ceiling'    => array( array( 'max_tokens' => 'lots' ) ),
			'negative temperature'   => array( array( 'temperature' => -1 ) ),
			'non-numeric temperature' => array( array( 'temperature' => 'hot' ) ),
			'empty options'          => array( array( 'custom_options' => array() ) ),
			'non-array options'      => array( array( 'custom_options' => 'thinking' ) ),
			// Provider parameters belong under `custom_options`; a top-level
			// key is a typo that would otherwise fail silently at the provider.
			'top-level provider key' => array( array( 'thinking' => array( 'type' => 'adaptive' ) ) ),
		);
	}

	/**
	 * A filter returning the wrong type leaves the builder alone entirely.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
	public function test_non_array_filter_return_is_ignored() {
		$this->filter_returns( false );
		$builder = $this->builder();

		$this->assertSame( $builder, openstation_ai_apply_model_config( $builder, array() ) );
		$this->assertNull( $builder->model_config );
	}

	/**
	 * @covers ::openstation_ai_apply_model_config
	 */
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

	/**
	 * A bare model id is not a ModelInterface, so it has to route through
	 * using_model_preference() or the SDK raises a TypeError.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
	public function test_model_id_routes_through_model_preference() {
		$this->filter_returns( array( 'model' => 'claude-sonnet-5' ) );
		$builder = $this->builder();

		openstation_ai_apply_model_config( $builder, array() );

		$this->assertSame( array( 'claude-sonnet-5' ), $builder->preference );
	}

	/**
	 * The filter's own ceiling must survive the model's default, which means
	 * the config has to be applied before the model.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
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

	/**
	 * A list would reach the provider as parameters named `0`, `1`, ….
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
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

	/**
	 * Every documented key is present whatever the caller passed, so a
	 * subscriber can branch on `$context['source']` without guarding.
	 *
	 * @covers ::openstation_ai_apply_model_config
	 */
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
}
