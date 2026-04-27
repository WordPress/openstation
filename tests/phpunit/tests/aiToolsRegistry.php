<?php
/**
 * Tests for `desktop_mode_register_ai_tool()` — the PHP-side registry
 * for server-dispatched AI Copilot tools.
 *
 * Module-level static store is process-global, so tests use unique
 * tool names per case.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiToolsRegistry extends WP_UnitTestCase {

	/**
	 * @covers ::desktop_mode_register_ai_tool
	 */
	public function test_registers_a_tool() {
		$name = 'ai_tool_a_' . substr( md5( uniqid() ), 0, 8 );
		$ok   = desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'Does a thing.',
			'parameters'  => array( 'type' => 'object', 'properties' => (object) array() ),
			'handler'     => static function () {
				return array( 'ok' => true );
			},
		) );
		$this->assertTrue( $ok );

		$entry = desktop_mode_desktop_ai_tool_registry( $name );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Does a thing.', $entry['description'] );
	}

	/**
	 * @covers ::desktop_mode_register_ai_tool
	 */
	public function test_invalid_name_returns_wp_error() {
		$r = desktop_mode_register_ai_tool( array(
			'name'        => 'Has Spaces',
			'description' => 'x',
			'handler'     => '__return_true',
		) );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'desktop_mode_ai_tool_invalid_name', $r->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_ai_tool
	 */
	public function test_missing_handler_returns_wp_error() {
		$r = desktop_mode_register_ai_tool( array(
			'name'        => 'ai_tool_b_' . substr( md5( uniqid() ), 0, 8 ),
			'description' => 'x',
			'handler'     => 'function_that_does_not_exist_' . uniqid(),
		) );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'desktop_mode_ai_tool_invalid_handler', $r->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_ai_tool
	 */
	public function test_missing_description_returns_wp_error() {
		$r = desktop_mode_register_ai_tool( array(
			'name'    => 'ai_tool_c_' . substr( md5( uniqid() ), 0, 8 ),
			'handler' => '__return_true',
		) );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'desktop_mode_ai_tool_missing_description', $r->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_get_registered_ai_tools_for_user
	 */
	public function test_capability_gates_visibility() {
		$name = 'ai_tool_cap_' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'Admin only.',
			'capability'  => 'manage_options',
			'handler'     => static function () {
				return array();
			},
		) );

		$subscriber = $this->factory()->user->create( array( 'role' => 'subscriber' ) );
		$admin      = $this->factory()->user->create( array( 'role' => 'administrator' ) );

		$for_sub   = desktop_mode_get_registered_ai_tools_for_user( $subscriber );
		$for_admin = desktop_mode_get_registered_ai_tools_for_user( $admin );

		$names_sub   = array_map( static fn( $e ) => $e['name'], $for_sub );
		$names_admin = array_map( static fn( $e ) => $e['name'], $for_admin );

		$this->assertNotContains( $name, $names_sub );
		$this->assertContains( $name, $names_admin );
	}

	/**
	 * @covers ::desktop_mode_ai_invoke_registered_tool
	 */
	public function test_invoke_handles_wp_error_return() {
		$name = 'ai_tool_err_' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'Errors out.',
			'handler'     => static function () {
				return new WP_Error( 'whoops', 'Nope.' );
			},
		) );
		$entry  = desktop_mode_desktop_ai_tool_registry( $name );
		$result = desktop_mode_ai_invoke_registered_tool( $entry, array(), 1 );
		$this->assertSame( 'whoops', $result['error'] );
		$this->assertSame( $name, $result['tool'] );
	}

	/**
	 * @covers ::desktop_mode_ai_invoke_registered_tool
	 */
	public function test_invoke_handles_thrown_exception() {
		$name = 'ai_tool_throw_' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'Throws.',
			'handler'     => static function () {
				throw new \RuntimeException( 'boom' );
			},
		) );
		$error_calls = 0;
		add_action( 'desktop_mode_ai_search_error', static function () use ( &$error_calls ) {
			$error_calls++;
		} );

		$entry  = desktop_mode_desktop_ai_tool_registry( $name );
		$result = desktop_mode_ai_invoke_registered_tool( $entry, array(), 1 );

		$this->assertSame( 'tool_exception', $result['error'] );
		$this->assertSame( 1, $error_calls );
	}

	/**
	 * @covers ::desktop_mode_ai_tool_entry_to_definition
	 */
	public function test_entry_to_definition_strips_handler() {
		$name = 'ai_tool_def_' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'Builds a def.',
			'parameters'  => array( 'type' => 'object', 'properties' => (object) array() ),
			'handler'     => '__return_true',
		) );
		$entry = desktop_mode_desktop_ai_tool_registry( $name );
		$def   = desktop_mode_ai_tool_entry_to_definition( $entry );

		$this->assertSame( 'function', $def['type'] );
		$this->assertSame( $name, $def['name'] );
		$this->assertSame( 'Builds a def.', $def['description'] );
		$this->assertArrayNotHasKey( 'handler', $def );
	}

	/**
	 * @covers ::desktop_mode_register_ai_tool
	 */
	public function test_registered_action_fires_with_name_and_entry() {
		$captured = array();
		add_action( 'desktop_mode_ai_tool_registered', static function ( $n, $e ) use ( &$captured ) {
			$captured[] = array( 'name' => $n, 'entry' => $e );
		}, 10, 2 );

		$name = 'ai_tool_action_' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_ai_tool( array(
			'name'        => $name,
			'description' => 'x',
			'handler'     => '__return_true',
		) );

		$matches = array_filter( $captured, static fn( $c ) => $c['name'] === $name );
		$this->assertCount( 1, $matches );
	}
}
