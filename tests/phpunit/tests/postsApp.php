<?php
/**
 * Tests for the Posts app — the App Framework port of the native
 * Posts window: the manifest, the capability gates (moved whole from
 * the legacy registration), the query-args filter, and the
 * mount / filter / page / sort / trash dispatch cycle end to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-posts-window
 */
class Tests_OpenStation_PostsApp extends WP_UnitTestCase {

	private $admin_id;
	private $editor_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id     = self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $this->admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_posts_window_user_can_use' );
		remove_all_filters( 'openstation_posts_window_user_can_register' );
		remove_all_filters( 'openstation_posts_window_query_args' );
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	private function app() {
		$app = openstation_apps_registry()->get( 'desktop-mode-posts' );
		$this->assertNotNull( $app );
		return $app;
	}

	private function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-posts',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	// --------------------------------------------------------- manifest

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_registration() {
		$manifest = $this->app()->manifest();
		$this->assertSame( 'Posts', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-post', $manifest['icon'] );
		$this->assertSame( 1100, $manifest['width'] );
		$this->assertSame( 720, $manifest['height'] );
		$this->assertSame( 720, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );
		// The dock tile is WordPress's own Posts entry; the shell's URL
		// remap routes it here.
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( array( 'post' ), $manifest['watch'] );
		$this->assertSame( array( 'filter', 'page', 'sort', 'trash' ), $manifest['actions'] );
		$this->assertSame( array(), $manifest['tabs'], 'The Categories / Tags tabs are in-body canvases, not framework tabs.' );
		$state = $manifest['state'];
		$this->assertSame( 1, $state['page'] );
		$this->assertSame( 20, $state['perPage'] );
		$this->assertSame( '', $state['status'] );
		$this->assertSame( 'date', $state['orderby'] );
		$this->assertSame( 'desc', $state['order'] );
		$this->assertSame( array(), $state['author'] );
		$this->assertSame( array(), $state['tag'] );
	}

	/**
	 * The config extra is resolved for the ACTING user when the
	 * manifest is built, never once at file load.
	 *
	 * @covers \OpenStation\App::manifest
	 */
	public function test_config_carries_the_static_facts_for_the_acting_user() {
		$config = $this->app()->manifest()['config'];
		$this->assertSame( 'posts', $config['mode'] );
		$this->assertStringContainsString( 'post.php', $config['editPostUrlBase'] );
		$this->assertStringContainsString( 'post-new.php', $config['newPostUrl'] );
		// The declared sort travels with the config: the client returns
		// to it when a column sort is cleared.
		$this->assertSame( 'date', $config['defaultOrderby'] );
		$this->assertSame( 'desc', $config['defaultOrder'] );
		$this->assertArrayNotHasKey( 'frontPageId', $config );
		$this->assertArrayNotHasKey( 'currentUserId', $config, 'Nothing reads the acting user id; it is not shipped.' );
		$this->assertArrayNotHasKey( 'defaultPerPage', $config, 'The per-page default is the declared state.' );
	}

	/**
	 * @covers ::openstation_posts_app_config
	 */
	public function test_config_helper_normalises_the_default_order() {
		$this->assertSame( 'asc', openstation_posts_app_config( 'posts', 'title', 'asc' )['defaultOrder'] );
		$this->assertSame( 'desc', openstation_posts_app_config( 'posts', 'title', 'sideways' )['defaultOrder'] );
		$this->assertSame( 'posts', openstation_posts_app_config( 'other' )['mode'] );
	}

	// ------------------------------------------------------------- gate

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_follows_the_register_capability_filter() {
		$app = $this->app();
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		add_filter( 'openstation_posts_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * @covers ::openstation_posts_window_user_can_register
	 */
	public function test_register_gate_is_cap_only() {
		wp_set_current_user( $this->admin_id );
		$this->assertTrue( openstation_posts_window_user_can_register(), 'No opt-in needed: registration is cap-only so the toggle works without an F5.' );
		wp_set_current_user( $this->editor_id );
		$this->assertTrue( openstation_posts_window_user_can_register() );
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( openstation_posts_window_user_can_register() );
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_posts_window_user_can_register() );
	}

	/**
	 * @covers ::openstation_posts_window_user_can_use
	 */
	public function test_use_gate_is_cap_and_opt_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertFalse( openstation_posts_window_user_can_use(), 'Opt-in Beta: closed until the user turns the toggle on.' );
		openstation_save_os_settings( $this->admin_id, array( 'nativePostsEnabled' => true ) );
		$this->assertTrue( openstation_posts_window_user_can_use() );
		openstation_save_os_settings( $this->admin_id, array( 'nativePostsEnabled' => false ) );
		$this->assertFalse( openstation_posts_window_user_can_use() );

		openstation_save_os_settings( $this->subscriber_id, array( 'nativePostsEnabled' => true ) );
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( openstation_posts_window_user_can_use(), 'The toggle alone never unlocks the window without `edit_posts`.' );

		// The explicit id argument is honoured.
		openstation_save_os_settings( $this->editor_id, array( 'nativePostsEnabled' => true ) );
		$this->assertTrue( openstation_posts_window_user_can_use( $this->editor_id ) );
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_posts_window_user_can_use() );
	}

