<?php
/**
 * Tests for the core-update toast pipeline:
 *
 *   - `desktop_mode_get_core_update()` — the server-side descriptor
 *     (capability gating, update-state reading, the
 *     `desktop_mode_core_update_notice` filter).
 *   - `desktop_mode_chromeless_suppress_update_nags()` — the in-window
 *     nag suppressor.
 *   - that the descriptor lands in the shell config as `coreUpdate`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-update-notice
 */
class Tests_DesktopMode_UpdateNotice extends WP_UnitTestCase {

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
		unset( $_GET['desktop_mode_chromeless'] );
		remove_all_filters( 'desktop_mode_core_update_notice' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_descriptor_when_update_available() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );

		$update = desktop_mode_get_core_update();
		$this->assertIsArray( $update );
		$this->assertSame( '9.9.9', $update['version'] );
		$this->assertStringContainsString( 'update-core.php', $update['url'] );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_null_without_update() {
		wp_set_current_user( self::$admin_id );
		// No transient (cleared in set_up) → response is 'latest'.
		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_null_without_capability() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->fake_core_update( '9.9.9' );

		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_filter_can_suppress_the_toast() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter( 'desktop_mode_core_update_notice', '__return_null' );

		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_filter_can_mutate_the_descriptor() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter(
			'desktop_mode_core_update_notice',
			static function ( $update ) {
				$update['version'] = '9.9.9-custom';
				return $update;
			}
		);

		$update = desktop_mode_get_core_update();
		$this->assertSame( '9.9.9-custom', $update['version'] );
	}

	/**
	 * The chromeless suppressor detaches core's per-window update /
	 * maintenance nags so they don't repeat inside every window.
	 *
	 * @covers ::desktop_mode_chromeless_suppress_update_nags
	 */
	public function test_suppressor_removes_nags_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		add_action( 'admin_notices', 'update_nag', 3 );
		add_action( 'network_admin_notices', 'update_nag', 3 );
		add_action( 'admin_notices', 'maintenance_nag', 10 );

		desktop_mode_chromeless_suppress_update_nags();

		$this->assertFalse( has_action( 'admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'network_admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'maintenance_nag' ) );
	}

	/**
	 * Outside a chromeless request the nags are left in place.
	 *
	 * @covers ::desktop_mode_chromeless_suppress_update_nags
	 */
	public function test_suppressor_leaves_nags_when_not_chromeless() {
		wp_set_current_user( self::$admin_id );
		add_action( 'admin_notices', 'update_nag', 3 );

		desktop_mode_chromeless_suppress_update_nags();

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
