<?php
/**
 * Tests for the `dock_order` arg on `openstation_register_window()`.
 *
 * Registration order cannot express where a tile belongs on the rail:
 * native-window tiles land whenever their lazy script resolves, so a
 * window registered last in PHP can still be overtaken. `dock_order`
 * is what the shell sorts by, and the payload is how it travels.
 *
 * The default of `0` matters as much as the value: it puts a plugin's
 * launcher AHEAD of the shell's own trailing cluster (Mio 10, Overview
 * 20, System 30, Trash 40), which is where a launcher belongs.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::openstation_register_window
 * @covers ::openstation_build_native_windows_payload
 */
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

	/**
	 * The payload entry for one id, or null.
	 *
	 * @param string $id Window id.
	 * @return array|null
	 */
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
		// The registry stores what it is given; a string from a config
		// array must not reach JS, where `> ` would compare strings.
		$this->register_window( 'os_test_string_order', array( 'dock_order' => '25' ) );

		$entry = $this->payload_for( 'os_test_string_order' );

		$this->assertNotNull( $entry );
		$this->assertSame( 25, $entry['dockOrder'] );
	}

	/**
	 * Trash sits at the end of the rail, after the shell's own cluster.
	 * The value is the whole reason `dock_order` exists, so it is
	 * pinned rather than left to the module that sets it.
	 */
	public function test_the_recycle_bin_sorts_last() {
		$args = apply_filters(
			'openstation_recycle_bin_window_args',
			array( 'dock_order' => 40 )
		);

		$this->assertSame(
			40,
			$args['dock_order'],
			'Trash must sort after System (30) to sit at the end of the dock.'
		);
	}
}
