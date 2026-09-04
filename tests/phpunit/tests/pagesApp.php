<?php
/**
 * Tests for the Pages app — the Posts app's twin over `/wp/v2/pages`:
 * the manifest, the gate, the hierarchical defaults, the pages-only
 * config facts and REST field, and the dispatch cycle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-pages-window
 */
class Tests_OpenStation_PagesApp extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $this->admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_pages_window_user_can_register' );
		remove_all_filters( 'openstation_pages_window_user_can_use' );
		remove_all_filters( 'openstation_pages_window_template_labels' );
		delete_option( 'page_on_front' );
		delete_option( 'page_for_posts' );
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	private function app() {
		$app = openstation_apps_registry()->get( 'desktop-mode-pages' );
		$this->assertNotNull( $app );
		return $app;
	}

	private function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-pages',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_registration() {
		$manifest = $this->app()->manifest();
		$this->assertSame( 'Pages', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-page', $manifest['icon'] );
		$this->assertSame( 1100, $manifest['width'] );
		$this->assertSame( 720, $manifest['height'] );
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( array( 'page' ), $manifest['watch'] );
		$this->assertSame( array( 'filter', 'page', 'sort', 'trash' ), $manifest['actions'] );
		// Pages are usually shallow + ordered by menu_order.
		$this->assertSame( 'menu_order', $manifest['state']['orderby'] );
		$this->assertSame( 'asc', $manifest['state']['order'] );
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_config_carries_the_pages_facts() {
		$front = self::factory()->post->create( array( 'post_type' => 'page' ) );
		update_option( 'page_on_front', $front );
		add_filter(
			'openstation_pages_window_template_labels',
			static function ( $labels ) {
				$labels['page-wide.php'] = 'Wide';
				return $labels;
			}
		);
		$config = $this->app()->manifest()['config'];
		$this->assertSame( 'pages', $config['mode'] );
		$this->assertSame( $front, $config['frontPageId'] );
		$this->assertSame( 0, $config['postsPageId'] );
		$this->assertStringContainsString( 'post_type=page', $config['newPostUrl'] );
		$this->assertSame( 'Default template', $config['pageTemplates'][''] );
		$this->assertSame( 'Wide', $config['pageTemplates']['page-wide.php'] );
		// The declared sort travels with the config.
		$this->assertSame( 'menu_order', $config['defaultOrderby'] );
		$this->assertSame( 'asc', $config['defaultOrder'] );
		$this->assertSame( $config, openstation_pages_app_config(), 'The manifest reads the Pages layer, which wraps the shared facts.' );
	}

	/**
	 * @covers ::openstation_posts_app_sort
	 */
	public function test_sort_falls_back_to_menu_order() {
		$response = $this->dispatch( 'sort', array( 'orderby' => 'title' ), array( 'orderby' => 'wordCount' ) );
		$this->assertSame( 'menu_order', $response['state']['orderby'] );
		$this->assertSame( 'asc', $response['state']['order'] );
		$response = $this->dispatch( 'sort', array(), array( 'orderby' => 'comment_count', 'order' => 'desc' ) );
		$this->assertSame( 'comment_count', $response['state']['orderby'] );
		$this->assertSame( 'desc', $response['state']['order'] );
	}

	/**
	 * @covers \OpenStation\App::allows
	 * @covers ::openstation_pages_window_user_can_register
	 */
	public function test_gate_is_edit_pages_and_filterable() {
		$app = $this->app();
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( $this->admin_id );
		add_filter( 'openstation_pages_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * @covers ::openstation_pages_window_user_can_use
	 */
	public function test_use_gate_is_cap_and_opt_in() {
		$this->assertFalse( openstation_pages_window_user_can_use() );
		openstation_save_os_settings( $this->admin_id, array( 'nativePagesEnabled' => true ) );
		$this->assertTrue( openstation_pages_window_user_can_use() );
	}

	/**
	 * @covers ::openstation_pages_window_default_query_args
	 */
	public function test_default_query_args_carry_the_page_columns() {
		$args = openstation_pages_window_default_query_args();
		$this->assertSame( 'menu_order', $args['orderby'] );
		foreach ( array( 'parent', 'menu_order', 'slug', 'link', 'template', 'openstation_comment_count' ) as $field ) {
			$this->assertStringContainsString( $field, $args['_fields'] );
		}
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_serves_pages_with_parent_template_and_comment_count() {
		$parent = self::factory()->post->create(
			array(
				'post_type'  => 'page',
				'post_title' => 'About',
			)
		);
		$child  = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_title'  => 'Team',
				'post_parent' => $parent,
			)
		);
		self::factory()->comment->create( array( 'comment_post_ID' => $child ) );
		$post = self::factory()->post->create( array( 'post_title' => 'Not a page' ) );

		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$list = $response['data']['list'];
		$ids  = wp_list_pluck( $list['items'], 'id' );
		$this->assertContains( $parent, $ids );
		$this->assertContains( $child, $ids );
		$this->assertNotContains( $post, $ids );
		$row = $list['items'][ array_search( $child, $ids, true ) ];
		$this->assertSame( $parent, $row['parent'] );
		$this->assertSame( '', $row['template'] );
		$this->assertSame( 1, $row['openstation_comment_count'] );
		$this->assertArrayHasKey( 'slug', $row );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_trash_announces_the_page_type() {
		$page     = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$response = $this->dispatch( 'trash', array(), array( 'ids' => array( $page ) ) );
		$this->assertSame( 'trash', get_post_status( $page ) );
		$announce = null;
		foreach ( $response['effects'] as $effect ) {
			if ( 'announce' === $effect['type'] ) {
				$announce = $effect;
			}
		}
		$this->assertNotNull( $announce );
		$this->assertSame( 'page', $announce['contentType'] );
		$this->assertSame( array( $page ), $announce['ids'] );
	}
}
