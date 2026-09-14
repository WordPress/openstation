<?php
/**
 * MIO transport bounds, authorization, and private discovery.
 *
 * @package OpenStation
 * @group openstation
 * @group os-mio
 */

defined( 'ABSPATH' ) || exit;

class Tests_OpenStation_MioAssistant extends WP_UnitTestCase {
	/** @covers ::openstation_rest_mio_permission */
	public function test_disabled_mio_api_blocks_direct_turns() {
		$user = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user );
		openstation_save_os_settings( $user, array( 'mioEnabled' => false ) );
		$error = openstation_rest_mio_permission();
		$this->assertWPError( $error );
		$this->assertSame( 'openstation_mio_api_disabled', $error->get_error_code() );
		$response = rest_get_server()->dispatch( new WP_REST_Request( 'POST', '/desktop-mode/v1/mio/turn' ) );
		$this->assertSame( 403, $response->get_status() );
	}

	/** A valid window-authored request without side-effecting tools. */
	private function turn() {
		return array(
			'prompt'     => 'You are MIO in Preferences.',
			'transcript' => '{"messages":[{"role":"user","text":"Hello"}]}',
			'tools'      => array(
				array(
					'name'        => 'set_window_radius',
					'description' => 'Change corners.',
					'parameters'  => array( 'type' => 'object', 'properties' => array( 'value' => array( 'type' => 'string' ) ) ),
				),
			),
		);
	}

	/** @covers ::openstation_mio_normalize_arguments */
	public function test_empty_sdk_arguments_normalize_only_for_parameterless_tools() {
		$this->assertSame( '{}', openstation_mio_normalize_arguments( '[]', array( 'type' => 'object', 'properties' => array() ) ) );
		$this->assertSame( '[]', openstation_mio_normalize_arguments( '[]', $this->turn()['tools'][0]['parameters'] ) );
		$this->assertSame( '{"unexpected":1}', openstation_mio_normalize_arguments( '{"unexpected":1}', array( 'type' => 'object' ) ) );
	}

	/** @covers ::openstation_mio_valid_turn */
	public function test_valid_turn_accepts_window_authored_prompt_and_private_tools() {
		$this->assertTrue( openstation_mio_valid_turn( $this->turn() ) );
	}

	/** @covers ::openstation_mio_valid_turn */
	public function test_rejects_missing_fields_unknown_fields_and_oversized_context() {
		$this->assertFalse( openstation_mio_valid_turn( null ) );
		$this->assertFalse( openstation_mio_valid_turn( array() ) );
		$turn = $this->turn();
		$turn['execute'] = 'delete_all';
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
		$turn = $this->turn();
		$turn['prompt'] = str_repeat( 'x', 16001 );
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
		$turn = $this->turn();
		$turn['transcript'] = str_repeat( 'x', 96001 );
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
	}

	/** @covers ::openstation_mio_valid_turn */
	public function test_rejects_ambiguous_or_malformed_tool_catalogs() {
		$turn = $this->turn();
		$turn['tools'][] = $turn['tools'][0];
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
		$turn = $this->turn();
		$turn['tools'][0]['name'] = 'namespace/public-action';
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
		$turn = $this->turn();
		$turn['tools'][0]['parameters'] = array( 'type' => 'array' );
		$this->assertFalse( openstation_mio_valid_turn( $turn ) );
	}

	/** @covers ::openstation_register_mio_rest_route */
	public function test_route_requires_authentication_and_publishes_no_wordpress_abilities() {
		wp_set_current_user( 0 );
		$server = rest_get_server();
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/mio/turn' );
		$response = $server->dispatch( $request );
		$this->assertSame( 403, $response->get_status() );
		if ( function_exists( 'wp_get_abilities' ) ) {
			foreach ( wp_get_abilities() as $ability ) {
				$this->assertStringNotContainsString( 'set_window_radius', $ability->get_name() );
				$this->assertStringNotContainsString( 'set_extended_games', $ability->get_name() );
			}
		}
	}

	/** @covers ::openstation_rest_mio_turn */
	public function test_callback_rejects_invalid_input_before_any_generation() {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/mio/turn' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( '{}' );
		$error = openstation_rest_mio_turn( $request );
		$this->assertWPError( $error );
		$this->assertSame( 'openstation_mio_invalid_turn', $error->get_error_code() );
		$request->set_body( str_repeat( 'x', 220001 ) );
		$this->assertSame( 'openstation_mio_too_large', openstation_rest_mio_turn( $request )->get_error_code() );
	}
}
