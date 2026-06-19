<?php
/**
 * Tests for the "My WordPress" pinned virtual folder.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-my-wordpress
 */
class Tests_DesktopMode_MyWordpress extends WP_UnitTestCase {

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
		remove_all_filters( 'desktop_mode_my_wordpress_user_can_use' );
		remove_all_filters( 'desktop_mode_my_wordpress_window_args' );
		remove_all_filters( 'desktop_mode_my_wordpress_icon_args' );
		remove_all_filters( 'desktop_mode_my_wordpress_entities' );
		parent::tear_down();
	}

	/**
	 * `init` registers both a native window and a pinned desktop icon.
	 *
	 * @covers ::desktop_mode_my_wordpress_register_window
	 */
	public function test_registers_pinned_icon() {
		desktop_mode_my_wordpress_register_window();

		$icon = desktop_mode_desktop_icon_registry( 'desktop-mode-my-wordpress' );
		$this->assertIsArray( $icon );
		$this->assertTrue( $icon['pinned'] );
		$this->assertSame( -1, $icon['position'] );
		$this->assertSame( 'desktop-mode-my-wordpress', $icon['window'] );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_register_window
	 */
	public function test_registers_native_window_with_config() {
		desktop_mode_my_wordpress_register_window();

		$entry = desktop_mode_native_window_registry( 'desktop-mode-my-wordpress' );
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
	 * Default entities are Posts, Pages, and Users; the filter is
	 * the extension point for additional kinds.
	 *
	 * @covers ::desktop_mode_my_wordpress_entities
	 */
	public function test_default_entities_are_posts_pages_and_users() {
		$entities = desktop_mode_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'posts', $ids );
		$this->assertContains( 'pages', $ids );
		$this->assertContains( 'users', $ids );

		// Users entity declares `kind: 'user'` so the bundle picks
		// the user-shaped render path.
		$by_id = array();
		foreach ( $entities as $e ) {
			$by_id[ $e['id'] ] = $e;
		}
		$this->assertSame( 'user', $by_id['users']['kind'] );
		$this->assertSame( 'post', $by_id['posts']['kind'] );
		$this->assertSame( 'post', $by_id['pages']['kind'] );
		$this->assertSame( 'wp/v2/users', $by_id['users']['restPath'] );
	}

	/**
	 * The Agents section ships alongside Posts / Pages / Users / Media
	 * with an inline-SVG data-URI icon (so the shared `renderIcon` path
	 * lights it up without plumbing changes), a `restPath` of
	 * `desktop-mode/v1/agents` (the real REST surface), and a `kind` of
	 * `'agents'`.
	 *
	 * @covers ::desktop_mode_my_wordpress_entities
	 * @covers ::desktop_mode_my_wordpress_agents_icon
	 */
	public function test_agents_entity_ships_with_svg_icon_and_agents_kind() {
		$entities = desktop_mode_my_wordpress_entities();
		$by_id    = array();
		foreach ( $entities as $e ) {
			$by_id[ $e['id'] ] = $e;
		}
		$this->assertArrayHasKey( 'agents', $by_id );
		$agents = $by_id['agents'];
		$this->assertSame( 'agents', $agents['kind'] );
		$this->assertSame( 'desktop-mode/v1/agents', $agents['restPath'] );
		$this->assertStringStartsWith(
			'data:image/svg+xml;base64,',
			$agents['icon']
		);
		$decoded = base64_decode( substr( $agents['icon'], strlen( 'data:image/svg+xml;base64,' ) ), true );
		$this->assertNotFalse( $decoded );
		$this->assertStringContainsString( '<svg', $decoded );
		$this->assertStringContainsString( '</svg>', $decoded );
	}

	/**
	 * The My WordPress window config ships an `agentsConfig` blob that
	 * downstream JS reads to decide whether to paint the soft-gate or
	 * the live Agents UI.
	 *
	 * @covers ::desktop_mode_my_wordpress_register_window
	 * @covers ::desktop_mode_agents_window_config
	 */
	public function test_agents_config_blob_shipped_with_window() {
		desktop_mode_my_wordpress_register_window();
		$entry = desktop_mode_native_window_registry( 'desktop-mode-my-wordpress' );
		$this->assertIsArray( $entry );
		$this->assertArrayHasKey( 'agentsConfig', $entry['config'] );
		$cfg = $entry['config']['agentsConfig'];
		$this->assertArrayHasKey( 'enabled', $cfg );
		$this->assertArrayHasKey( 'gutenbergActive', $cfg );
		$this->assertArrayHasKey( 'restNamespace', $cfg );
		$this->assertSame( 'desktop-mode/v1', $cfg['restNamespace'] );
		$this->assertArrayHasKey( 'enableExperimentNonce', $cfg );
	}

	/**
	 * Plugins must be able to remove the Agents entry through the
	 * standard entities filter — the mock surface is reversible.
	 *
	 * @covers ::desktop_mode_my_wordpress_entities
	 */
	public function test_agents_entity_can_be_removed_via_filter() {
		add_filter( 'desktop_mode_my_wordpress_entities', static function ( $entities ) {
			return array_values( array_filter(
				$entities,
				static function ( $e ) {
					return 'agents' !== $e['id'];
				}
			) );
		} );

		$entities = desktop_mode_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertNotContains( 'agents', $ids );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_entities
	 */
	public function test_entities_filter_can_extend() {
		add_filter( 'desktop_mode_my_wordpress_entities', static function ( $entities ) {
			$entities[] = array(
				'id'       => 'comments',
				'label'    => 'Comments',
				'icon'     => 'dashicons-admin-comments',
				'restPath' => 'wp/v2/comments',
			);
			return $entities;
		} );

		$entities = desktop_mode_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'comments', $ids );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_user_can_use
	 */
	public function test_subscriber_cannot_use_by_default() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( desktop_mode_my_wordpress_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_user_can_use
	 */
	public function test_can_use_filter_overrides_default() {
		wp_set_current_user( self::$subscriber_id );
		add_filter( 'desktop_mode_my_wordpress_user_can_use', '__return_true' );
		$this->assertTrue( desktop_mode_my_wordpress_user_can_use() );
	}

	/**
	 * Window-args filter wins over the defaults.
	 *
	 * @covers ::desktop_mode_my_wordpress_register_window
	 */
	public function test_window_args_filter_can_override_size() {
		add_filter( 'desktop_mode_my_wordpress_window_args', static function ( $args ) {
			$args['width']  = 1280;
			$args['height'] = 800;
			return $args;
		} );

		desktop_mode_my_wordpress_register_window();
		$entry = desktop_mode_native_window_registry( 'desktop-mode-my-wordpress' );
		$this->assertSame( 1280, $entry['width'] );
		$this->assertSame( 800, $entry['height'] );
	}
}
