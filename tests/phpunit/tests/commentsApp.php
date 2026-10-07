<?php

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

	protected function comment( $post_id, $approved = '0', $parent = 0, array $extra = array() ) {
		return self::factory()->comment->create(
			array_merge(
				array(
					'comment_post_ID'  => $post_id,
					'comment_approved' => $approved,
					'comment_parent'   => $parent,
					'comment_content'  => 'Comment body',
				),
				$extra
			)
		);
	}

	protected function rail_ids( array $response ) {
		return array_map( 'intval', wp_list_pluck( $response['data']['rail']['items'], 'id' ) );
	}

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

		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( array( 'comment' ), $manifest['watch'] );
		foreach ( array( 'reopen', 'filter', 'page', 'select', 'moderate', 'reply', 'edit' ) as $action ) {
			$this->assertContains( $action, $manifest['actions'] );
		}

		$this->assertContains( 'reopen', $manifest['lifecycle'] );

		$this->assertSame( array( 'currentUserId', 'canModerate', 'canEditComments' ), array_keys( $manifest['config'] ) );
		$this->assertTrue( $manifest['config']['canModerate'] );
		$this->assertTrue( $manifest['config']['canEditComments'] );
		$this->assertSame( self::$admin_id, $manifest['config']['currentUserId'] );
		$this->assertSame( array( 'tab', 'search', 'page', 'post', 'selected', 'gen' ), array_keys( $manifest['state'] ) );
		$this->assertSame( 'pending', $manifest['state']['tab'] );
		$this->assertSame( 0, $manifest['state']['post'] );
	}

	public function test_gate_follows_the_legacy_capability_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-comments' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_comments_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_comments_window_user_can_register', '__return_false' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

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
		$this->assertSame( '', $response['data']['rail']['code'] );
		$this->assertSame( 'pending', $response['state']['tab'] );

		$this->assertSame( $ids[0], $response['state']['selected'] );

		$row = $response['data']['rail']['items'][ array_search( $pending, $ids, true ) ];
		$this->assertSame( 'Scoped post', $row['openstation_post_title'] );
		$this->assertTrue( $row['openstation_can_edit'] );
		$this->assertSame( 0, $row['openstation_replies_count'] );
		$this->assertSame( 0, $row['parent'] );

		$this->assertArrayNotHasKey( 'openstation_can_moderate', $row );

		$this->assertGreaterThanOrEqual( 1, $response['data']['counts']['pending'] );
		$this->assertGreaterThanOrEqual( 2, $response['data']['counts']['approved'] );
		$this->assertStringStartsWith( 'pending|', $response['data']['railKey'] );
	}

	public function test_reply_counts_are_one_query_for_the_whole_page() {
		global $wpdb;
		$roots = array();
		for ( $i = 0; $i < 5; $i++ ) {
			$roots[] = $this->comment( self::$post_id, '1' );
		}

		$this->comment( self::$post_id, '1', $roots[0] );
		$this->comment( self::$post_id, '1', $roots[0] );
		$this->comment( self::$post_id, '0', $roots[1] );
		$this->comment( self::$post_id, 'spam', $roots[1] );

		$before = $wpdb->num_queries;
		$counts = OpenStation\Apps\Comments\reply_counts( $roots );
		$this->assertSame( 1, $wpdb->num_queries - $before );
		$this->assertSame( 2, $counts[ $roots[0] ] );
		$this->assertSame( 1, $counts[ $roots[1] ] );
		$this->assertSame( 0, $counts[ $roots[2] ] );
		$this->assertSame( array(), OpenStation\Apps\Comments\reply_counts( array() ) );

		$response = $this->dispatch( 'refresh', array( 'tab' => 'all' ) );
		$by_id    = array();
		foreach ( $response['data']['rail']['items'] as $row ) {
			$by_id[ (int) $row['id'] ] = (int) $row['openstation_replies_count'];
		}
		$this->assertSame( 2, $by_id[ $roots[0] ] );
		$this->assertSame( 1, $by_id[ $roots[1] ] );
	}

	public function test_the_post_param_scopes_the_rail_and_a_changed_scope_reopens_it() {
		$here  = $this->comment( self::$post_id, '1' );
		$there = $this->comment( self::$other_post_id, '1' );

		$response = $this->dispatch( 'mount', array(), array(), array( 'post' => self::$post_id ) );
		$this->assertTrue( $response['ok'] );

		$this->assertSame( 'all', $response['state']['tab'] );
		$this->assertSame( self::$post_id, $response['state']['post'] );
		$ids = $this->rail_ids( $response );
		$this->assertContains( $here, $ids );
		$this->assertNotContains( $there, $ids );

		$response = $this->dispatch( 'reopen', $response['state'], array(), array( 'post' => 0 ) );
		$this->assertSame( 0, $response['state']['post'] );
		$this->assertContains( $there, $this->rail_ids( $response ) );
	}

	public function test_reopen_with_an_unchanged_scope_keeps_pages_and_selection() {
		$this->comment( self::$post_id, '1' );
		$state = array(
			'tab'      => 'all',
			'search'   => '',
			'page'     => 3,
			'post'     => 0,
			'selected' => 999,
			'gen'      => 4,
		);
		$response = $this->dispatch( 'reopen', $state, array(), array( 'post' => 0 ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 3, $response['state']['page'] );
		$this->assertSame( 999, $response['state']['selected'] );
		$this->assertSame( 4, $response['state']['gen'] );

		$scoped = $this->dispatch( 'reopen', $state, array(), array( 'post' => self::$post_id ) );
		$this->assertSame( 1, $scoped['state']['page'] );
		$this->assertSame( self::$post_id, $scoped['state']['post'] );
	}

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

		$this->assertSame( $spam, $response['state']['selected'] );
	}

	public function test_mine_and_search_narrow_the_rail() {
		$mine   = $this->comment( self::$post_id, '0', 0, array( 'user_id' => self::$admin_id, 'comment_content' => 'Needle in mine' ) );
		$theirs = $this->comment( self::$post_id, '0', 0, array( 'user_id' => self::$contributor_id, 'comment_content' => 'Needle in theirs' ) );
		$other  = $this->comment( self::$post_id, '1', 0, array( 'user_id' => self::$admin_id, 'comment_content' => 'Hay' ) );

		$response = $this->dispatch( 'filter', array( 'tab' => 'mine' ) );
		$ids      = $this->rail_ids( $response );
		$this->assertContains( $mine, $ids );
		$this->assertContains( $other, $ids, 'Mine spans every status' );
		$this->assertNotContains( $theirs, $ids );

		$response = $this->dispatch( 'filter', array( 'tab' => 'all', 'search' => 'Needle' ) );
		$ids      = $this->rail_ids( $response );
		$this->assertContains( $mine, $ids );
		$this->assertContains( $theirs, $ids );
		$this->assertNotContains( $other, $ids );
	}

	public function test_the_query_args_filter_sets_the_page_size() {
		for ( $i = 0; $i < 3; $i++ ) {
			$this->comment( self::$post_id, '0' );
		}
		$narrow = static function ( array $args ) {
			$args['per_page'] = 2;
			return $args;
		};
		add_filter( 'openstation_comments_window_query_args', $narrow );
		$response = $this->dispatch( 'mount' );
		remove_filter( 'openstation_comments_window_query_args', $narrow );

		$this->assertCount( 2, $response['data']['rail']['items'] );
		$this->assertSame( 2, $response['data']['rail']['perPage'] );
		$this->assertSame( 2, $response['data']['rail']['pages'] );
	}

	public function test_select_serves_the_whole_thread_and_leaves_the_rail_out() {
		$root  = $this->comment( self::$post_id, '1' );
		$reply = $this->comment( self::$post_id, '0', $root );
		$deep  = $this->comment( self::$post_id, 'spam', $reply );

		$response = $this->dispatch( 'select', array( 'tab' => 'all' ), array( 'id' => $root ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( $root, $response['state']['selected'] );
		$this->assertFalse( $response['data']['thread']['truncated'] );
		$thread = array_map( 'intval', wp_list_pluck( $response['data']['thread']['rows'], 'id' ) );

		$this->assertSame( array( $root, $reply, $deep ), $thread );
		$this->assertArrayNotHasKey( 'openstation_replies_count', $response['data']['thread']['rows'][0] );

		$this->assertArrayNotHasKey( 'rail', $response['data'] );
		$this->assertArrayNotHasKey( 'railKey', $response['data'] );
		$this->assertArrayHasKey( 'counts', $response['data'] );
	}

	public function test_load_more_serves_the_next_rail_page_and_leaves_the_thread_out() {
		for ( $i = 0; $i < 3; $i++ ) {
			$this->comment( self::$post_id, '0' );
		}
		$narrow = static function ( array $args ) {
			$args['per_page'] = 2;
			return $args;
		};
		add_filter( 'openstation_comments_window_query_args', $narrow );
		$mounted  = $this->dispatch( 'mount' );
		$response = $this->dispatch( 'page', $mounted['state'], array( 'page' => 2 ) );
		remove_filter( 'openstation_comments_window_query_args', $narrow );

		$this->assertSame( 2, $response['state']['page'] );
		$this->assertSame( 2, $response['data']['rail']['page'] );
		$this->assertCount( 1, $response['data']['rail']['items'] );
		$this->assertSame( $mounted['data']['railKey'], $response['data']['railKey'], 'the accumulation continues' );
		$this->assertArrayNotHasKey( 'thread', $response['data'] );
	}

	public function test_edit_after_load_more_keeps_the_page_and_the_accumulation() {
		$id    = $this->comment( self::$post_id, '1' );
		$state = array(
			'tab'      => 'all',
			'search'   => '',
			'page'     => 2,
			'post'     => 0,
			'selected' => $id,
			'gen'      => 3,
		);
		$response = $this->dispatch( 'edit', $state, array( 'id' => $id, 'content' => 'Rewritten' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 2, $response['state']['page'] );
		$this->assertSame( 3, $response['state']['gen'] );
		$this->assertSame( $id, $response['state']['selected'] );
		$this->assertSame( 'Rewritten', get_comment( $id )->comment_content );
	}

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

		$this->assertNotContains( $pending, $this->rail_ids( $response ) );
	}

	public function test_moderate_skips_what_it_cannot_and_refuses_an_unknown_verb() {
		$pending = $this->comment( self::$post_id, '0' );
		$fired   = array();
		$listener = static function ( $action, $processed, $skipped ) use ( &$fired ) {
			$fired[] = array( $action, $processed, $skipped );
		};
		add_action( 'openstation_comments_window_after_bulk', $listener, 10, 3 );
		$response = $this->dispatch( 'moderate', array(), array( 'ids' => array( $pending, 999999 ), 'action' => 'approve' ) );
		remove_action( 'openstation_comments_window_after_bulk', $listener, 10 );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( array( array( 'approve', array( $pending ), array( 999999 ) ) ), $fired );

		$refused = $this->dispatch( 'moderate', array(), array( 'ids' => array( $pending ), 'action' => 'explode' ) );
		$this->assertFalse( $refused['ok'] );
		$this->assertSame( 'action_failed', $refused['error'] );
	}

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

	public function test_an_author_can_reply_on_their_own_post_but_not_elsewhere() {
		wp_set_current_user( self::$contributor_id );
		$own_post = self::factory()->post->create(
			array(
				'post_status' => 'pending',
				'post_author' => self::$contributor_id,
			)
		);
		$on_own   = $this->comment( $own_post, '1' );
		$on_other = $this->comment( self::$post_id, '1' );

		$manifest = openstation_apps_registry()->get( 'desktop-mode-comments' )->manifest();
		$this->assertFalse( $manifest['config']['canModerate'] );
		$this->assertTrue( $manifest['config']['canEditComments'] );

		$ok = $this->dispatch( 'reply', array(), array( 'parent' => $on_own, 'content' => 'Thank you' ) );
		$this->assertTrue( $ok['ok'] );
		$this->assertCount( 1, get_comments( array( 'parent' => $on_own, 'status' => 'all' ) ) );

		$refused = $this->dispatch( 'reply', array(), array( 'parent' => $on_other, 'content' => 'Nope' ) );
		$this->assertFalse( $refused['ok'] );
		$this->assertCount( 0, get_comments( array( 'parent' => $on_other, 'status' => 'all' ) ) );
	}

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

	public function test_the_bulk_and_counts_routes_still_answer() {
		$pending = $this->comment( self::$post_id, '0' );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/comments/bulk' );
		$request->set_body_params(
			array(
				'ids'    => array( $pending ),
				'action' => 'approve',
			)
		);
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $pending ), $response->get_data()['processed'] );
		$this->assertSame( 'approved', wp_get_comment_status( $pending ) );

		$counts = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/comments/counts' ) );
		$this->assertSame( 200, $counts->get_status() );
		$this->assertGreaterThanOrEqual( 1, $counts->get_data()['approved'] );
		$this->assertSame( array( 'pending', 'approved', 'spam', 'trash', 'total' ), array_keys( $counts->get_data() ) );
	}
}
