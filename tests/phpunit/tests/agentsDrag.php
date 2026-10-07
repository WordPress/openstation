<?php

class Tests_OpenStation_AgentsDrag extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function create_agent( array $overrides = array() ) {
		$user = openstation_agent_create(
			array_merge(
				array(
					'name' => 'Drop Agent',
					'role' => 'author',
				),
				$overrides
			)
		);
		$this->assertNotWPError( $user );
		return $user;
	}

	public function test_human_user_file_has_no_agent_fields() {
		$shape = ( new OpenStation_User_File( (string) self::$admin_id ) )->serialize();
		$this->assertArrayNotHasKey( 'isAgent', $shape );
		$this->assertArrayNotHasKey( 'agentDragKinds', $shape );
	}

	public function test_agent_without_drag_trigger_serializes_null_kinds() {
		$agent = $this->create_agent();
		openstation_agent_update( $agent->ID, array( 'description' => 'Drops backgrounds.' ) );
		$shape = ( new OpenStation_User_File( (string) $agent->ID ) )->serialize();
		$this->assertTrue( $shape['isAgent'] );
		$this->assertNull( $shape['agentDragKinds'] );

		$this->assertSame( 'Drops backgrounds.', $shape['agentDescription'] );
	}

	public function test_drag_trigger_kinds_ship_inline() {
		$filtered = $this->create_agent( array( 'name' => 'Filtered' ) );
		openstation_agent_update(
			$filtered->ID,
			array(
				'triggers' => array(
					array(
						'kind'   => 'drag',
						'config' => array( 'entityKinds' => array( 'media', 'post' ) ),
					),
				),
			)
		);
		$shape = ( new OpenStation_User_File( (string) $filtered->ID ) )->serialize();
		$this->assertSame( array( 'media', 'post' ), $shape['agentDragKinds'] );

		$open = $this->create_agent( array( 'name' => 'Open' ) );
		openstation_agent_update(
			$open->ID,
			array(
				'triggers' => array(
					array(
						'kind'   => 'drag',
						'config' => array(),
					),
				),
			)
		);
		$shape = ( new OpenStation_User_File( (string) $open->ID ) )->serialize();
		$this->assertSame( array(), $shape['agentDragKinds'] );
	}

	public function test_invoke_source_reaches_completed_context() {
		$agent = $this->create_agent( array( 'name' => 'Sourced' ) );
		add_filter(
			'openstation_agent_runner_generate',
			static function () {
				return array(
					'text'           => 'ok',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$captured = null;
		add_action(
			'openstation_agent_completed',
			static function ( $agent_id, $message, $result, $context ) use ( &$captured ) {
				$captured = $context;
			},
			10,
			4
		);

		$request = new WP_REST_Request( 'POST', "/desktop-mode/v1/agents/{$agent->ID}/invoke" );
		$request->set_param( 'id', $agent->ID );
		$request->set_param( 'message', 'The user dropped the media "Hornet" (id 44) onto you.' );
		$request->set_param( 'source', 'drag' );

		$response = openstation_agents_rest_invoke( $request );
		$this->assertNotWPError( $response );
		$this->assertSame( 'drag', $captured['source'] );

		$this->assertSame( array(), $captured['history'] );
	}
}
