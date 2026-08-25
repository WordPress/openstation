<?php
/**
 * Tests for the agents REST surface — permissions, CRUD round-trips,
 * invoke, and the catalogues. Handlers are invoked directly (the house
 * pattern) with `WP_REST_Request` objects.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsRest extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function request( $method, $path, array $params = array() ) {
		$req = new WP_REST_Request( $method, '/desktop-mode/v1' . $path );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		return $req;
	}

	private function create_agent_via_rest( array $overrides = array() ) {
		$response = openstation_agents_rest_create(
			$this->request(
				'POST',
				'/agents',
				array_merge(
					array(
						'name'         => 'Rest Agent',
						'role'         => 'author',
						'description'  => 'Handles REST tests.',
						'instructions' => 'Be terse.',
						'abilities'    => array( 'desktop-mode/get-post' ),
					),
					$overrides
				)
			)
		);
		$this->assertNotWPError( $response );
		return $response->get_data();
	}

	/**
	 * Routes are registered under the plugin namespace.
	 *
	 * @covers ::openstation_agents_register_rest_routes
	 */
	public function test_routes_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/desktop-mode/v1/agents', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/(?P<id>\d+)', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/(?P<id>\d+)/invoke', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/abilities', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/trigger-kinds', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/hooks-catalogue', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/agents/roles', $routes );
	}

	/**
	 * @covers ::openstation_agents_rest_read_permission
	 * @covers ::openstation_agents_rest_write_permission
	 * @covers ::openstation_agents_rest_invoke_permission
	 */
	public function test_permission_matrix() {
		// Admin: everything.
		$this->assertTrue( openstation_agents_rest_read_permission() );
		$this->assertTrue( openstation_agents_rest_write_permission() );
		$this->assertTrue( openstation_agents_rest_invoke_permission() );

		// Editor: read + invoke, no manage (no `edit_users`).
		wp_set_current_user( self::$editor_id );
		$this->assertTrue( openstation_agents_rest_read_permission() );
		$this->assertTrue( openstation_agents_rest_invoke_permission() );
		$write = openstation_agents_rest_write_permission();
		$this->assertWPError( $write );
		$this->assertSame( 403, $write->get_error_data()['status'] );

		// Subscriber: nothing.
		wp_set_current_user( self::$subscriber_id );
		$this->assertWPError( openstation_agents_rest_read_permission() );
		$this->assertWPError( openstation_agents_rest_invoke_permission() );

		// Logged out: nothing, with 401.
		wp_set_current_user( 0 );
		$read = openstation_agents_rest_read_permission();
		$this->assertWPError( $read );
		$this->assertSame( 401, $read->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_agents_rest_create
	 * @covers ::openstation_agents_rest_shape_user
	 */
	public function test_create_returns_canonical_shape() {
		$shape = $this->create_agent_via_rest();

		$this->assertSame( 'Rest Agent', $shape['name'] );
		$this->assertSame( 'rest-agent', $shape['slug'] );
		$this->assertSame( 'author', $shape['role'] );
		$this->assertSame( 'Handles REST tests.', $shape['description'] );
		$this->assertSame( 'Be terse.', $shape['instructions'] );
		$this->assertSame( array( 'desktop-mode/get-post' ), $shape['abilities'] );
		$this->assertSame( array(), $shape['triggers'] );
		$this->assertSame( '', $shape['model'] );
		$this->assertSame( 0, $shape['rateLimit'] );
		$this->assertNotEmpty( $shape['avatarUrl'] );
		$this->assertTrue( openstation_agent_is_agent( $shape['id'] ) );
	}

	/**
	 * The create route forwards every field it declares.
	 *
	 * It used to take the name, the role, the description, the
	 * instructions and the abilities, and drop the three that make an
	 * agent a character: `vibes`, `face` and `faceSeed`. The wizard was
	 * sending all three, so an agent someone had just picked a face for
	 * arrived on the site wearing the fallback glyph and with no voice
	 * line. That is what the grid full of identical grey robots
	 * actually was.
	 *
	 * @covers ::openstation_agents_rest_create
	 */
	public function test_create_keeps_the_face_and_the_voice() {
		$face = array(
			'appearance' => array( 'hueStart' => 200 ),
			'physics'    => array( 'shapePreset' => 'star' ),
		);
		$data = $this->create_agent_via_rest(
			array(
				'name'     => 'Character Agent',
				'vibes'    => 'blunt, precise, no sugarcoating',
				'face'     => $face,
				'faceSeed' => 4242,
			)
		);

		$this->assertSame( 'blunt, precise, no sugarcoating', $data['vibes'] );
		$this->assertSame( 4242, $data['faceSeed'] );
		$this->assertSame( 200, (int) $data['face']['appearance']['hueStart'] );
		$this->assertSame( 'star', $data['face']['physics']['shapePreset'] );

		// And the portrait reached disk, which is the only way
		// `get_avatar()` ever sees it.
		$this->assertNotSame(
			'',
			openstation_agent_face_url( (int) $data['id'] ),
			'the created agent has no face file'
		);
	}

	/**
	 * Triggers are part of the create, not a follow-up patch.
	 *
	 * The wizard's Powers step configures them before the
	 * agent exists; without this the agent would be briefly live and
	 * unreachable, and a failed second request would strand it there.
	 *
	 * @covers ::openstation_agents_rest_create
	 */
	public function test_create_accepts_triggers() {
		$data = $this->create_agent_via_rest(
			array(
				'name'     => 'Triggered Agent',
				'triggers' => array(
					array( 'kind' => 'chat', 'config' => array() ),
				),
			)
		);

		$this->assertCount( 1, $data['triggers'] );
		$this->assertSame( 'chat', $data['triggers'][0]['kind'] );
	}

	/**
	 * A create with no face still gets a seed, so the roll is
	 * available later.
	 *
	 * @covers ::openstation_agents_rest_create
	 */
	public function test_create_without_a_face_still_seeds_one() {
		$data = $this->create_agent_via_rest( array( 'name' => 'Seedless' ) );

		$this->assertGreaterThan( 0, (int) $data['faceSeed'] );
	}

	/**
	 * @covers ::openstation_agents_rest_create
	 */
	public function test_create_rejects_disallowed_role() {
		$result = openstation_agents_rest_create(
			$this->request(
				'POST',
				'/agents',
				array(
					'name' => 'Bad Role',
					'role' => 'subscriber',
				)
			)
		);
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_agent_invalid_role', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_agents_rest_list
	 * @covers ::openstation_agents_rest_get
	 */
	public function test_list_and_get() {
		$shape = $this->create_agent_via_rest();

		$response = openstation_agents_rest_list();
		$list     = $response->get_data();
		$this->assertCount( 1, $list );
		$this->assertSame( $shape['id'], $list[0]['id'] );

		// The My WordPress root grid derives folder counts from the
		// standard collection header.
		$headers = $response->get_headers();
		$this->assertSame( '1', (string) $headers['X-WP-Total'] );

		$get = openstation_agents_rest_get(
			$this->request( 'GET', "/agents/{$shape['id']}", array( 'id' => $shape['id'] ) )
		);
		$this->assertNotWPError( $get );
		$this->assertSame( 'Rest Agent', $get->get_data()['name'] );

		$missing = openstation_agents_rest_get(
			$this->request( 'GET', '/agents/999999', array( 'id' => 999999 ) )
		);
		$this->assertWPError( $missing );
		$this->assertSame( 404, $missing->get_error_data()['status'] );

		// A plain human user id is not an agent.
		$human = openstation_agents_rest_get(
			$this->request( 'GET', '/agents/' . self::$editor_id, array( 'id' => self::$editor_id ) )
		);
		$this->assertWPError( $human );
	}

	/**
	 * @covers ::openstation_agents_rest_patch
	 */
	public function test_patch_updates_fields() {
		$shape = $this->create_agent_via_rest();

		$req = $this->request( 'POST', "/agents/{$shape['id']}", array( 'id' => $shape['id'] ) );
		$req->set_header( 'Content-Type', 'application/json' );
		$req->set_body(
			wp_json_encode(
				array(
					'instructions' => 'Updated prompt.',
					'abilities'    => array(),
					'triggers'     => array(
						array(
							'kind'   => 'chat',
							'config' => array(),
						),
					),
					'rateLimit'    => 10,
				)
			)
		);

		$response = openstation_agents_rest_patch( $req );
		$this->assertNotWPError( $response );
		$data = $response->get_data();
		$this->assertSame( 'Updated prompt.', $data['instructions'] );
		$this->assertSame( array(), $data['abilities'] );
		$this->assertSame( 10, $data['rateLimit'] );
		$this->assertCount( 1, $data['triggers'] );
		$this->assertSame( 'chat', $data['triggers'][0]['kind'] );
	}

	/**
	 * @covers ::openstation_agents_rest_delete
	 */
	public function test_delete_removes_agent() {
		$shape = $this->create_agent_via_rest();

		$response = openstation_agents_rest_delete(
			$this->request( 'DELETE', "/agents/{$shape['id']}", array( 'id' => $shape['id'] ) )
		);
		$this->assertNotWPError( $response );
		$this->assertTrue( $response->get_data()['deleted'] );
		$this->assertFalse( get_userdata( $shape['id'] ) );
	}

	/**
	 * @covers ::openstation_agents_rest_invoke
	 */
	public function test_invoke_round_trip() {
		$shape = $this->create_agent_via_rest();

		add_filter(
			'openstation_agent_runner_generate',
			static function () {
				return array(
					'text'           => 'invoked!',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$response = openstation_agents_rest_invoke(
			$this->request(
				'POST',
				"/agents/{$shape['id']}/invoke",
				array(
					'id'      => $shape['id'],
					'message' => 'run please',
				)
			)
		);
		$this->assertNotWPError( $response );
		$this->assertSame( 'invoked!', $response->get_data()['text'] );
	}

	/**
	 * Runner errors surface with their status (e.g. rate limit 429).
	 *
	 * @covers ::openstation_agents_rest_invoke
	 */
	public function test_invoke_propagates_runner_errors() {
		$shape = $this->create_agent_via_rest();
		openstation_agent_update( $shape['id'], array( 'rateLimit' => 1 ) );
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

		$args = array(
			'id'      => $shape['id'],
			'message' => 'again',
		);
		openstation_agents_rest_invoke( $this->request( 'POST', "/agents/{$shape['id']}/invoke", $args ) );
		$second = openstation_agents_rest_invoke( $this->request( 'POST', "/agents/{$shape['id']}/invoke", $args ) );

		$this->assertWPError( $second );
		$this->assertSame( 'openstation_agent_rate_limited', $second->get_error_code() );
		$this->assertSame( 429, $second->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_agents_rest_trigger_kinds
	 * @covers ::openstation_agents_rest_hooks_catalogue
	 * @covers ::openstation_agents_rest_roles
	 */
	public function test_catalogues() {
		$kinds = openstation_agents_rest_trigger_kinds()->get_data();
		$slugs = wp_list_pluck( $kinds, 'slug' );
		$this->assertContains( 'chat', $slugs );
		$this->assertContains( 'send-to', $slugs );
		$this->assertContains( 'hook', $slugs );

		// The wired flag tells the Triggers pane which kinds have real
		// intake plumbing (pickable) vs. declared-only ("coming soon").
		$wired = array();
		foreach ( $kinds as $kind ) {
			$this->assertArrayHasKey( 'wired', $kind, "Kind {$kind['slug']} must declare wired" );
			$wired[ $kind['slug'] ] = $kind['wired'];
		}
		$this->assertTrue( $wired['chat'] );
		$this->assertTrue( $wired['send-to'] );
		$this->assertTrue( $wired['drag'] );
		$this->assertFalse( $wired['hook'] );
		$this->assertFalse( $wired['endpoint'] );
		$this->assertFalse( $wired['agent'] );

		$hooks = openstation_agents_rest_hooks_catalogue()->get_data();
		$this->assertContains( 'save_post', wp_list_pluck( $hooks, 'hook' ) );

		$roles = openstation_agents_rest_roles()->get_data();
		$this->assertContains( 'author', wp_list_pluck( $roles, 'slug' ) );
		$this->assertNotContains( 'subscriber', wp_list_pluck( $roles, 'slug' ) );
	}

	/**
	 * The abilities catalogue projects the readonly annotation.
	 * Requires the Abilities API.
	 *
	 * @covers ::openstation_agents_abilities_catalogue
	 */
	public function test_abilities_catalogue_readonly_badges() {
		if ( ! function_exists( 'wp_get_abilities' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}

		$catalogue = openstation_agents_rest_abilities_catalogue()->get_data();
		$by_slug   = array();
		foreach ( $catalogue as $row ) {
			$by_slug[ $row['slug'] ] = $row;
		}

		$this->assertArrayHasKey( 'desktop-mode/get-post', $by_slug );
		$this->assertTrue( $by_slug['desktop-mode/get-post']['readonly'] );
		$this->assertArrayHasKey( 'desktop-mode/update-post', $by_slug );
		$this->assertFalse( $by_slug['desktop-mode/update-post']['readonly'] );
	}
}