	/**
	 * @covers ::openstation_posts_window_user_can_use
	 */
	public function test_use_gate_filters_can_force_either_way() {
		wp_set_current_user( $this->editor_id );
		openstation_save_os_settings( $this->editor_id, array( 'nativePostsEnabled' => false ) );
		add_filter( 'openstation_posts_window_user_can_use', '__return_true' );
		$this->assertTrue( openstation_posts_window_user_can_use() );
		remove_all_filters( 'openstation_posts_window_user_can_use' );

		openstation_save_os_settings( $this->editor_id, array( 'nativePostsEnabled' => true ) );
		add_filter( 'openstation_posts_window_user_can_use', '__return_false' );
		$this->assertFalse( openstation_posts_window_user_can_use() );
	}

	// ------------------------------------------------------- query args

	/**
	 * @covers ::openstation_posts_window_default_query_args
	 */
	public function test_default_query_args_include_embed_and_fields() {
		$args = openstation_posts_window_default_query_args();
		$this->assertStringContainsString( 'author', $args['_embed'] );
		$this->assertStringContainsString( 'wp:term', $args['_embed'] );
		$this->assertStringContainsString( 'wp:featuredmedia', $args['_embed'] );
		foreach ( array( 'title', 'status', 'date', 'openstation_lock', '_embedded' ) as $field ) {
			$this->assertStringContainsString( $field, $args['_fields'] );
		}
	}

	/**
	 * @covers ::openstation_posts_window_default_query_args
	 */
	public function test_query_args_filter_is_applied() {
		add_filter(
			'openstation_posts_window_query_args',
			static function ( $args ) {
				$args['post_type'] = 'product';
				return $args;
			}
		);
		$args = openstation_posts_window_default_query_args();
		$this->assertSame( 'product', $args['post_type'] );
		$this->assertArrayHasKey( '_embed', $args );
	}

	/**
	 * @covers ::openstation_posts_app_query
	 */
	public function test_query_builder_mirrors_the_legacy_fetch() {
		$state = new OpenStation\App\State(
			openstation_posts_app_state(),
			array(
				'page'    => 3,
				'perPage' => 50,
				'search'  => ' hello ',
				'status'  => '',
				'orderby' => 'title',
				'order'   => 'asc',
				'author'  => array( 1, 0, '7' ),
				'tag'     => array( 4 ),
			)
		);
		$query = openstation_posts_app_query( openstation_posts_window_default_query_args(), $state );
		$this->assertSame( 3, $query['page'] );
		$this->assertSame( 50, $query['per_page'] );
		$this->assertSame( 'hello', $query['search'] );
		// The "All" segment is `status=any`, never core's publish-only default.
		$this->assertSame( 'any', $query['status'] );
		$this->assertSame( 'title', $query['orderby'] );
		$this->assertSame( 'asc', $query['order'] );
		$this->assertSame( array( 1, 7 ), $query['author'] );
		$this->assertSame( array( 4 ), $query['tags'] );
		$this->assertArrayHasKey( '_embed', $query );

		$trash = new OpenStation\App\State( openstation_posts_app_state(), array( 'status' => 'trash' ) );
		$this->assertSame( 'trash', openstation_posts_app_query( array(), $trash )['status'] );
	}

