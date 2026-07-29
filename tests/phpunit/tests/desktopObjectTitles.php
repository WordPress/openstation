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
	 * Both the window and the desktop icon paint the custom cork
	 * board SVG. `desktop_mode_register_icon()` converts `icon_svg`
	 * into the same base64 data URI the window is handed directly, so
	 * the two surfaces must end up byte-identical — a drift here
	 * means the title bar and the wallpaper tile show different art.
	 *
	 * @covers ::desktop_mode_content_graph_register_window
	 * @covers ::desktop_mode_content_graph_icon_svg
	 */
	public function test_content_graph_uses_the_corkboard_svg() {
		desktop_mode_content_graph_register_window();

		$entry    = desktop_mode_native_window_registry( 'desktop-mode-content-graph' );
		$icon     = desktop_mode_desktop_icon_registry( 'desktop-mode-content-graph' );
		$expected = 'data:image/svg+xml;base64,'
			. base64_encode( desktop_mode_content_graph_icon_svg() );

		$this->assertSame( $expected, $entry['icon'] );
		$this->assertSame( $expected, $icon['icon'] );
	}

	/**
	 * The renderer only accepts `data:image/svg+xml;base64,` with a
	 * clean base64 payload — anything else silently degrades to the
	 * letter-badge fallback instead of painting the art.
	 *
	 * @covers ::desktop_mode_content_graph_icon_svg
	 */
	public function test_corkboard_svg_survives_the_icon_sanitizer() {
		$uri = 'data:image/svg+xml;base64,'
			. base64_encode( desktop_mode_content_graph_icon_svg() );

		$this->assertSame( $uri, desktop_mode_sanitize_dock_icon( $uri ) );
	}

	/**
	 * The art is a silhouette: every painted element is drawn in
	 * `currentColor`, which is what makes `renderIcon()` paint it as a
	 * mask and take the surface's text colour. A stray literal colour
	 * would survive the mask's alpha-only pass as a hole, so the
	 * absence of `fill="#…"` is load-bearing, not cosmetic.
	 *
	 * @covers ::desktop_mode_content_graph_icon_svg
	 */
	public function test_corkboard_svg_is_drawn_entirely_in_current_color() {
		$svg = desktop_mode_content_graph_icon_svg();

		$this->assertStringStartsWith( '<svg', $svg );
		$this->assertStringContainsString( 'viewBox="0 0 64 64"', $svg );
		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertDoesNotMatchRegularExpression( '/(fill|stroke)="#/', $svg );
	}

	/**
	 * The pins are the cue that separates a pinboard from a picture
	 * frame, and they are the first thing to vanish when the icon is
	 * painted at 20px in the dock. Guard the count and radius so a
	 * future tidy-up doesn't shrink them into nothing.
	 *
	 * @covers ::desktop_mode_content_graph_icon_svg
	 */
	public function test_corkboard_svg_keeps_its_pins_legible() {
		$svg = desktop_mode_content_graph_icon_svg();

		$this->assertSame( 2, substr_count( $svg, 'r="3"' ) );
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
