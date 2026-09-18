<?php
/**
 * Tests for the first-run stamps: the install / first-enable moments
 * the deactivation feedback payload reads.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group first-run
 */
class Tests_OpenStation_FirstRunStamps extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		delete_option( OPENSTATION_INSTALLED_AT_OPTION );
		delete_option( OPENSTATION_FIRST_ENABLED_AT_OPTION );
		foreach ( array( self::$admin_id, self::$subscriber_id ) as $user_id ) {
			delete_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY );
			delete_user_meta( $user_id, 'desktop_mode_mode' );
		}
		wp_set_current_user( 0 );
	}

	public function tear_down() {
		remove_all_actions( 'openstation_user_enabled' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_stamp_install_on_activation
	 * @covers ::openstation_record_installed
	 */
	public function test_activation_writes_the_install_stamp_once() {
		$this->assertTrue( openstation_record_installed( 'activation' ) );
		$first = openstation_get_install_stamp();
		$this->assertSame( 'activation', $first['via'] );
		$this->assertEqualsWithDelta( time(), $first['at'], 5 );

		// A reactivation (or a later backfill) leaves the first moment alone.
		$this->assertFalse( openstation_record_installed( 'activation' ) );
		$this->assertFalse( openstation_record_installed( 'backfill' ) );
		$this->assertSame( $first, openstation_get_install_stamp() );

		$this->assertNotFalse(
			has_action( 'activate_' . plugin_basename( OPENSTATION_FILE ), 'openstation_stamp_install_on_activation' )
		);
	}

	/**
	 * A site with prior desktop use predates the stamps whatever hook
	 * writes them: a reactivation is backfilled, the first enable is
	 * recorded as unknown, and the payload sends null for both ages.
	 *
	 * @covers ::openstation_record_installed
	 */
	public function test_reactivation_on_a_site_with_a_past_is_backfilled() {
		update_user_meta( self::$subscriber_id, 'desktop_mode_mode', '1' );

		$this->assertTrue( openstation_record_installed( 'activation' ) );
		$this->assertSame( 'backfill', openstation_get_install_stamp()['via'] );
		$this->assertSame(
			array(
				'at'  => 0,
				'via' => 'backfill',
			),
			openstation_get_first_enabled_stamp()
		);
		$this->assertNull( openstation_install_age_days() );

		// The next enable is not the site's first, and the stamp stays.
		$this->assertFalse( openstation_record_user_enabled( self::$admin_id ) );
		$this->assertSame( 0, openstation_get_first_enabled_stamp()['at'] );

		$payload = openstation_deactivation_feedback_payload( array( 'other' ) );
		$this->assertNull( $payload['install_age_days'] );
		$this->assertNull( $payload['first_enable_delay_days'] );
	}

	/**
	 * A backfilled stamp says so, and every age reads it as unknown.
	 *
	 * @covers ::openstation_backfill_install_stamp
	 * @covers ::openstation_install_age_days
	 */
	public function test_backfill_is_marked_and_reports_unknown_age() {
		openstation_backfill_install_stamp();
		openstation_backfill_install_stamp();

		$stamp = openstation_get_install_stamp();
		$this->assertSame( 'backfill', $stamp['via'] );
		$this->assertNull( openstation_install_age_days() );
		$this->assertNull( openstation_activation_within( 7 ) );
	}

	/**
	 * @covers ::openstation_record_user_enabled
	 */
	public function test_enable_stamps_user_once_and_site_once_and_fires_the_action() {
		$calls = array();
		add_action(
			'openstation_user_enabled',
			static function ( $user_id, $first_on_site ) use ( &$calls ) {
				$calls[] = array( $user_id, $first_on_site );
			},
			10,
			2
		);

		$this->assertTrue( openstation_record_user_enabled( self::$admin_id ) );
		$admin_at = openstation_get_user_enabled_at( self::$admin_id );
		$site     = openstation_get_first_enabled_stamp();
		$this->assertGreaterThan( 0, $admin_at );
		$this->assertSame( 'activation', $site['via'] );

		// The second user is not the first on the site; the first
		// user's own stamp does not move on a re-enable.
		$this->assertFalse( openstation_record_user_enabled( self::$subscriber_id ) );
		$this->assertFalse( openstation_record_user_enabled( self::$admin_id ) );
		$this->assertSame( $admin_at, openstation_get_user_enabled_at( self::$admin_id ) );
		$this->assertSame( $site, openstation_get_first_enabled_stamp() );

		$this->assertSame(
			array(
				array( self::$admin_id, true ),
				array( self::$subscriber_id, false ),
				array( self::$admin_id, false ),
			),
			$calls
		);
	}
}
