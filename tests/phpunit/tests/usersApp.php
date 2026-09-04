<?php
/**
 * Tests for the Users app — the App Framework port of the native
 * Users window: the manifest, the gate, the list `data()` over
 * `wp/v2/users` with the page's stats in two grouped queries, the
 * sort, and the bulk-role / bulk-delete / create / email actions end
 * to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group users-app
 */
class Tests_OpenStation_UsersApp extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create(
			array(
				'role'         => 'administrator',
				'display_name' => 'Ada Admin',
			)
		);
		self::$editor_id     = $factory->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Edgar Editor',
			)
		);
		self::$subscriber_id = $factory->user->create(
			array(
				'role'         => 'subscriber',
				'display_name' => 'Sam Subscriber',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		// Super admin on multisite, so `delete_users` / `remove_users`
		// resolve the way a real network admin's do.
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
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
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-users',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	/**
	 * The effects of one type in a response.
	 *
	 * @param array  $response Runtime response.
	 * @param string $type     Effect type.
	 * @return array
	 */
	protected function effects( array $response, $type ) {
		return array_values( wp_list_filter( $response['effects'], array( 'type' => $type ) ) );
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-users' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Users', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-users', $manifest['icon'] );
		$this->assertSame( 1100, $manifest['width'] );
		$this->assertSame( 720, $manifest['height'] );
		$this->assertSame( 720, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );
		// The dock tile is WordPress's own; the URL remap routes it here.
		$this->assertSame( 'none', $manifest['placement'] );
		// A profile saved elsewhere repaints the list.
		$this->assertSame( array( 'user' ), $manifest['watch'] );
		$this->assertSame(
			array( 'filter', 'page', 'sort', 'bulk-role', 'bulk-delete', 'send-reset', 'resend-welcome', 'create' ),
			$manifest['actions']
		);
		$this->assertSame( 1, $manifest['state']['page'] );
		$this->assertSame( 20, $manifest['state']['perPage'] );
		$this->assertSame( 'all', $manifest['state']['tab'] );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_is_list_users_and_follows_the_legacy_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-users' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_users_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_users_window_user_can_register', '__return_false' );

		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( $app->allows( openstation_apps_os() ), 'a viewer without list_users is refused' );
	}

	/**
	 * The facts an admin ships vs. an editor's — the role dropdown
	 * lists only what the viewer can assign.
	 *
	 * @covers ::openstation_users_window_role_label_map
	 */
	public function test_the_facts_follow_the_viewers_capabilities() {
		$app    = openstation_apps_registry()->get( 'desktop-mode-users' );
		$config = $app->manifest()['config'];
		$this->assertSame( self::$admin_id, $config['currentUserId'] );
		$this->assertTrue( $config['canEdit'] );
		$this->assertTrue( $config['canPromote'] );
		$this->assertTrue( $config['canCreate'] );
		$this->assertTrue( $config['canDelete'] );
		$this->assertArrayHasKey( 'administrator', $config['assignableRoles'] );
		$this->assertArrayHasKey( 'subscriber', $config['allRoles'] );
		$this->assertArrayHasKey( '', $config['locales'] );
		$this->assertSame( get_option( 'default_role' ), $config['defaultRole'] );
		$this->assertNotEmpty( $config['colorSchemes'] );
		$this->assertSame( wp_get_user_contact_methods(), $config['contactMethods'] );
		// Both windows read the same memoised facts.
		$this->assertSame( $config, openstation_apps_registry()->get( 'desktop-mode-user-edit' )->manifest()['config'] );

		wp_set_current_user( self::$editor_id );
		$config = $app->manifest()['config'];
		$this->assertFalse( $config['canPromote'] );
		$this->assertFalse( $config['canCreate'] );
		$this->assertSame( array(), $config['assignableRoles'], 'no promote_users → no assignable roles' );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_serves_the_rows_wp_v2_users_serves_with_the_openstation_fields() {
		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$list = $response['data']['list'];
		$this->assertSame( '', $list['error'] );
		$ids = wp_list_pluck( $list['items'], 'id' );
		$this->assertContains( self::$editor_id, $ids );
		$this->assertContains( self::$subscriber_id, $ids );
		$this->assertGreaterThanOrEqual( 3, $list['total'] );

		$row = null;
		foreach ( $list['items'] as $item ) {
			if ( self::$editor_id === (int) $item['id'] ) {
				$row = $item;
			}
		}
		$this->assertNotNull( $row );
		// The `context=edit` fields the columns paint, and the REST
		// fields that are cheap per row.
		$this->assertArrayHasKey( 'email', $row );
		$this->assertSame( array( 'editor' ), $row['roles'] );
		$this->assertArrayHasKey( 'registered_date', $row );
		$this->assertArrayHasKey( 'openstation_last_login', $row );
		$this->assertContains( $row['openstation_presence'], array( 'online', 'inactive', 'offline' ) );
		$this->assertTrue( $row['openstation_can_edit'] );
		// The stats ride in from the grouped page query, not the field.
		$this->assertSame( array( 'posts', 'pages', 'comments' ), array_keys( $row['openstation_user_stats'] ) );
		// A query per row, and the app has both cheaper: not asked for.
		$this->assertArrayNotHasKey( 'openstation_assignable_roles', $row );
		$this->assertArrayNotHasKey( 'url', $row );
		$this->assertArrayNotHasKey( 'description', $row );
	}

	/**
	 * The Content column's numbers: one page of users costs two grouped
	 * queries however many rows, and counts what the per-user REST
	 * field counts (published posts and pages, approved comments).
	 *
	 * @covers ::openstation_users_window_stats_for
	 */
	public function test_the_page_stats_cost_two_queries_however_many_rows() {
		global $wpdb;
		$post = self::factory()->post->create( array( 'post_author' => self::$editor_id ) );
		self::factory()->post->create(
			array(
				'post_author' => self::$editor_id,
				'post_type'   => 'page',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$editor_id,
				'post_status' => 'draft',
			)
		);
		self::factory()->comment->create(
			array(
				'user_id'         => self::$editor_id,
				'comment_post_ID' => $post,
			)
		);
		self::factory()->comment->create(
			array(
				'user_id'          => self::$editor_id,
				'comment_post_ID'  => $post,
				'comment_approved' => '0',
			)
		);

		$before = $wpdb->num_queries;
		$stats  = openstation_users_window_stats_for( array( self::$admin_id, self::$editor_id, self::$subscriber_id ) );
		$this->assertSame( 2, $wpdb->num_queries - $before );
		$this->assertSame(
			array(
				'posts'    => 1,
				'pages'    => 1,
				'comments' => 1,
			),
			$stats[ self::$editor_id ]
		);
		$this->assertSame(
			array(
				'posts'    => 0,
				'pages'    => 0,
				'comments' => 0,
			),
			$stats[ self::$subscriber_id ],
			'every id asked for is answered'
		);
		$this->assertSame( array(), openstation_users_window_stats_for( array() ) );

		// The list carries them under the REST field's name.
		$response = $this->dispatch( 'mount', array( 'search' => 'Edgar Editor' ) );
		$this->assertSame( $stats[ self::$editor_id ], $response['data']['list']['items'][0]['openstation_user_stats'] );
	}

	/**
	 * A column header click: the collection's `orderby` keys only, and
	 * a direction that is one of two.
	 *
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_sort_validates_the_column_and_the_direction() {
		$asc = $this->dispatch(
			'sort',
			array(),
			array(
				'orderby' => 'email',
				'order'   => 'asc',
			)
		);
		$this->assertSame( 'email', $asc['state']['orderby'] );
		$this->assertSame( 'asc', $asc['state']['order'] );
		$desc = $this->dispatch(
			'sort',
			array(),
			array(
				'orderby' => 'email',
				'order'   => 'DESC',
			)
		);
		$this->assertSame( 'desc', $desc['state']['order'] );
		$this->assertSame(
			array_reverse( wp_list_pluck( $asc['data']['list']['items'], 'id' ) ),
			wp_list_pluck( $desc['data']['list']['items'], 'id' ),
			'the same page, the other way round'
		);

		$bogus = $this->dispatch(
			'sort',
			array( 'orderby' => 'email' ),
			array(
				'orderby' => 'user_pass',
				'order'   => 'sideways',
			)
		);
		$this->assertSame( 'name', $bogus['state']['orderby'], 'an unknown column falls back to the name' );
		$this->assertSame( 'asc', $bogus['state']['order'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_search_rides_filter_and_the_page_action_turns_pages() {
		$searched = $this->dispatch( 'filter', array( 'search' => 'Sam Subscriber', 'page' => 3 ) );
		$this->assertSame( 1, $searched['state']['page'], 'a filter change lands on page 1' );
		$ids = wp_list_pluck( $searched['data']['list']['items'], 'id' );
		$this->assertSame( array( self::$subscriber_id ), $ids );

		$first = $this->dispatch( 'page', array( 'perPage' => 1 ), array( 'page' => 1 ) );
		$this->assertSame( 1, $first['state']['page'] );
		$this->assertCount( 1, $first['data']['list']['items'] );
		$this->assertGreaterThanOrEqual( 3, $first['data']['list']['pages'] );

		$second = $this->dispatch( 'page', array( 'perPage' => 1 ), array( 'page' => 2 ) );
		$this->assertSame( 2, $second['state']['page'] );
		$this->assertSame( 2, $second['data']['list']['page'] );
		$this->assertNotSame( $first['data']['list']['items'][0]['id'], $second['data']['list']['items'][0]['id'] );

		// Out of range lands on page 1 rather than an empty table.
		$beyond = $this->dispatch( 'page', array( 'perPage' => 100 ), array( 'page' => 99 ) );
		$this->assertSame( 1, $beyond['state']['page'] );
		$this->assertNotEmpty( $beyond['data']['list']['items'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_bulk_role_promotes_toasts_and_announces() {
		$response = $this->dispatch(
			'bulk-role',
			array(),
			array(
				'ids'  => array( self::$subscriber_id ),
				'role' => 'author',
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertSame( array( 'author' ), get_userdata( self::$subscriber_id )->roles );
		$announce = $this->effects( $response, 'announce' );
		$this->assertCount( 1, $announce );
		$this->assertSame( 'user', $announce[0]['contentType'] );
		$this->assertSame( 'updated', $announce[0]['action'] );
		$this->assertSame( array( self::$subscriber_id ), $announce[0]['ids'] );
		$toasts = $this->effects( $response, 'toast' );
		$this->assertStringContainsString( 'Role updated for 1 user', $toasts[0]['message'] );

		get_userdata( self::$subscriber_id )->set_role( 'subscriber' );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_bulk_role_refuses_a_viewer_without_promote_users() {
		wp_set_current_user( self::$editor_id );
		// The gate refuses an editor at the door; the action re-checks.
		$app = openstation_apps_registry()->get( 'desktop-mode-users' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_users_window_user_can_register', '__return_true' );
		$response = $this->dispatch(
			'bulk-role',
			array(),
			array(
				'ids'  => array( self::$subscriber_id ),
				'role' => 'administrator',
			)
		);
		remove_filter( 'openstation_users_window_user_can_register', '__return_true' );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( array( 'subscriber' ), get_userdata( self::$subscriber_id )->roles );
		$this->assertCount( 0, $this->effects( $response, 'announce' ) );
		$this->assertStringContainsString( 'not allowed', $this->effects( $response, 'toast' )[0]['message'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_bulk_delete_refuses_self_and_deletes_another() {
		$doomed = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		$self = $this->dispatch( 'bulk-delete', array(), array( 'ids' => array( self::$admin_id ) ) );
		$this->assertTrue( $self['ok'] );
		$this->assertInstanceOf( 'WP_User', get_userdata( self::$admin_id ) );
		$this->assertStringContainsString( '0 user(s) deleted', $this->effects( $self, 'toast' )[0]['message'] );

		$response = $this->dispatch( 'bulk-delete', array(), array( 'ids' => array( $doomed ) ) );
		$this->assertTrue( $response['ok'] );
		if ( is_multisite() ) {
			$this->assertFalse( is_user_member_of_blog( $doomed, get_current_blog_id() ) );
		} else {
			$this->assertFalse( get_userdata( $doomed ) );
		}
		$announce = $this->effects( $response, 'announce' );
		$this->assertSame( 'deleted', $announce[0]['action'] );
		$this->assertNotContains( $doomed, wp_list_pluck( $response['data']['list']['items'], 'id' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_create_makes_the_account_fires_the_action_and_returns_to_the_list() {
		$seen = array();
		add_action(
			'openstation_users_window_user_created',
			static function ( $user_id ) use ( &$seen ) {
				$seen[] = $user_id;
			}
		);
		$response = $this->dispatch(
			'create',
			array( 'tab' => 'add-new' ),
			array(
				'values' => array(
					'username'          => 'jane.doe',
					'email'             => 'jane@example.com',
					'first_name'        => 'Jane',
					'role'              => 'editor',
					'send_notification' => false,
				),
			)
		);
		$this->assertTrue( $response['ok'] );
		$user = get_user_by( 'login', 'jane.doe' );
		$this->assertInstanceOf( 'WP_User', $user );
		$this->assertSame( array( 'editor' ), $user->roles );
		$this->assertSame( 'Jane', $user->first_name );
		$this->assertSame( array( (int) $user->ID ), $seen );
		$this->assertSame( 'all', $response['state']['tab'] );
		$this->assertSame( 1, $response['state']['created'] );
		$this->assertSame( '', $response['state']['createError'] );
		$this->assertSame( 'created', $this->effects( $response, 'announce' )[0]['action'] );
		$this->assertContains( (int) $user->ID, wp_list_pluck( $response['data']['list']['items'], 'id' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_create_reports_the_failure_and_the_field_it_names() {
		$existing = get_userdata( self::$editor_id );
		$response = $this->dispatch(
			'create',
			array( 'tab' => 'add-new' ),
			array(
				'values' => array(
					'username' => 'brand-new',
					'email'    => $existing->user_email,
				),
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'email', $response['state']['createField'] );
		$this->assertStringContainsString( 'already in use', $response['state']['createError'] );
		$this->assertSame( 'add-new', $response['state']['tab'], 'a failure keeps the form open' );
		$this->assertFalse( get_user_by( 'login', 'brand-new' ) );
	}

	/**
	 * A role outside the viewer's `editable_roles` is refused, and the
	 * form learns which field to mark.
	 *
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_create_refuses_a_role_the_viewer_cannot_assign_and_names_the_field() {
		$narrow = static function ( $roles ) {
			unset( $roles['administrator'] );
			return $roles;
		};
		add_filter( 'editable_roles', $narrow );
		$response = $this->dispatch(
			'create',
			array( 'tab' => 'add-new' ),
			array(
				'values' => array(
					'username' => 'wannabe',
					'email'    => 'wannabe@example.com',
					'role'     => 'administrator',
				),
			)
		);
		remove_filter( 'editable_roles', $narrow );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'role', $response['state']['createField'] );
		$this->assertStringContainsString( 'not allowed to assign', $response['state']['createError'] );
		$this->assertSame( 'add-new', $response['state']['tab'] );
		$this->assertFalse( get_user_by( 'login', 'wannabe' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_resend_welcome_emails_throttles_and_refuses_a_viewer_without_edit_users() {
		add_filter( 'pre_wp_mail', '__return_true' );
		$first = $this->dispatch( 'resend-welcome', array(), array( 'id' => self::$subscriber_id ) );
		remove_filter( 'pre_wp_mail', '__return_true' );
		$this->assertTrue( $first['ok'] );
		$this->assertStringContainsString( 'Welcome email resent to', $this->effects( $first, 'toast' )[0]['message'] );

		$second = $this->dispatch( 'resend-welcome', array(), array( 'id' => self::$subscriber_id ) );
		$this->assertStringContainsString( 'already sent recently', $this->effects( $second, 'toast' )[0]['message'] );

		wp_set_current_user( self::$editor_id );
		add_filter( 'openstation_users_window_user_can_register', '__return_true' );
		$refused = $this->dispatch( 'resend-welcome', array(), array( 'id' => self::$subscriber_id ) );
		remove_filter( 'openstation_users_window_user_can_register', '__return_true' );
		$this->assertStringContainsString( 'not allowed to email', $this->effects( $refused, 'toast' )[0]['message'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_send_reset_emails_and_throttles() {
		// The test container has no mailer; `retrieve_password()` reports
		// a failed `wp_mail()` as an error, so short-circuit the send.
		add_filter( 'pre_wp_mail', '__return_true' );
		$first = $this->dispatch( 'send-reset', array(), array( 'id' => self::$subscriber_id ) );
		remove_filter( 'pre_wp_mail', '__return_true' );
		$this->assertTrue( $first['ok'] );
		$this->assertStringContainsString( 'Reset email sent to', $this->effects( $first, 'toast' )[0]['message'] );

		$second = $this->dispatch( 'send-reset', array(), array( 'id' => self::$subscriber_id ) );
		$this->assertStringContainsString( 'already sent recently', $this->effects( $second, 'toast' )[0]['message'] );
	}

	/**
	 * The route stays for other consumers, over the same function.
	 *
	 * @covers ::openstation_users_window_rest_bulk_role
	 */
	public function test_the_bulk_role_route_still_answers() {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/users/bulk-role' );
		$request->set_body_params(
			array(
				'ids'  => array( self::$subscriber_id ),
				'role' => 'contributor',
			)
		);
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['results'][ (string) self::$subscriber_id ]['ok'] );
		$this->assertSame( array( 'contributor' ), get_userdata( self::$subscriber_id )->roles );
		get_userdata( self::$subscriber_id )->set_role( 'subscriber' );
	}
}
