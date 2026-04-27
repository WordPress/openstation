<?php
/**
 * Tests for the AI provider registry — `desktop_mode_register_ai_provider()`,
 * lookups, dispatch helpers, and active-provider resolution.
 *
 * The registry uses a process-static store, so each test cleans up after
 * itself rather than relying on tear_down to walk an unknown set of ids.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiProviderRegistry extends WP_UnitTestCase {

	private function unique_id( $prefix = 'p' ) {
		return $prefix . '_' . substr( md5( uniqid( '', true ) ), 0, 8 );
	}

	private function noop_provider_args() {
		return array(
			'label'              => 'Test',
			'make_turn_input'    => static function ( $kind, $payload ) {
				return array( 'kind' => $kind, 'payload' => $payload );
			},
			'agentic_call'       => static function () {
				return array(
					'text'           => 'hello',
					'function_calls' => array(),
					'next_state'     => null,
					'raw'            => array(),
				);
			},
			'structured_request' => static function () {
				return array( 'ok' => true );
			},
		);
	}

	// -----------------------------------------------------------------
	// Registration
	// -----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_ai_provider
	 */
	public function test_registers_a_provider() {
		$id = $this->unique_id();
		$ok = desktop_mode_register_ai_provider( $id, $this->noop_provider_args() );
		$this->assertTrue( $ok );

		$def = desktop_mode_ai_get_provider( $id );
		$this->assertIsArray( $def );
		$this->assertSame( $id, $def['id'] );
		$this->assertSame( 'Test', $def['label'] );

		desktop_mode_unregister_ai_provider( $id );
	}

	/**
	 * @covers ::desktop_mode_register_ai_provider
	 */
	public function test_empty_id_returns_wp_error() {
		$err = desktop_mode_register_ai_provider( '', $this->noop_provider_args() );
		$this->assertInstanceOf( 'WP_Error', $err );
		$this->assertSame( 'desktop_mode_ai_provider_id', $err->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_ai_provider
	 */
	public function test_missing_callback_returns_wp_error() {
		$args = $this->noop_provider_args();
		unset( $args['agentic_call'] );

		$err = desktop_mode_register_ai_provider( $this->unique_id(), $args );
		$this->assertInstanceOf( 'WP_Error', $err );
		$this->assertSame( 'desktop_mode_ai_provider_callback', $err->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_ai_provider
	 */
	public function test_non_callable_callback_returns_wp_error() {
		$args                 = $this->noop_provider_args();
		$args['make_turn_input'] = 'not_a_function_that_exists_anywhere';

		$err = desktop_mode_register_ai_provider( $this->unique_id(), $args );
		$this->assertInstanceOf( 'WP_Error', $err );
		$this->assertSame( 'desktop_mode_ai_provider_callback', $err->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_unregister_ai_provider
	 */
	public function test_unregister_returns_true_when_present_false_otherwise() {
		$id = $this->unique_id();
		desktop_mode_register_ai_provider( $id, $this->noop_provider_args() );

		$this->assertTrue( desktop_mode_unregister_ai_provider( $id ) );
		$this->assertFalse( desktop_mode_unregister_ai_provider( $id ) );
		$this->assertNull( desktop_mode_ai_get_provider( $id ) );
	}

	// -----------------------------------------------------------------
	// Lookup + active-provider resolution
	// -----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_ai_get_providers
	 */
	public function test_get_providers_includes_built_in_openai() {
		$providers = desktop_mode_ai_get_providers();
		$this->assertArrayHasKey( 'openai', $providers );
		$this->assertSame( 'OpenAI', $providers['openai']['label'] );
	}

	/**
	 * @covers ::desktop_mode_ai_get_active_provider_id
	 */
	public function test_active_provider_falls_back_to_openai_default() {
		$user_id = self::factory()->user->create();
		$this->assertSame( 'openai', desktop_mode_ai_get_active_provider_id( $user_id ) );
	}

	/**
	 * @covers ::desktop_mode_ai_get_active_provider_id
	 */
	public function test_active_provider_filter_overrides_default() {
		$user_id = self::factory()->user->create();

		$pinned = $this->unique_id();
		desktop_mode_register_ai_provider( $pinned, $this->noop_provider_args() );

		add_filter(
			'desktop_mode_ai_active_provider',
			static function () use ( $pinned ) {
				return $pinned;
			}
		);

		$this->assertSame( $pinned, desktop_mode_ai_get_active_provider_id( $user_id ) );

		remove_all_filters( 'desktop_mode_ai_active_provider' );
		desktop_mode_unregister_ai_provider( $pinned );
	}

	/**
	 * @covers ::desktop_mode_ai_get_active_provider
	 */
	public function test_active_provider_returns_wp_error_when_unregistered() {
		$user_id = self::factory()->user->create();

		add_filter(
			'desktop_mode_ai_active_provider',
			static function () {
				return 'definitely_not_registered';
			}
		);

		$result = desktop_mode_ai_get_active_provider( $user_id );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_ai_no_provider', $result->get_error_code() );

		remove_all_filters( 'desktop_mode_ai_active_provider' );
	}

	// -----------------------------------------------------------------
	// Dispatch helpers
	// -----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_ai_provider_make_turn_input
	 */
	public function test_make_turn_input_dispatches_to_active_provider() {
		$user_id = self::factory()->user->create();
		$id      = $this->unique_id();

		desktop_mode_register_ai_provider( $id, $this->noop_provider_args() );
		add_filter(
			'desktop_mode_ai_active_provider',
			static function () use ( $id ) {
				return $id;
			}
		);

		$out = desktop_mode_ai_provider_make_turn_input( $user_id, 'user_message', 'hi' );
		$this->assertSame( array( 'kind' => 'user_message', 'payload' => 'hi' ), $out );

		remove_all_filters( 'desktop_mode_ai_active_provider' );
		desktop_mode_unregister_ai_provider( $id );
	}

	/**
	 * @covers ::desktop_mode_ai_provider_agentic_call
	 */
	public function test_agentic_call_normalizes_provider_response() {
		$user_id = self::factory()->user->create();
		$id      = $this->unique_id();

		desktop_mode_register_ai_provider( $id, $this->noop_provider_args() );
		add_filter(
			'desktop_mode_ai_active_provider',
			static function () use ( $id ) {
				return $id;
			}
		);

		$turn = desktop_mode_ai_provider_agentic_call(
			$user_id,
			'sk-test',
			null,
			array(),
			null,
			'',
			null
		);
		$this->assertSame( 'hello', $turn['text'] );
		$this->assertSame( array(), $turn['function_calls'] );
		$this->assertNull( $turn['next_state'] );

		remove_all_filters( 'desktop_mode_ai_active_provider' );
		desktop_mode_unregister_ai_provider( $id );
	}

	/**
	 * @covers ::desktop_mode_ai_provider_agentic_call
	 */
	public function test_agentic_call_propagates_wp_error() {
		$user_id = self::factory()->user->create();
		$id      = $this->unique_id();
		$args    = $this->noop_provider_args();
		$args['agentic_call'] = static function () {
			return new WP_Error( 'boom', 'bad things' );
		};

		desktop_mode_register_ai_provider( $id, $args );
		add_filter(
			'desktop_mode_ai_active_provider',
			static function () use ( $id ) {
				return $id;
			}
		);

		$turn = desktop_mode_ai_provider_agentic_call(
			$user_id,
			'sk-test',
			null,
			array(),
			null,
			'',
			null
		);
		$this->assertInstanceOf( 'WP_Error', $turn );
		$this->assertSame( 'boom', $turn->get_error_code() );

		remove_all_filters( 'desktop_mode_ai_active_provider' );
		desktop_mode_unregister_ai_provider( $id );
	}

	// -----------------------------------------------------------------
	// JS-safe shape
	// -----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_ai_get_providers_for_config
	 */
	public function test_providers_for_config_strips_callables() {
		$entries = desktop_mode_ai_get_providers_for_config();
		$this->assertNotEmpty( $entries );
		foreach ( $entries as $entry ) {
			$this->assertArrayNotHasKey( 'agentic_call', $entry );
			$this->assertArrayNotHasKey( 'make_turn_input', $entry );
			$this->assertArrayNotHasKey( 'structured_request', $entry );
			$this->assertArrayHasKey( 'id', $entry );
			$this->assertArrayHasKey( 'label', $entry );
		}
	}

	// -----------------------------------------------------------------
	// Per-provider key resolution
	// -----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_ai_resolve_key_for_provider
	 */
	public function test_resolve_key_prefers_per_provider_map() {
		$settings = array(
			'apiKey'  => 'legacy-openai-key',
			'apiKeys' => array(
				'anthropic' => 'sk-ant-…',
			),
		);
		$this->assertSame( 'sk-ant-…', desktop_mode_ai_resolve_key_for_provider( $settings, 'anthropic' ) );
	}

	/**
	 * @covers ::desktop_mode_ai_resolve_key_for_provider
	 */
	public function test_resolve_key_falls_back_to_legacy_for_openai_only() {
		$settings = array(
			'apiKey'  => 'legacy-openai-key',
			'apiKeys' => array(),
		);
		$this->assertSame( 'legacy-openai-key', desktop_mode_ai_resolve_key_for_provider( $settings, 'openai' ) );
		$this->assertSame( '', desktop_mode_ai_resolve_key_for_provider( $settings, 'anthropic' ) );
	}
}
