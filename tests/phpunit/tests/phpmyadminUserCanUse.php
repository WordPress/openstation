<?php

class Tests_OpenStation_PhpMyAdminUserCanUse extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );

		if ( ! defined( 'OPENSTATION_PHPMYADMIN_DIR' ) ) {
			define( 'OPENSTATION_PHPMYADMIN_DIR', trailingslashit( get_temp_dir() ) . 'desktop-mode-phpmyadmin-test/' );
		}
		if ( ! defined( 'OPENSTATION_PHPMYADMIN_URL' ) ) {
			define( 'OPENSTATION_PHPMYADMIN_URL', 'http://example.org/wp-content/plugins/desktop-mode-phpmyadmin/' );
		}
		if ( ! defined( 'OPENSTATION_PHPMYADMIN_VERSION' ) ) {
			define( 'OPENSTATION_PHPMYADMIN_VERSION', '0.0.0-test' );
		}

		if ( ! function_exists( 'openstation_phpmyadmin_user_can_use' ) ) {
			require_once dirname( __DIR__, 3 ) . '/extensions/desktop-mode-phpmyadmin/includes/window.php';
		}
	}

	public static function wpTearDownAfterClass() {
		self::remove_vendor_index();
	}

	public function tear_down() {
		remove_all_filters( 'openstation_phpmyadmin_user_can_use' );
		self::remove_vendor_index();
		parent::tear_down();
	}

	protected static function create_vendor_index() {
		$vendor = openstation_phpmyadmin_vendor_dir();
		wp_mkdir_p( $vendor );
		file_put_contents( $vendor . '/index.php', "<?php // test sentinel\n" );
		clearstatcache();
	}

	protected static function remove_vendor_index() {
		$index = openstation_phpmyadmin_vendor_dir() . '/index.php';
		if ( file_exists( $index ) ) {
			unlink( $index );
		}
		clearstatcache();
	}

	protected function environment_is_local() {
		return 'local' === wp_get_environment_type();
	}

	public function test_filter_cannot_bypass_vendor_gate() {
		wp_set_current_user( self::$admin_id );

		add_filter( 'openstation_phpmyadmin_user_can_use', '__return_true' );

		$this->assertFalse( openstation_phpmyadmin_vendor_present() );
		$this->assertFalse( openstation_phpmyadmin_user_can_use() );
	}

	public function test_filter_cannot_bypass_environment_gate() {
		if ( $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a non-local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		add_filter( 'openstation_phpmyadmin_user_can_use', '__return_true' );

		$this->assertFalse( openstation_phpmyadmin_user_can_use() );
	}

	public function test_filter_can_narrow() {
		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		add_filter( 'openstation_phpmyadmin_user_can_use', '__return_false' );

		$this->assertFalse( openstation_phpmyadmin_user_can_use() );
	}

	public function test_subscriber_denied_by_default() {
		wp_set_current_user( self::$subscriber_id );
		self::create_vendor_index();

		$this->assertFalse( openstation_phpmyadmin_user_can_use() );
	}

	public function test_admin_allowed_when_all_gates_pass() {
		if ( ! $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$admin_id );
		self::create_vendor_index();

		$this->assertTrue( openstation_phpmyadmin_user_can_use() );
	}

	public function test_filter_can_widen_capability_when_hard_gates_pass() {
		if ( ! $this->environment_is_local() ) {
			$this->markTestSkipped( 'Requires a local environment; wp_get_environment_type() is cached and cannot be changed mid-process.' );
		}

		wp_set_current_user( self::$subscriber_id );
		self::create_vendor_index();

		add_filter( 'openstation_phpmyadmin_user_can_use', '__return_true' );

		$this->assertTrue( openstation_phpmyadmin_user_can_use() );
	}
}
