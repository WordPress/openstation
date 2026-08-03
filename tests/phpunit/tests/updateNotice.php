<?php
/**
 * Tests for the core-update descriptor + the in-window nag suppressor.
 *
 * Release art + codename are resolved on the client now, so PHP only
 * reports the update relationship: `{ version, branch, url, crossing }`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-update-notice
 */
class Tests_OpenStation_UpdateNotice extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		delete_site_transient( 'update_core' );
	}

	public function tear_down() {
		delete_site_transient( 'update_core' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['open_station_chromeless'] );
		remove_all_filters( 'open_station_show_core_update_notice' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_get_core_update
	 */
	public function test_returns_null_without_update() {
		wp_set_current_user( self::$admin_id );
		// No transient (cleared in set_up) → response is 'latest'.
		$this->assertNull( open_station_get_core_update() );
	}

	/**
	 * @covers ::open_station_get_core_update
	 */
	public function test_returns_null_without_capability() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->fake_core_update( '9.9.9' );
		$this->assertNull( open_station_get_core_update() );
	}

	/**
	 * @covers ::open_station_get_core_update
	 */
	public function test_descriptor_shape() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '99.9' );

		$update = open_station_get_core_update();
		$this->assertIsArray( $update );
		$this->assertArrayHasKey( 'version', $update );
		$this->assertArrayHasKey( 'available', $update );
		$this->assertArrayHasKey( 'branch', $update );
		$this->assertArrayHasKey( 'crossing', $update );
		$this->assertStringContainsString( 'update-core.php', $update['url'] );
	}

	/**
	 * @covers ::open_station_is_major_update
	 */
	public function test_major_update_detection() {
		$this->assertTrue( open_station_is_major_update( '6.9.2', '7.0' ) );
		$this->assertTrue( open_station_is_major_update( '6.8', '6.9' ) );
		$this->assertFalse( open_station_is_major_update( '7.0', '7.0.2' ) );
		$this->assertFalse( open_station_is_major_update( '7.0', '7.0' ) );
	}

	/**
	 * Crossing into a new major (installed 7.0.x → 8.0.1) reports the
	 * major branch as the display version and flags `crossing`.
	 *
	 * @covers ::open_station_get_core_update
	 */
	public function test_crossing_major() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '8.0.1' );

		$update = open_station_get_core_update();
		$this->assertSame( '8.0', $update['version'] );      // display = branch
		$this->assertSame( '8.0.1', $update['available'] );  // exact, for dismissal
		$this->assertSame( '8.0', $update['branch'] );
		$this->assertTrue( $update['crossing'] );
	}

	/**
	 * A same-branch minor (7.0.x → 7.0.2) reports the exact version and
	 * is not crossing.
	 *
	 * @covers ::open_station_get_core_update
	 */
	public function test_same_branch_minor() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '7.0.2' );

		$update = open_station_get_core_update();
		$this->assertSame( '7.0.2', $update['version'] );
		$this->assertSame( '7.0.2', $update['available'] );
		$this->assertSame( '7.0', $update['branch'] );
		$this->assertFalse( $update['crossing'] );
	}

	/**
	 * @covers ::open_station_get_core_update
	 */
	public function test_notice_filter_can_suppress() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter( 'open_station_show_core_update_notice', '__return_false' );

		$this->assertNull( open_station_get_core_update() );
	}

	/**
	 * The chromeless suppressor detaches core's per-window update /
	 * maintenance nags so they don't repeat inside every window.
	 *
	 * @covers ::open_station_chromeless_suppress_update_nags
	 */
	public function test_suppressor_removes_nags_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		add_action( 'admin_notices', 'update_nag', 3 );
		add_action( 'network_admin_notices', 'update_nag', 3 );
		add_action( 'admin_notices', 'maintenance_nag', 10 );

		open_station_chromeless_suppress_update_nags();

		$this->assertFalse( has_action( 'admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'network_admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'maintenance_nag' ) );
	}

	/**
	 * Outside a chromeless request the nags are left in place.
	 *
	 * @covers ::open_station_chromeless_suppress_update_nags
	 */
	public function test_suppressor_leaves_nags_when_not_chromeless() {
		wp_set_current_user( self::$admin_id );
		add_action( 'admin_notices', 'update_nag', 3 );

		open_station_chromeless_suppress_update_nags();

		$this->assertNotFalse( has_action( 'admin_notices', 'update_nag' ) );

		remove_action( 'admin_notices', 'update_nag', 3 );
	}

	/**
	 * Seed the `update_core` site transient so
	 * `get_preferred_from_update_core()` reports an available upgrade.
	 *
	 * @param string $version Version string to advertise.
	 */
	private function fake_core_update( $version ) {
		$item = (object) array(
			'response' => 'upgrade',
			'current'  => $version,
			'locale'   => 'en_US',
			'url'      => 'https://wordpress.org/download/',
			'packages' => (object) array( 'full' => 'https://example.com/wp.zip' ),
		);

		set_site_transient(
			'update_core',
			(object) array(
				'updates'         => array( $item ),
				'version_checked' => '1.0',
				'last_checked'    => time(),
			)
		);
	}
}
