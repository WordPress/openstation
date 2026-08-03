<?php
/**
 * Tests for the pinned virtual site folder (module slug
 * `my-wordpress`; the window is titled after the site itself).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpress extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_user_can_use' );
		remove_all_filters( 'openstation_my_wordpress_window_args' );
		remove_all_filters( 'openstation_my_wordpress_icon_args' );
		remove_all_filters( 'openstation_my_wordpress_entities' );
		remove_all_filters( 'openstation_site_title' );
		parent::tear_down();
	}

	/**
	 * `init` registers both a native window and a pinned desktop icon.
	 *
	 * @covers ::openstation_my_wordpress_register_window
	 */
	public function test_registers_pinned_icon() {
		openstation_my_wordpress_register_window();

		$icon = openstation_desktop_icon_registry( 'desktop-mode-my-wordpress' );
		$this->assertIsArray( $icon );
		$this->assertTrue( $icon['pinned'] );
		$this->assertSame( -1, $icon['position'] );
		$this->assertSame( 'desktop-mode-my-wordpress', $icon['window'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_register_window
	 */
	public function test_registers_native_window_with_config() {
		openstation_my_wordpress_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-my-wordpress' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'desktop-mode-my-wordpress', $entry['script'] );
		$this->assertArrayHasKey( 'config', $entry );
		$this->assertArrayHasKey( 'restRoot', $entry['config'] );
		$this->assertArrayHasKey( 'restNonce', $entry['config'] );
		$this->assertArrayHasKey( 'editPostUrlBase', $entry['config'] );
		$this->assertArrayHasKey( 'editUserUrlBase', $entry['config'] );
		$this->assertSame( 'none', $entry['placement'] );
	}

	/**
	 * The folder is named after the site, not after the software
	 * running it — the window title, the pinned icon, and the
	 * `siteName` config the bundle uses for its breadcrumb root all
	 * come from `openstation_site_title()`.
	 *
	 * @covers ::openstation_my_wordpress_register_window
	 */
	public function test_window_and_icon_are_titled_after_the_site() {
		$original = get_option( 'blogname' );
		update_option( 'blogname', "Izzi's Gym" );

		openstation_my_wordpress_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-my-wordpress' );
		$icon  = openstation_desktop_icon_registry( 'desktop-mode-my-wordpress' );

		update_option( 'blogname', $original );

		$this->assertSame( "Izzi's Gym", $entry['title'] );
		$this->assertSame( "Izzi's Gym", $entry['config']['siteName'] );
		$this->assertSame( "Izzi's Gym", $icon['title'] );
	}

	/**
	 * Retitling via `openstation_site_title` reaches the window, the
	 * icon, and the bundle config in one hook.
	 *
	 * @covers ::openstation_my_wordpress_register_window
	 */
	public function test_site_title_filter_retitles_the_folder() {
		add_filter(
			'openstation_site_title',
			static function () {
				return 'Workspace';
			}
		);

		openstation_my_wordpress_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-my-wordpress' );
		$icon  = openstation_desktop_icon_registry( 'desktop-mode-my-wordpress' );

		$this->assertSame( 'Workspace', $entry['title'] );
		$this->assertSame( 'Workspace', $entry['config']['siteName'] );
		$this->assertSame( 'Workspace', $icon['title'] );
	}

	/**
	 * Default entities are Posts, Pages, and Users; the filter is
	 * the extension point for additional kinds.
	 *
	 * @covers ::openstation_my_wordpress_entities
	 */
	public function test_default_entities_are_posts_pages_and_users() {
		$entities = openstation_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'posts', $ids );
		$this->assertContains( 'pages', $ids );
		$this->assertContains( 'users', $ids );
		$this->assertContains( 'media', $ids );

		// Users entity declares `kind: 'user'` so the bundle picks
		// the user-shaped render path.
		$by_id = array();
		foreach ( $entities as $e ) {
			$by_id[ $e['id'] ] = $e;
		}
		$this->assertSame( 'user', $by_id['users']['kind'] );
		$this->assertSame( 'post', $by_id['posts']['kind'] );
		$this->assertSame( 'post', $by_id['pages']['kind'] );
		$this->assertSame( 'media', $by_id['media']['kind'] );
		$this->assertSame( 'wp/v2/users', $by_id['users']['restPath'] );

		// Post type mapping for cross-window sync
		$this->assertSame( 'post', $by_id['posts']['post_type'] );
		$this->assertSame( 'page', $by_id['pages']['post_type'] );
		$this->assertSame( 'attachment', $by_id['media']['post_type'] );
		$this->assertArrayNotHasKey( 'post_type', $by_id['users'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_entities
	 */
	public function test_entities_filter_can_extend() {
		add_filter( 'openstation_my_wordpress_entities', static function ( $entities ) {
			$entities[] = array(
				'id'       => 'comments',
				'label'    => 'Comments',
				'icon'     => 'dashicons-admin-comments',
				'restPath' => 'wp/v2/comments',
			);
			return $entities;
		} );

		$entities = openstation_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'comments', $ids );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_can_use
	 */
	public function test_subscriber_cannot_use_by_default() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( openstation_my_wordpress_user_can_use() );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_can_use
	 */
	public function test_can_use_filter_overrides_default() {
		wp_set_current_user( self::$subscriber_id );
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_true' );
		$this->assertTrue( openstation_my_wordpress_user_can_use() );
	}

	/**
	 * Window-args filter wins over the defaults.
	 *
	 * @covers ::openstation_my_wordpress_register_window
	 */
	public function test_window_args_filter_can_override_size() {
		add_filter( 'openstation_my_wordpress_window_args', static function ( $args ) {
			$args['width']  = 1280;
			$args['height'] = 800;
			return $args;
		} );

		openstation_my_wordpress_register_window();
		$entry = openstation_native_window_registry( 'desktop-mode-my-wordpress' );
		$this->assertSame( 1280, $entry['width'] );
		$this->assertSame( 800, $entry['height'] );
	}
}
