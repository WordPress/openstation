<?php
/**
 * FeedBuddy OpenStation registration tests.
 *
 * @package OpenStationFeedBuddy
 */

if ( ! function_exists( 'feed_buddy_register_surfaces' ) ) {
	require_once dirname( __DIR__, 2 ) . '/desktop-mode-feed-buddy.php';
}

/**
 * Covers the surfaces SOL Inbound Monologue registers with the shell:
 * the native reader window, the buddy-list widget, and the launcher
 * icon that puts the extension in OS Settings → Apps & Icons.
 *
 * @group openstation
 */
class Test_Feed_Buddy_Registration extends WP_UnitTestCase {

	/**
	 * @var int
	 */
	private $user_id;

	public function set_up() {
		parent::set_up();

		if ( ! function_exists( 'open_station_register_window' ) ) {
			$this->markTestSkipped( 'OpenStation is not loaded.' );
		}

		$this->user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $this->user_id );
	}

	public function tear_down() {
		// The registries are module-level statics that outlive a
		// single test. The window and widget ones are keyed by id, so
		// re-registration overwrites rather than duplicates — but the
		// icon leaks into the shared desktop-icons payload every other
		// test in the process reads, so drop it explicitly.
		open_station_unregister_icon( 'feed-buddy-reader' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * The reader window registers, and lands on the dock.
	 */
	public function test_registers_reader_window() {
		feed_buddy_register_surfaces();

		$entry = open_station_native_window_registry( 'feed-buddy-reader' );

		$this->assertIsArray( $entry, 'Reader window should be registered.' );
		$this->assertSame( 'dock', $entry['placement'] );
		$this->assertSame( 'desktop-mode-feed-buddy', $entry['script'] );
		$this->assertSame( 'desktop-mode-feed-buddy', $entry['style'] );
	}

	/**
	 * The buddy-list widget registers movable + resizable — the CSS
	 * that dresses the shell chrome is selected on this exact id, so
	 * a change here is a visual break.
	 */
	public function test_registers_buddy_list_widget() {
		feed_buddy_register_surfaces();

		$entry = open_station_desktop_widget_registry( 'feed-buddy/buddy-list' );

		$this->assertIsArray( $entry, 'Buddy-list widget should be registered.' );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	/**
	 * The launcher icon registers and targets the reader window.
	 *
	 * Without this the extension has no row in OS Settings →
	 * Apps & Icons: that list is built from dock items plus
	 * `open_station_register_icon()` entries, and a docked native
	 * window is neither.
	 */
	public function test_registers_launcher_icon_for_apps_and_icons() {
		feed_buddy_register_surfaces();

		$entry = open_station_desktop_icon_registry( 'feed-buddy-reader' );

		$this->assertIsArray( $entry, 'Launcher icon should be registered.' );
		$this->assertSame( 'feed-buddy-reader', $entry['window'] );
		$this->assertSame( 'dashicons-rss', $entry['icon'] );
		$this->assertSame( '', (string) $entry['url'], 'Icon targets a window, not a URL.' );
	}

	/**
	 * The icon is also reachable through the payload the shell ships
	 * to the browser — the registry alone is not what Apps & Icons
	 * reads.
	 */
	public function test_launcher_icon_reaches_the_desktop_icons_payload() {
		feed_buddy_register_surfaces();

		$ids = wp_list_pluck( open_station_build_desktop_icons_payload(), 'id' );

		$this->assertContains( 'feed-buddy-reader', $ids );
	}

	/**
	 * Logged-out requests register nothing.
	 *
	 * The icon is cleared first because the registry is a static that
	 * survives whichever test in this process ran before this one.
	 */
	public function test_registers_nothing_when_logged_out() {
		open_station_unregister_icon( 'feed-buddy-reader' );
		wp_set_current_user( 0 );

		feed_buddy_register_surfaces();

		$this->assertNull( open_station_desktop_icon_registry( 'feed-buddy-reader' ) );
	}
}
