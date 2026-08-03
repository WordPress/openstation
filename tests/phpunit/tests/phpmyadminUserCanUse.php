<?php
/**
 * Tests for the phpMyAdmin composite access gate.
 *
 * Covers `open_station_phpmyadmin_user_can_use()` — the authorization
 * chokepoint shared by the bundle endpoint and the window/icon
 * registration. The local-env and vendor-present gates are documented
 * as non-negotiable security gates: the
 * `open_station_phpmyadmin_user_can_use` filter may adjust who can use
 * the shortcut, but it must never be able to bypass either hard gate.
 *
 * The extension constants are defined here to point the vendor dir at
 * a throwaway temp directory, so the vendor-present gate can be
 * toggled per test by creating/removing the `index.php` sentinel.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_PhpMyAdminUserCanUse extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );

		if ( ! defined( 'OPEN_STATION_PHPMYADMIN_DIR' ) ) {
			define( 'OPEN_STATION_PHPMYADMIN_DIR', trailingslashit( get_temp_dir() ) . 'desktop-mode-phpmyadmin-test/' );
		}
		if ( ! defined( 'OPEN_STATION_PHPMYADMIN_URL' ) ) {
			define( 'OPEN_STATION_PHPMYADMIN_URL', 'http://example.org/wp-content/plugins/desktop-mode-phpmyadmin/' );
		}
		if ( ! defined( 'OPEN_STATION_PHPMYADMIN_VERSION' ) ) {
			define( 'OPEN_STATION_PHPMYADMIN_VERSION', '0.0.0-test' );
		}

		if ( ! function_exists( 'open_station_phpmyadmin_user_can_use' ) ) {
			require_once dirname( __DIR__, 3 ) . '/extensions/desktop-mode-phpmyadmin/includes/window.php';
		}
	}

	public static function wpTearDownAfterClass() {
		self::remove_vendor_index();
	}

	public function tear_down() {
		remove_all_filters( 'open_station_phpmyadmin_user_can_use' );
		self::remove_vendor_index();
		parent::tear_down();
	}

	/**
	 * Creates the vendor `index.php` sentinel so the vendor-present
	 * gate passes.
	 */
	protected static function create_vendor_index() {
		$vendor = open_station_phpmyadmin_vendor_dir();
		wp_mkdir_p( $vendor );
		file_put_contents( $vendor . '/index.php', "<?php // test sentinel\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		clearstatcache();
	}

	/**
	 * Removes the vendor `index.php` sentinel so the vendor-present
	 * gate fails.
	 */
	protected static function remove_vendor_index() {
		$index = open_station_phpmyadmin_vendor_dir() . '/index.php';
		if ( file_exists( $index ) ) {
			unlink( $index );
		}
		clearstatcache();
	}

	/**
	 * Whether the test environment itself passes the local-env gate.
	 *
	 * @return bool
	 */
	protected function environment_is_local() {
		return 'local' === wp_get_environment_type();
	}

	/**
	 * A `__return_true` filter must NOT re-enable the gate when the
	 * bundled vendor distribution is missing — the vendor-present gate
	 * is a non-negotiable security gate.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_filter_cannot_bypass_vendor_gate() {
		wp_set_current_user( self::$admin_id );

		add_filter( 'open_station_phpmyadmin_user_can_use', '__return_true' );

		$this->assertFalse( open_station_phpmyadmin_vendor_present() );
		$this->assertFalse( open_station_phpmyadmin_user_can_use() );
	}

	/**
	 * A `__return_true` filter must NOT re-enable the gate on a
	 * non-local environment — the local-env gate is a non-negotiable
	 * security gate.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_filter_cannot_bypass_environment_gate() {
		if ( $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a non-local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		add_filter( 'open_station_phpmyadmin_user_can_use', '__return_true' );

		$this->assertFalse( open_station_phpmyadmin_user_can_use() );
	}

	/**
	 * The filter can still narrow access for a user who passes every
	 * default gate.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_filter_can_narrow() {
		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		add_filter( 'open_station_phpmyadmin_user_can_use', '__return_false' );

		$this->assertFalse( open_station_phpmyadmin_user_can_use() );
	}

	/**
	 * Default gate: lower-privilege users are denied.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_subscriber_denied_by_default() {
		wp_set_current_user( self::$subscriber_id );
		self::create_vendor_index();

		$this->assertFalse( open_station_phpmyadmin_user_can_use() );
	}

	/**
	 * Default gate: an administrator passes when both hard gates pass.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_admin_allowed_when_all_gates_pass() {
		if ( ! $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		$this->assertTrue( open_station_phpmyadmin_user_can_use() );
	}

	/**
	 * The filter may widen the capability portion (e.g. allow a
	 * lower-privilege user) — but only while both hard gates pass.
	 *
	 * @covers ::open_station_phpmyadmin_user_can_use
	 */
	public function test_filter_can_widen_capability_when_hard_gates_pass() {
		if ( ! $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$subscriber_id );
		self::create_vendor_index();

		add_filter( 'open_station_phpmyadmin_user_can_use', '__return_true' );

		$this->assertTrue( open_station_phpmyadmin_user_can_use() );
	}
}
