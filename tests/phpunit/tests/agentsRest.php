<?php
/**
 * Tests for the Agents REST surface at /desktop-mode/v1/agents.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_Agents_Rest extends WP_UnitTestCase {

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

		if ( ! post_type_exists( 'wp_guideline' ) ) {
			register_post_type(
				'wp_guideline',
				array(
					'public'       => false,
					'show_in_rest' => true,
					'rest_base'    => 'guidelines',
					'supports'     => array( 'title', 'editor', 'excerpt', 'author' ),
				)
			);
		}
		if ( ! taxonomy_exists( 'wp_guideline_type' ) ) {
			register_taxonomy(
				'wp_guideline_type',
				'wp_guideline',
				array(
					'hierarchical' => true,
					'show_in_rest' => true,
				)
			);
		}

		// Ensure REST routes are wired.
		do_action( 'rest_api_init' );
	}

	public function tear_down() {
		// Hard-delete every agent user the test created so state
		// doesn't leak.
		$users = get_users(
			array(
				'meta_key'   => DESKTOP_MODE_AGENT_USER_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value' => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'fields'     => 'ID',
				'number'     => 200,
			)
		);
		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		foreach ( $users as $uid ) {
			wp_delete_user( $uid );
		}
		parent::tear_down();
	}

	private function dispatch( $method, $route, $body = null ) {
		$request = new WP_REST_Request( $method, $route );
		if ( null !== $body ) {
			$request->set_body_params( $body );
		}
		return rest_get_server()->dispatch( $request );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_list
	 */
	public function test_list_empty_returns_empty_array() {
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertIsArray( $response->get_data() );
		$this->assertCount( 0, $response->get_data() );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_create
	 */
	public function test_create_returns_agent_shape() {
		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name'         => 'Remove BG',
				'role'         => 'editor',
				'description'  => 'Removes image backgrounds.',
				'instructions' => 'You are an image processor.',
			)
		);
		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'id', $data );
		$this->assertSame( 'Remove BG', $data['name'] );
		$this->assertSame( 'remove-bg', $data['slug'] );
		$this->assertSame( 'Removes image backgrounds.', $data['description'] );
		$this->assertSame( 'editor', $data['role'] );
		$this->assertIsArray( $data['abilities'] );
		$this->assertIsArray( $data['triggers'] );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_create
	 */
	public function test_create_rejects_invalid_role() {
		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Bad Role',
				'role' => 'this_role_does_not_exist',
			)
		);
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_get
	 */
	public function test_get_returns_404_for_missing_agent() {
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents/999999' );
		$this->assertSame( 404, $response->get_status() );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_patch
	 */
	public function test_patch_updates_name_and_instructions() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name'         => 'Original',
				'role'         => 'author',
				'instructions' => 'first',
			)
		)->get_data();

		$id = $created['id'];

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $id,
			array(
				'name'         => 'Renamed',
				'instructions' => 'updated',
			)
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'Renamed', $data['name'] );
		$this->assertSame( 'updated', $data['instructions'] );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_patch
	 */
	public function test_patch_writes_abilities() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Abilities Agent',
				'role' => 'editor',
			)
		)->get_data();

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $created['id'],
			array(
				'abilities' => array( 'media/upload', 'media/replace' ),
			)
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 2, $data['abilities'] );
		$this->assertContains( 'media/upload', $data['abilities'] );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_patch
	 */
	public function test_patch_writes_triggers() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Triggers Agent',
				'role' => 'editor',
			)
		)->get_data();

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $created['id'],
			array(
				'triggers' => array(
					array( 'kind' => 'hook', 'config' => array( 'hook' => 'save_post', 'priority' => 10 ) ),
				),
			)
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 1, $data['triggers'] );
		$this->assertSame( 'hook', $data['triggers'][0]['kind'] );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_delete
	 */
	public function test_delete_removes_agent_and_guideline() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'To Delete',
				'role' => 'editor',
			)
		)->get_data();

		$response = $this->dispatch(
			'DELETE',
			'/desktop-mode/v1/agents/' . $created['id']
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['deleted'] );

		$get = $this->dispatch( 'GET', '/desktop-mode/v1/agents/' . $created['id'] );
		$this->assertSame( 404, $get->get_status() );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_read_permission
	 */
	public function test_subscriber_cannot_read() {
		wp_set_current_user( self::$subscriber_id );
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents' );
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Editors have `edit_posts` and the canonical `wp_guideline` CPT
	 * grants `'read' => 'edit_posts'` — so editors can browse agents
	 * alongside any other guideline. (They cannot create agents
	 * because creating one needs `edit_users` — see the next test.)
	 *
	 * @covers ::desktop_mode_agents_rest_read_permission
	 */
	public function test_editor_can_read() {
		wp_set_current_user( self::$editor_id );
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents' );
		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_write_permission
	 */
	public function test_editor_cannot_create() {
		wp_set_current_user( self::$editor_id );
		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Editor Cannot',
				'role' => 'author',
			)
		);
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * The create handler always reauthors the guideline to the
	 * synthetic agent user, regardless of who triggered the create —
	 * so revisions and comments attribute to the agent, not to the
	 * human admin who created it.
	 *
	 * @covers ::desktop_mode_agents_rest_create
	 */
	public function test_create_sets_guideline_author_to_agent_user() {
		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Author Test',
				'role' => 'editor',
			)
		);
		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();

		$post = get_post( (int) $data['guidelineId'] );
		$this->assertSame( (int) $data['id'], (int) $post->post_author );
	}

	/**
	 * The PATCH endpoint accepts a `status` field — `publish` /
	 * `private` / `draft` — so admins can opt agents out of the
	 * ecosystem-discovery loop (pushmd projection, Dolly skill
	 * picker) by flipping them to `private`.
	 *
	 * @covers ::desktop_mode_agents_rest_patch
	 */
	public function test_patch_can_flip_status_to_private() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Privacy Flip',
				'role' => 'editor',
			)
		)->get_data();

		$this->assertSame( 'publish', $created['status'] );

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $created['id'],
			array( 'status' => 'private' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'private', $response->get_data()['status'] );

		$guideline = get_post( (int) $created['guidelineId'] );
		$this->assertSame( 'private', $guideline->post_status );
	}

	/**
	 * Invalid status values are rejected with 400.
	 *
	 * @covers ::desktop_mode_agents_rest_patch
	 */
	public function test_patch_rejects_invalid_status() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Status Reject',
				'role' => 'editor',
			)
		)->get_data();

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $created['id'],
			array( 'status' => 'banana' )
		);
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * The POST create endpoint honours an explicit `status` arg so
	 * the bundle can create private agents directly.
	 *
	 * @covers ::desktop_mode_agents_rest_create
	 */
	public function test_create_with_explicit_status_private() {
		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name'   => 'Born Private',
				'role'   => 'editor',
				'status' => 'private',
			)
		);
		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'private', $data['status'] );
		$guideline = get_post( (int) $data['guidelineId'] );
		$this->assertSame( 'private', $guideline->post_status );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_write_permission
	 */
	public function test_substrate_missing_returns_412() {
		add_filter( 'desktop_mode_agents_storage_available', '__return_false' );

		$response = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Substrate Down',
				'role' => 'editor',
			)
		);
		$this->assertSame( 412, $response->get_status() );

		remove_all_filters( 'desktop_mode_agents_storage_available' );
	}

	/**
	 * The abilities-catalogue route returns whatever
	 * `desktop_mode_agents_abilities_catalogue()` resolved — sourced
	 * from `wp_get_abilities()` + the
	 * `desktop_mode_agent_abilities_catalogue` filter. The route
	 * never invents abilities itself, so an empty registry → empty
	 * list (200, not 404).
	 *
	 * We inject one ability through the filter to assert the shape
	 * round-trips without depending on Core's own abilities being
	 * registered in the PHPUnit harness.
	 *
	 * @covers ::desktop_mode_agents_rest_abilities_catalogue
	 */
	public function test_abilities_catalogue_route_returns_list() {
		add_filter(
			'desktop_mode_agent_abilities_catalogue',
			static function ( $catalogue ) {
				$catalogue[] = array(
					'slug'        => 'test-plugin/sample-ability',
					'label'       => 'Sample',
					'description' => 'For the route assertion.',
				);
				return $catalogue;
			}
		);

		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents/abilities' );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertIsArray( $data );
		$slugs = wp_list_pluck( $data, 'slug' );
		$this->assertContains( 'test-plugin/sample-ability', $slugs );

		remove_all_filters( 'desktop_mode_agent_abilities_catalogue' );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_send_to_targets
	 */
	public function test_send_to_targets_route_returns_list() {
		$created = $this->dispatch(
			'POST',
			'/desktop-mode/v1/agents',
			array(
				'name' => 'Send-To Route',
				'role' => 'editor',
			)
		)->get_data();

		// Add a send-to trigger via PATCH.
		$this->dispatch(
			'POST',
			'/desktop-mode/v1/agents/' . $created['id'],
			array(
				'triggers' => array(
					array(
						'kind'   => 'send-to',
						'config' => array( 'entityKinds' => array( 'post' ) ),
					),
				),
			)
		);

		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents/send-to-targets' );
		$this->assertSame( 200, $response->get_status() );
		$ids = wp_list_pluck( $response->get_data(), 'id' );
		$this->assertContains( (int) $created['id'], $ids );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_trigger_kinds
	 */
	public function test_trigger_kinds_route_returns_list() {
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents/trigger-kinds' );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$slugs = wp_list_pluck( $data, 'slug' );
		$this->assertContains( 'drag', $slugs );
		$this->assertContains( 'hook', $slugs );
	}

	/**
	 * @covers ::desktop_mode_agents_rest_hooks_catalogue
	 */
	public function test_hooks_catalogue_route_returns_list() {
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/agents/hooks-catalogue' );
		$this->assertSame( 200, $response->get_status() );
		$names = wp_list_pluck( $response->get_data(), 'hook' );
		$this->assertContains( 'save_post', $names );
	}
}
