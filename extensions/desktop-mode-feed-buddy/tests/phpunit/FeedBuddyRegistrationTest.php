<?php

if ( ! function_exists( 'feed_buddy_register_surfaces' ) ) {
	require_once dirname( __DIR__, 2 ) . '/desktop-mode-feed-buddy.php';
}

class Test_Feed_Buddy_Registration extends WP_UnitTestCase {

	private $user_id;

	public function set_up() {
		parent::set_up();

		if ( ! function_exists( 'openstation_register_window' ) ) {
			$this->markTestSkipped( 'OpenStation is not loaded.' );
		}

		$this->user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $this->user_id );
	}

	public function tear_down() {

		openstation_unregister_icon( 'feed-buddy-reader' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_registers_reader_window() {
		feed_buddy_register_surfaces();

		$entry = openstation_native_window_registry( 'feed-buddy-reader' );

		$this->assertIsArray( $entry, 'Reader window should be registered.' );
		$this->assertSame( 'dock', $entry['placement'] );
		$this->assertSame( 'desktop-mode-feed-buddy', $entry['script'] );
		$this->assertSame( 'desktop-mode-feed-buddy', $entry['style'] );
	}

	public function test_registers_buddy_list_widget() {
		feed_buddy_register_surfaces();

		$entry = openstation_desktop_widget_registry( 'feed-buddy/buddy-list' );

		$this->assertIsArray( $entry, 'Buddy-list widget should be registered.' );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	public function test_registers_launcher_icon_for_apps_and_icons() {
		feed_buddy_register_surfaces();

		$entry = openstation_desktop_icon_registry( 'feed-buddy-reader' );

		$this->assertIsArray( $entry, 'Launcher icon should be registered.' );
		$this->assertSame( 'feed-buddy-reader', $entry['window'] );
		$this->assertSame( 'dashicons-rss', $entry['icon'] );
		$this->assertSame( '', (string) $entry['url'], 'Icon targets a window, not a URL.' );
	}

	public function test_launcher_icon_reaches_the_desktop_icons_payload() {
		feed_buddy_register_surfaces();

		$ids = wp_list_pluck( openstation_build_desktop_icons_payload(), 'id' );

		$this->assertContains( 'feed-buddy-reader', $ids );
	}

	public function test_registers_nothing_when_logged_out() {
		openstation_unregister_icon( 'feed-buddy-reader' );
		wp_set_current_user( 0 );

		feed_buddy_register_surfaces();

		$this->assertNull( openstation_desktop_icon_registry( 'feed-buddy-reader' ) );
	}
}