	// --------------------------------------------------------- dispatch

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_serves_the_rows_wp_v2_posts_serves() {
		$post_id = self::factory()->post->create(
			array(
				'post_title'  => 'Alpha memo',
				'post_author' => $this->admin_id,
			)
		);
		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$list = $response['data']['list'];
		$this->assertSame( '', $list['error'] );
		$this->assertSame( 1, $list['page'] );
		$this->assertSame( 20, $list['perPage'] );
		$ids = wp_list_pluck( $list['items'], 'id' );
		$this->assertContains( $post_id, $ids );
		$row = $list['items'][ array_search( $post_id, $ids, true ) ];
		$this->assertSame( 'Alpha memo', $row['title']['rendered'] );
		$this->assertArrayHasKey( 'author', $row['_embedded'], 'The `_embed` side-loads ride the in-process request.' );
		$this->assertArrayHasKey( 'openstation_lock', $row, 'Registered REST fields are projected in.' );
		$this->assertArrayNotHasKey( 'content', $row, '`_fields` is applied.' );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_drafts_are_in_all_and_status_narrows() {
		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$live  = self::factory()->post->create();
		$all   = wp_list_pluck( $this->dispatch( 'refresh' )['data']['list']['items'], 'id' );
		$this->assertContains( $draft, $all );
		$this->assertContains( $live, $all );

		$drafts = $this->dispatch( 'filter', array( 'status' => 'draft', 'page' => 4 ) );
		$this->assertSame( 1, $drafts['state']['page'], '`filter` restarts from page 1.' );
		$ids = wp_list_pluck( $drafts['data']['list']['items'], 'id' );
		$this->assertContains( $draft, $ids );
		$this->assertNotContains( $live, $ids );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_search_and_page_and_sort() {
		self::factory()->post->create_many( 3, array( 'post_title' => 'Beta plan' ) );
		self::factory()->post->create( array( 'post_title' => 'Gamma' ) );

		$searched = $this->dispatch( 'refresh', array( 'search' => 'Beta' ) );
		$this->assertSame( 3, $searched['data']['list']['total'] );

		$paged = $this->dispatch( 'page', array( 'search' => 'Beta', 'perPage' => 2 ), array( 'page' => 2 ) );
		$this->assertSame( 2, $paged['state']['page'] );
		$this->assertSame( 2, $paged['data']['list']['pages'] );
		$this->assertCount( 1, $paged['data']['list']['items'] );

		// Out of range → back to page 1, server-side.
		$beyond = $this->dispatch( 'page', array( 'search' => 'Beta', 'perPage' => 2 ), array( 'page' => 9 ) );
		$this->assertSame( 1, $beyond['state']['page'] );
		$this->assertCount( 2, $beyond['data']['list']['items'] );

		$sorted = $this->dispatch( 'sort', array(), array( 'orderby' => 'title', 'order' => 'ASC' ) );
		$this->assertSame( 'title', $sorted['state']['orderby'] );
		$this->assertSame( 'asc', $sorted['state']['order'] );
		$titles = array_map( static fn( $r ) => $r['title']['rendered'], $sorted['data']['list']['items'] );
		$this->assertSame( 'Beta plan', $titles[0] );
	}

	/**
	 * A column core cannot sort by (a plugin column, a typo) never
	 * reaches `WP_Query`: the sort falls back to the declared default.
	 *
	 * @covers ::openstation_posts_app_sort
	 */
	public function test_sort_only_keeps_an_orderby_it_knows() {
		$bogus = $this->dispatch( 'sort', array( 'orderby' => 'title' ), array( 'orderby' => 'wordCount', 'order' => 'sideways' ) );
		$this->assertTrue( $bogus['ok'] );
		$this->assertSame( 'date', $bogus['state']['orderby'] );
		$this->assertSame( 'desc', $bogus['state']['order'] );
		$this->assertSame( '', $bogus['data']['list']['error'] );

		$state = new OpenStation\App\State( openstation_posts_app_state() );
		openstation_posts_app_sort( $state, array( 'orderby' => 'comment_count', 'order' => 'asc' ), 'menu_order', 'asc' );
		$this->assertSame( 'comment_count', $state->get( 'orderby' ) );
		$this->assertSame( 'asc', $state->get( 'order' ) );
		openstation_posts_app_sort( $state, array( 'orderby' => 'DROP TABLE' ), 'menu_order', 'asc' );
		$this->assertSame( 'menu_order', $state->get( 'orderby' ) );
		$this->assertSame( 'asc', $state->get( 'order' ), 'No direction sent: the declared default direction.' );
		openstation_posts_app_sort( $state, array(), 'date', 'desc' );
		$this->assertSame( 'date', $state->get( 'orderby' ) );
		$this->assertSame( 'desc', $state->get( 'order' ) );
	}

	/**
	 * Only a page past the end lands on page 1; a refusal for any
	 * other reason surfaces as the error it is, on the page asked for.
	 *
	 * @covers ::openstation_posts_app_data
	 */
	public function test_a_refused_query_is_not_retried_on_page_one() {
		self::factory()->post->create_many( 3 );
		// A state key the client never writes but the schema allows: an
		// unknown `orderby` makes the collection refuse the request.
		$response = $this->dispatch( 'refresh', array( 'orderby' => 'bogus', 'page' => 2 ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 2, $response['state']['page'], 'The page stays where the user put it.' );
		$list = $response['data']['list'];
		$this->assertSame( array(), $list['items'] );
		$this->assertNotSame( '', $list['error'] );
		$this->assertSame( 'rest_invalid_param', $list['code'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_empty_result_reports_zero_pages() {
		$response = $this->dispatch( 'refresh', array( 'search' => 'nothing-matches-this' ) );
		$this->assertSame( 0, $response['data']['list']['total'] );
		$this->assertSame( 0, $response['data']['list']['pages'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_trash_trashes_announces_and_skips_trashed_rows() {
		$a       = self::factory()->post->create();
		$b       = self::factory()->post->create();
		$already = self::factory()->post->create( array( 'post_status' => 'trash' ) );

		$response = $this->dispatch( 'trash', array(), array( 'ids' => array( $a, $b, $already, 999999 ) ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'trash', get_post_status( $a ) );
		$this->assertSame( 'trash', get_post_status( $b ) );
		$this->assertSame( 'trash', get_post_status( $already ), 'A row already in the trash is skipped, never deleted for good.' );

		$announce = null;
		foreach ( $response['effects'] as $effect ) {
			if ( 'announce' === $effect['type'] ) {
				$announce = $effect;
			}
		}
		$this->assertNotNull( $announce );
		$this->assertSame( 'post', $announce['contentType'] );
		$this->assertSame( 'trashed', $announce['action'] );
		$this->assertSame( array( $a, $b ), $announce['ids'] );
		// The trashed rows left the recomputed page.
		$ids = wp_list_pluck( $response['data']['list']['items'], 'id' );
		$this->assertNotContains( $a, $ids );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_trash_refuses_what_the_user_cannot_delete_with_a_toast() {
		$post = self::factory()->post->create( array( 'post_author' => $this->admin_id ) );
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		wp_set_current_user( $contributor );
		$response = $this->dispatch( 'trash', array(), array( 'ids' => array( $post ) ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'publish', get_post_status( $post ) );
		$this->assertNotContains( 'announce', wp_list_pluck( $response['effects'], 'type' ) );
		$toast = null;
		foreach ( $response['effects'] as $effect ) {
			if ( 'toast' === $effect['type'] ) {
				$toast = $effect;
			}
		}
		$this->assertNotNull( $toast );
		$this->assertSame( '1 item could not be moved to the trash.', $toast['message'] );

		$other = self::factory()->post->create( array( 'post_author' => $this->admin_id ) );
		$both  = $this->dispatch( 'trash', array(), array( 'ids' => array( $post, $other ) ) );
		$this->assertSame( '2 items could not be moved to the trash.', $both['effects'][0]['message'] );
	}

	// ------------------------------------------------------- terms REST

	/**
	 * @covers ::openstation_posts_window_rest_permission
	 */
	public function test_terms_routes_share_one_named_permission_callback() {
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );
		foreach ( array( '/desktop-mode/v1/term-counts', '/desktop-mode/v1/tag-cooccurrence' ) as $route ) {
			$this->assertArrayHasKey( $route, $routes );
			$this->assertSame( 'openstation_posts_window_rest_permission', $routes[ $route ][0]['permission_callback'] );
		}
		wp_set_current_user( $this->editor_id );
		$this->assertTrue( openstation_posts_window_rest_permission() );
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( openstation_posts_window_rest_permission() );
		$this->assertFalse( function_exists( 'openstation_posts_window_tags_and_filter' ), 'The tags AND-match switch is gone with the flag no client sends.' );
	}
}
