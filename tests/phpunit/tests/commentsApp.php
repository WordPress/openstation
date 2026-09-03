<?php
/**
 * Tests for the Comments app — the App Framework port of the native
 * Comments window: the manifest, the gate, the rail and thread data,
 * the post scope carried by params, and the moderate / reply / edit
 * dispatch cycle end to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group comments-app
 */

class Tests_OpenStation_CommentsApp extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $contributor_id;
	protected static $post_id;
	protected static $other_post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$post_id        = $factory->post->create(
			array(
				'post_status' => 'publish',
				'post_title'  => 'Scoped post',
				'post_author' => self::$admin_id,
			)
		);
		self::$other_post_id  = $factory->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => self::$admin_id,
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action name.
	 * @param array  $state  Client state.
	 * @param array  $args   Action args.
	 * @param array  $params Open-time params.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array(), array $params = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-comments',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
				'params' => $params,
			),
			openstation_apps_os()
		);
	}

	/**
	 * A comment on a post with a status.
	 *
	 * @param int    $post_id  Post.
	 * @param string $approved `0` | `1` | `spam` | `trash`.
	 * @param int    $parent   Parent comment id.
	 * @return int Comment id.
	 */
	protected function comment( $post_id, $approved = '0', $parent = 0 ) {
		return self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => $approved,
				'comment_parent'   => $parent,
				'comment_content'  => 'Comment body',
			)
		);
	}

	/**
	 * @param array $response Dispatch response.
	 * @return int[] The rail's comment ids.
	 */
	protected function rail_ids( array $response ) {
		return array_map( 'intval', wp_list_pluck( $response['data']['rail']['items'], 'id' ) );
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-comments' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Comments', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-comments', $manifest['icon'] );
		$this->assertSame( 1180, $manifest['width'] );
		$this->assertSame( 760, $manifest['height'] );
		$this->assertSame( 760, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );
		// The Comments dock tile is WordPress's own; the remap routes it here.
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( array( 'comment' ), $manifest['watch'] );
		foreach ( array( 'reopen', 'filter', 'page', 'select', 'moderate', 'reply', 'edit' ) as $action ) {
			$this->assertContains( $action, $manifest['actions'] );
		}
		// A live window reopened from a "comments on this post" link retargets.
		$this->assertContains( 'reopen', $manifest['lifecycle'] );
		// Static facts ride the config, never a response.
		$this->assertTrue( $manifest['config']['canModerate'] );
		$this->assertSame( 'rich', $manifest['config']['replyEditor'] );
		$this->assertArrayHasKey( 'enabled', $manifest['config']['aiModeration'] );
		$this->assertArrayHasKey( 'providerConfigured', $manifest['config']['aiModeration'] );
		$this->assertTrue( $manifest['config']['aiModeration']['canManage'] );
		$this->assertSame( 'pending', $manifest['state']['tab'] );
		$this->assertSame( 0, $manifest['state']['post'] );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_follows_the_legacy_capability_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-comments' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_comments_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_comments_window_user_can_register', '__return_false' );

		// A subscriber lacks `edit_posts`.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_serves_the_pending_rail_with_the_computed_fields() {
		$pending  = $this->comment( self::$post_id, '0' );
		$approved = $this->comment( self::$post_id, '1' );
		$this->comment( self::$post_id, '1', $approved );

		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$ids = $this->rail_ids( $response );
		$this->assertContains( $pending, $ids );
		$this->assertNotContains( $approved, $ids );
		$this->assertSame( '', $response['data']['rail']['error'] );
		$this->assertSame( 'pending', $response['state']['tab'] );
		// The rail auto-selects its first conversation.
		$this->assertSame( $ids[0], $response['state']['selected'] );

		$row = $response['data']['rail']['items'][ array_search( $pending, $ids, true ) ];
		$this->assertSame( 'Scoped post', $row['openstation_post_title'] );
		$this->assertTrue( $row['openstation_can_moderate'] );
		$this->assertSame( 0, $row['openstation_replies_count'] );
		$this->assertSame( 0, $row['parent'] );

		$this->assertGreaterThanOrEqual( 1, $response['data']['counts']['pending'] );
		$this->assertGreaterThanOrEqual( 2, $response['data']['counts']['approved'] );
		$this->assertStringStartsWith( 'pending|', $response['data']['railKey'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_the_post_param_scopes_the_rail_and_reopen_clears_it() {
		$here  = $this->comment( self::$post_id, '1' );
		$there = $this->comment( self::$other_post_id, '1' );

		$response = $this->dispatch( 'mount', array(), array(), array( 'post' => self::$post_id ) );
		$this->assertTrue( $response['ok'] );
		// A scoped open lands on All, so the post's whole thread shows.
		$this->assertSame( 'all', $response['state']['tab'] );
		$this->assertSame( self::$post_id, $response['state']['post'] );
		$ids = $this->rail_ids( $response );
		$this->assertContains( $here, $ids );
		$this->assertNotContains( $there, $ids );

		$response = $this->dispatch( 'reopen', $response['state'], array(), array( 'post' => 0 ) );
		$this->assertSame( 0, $response['state']['post'] );
		$this->assertContains( $there, $this->rail_ids( $response ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_filter_switches_tabs_and_restarts_the_accumulation() {
		$spam    = $this->comment( self::$post_id, 'spam' );
		$pending = $this->comment( self::$post_id, '0' );

		$mounted = $this->dispatch( 'mount' );
		$state   = $mounted['state'];
		$state['tab'] = 'spam';
		$state['page'] = 3;
		$response = $this->dispatch( 'filter', $state );
		$this->assertTrue( $response['ok'] );
		$ids = $this->rail_ids( $response );
		$this->assertContains( $spam, $ids );
		$this->assertNotContains( $pending, $ids );
		$this->assertSame( 1, $response['state']['page'] );
		$this->assertGreaterThan( $mounted['state']['gen'], $response['state']['gen'] );
		// The selection followed the view: the pending one left it.
		$this->assertSame( $spam, $response['state']['selected'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_select_serves_the_whole_thread_of_the_post() {
		$root  = $this->comment( self::$post_id, '1' );
		$reply = $this->comment( self::$post_id, '0', $root );
		$deep  = $this->comment( self::$post_id, 'spam', $reply );

		$response = $this->dispatch( 'select', array( 'tab' => 'all' ), array( 'id' => $root ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( $root, $response['state']['selected'] );
		$thread = array_map( 'intval', wp_list_pluck( $response['data']['thread'], 'id' ) );
		// All depths, all statuses, oldest first.
		$this->assertSame( array( $root, $reply, $deep ), $thread );
		$this->assertArrayNotHasKey( 'openstation_replies_count', $response['data']['thread'][0] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_moderate_approves_announces_and_fires_after_bulk() {
		$pending = $this->comment( self::$post_id, '0' );
		$fired   = array();
		$listener = static function ( $action, $processed, $skipped ) use ( &$fired ) {
			$fired[] = array( $action, $processed, $skipped );
		};
		add_action( 'openstation_comments_window_after_bulk', $listener, 10, 3 );

		$response = $this->dispatch(
			'moderate',
			array( 'tab' => 'pending' ),
			array(
				'ids'    => array( $pending ),
				'action' => 'approve',
			)
		);
		remove_action( 'openstation_comments_window_after_bulk', $listener, 10 );

		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'approved', wp_get_comment_status( $pending ) );
		$this->assertSame( array( array( 'approve', array( $pending ), array() ) ), $fired );

		$announce = null;
		foreach ( $response['effects'] as $effect ) {
			if ( 'announce' === $effect['type'] ) {
				$announce = $effect;
			}
		}
		$this->assertNotNull( $announce );
		$this->assertSame( 'comment', $announce['contentType'] );
		$this->assertSame( 'updated', $announce['action'] );
		$this->assertSame( array( $pending ), $announce['ids'] );
		// The approved comment left the Pending rail in the same response.
		$this->assertNotContains( $pending, $this->rail_ids( $response ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_moderate_is_refused_without_moderate_comments() {
		$pending = $this->comment( self::$post_id, '0' );
		wp_set_current_user( self::$contributor_id );

		$response = $this->dispatch(
			'moderate',
			array(),
			array(
				'ids'    => array( $pending ),
				'action' => 'trash',
			)
		);
		$this->assertFalse( $response['ok'] );
		$this->assertSame( 'action_failed', $response['error'] );
		$this->assertSame( 'unapproved', wp_get_comment_status( $pending ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_reply_creates_a_child_comment_and_announces_it() {
		$root = $this->comment( self::$post_id, '1' );

		$response = $this->dispatch(
			'reply',
			array( 'tab' => 'all' ),
			array(
				'parent'  => $root,
				'content' => 'Thanks for the comment!',
			)
		);
		$this->assertTrue( $response['ok'] );
		$children = get_comments(
			array(
				'parent' => $root,
				'status' => 'all',
			)
		);
		$this->assertCount( 1, $children );
		$this->assertSame( 'Thanks for the comment!', $children[0]->comment_content );
		$this->assertSame( (string) self::$admin_id, (string) $children[0]->user_id );

		$types = wp_list_pluck( $response['effects'], 'type' );
		$this->assertContains( 'announce', $types );

		// An empty reply is refused, as the route refuses it.
		$refused = $this->dispatch(
			'reply',
			array(),
			array(
				'parent'  => $root,
				'content' => '   ',
			)
		);
		$this->assertFalse( $refused['ok'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_edit_rewrites_the_body_through_the_core_controller() {
		$id = $this->comment( self::$post_id, '1' );

		$response = $this->dispatch(
			'edit',
			array(),
			array(
				'id'      => $id,
				'content' => 'Rewritten body',
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'Rewritten body', get_comment( $id )->comment_content );

		wp_set_current_user( self::$contributor_id );
		$refused = $this->dispatch(
			'edit',
			array(),
			array(
				'id'      => $id,
				'content' => 'Nope',
			)
		);
		$this->assertFalse( $refused['ok'] );
		$this->assertSame( 'Rewritten body', get_comment( $id )->comment_content );
	}
}
