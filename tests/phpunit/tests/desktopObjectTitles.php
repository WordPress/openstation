<?php
/**
 * Tests for the titles the desktop puts on its built-in objects.
 *
 * A desktop holds objects, not a mention of the OS you're already
 * standing in, and not the name of the data structure behind a view.
 * So: the file explorer is WP Explorer, its root folder is named after
 * the site, deleted things go to the Trash (WordPress's own
 * vocabulary), and the link map is a Corkboard. Module slugs, window
 * ids, and hook names keep their original spelling — those are the
 * plugin API and must not move.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-titles
 */
class Tests_OpenStation_DesktopObjectTitles extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_site_title' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_recycle_bin_register_window
	 */
	public function test_recycle_bin_window_is_titled_trash() {
		openstation_recycle_bin_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$this->assertSame( 'Trash', $entry['title'] );
	}

	/**
	 * The bin is a dock tile and nothing else — a desktop icon is
	 * something the user put there, not something the shell hands out.
	 *
	 * @covers ::openstation_recycle_bin_register_window
	 */
	public function test_recycle_bin_registers_no_desktop_icon() {
		// The registry is a process-static store, and the plugin's own
		// `init` has already run by the time the suite starts.
		openstation_unregister_icon( 'desktop-mode-recycle-bin' );

		openstation_recycle_bin_register_window();

		$this->assertNull(
			openstation_desktop_icon_registry( 'desktop-mode-recycle-bin' )
		);
	}

	/**
	 * Losing the icon would leave the tile with no control at all, so
	 * the window opts into the Apps & Plugins list on its own.
	 *
	 * @covers ::openstation_recycle_bin_register_window
	 */
	public function test_recycle_bin_tile_is_placeable() {
		openstation_recycle_bin_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$this->assertTrue( $entry['placeable'] );
	}

	/**
	 * The window id stays `desktop-mode-recycle-bin` — plugins bind
	 * to it, and a retitle is not a re-slug.
	 *
	 * @covers ::openstation_recycle_bin_register_window
	 */
	public function test_recycle_bin_keeps_its_window_id() {
		openstation_recycle_bin_register_window();

		$this->assertIsArray(
			openstation_native_window_registry( 'desktop-mode-recycle-bin' )
		);
	}

	/**
	 * @covers ::openstation_content_graph_register_window
	 */
	public function test_content_graph_window_and_icon_are_titled_corkboard() {
		openstation_content_graph_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-content-graph' );
		$icon  = openstation_desktop_icon_registry( 'desktop-mode-content-graph' );

		$this->assertSame( 'Corkboard', $entry['title'] );
		$this->assertSame( 'Corkboard', $icon['title'] );
	}

	/**
	 * Both the window and the desktop icon paint the custom cork
	 * board SVG. `openstation_register_icon()` converts `icon_svg`
	 * into the same base64 data URI the window is handed directly, so
	 * the two surfaces must end up byte-identical — a drift here
	 * means the title bar and the wallpaper tile show different art.
	 *
	 * @covers ::openstation_content_graph_register_window
	 * @covers ::openstation_content_graph_icon_svg
	 */
	public function test_content_graph_uses_the_corkboard_svg() {
		openstation_content_graph_register_window();

		$entry    = openstation_native_window_registry( 'desktop-mode-content-graph' );
		$icon     = openstation_desktop_icon_registry( 'desktop-mode-content-graph' );
		$expected = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_content_graph_icon_svg() );

		$this->assertSame( $expected, $entry['icon'] );
		$this->assertSame( $expected, $icon['icon'] );
	}

	/**
	 * The renderer only accepts `data:image/svg+xml;base64,` with a
	 * clean base64 payload — anything else silently degrades to the
	 * letter-badge fallback instead of painting the art.
	 *
	 * @covers ::openstation_content_graph_icon_svg
	 */
	public function test_corkboard_svg_survives_the_icon_sanitizer() {
		$uri = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_content_graph_icon_svg() );

		$this->assertSame( $uri, openstation_sanitize_dock_icon( $uri ) );
	}

	/**
	 * The art is a silhouette: every painted element is drawn in
	 * `currentColor`, which is what makes `renderIcon()` paint it as a
	 * mask and take the surface's text colour. A stray literal colour
	 * would survive the mask's alpha-only pass as a hole, so the
	 * absence of `fill="#…"` is load-bearing, not cosmetic.
	 *
	 * @covers ::openstation_content_graph_icon_svg
	 */
	public function test_corkboard_svg_is_drawn_entirely_in_current_color() {
		$svg = openstation_content_graph_icon_svg();

		$this->assertStringStartsWith( '<svg', $svg );
		$this->assertStringContainsString( 'viewBox="0 0 64 64"', $svg );
		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertDoesNotMatchRegularExpression( '/(fill|stroke)="#/', $svg );
	}

	/**
	 * The nodes are the mark. They are also the first thing to vanish
	 * when the icon is painted at 20px in the dock, where the 64-unit
	 * grid is scaled by 0.3125 and a radius of 5 becomes a disc barely
	 * three pixels across. Guard the floor so a future tidy-up doesn't
	 * shrink them into nothing.
	 *
	 * This replaces a guard on the two `r="3"` pin heads the icon used
	 * to carry. The pins are gone (a pin-led mark points at pinned
	 * notes, not at this window), but the property they were protecting
	 * is the same one, so it is asserted against the discs instead.
	 *
	 * @covers ::openstation_content_graph_icon_svg
	 */
	public function test_corkboard_svg_keeps_its_nodes_legible() {
		$svg = openstation_content_graph_icon_svg();

		preg_match_all( '/r="([0-9.]+)"/', $svg, $matches );
		$radii = array_map( 'floatval', $matches[1] );

		// One hub plus three satellites.
		$this->assertCount( 4, $radii );

		// Nothing below the 20px legibility floor.
		$this->assertGreaterThanOrEqual( 5.0, min( $radii ) );

		// The hub reads as the focused post only while it is strictly
		// the largest thing on the canvas; discs tied for largest read
		// as a mesh instead. Popping the top off a sorted list rather
		// than diffing on the max, so a tie fails here instead of
		// being quietly filtered away.
		sort( $radii );
		$hub = array_pop( $radii );
		$this->assertGreaterThan( max( $radii ), $hub );
	}

	/**
	 * Every icon the shell ships is a silhouette, so none of them may
	 * carry a literal colour. The Games gamepad was the last holdout:
	 * fixed colours cannot invert on a light surface, and under a
	 * desktop theme's icon tint `applyIconMask()` keeps only the alpha,
	 * which flattened the old art to a featureless blob.
	 *
	 * @covers ::openstation_games_icon_svg
	 * @covers ::openstation_recycle_bin_icon_svg
	 * @covers ::openstation_my_wordpress_icon_svg
	 */
	public function test_built_in_app_icons_are_all_silhouettes() {
		$icons = array(
			'games'        => openstation_games_icon_svg(),
			'recycle-bin'  => openstation_recycle_bin_icon_svg(),
			'my-wordpress' => openstation_my_wordpress_icon_svg(),
			'corkboard'    => openstation_content_graph_icon_svg(),
		);

		foreach ( $icons as $name => $svg ) {
			$this->assertStringStartsWith( '<svg', $svg, $name );
			$this->assertStringContainsString( 'viewBox="0 0 64 64"', $svg, $name );
			$this->assertStringContainsString( 'currentColor', $svg, $name );
			$this->assertDoesNotMatchRegularExpression( '/(fill|stroke)="#/', $svg, $name );

			// The sanitizer returns the URI untouched when it accepts it,
			// and a dashicon fallback when it does not.
			$uri = 'data:image/svg+xml;base64,' . base64_encode( $svg );
			$this->assertSame( $uri, openstation_sanitize_dock_icon( $uri ), $name );
		}
	}

	/**
	 * The bin ships its own art rather than falling back to
	 * `dashicons-trash`, and the title bar and the dock tile read it
	 * from the same place: a window whose title bar disagrees with its
	 * tile reads as two apps.
	 *
	 * @covers ::openstation_recycle_bin_register_window
	 */
	public function test_recycle_bin_uses_its_own_svg() {
		openstation_recycle_bin_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-recycle-bin' );

		$expected = 'data:image/svg+xml;base64,'
			. base64_encode( openstation_recycle_bin_icon_svg() );

		$this->assertSame( $expected, $entry['icon'] );
	}

	/**
	 * The Corkboard's detail panel offers "Open in <site>", so its
	 * bundle needs the site title too.
	 *
	 * @covers ::openstation_content_graph_register_window
	 */
	public function test_content_graph_config_carries_the_site_title() {
		add_filter(
			'openstation_site_title',
			static function () {
				return "Izzi's Gym";
			}
		);

		openstation_content_graph_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-content-graph' );

		$this->assertSame( "Izzi's Gym", $entry['config']['siteName'] );
	}

	/**
	 * @covers ::openstation_content_graph_register_window
	 */
	public function test_content_graph_keeps_its_window_id() {
		openstation_content_graph_register_window();

		$this->assertIsArray(
			openstation_native_window_registry( 'desktop-mode-content-graph' )
		);
	}
}
