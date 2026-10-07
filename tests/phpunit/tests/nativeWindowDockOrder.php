<?php

class Tests_OpenStation_NativeWindowDockOrder extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function register_window( $id, $args = array() ) {
		return openstation_register_window(
			$id,
			array_merge(
				array(
					'title'    => 'Demo',
					'icon'     => 'dashicons-star-filled',
					'template' => static function () {
						echo '<div></div>';
					},
				),
				$args
			)
		);
	}

	private function payload_for( $id ) {
		foreach ( openstation_build_native_windows_payload() as $entry ) {
			if ( $entry['id'] === $id ) {
				return $entry;
			}
		}
		return null;
	}

	public function test_dock_order_defaults_to_zero() {
		$this->register_window( 'os_test_default_order' );

		$entry = $this->payload_for( 'os_test_default_order' );

		$this->assertNotNull( $entry );
		$this->assertSame( 0, $entry['dockOrder'] );
	}

	public function test_dock_order_reaches_the_payload() {
		$this->register_window( 'os_test_ordered', array( 'dock_order' => 40 ) );

		$entry = $this->payload_for( 'os_test_ordered' );

		$this->assertNotNull( $entry );
		$this->assertSame( 40, $entry['dockOrder'] );
	}

	public function test_dock_order_is_cast_to_int() {

		$this->register_window( 'os_test_string_order', array( 'dock_order' => '25' ) );

		$entry = $this->payload_for( 'os_test_string_order' );

		$this->assertNotNull( $entry );
		$this->assertSame( 25, $entry['dockOrder'] );
	}

	public function test_the_recycle_bin_sorts_last() {
		$app = openstation_apps_registry()->get( 'desktop-mode-recycle-bin' );
		$this->assertNotNull( $app );

		$this->assertSame(
			40,
			$app->manifest()['dock_order'],
			'Trash must sort after System (30) to sit at the end of the dock.'
		);
	}
}
