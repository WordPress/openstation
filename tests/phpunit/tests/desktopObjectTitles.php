<?php
/**
 * Tests for the titles the desktop puts on its built-in objects.
 *
 * A desktop holds objects, not a mention of the OS you're already
 * standing in, and not the name of the data structure behind a view.
 * So: the site's folder is titled after the site, deleted things go to
 * the Trash (WordPress's own vocabulary), and the link map is a
 * Corkboard. Module slugs, window ids, and hook names keep their
 * original spelling — those are the plugin API and must not move.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-titles
 */
class Tests_DesktopMode_DesktopObjectTitles extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_site_title' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_recycle_bin_register_window
	 */
	public function test_recycle_bin_window_and_icon_are_titled_trash() {
		desktop_mode_recycle_bin_register_window();

		$entry = desktop_mode_native_window_registry( 'desktop-mode-recycle-bin' );
		$icon  = desktop_mode_desktop_icon_registry( 'desktop-mode-recycle-bin' );

		$this->assertSame( 'Trash', $entry['title'] );
		$this->assertSame( 'Trash', $icon['title'] );
	}

	/**
	 * The window id stays `desktop-mode-recycle-bin` — plugins bind
	 * to it, and a retitle is not a re-slug.
	 *
	 * @covers ::desktop_mode_recycle_bin_register_window
	 */
	public function test_recycle_bin_keeps_its_window_id() {
		desktop_mode_recycle_bin_register_window();

		$this->assertIsArray(
			desktop_mode_native_window_registry( 'desktop-mode-recycle-bin' )
		);
	}

	/**
	 * @covers ::desktop_mode_content_graph_register_window
	 */
	public function test_content_graph_window_and_icon_are_titled_corkboard() {
		desktop_mode_content_graph_register_window();

		$entry = desktop_mode_native_window_registry( 'desktop-mode-content-graph' );
		$icon  = desktop_mode_desktop_icon_registry( 'desktop-mode-content-graph' );

		$this->assertSame( 'Corkboard', $entry['title'] );
		$this->assertSame( 'Corkboard', $icon['title'] );
	}

	/**
	 * The Corkboard shows an index card — the object a corkboard
	 * holds. The pushpin belongs to Posts, and a node-graph glyph
	 * would depict the data structure instead of the desk object.
	 *
	 * @covers ::desktop_mode_content_graph_register_window
	 */
	public function test_content_graph_uses_the_index_card_icon() {
		desktop_mode_content_graph_register_window();

		$entry = desktop_mode_native_window_registry( 'desktop-mode-content-graph' );
		$icon  = desktop_mode_desktop_icon_registry( 'desktop-mode-content-graph' );

		$this->assertSame( 'dashicons-index-card', $entry['icon'] );
		$this->assertSame( 'dashicons-index-card', $icon['icon'] );

		// Posts keeps the pushpin — the two must not collide in the
		// dock or the wallpaper grid.
		$this->assertNotSame( 'dashicons-admin-post', $icon['icon'] );
	}

	/**
	 * The Corkboard's detail panel offers "Open in <site>", so its
	 * bundle needs the site title too.
	 *
	 * @covers ::desktop_mode_content_graph_register_window
	 */
	public function test_content_graph_config_carries_the_site_title() {
		add_filter(
			'desktop_mode_site_title',
			static function () {
				return "Izzi's Gym";
			}
		);

		desktop_mode_content_graph_register_window();

		$entry = desktop_mode_native_window_registry( 'desktop-mode-content-graph' );

		$this->assertSame( "Izzi's Gym", $entry['config']['siteName'] );
	}

	/**
	 * @covers ::desktop_mode_content_graph_register_window
	 */
	public function test_content_graph_keeps_its_window_id() {
		desktop_mode_content_graph_register_window();

		$this->assertIsArray(
			desktop_mode_native_window_registry( 'desktop-mode-content-graph' )
		);
	}
}
