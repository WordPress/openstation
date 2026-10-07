<?php

class Tests_OpenStation_UpdateNotice extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		delete_site_transient( 'update_core' );
	}

	public function tear_down() {
		delete_site_transient( 'update_core' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		remove_all_filters( 'openstation_show_core_update_notice' );
		parent::tear_down();
	}

	public function test_returns_null_without_update() {
		wp_set_current_user( self::$admin_id );

		$this->assertNull( openstation_get_core_update() );
	}

	public function test_returns_null_without_capability() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->fake_core_update( '9.9.9' );
		$this->assertNull( openstation_get_core_update() );
	}

	public function test_descriptor_shape() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '99.9' );

		$update = openstation_get_core_update();
		$this->assertIsArray( $update );
		$this->assertArrayHasKey( 'version', $update );
		$this->assertArrayHasKey( 'available', $update );
		$this->assertArrayHasKey( 'branch', $update );
		$this->assertArrayHasKey( 'crossing', $update );
		$this->assertStringContainsString( 'update-core.php', $update['url'] );
	}

	public function test_major_update_detection() {
		$this->assertTrue( openstation_is_major_update( '6.9.2', '7.0' ) );
		$this->assertTrue( openstation_is_major_update( '6.8', '6.9' ) );
		$this->assertFalse( openstation_is_major_update( '7.0', '7.0.2' ) );
		$this->assertFalse( openstation_is_major_update( '7.0', '7.0' ) );
	}

	public function test_crossing_major() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '8.0.1' );

		$update = openstation_get_core_update();
		$this->assertSame( '8.0', $update['version'] );
		$this->assertSame( '8.0.1', $update['available'] );
		$this->assertSame( '8.0', $update['branch'] );
		$this->assertTrue( $update['crossing'] );
	}

	public function test_same_branch_minor() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '7.0.2' );

		$update = openstation_get_core_update();
		$this->assertSame( '7.0.2', $update['version'] );
		$this->assertSame( '7.0.2', $update['available'] );
		$this->assertSame( '7.0', $update['branch'] );
		$this->assertFalse( $update['crossing'] );
	}

	public function test_notice_filter_can_suppress() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter( 'openstation_show_core_update_notice', '__return_false' );

		$this->assertNull( openstation_get_core_update() );
	}

	public function test_suppressor_removes_nags_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		add_action( 'admin_notices', 'update_nag', 3 );
		add_action( 'network_admin_notices', 'update_nag', 3 );
		add_action( 'admin_notices', 'maintenance_nag', 10 );

		openstation_chromeless_suppress_update_nags();

		$this->assertFalse( has_action( 'admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'network_admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'maintenance_nag' ) );
	}

	public function test_suppressor_leaves_nags_when_not_chromeless() {
		wp_set_current_user( self::$admin_id );
		add_action( 'admin_notices', 'update_nag', 3 );

		openstation_chromeless_suppress_update_nags();

		$this->assertNotFalse( has_action( 'admin_notices', 'update_nag' ) );

		remove_action( 'admin_notices', 'update_nag', 3 );
	}

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
