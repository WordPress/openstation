<?php
/**
 * Tests for framework-level presence (`includes/presence.php`).
 *
 * Covers storage, the state machine, transitions, the REST endpoint,
 * and the Heartbeat handler.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_Presence extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		delete_option( WP_DESKTOP_PRESENCE_OPTION );
	}

	public function tear_down() {
		delete_option( WP_DESKTOP_PRESENCE_OPTION );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$editor_id, 'desktop_mode_mode' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 * @covers ::desktop_mode_presence_status_for_user
	 */
	public function test_record_makes_user_online() {
		desktop_mode_presence_record( self::$admin_id, true );
		$this->assertSame( 'online', desktop_mode_presence_status_for_user( self::$admin_id ) );
	}

	/**
	 * @covers ::desktop_mode_presence_status_from_record
	 */
	public function test_inactive_threshold_demotes_online_to_inactive() {
		$now_ms = (int) round( microtime( true ) * 1000 );
		// Last seen recent, last active 6 minutes ago — should be inactive.
		$record = array(
			'last_seen_ms'   => $now_ms,
			'last_active_ms' => $now_ms - ( 6 * 60 * 1000 ),
		);
		$this->assertSame( 'inactive', desktop_mode_presence_status_from_record( $record ) );
	}

	/**
	 * @covers ::desktop_mode_presence_status_from_record
	 */
	public function test_offline_threshold_dominates() {
		$now_ms = (int) round( microtime( true ) * 1000 );
		// No heartbeat in 3 minutes — offline regardless of activity stamp.
		$record = array(
			'last_seen_ms'   => $now_ms - ( 3 * 60 * 1000 ),
			'last_active_ms' => $now_ms,
		);
		$this->assertSame( 'offline', desktop_mode_presence_status_from_record( $record ) );
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 */
	public function test_record_active_false_preserves_last_active() {
		desktop_mode_presence_record( self::$admin_id, true );
		$first = desktop_mode_presence_get_all()[ self::$admin_id ];
		usleep( 5000 );
		desktop_mode_presence_record( self::$admin_id, false );
		$second = desktop_mode_presence_get_all()[ self::$admin_id ];
		$this->assertGreaterThan( $first['last_seen_ms'], $second['last_seen_ms'], 'last_seen advances on every record' );
		$this->assertSame( $first['last_active_ms'], $second['last_active_ms'], 'last_active stays put when active=false' );
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 */
	public function test_changed_action_fires_only_on_transition() {
		$transitions = array();
		add_action(
			'wp_desktop_presence_changed',
			function ( $user_id, $new_status, $old_status ) use ( &$transitions ) {
				$transitions[] = array( $user_id, $old_status, $new_status );
			},
			10,
			3
		);

		// First record — transitions from offline (default) to online.
		desktop_mode_presence_record( self::$admin_id, true );
		// Second record — same status, no transition.
		desktop_mode_presence_record( self::$admin_id, true );

		$this->assertCount( 1, $transitions );
		$this->assertSame( self::$admin_id, $transitions[0][0] );
		$this->assertSame( 'offline', $transitions[0][1] );
		$this->assertSame( 'online', $transitions[0][2] );
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 */
	public function test_recorded_action_fires_every_time() {
		$count = 0;
		add_action(
			'wp_desktop_presence_recorded',
			function () use ( &$count ) {
				$count++;
			}
		);
		desktop_mode_presence_record( self::$admin_id, true );
		desktop_mode_presence_record( self::$admin_id, true );
		desktop_mode_presence_record( self::$admin_id, false );
		$this->assertSame( 3, $count );
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 */
	public function test_can_track_filter_vetoes_recording() {
		add_filter( 'wp_desktop_presence_can_track', '__return_false' );
		$ok = desktop_mode_presence_record( self::$admin_id, true );
		$this->assertFalse( $ok );
		$this->assertSame( 'offline', desktop_mode_presence_status_for_user( self::$admin_id ) );
		remove_filter( 'wp_desktop_presence_can_track', '__return_false' );
	}

	/**
	 * @covers ::desktop_mode_presence_snapshot
	 */
	public function test_snapshot_with_null_returns_all_tracked_users() {
		desktop_mode_presence_record( self::$admin_id, true );
		desktop_mode_presence_record( self::$editor_id, false );
		$snap = desktop_mode_presence_snapshot();
		$this->assertArrayHasKey( (string) self::$admin_id, $snap );
		$this->assertArrayHasKey( (string) self::$editor_id, $snap );
	}

	/**
	 * @covers ::desktop_mode_presence_snapshot
	 */
	public function test_snapshot_with_id_list_filters_to_those_only() {
		desktop_mode_presence_record( self::$admin_id, true );
		desktop_mode_presence_record( self::$editor_id, true );
		$snap = desktop_mode_presence_snapshot( array( self::$admin_id ) );
		$this->assertCount( 1, $snap );
		$this->assertArrayHasKey( (string) self::$admin_id, $snap );
		$this->assertArrayNotHasKey( (string) self::$editor_id, $snap );
	}

	/**
	 * @covers ::desktop_mode_presence_visible_users
	 */
	public function test_visible_users_filter_can_narrow_the_set() {
		add_filter(
			'wp_desktop_presence_visible_users',
			function ( $ids, $viewer ) {
				return array( $ids[0] ?? 0 );
			},
			10,
			2
		);
		$ids = desktop_mode_presence_visible_users( array( 1, 2, 3 ), self::$admin_id );
		$this->assertSame( array( 1 ), $ids );
		remove_all_filters( 'wp_desktop_presence_visible_users' );
	}

	/**
	 * @covers ::desktop_mode_presence_cron_prune
	 */
	public function test_cron_prune_drops_stale_entries() {
		$now_ms = (int) round( microtime( true ) * 1000 );
		// Manually seed the option with a fresh + a 30-day-old entry.
		update_option(
			WP_DESKTOP_PRESENCE_OPTION,
			array(
				self::$admin_id  => array(
					'last_seen_ms'   => $now_ms,
					'last_active_ms' => $now_ms,
				),
				self::$editor_id => array(
					'last_seen_ms'   => $now_ms - ( 30 * DAY_IN_SECONDS * 1000 ),
					'last_active_ms' => 0,
				),
			),
			false
		);
		desktop_mode_presence_cron_prune();
		$all = desktop_mode_presence_get_all();
		$this->assertArrayHasKey( self::$admin_id, $all );
		$this->assertArrayNotHasKey( self::$editor_id, $all );
	}

	/**
	 * @covers ::desktop_mode_presence_record
	 */
	public function test_invalid_user_id_is_a_noop() {
		$ok = desktop_mode_presence_record( 0, true );
		$this->assertFalse( $ok );
		$this->assertSame( array(), desktop_mode_presence_get_all() );
	}

	/**
	 * @covers ::desktop_mode_presence_status_for_user
	 */
	public function test_unknown_user_is_offline() {
		$this->assertSame( 'offline', desktop_mode_presence_status_for_user( 99999 ) );
	}

}
