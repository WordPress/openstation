<?php
/**
 * Tests for the Pulse Monitor server feed (includes/pulse-monitor.php):
 * the listener lease gate, request classification, the recorder, the
 * Heartbeat relay, the health snapshot, and the built-in wallpaper
 * registration.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_PulseMonitor extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_pulse_reset();
		delete_option( OPENSTATION_PULSE_LOG_OPTION );
		delete_option( OPENSTATION_PULSE_LISTENERS_OPTION );
		delete_option( OPENSTATION_PULSE_GATE_OPTION );
		delete_transient( 'health-check-site-status-result' );
		wp_set_current_user( 0 );
		// Most tests are about what a page view records; the opt-in that
		// lets page views through has its own tests below.
		add_filter( 'openstation_pulse_count_visitors', '__return_true' );
	}

	public function tear_down() {
		openstation_pulse_reset();
		delete_option( OPENSTATION_PULSE_LOG_OPTION );
		delete_option( OPENSTATION_PULSE_LISTENERS_OPTION );
		delete_option( OPENSTATION_PULSE_GATE_OPTION );
		delete_option( OPENSTATION_EXTENDED_OPTIONS_KEY );
		delete_transient( 'health-check-site-status-result' );
		wp_cache_delete( 'log', OPENSTATION_PULSE_CACHE_GROUP );
		wp_cache_delete( 'gate', OPENSTATION_PULSE_CACHE_GROUP );
		remove_all_filters( 'openstation_pulse_count_visitors' );
		remove_all_filters( 'openstation_pulse_event' );
		remove_all_filters( 'openstation_pulse_request_kind' );
		remove_all_filters( 'openstation_pulse_capability' );
		remove_all_filters( 'openstation_pulse_health' );
		unset( $_SERVER['HTTP_USER_AGENT'], $_SERVER['HTTP_REFERER'], $_REQUEST['_wp_http_referer'] );
		parent::tear_down();
	}

	private function listen_as( $user_id ) {
		update_option( OPENSTATION_PULSE_LISTENERS_OPTION, array( $user_id => time() + 100 ) );
	}

	private function log_entries() {
		$log = get_option( OPENSTATION_PULSE_LOG_OPTION, array() );
		return isset( $log['entries'] ) ? $log['entries'] : array();
	}

	/* ---------------------------------------------------------------------
	 * Listener leases
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 */
	public function test_nothing_is_recorded_without_a_listener() {
		openstation_pulse_on_shutdown();
		$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ) );
	}

	/**
	 * @covers ::openstation_pulse_listeners
	 * @covers ::openstation_pulse_is_listening
	 */
	public function test_expired_leases_do_not_count() {
		update_option( OPENSTATION_PULSE_LISTENERS_OPTION, array( self::$admin_id => time() - 1 ) );
		$this->assertFalse( openstation_pulse_is_listening() );
		$this->listen_as( self::$admin_id );
		$this->assertTrue( openstation_pulse_is_listening() );
	}

	/**
	 * @covers ::openstation_pulse_touch_listener
	 */
	public function test_touch_listener_writes_only_past_half_life() {
		$this->assertTrue( openstation_pulse_touch_listener( self::$admin_id ) );
		$this->assertFalse( openstation_pulse_touch_listener( self::$admin_id ), 'A fresh lease is not rewritten.' );

		update_option( OPENSTATION_PULSE_LISTENERS_OPTION, array( self::$admin_id => time() + 10 ) );
		$this->assertTrue( openstation_pulse_touch_listener( self::$admin_id ) );
		$this->assertFalse( openstation_pulse_touch_listener( 0 ) );
	}

	/* ---------------------------------------------------------------------
	 * Recorder
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 * @covers ::openstation_pulse_classify_request
	 */
	public function test_visitor_request_is_recorded() {
		$this->listen_as( self::$admin_id );
		$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15';
		openstation_pulse_on_shutdown();

		$entries = $this->log_entries();
		$this->assertCount( 1, $entries );
		$this->assertSame( 'visitors', $entries[0]['kind'] );
		$this->assertSame( 1, $entries[0]['seq'] );
		$this->assertSame( 0, $entries[0]['user'] );
	}

	/**
	 * @covers ::openstation_pulse_is_bot
	 */
	public function test_bots_are_told_apart() {
		$this->assertTrue( openstation_pulse_is_bot( 'Googlebot/2.1 (+http://www.google.com/bot.html)' ) );
		$this->assertTrue( openstation_pulse_is_bot( 'curl/8.4.0' ) );
		$this->assertTrue( openstation_pulse_is_bot( '' ) );
		$this->assertFalse( openstation_pulse_is_bot( 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0' ) );
	}

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 */
	public function test_listener_own_requests_are_not_recorded() {
		$this->listen_as( self::$admin_id );
		wp_set_current_user( self::$admin_id );
		openstation_pulse_on_shutdown();
		$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ) );
	}

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 */
	public function test_listener_own_editor_requests_are_not_recorded() {
		// The chromeless bridge reports the editor's requests from inside
		// the editor window, so the server must not echo them back.
		$this->listen_as( self::$admin_id );
		wp_set_current_user( self::$admin_id );
		$_SERVER['HTTP_REFERER'] = admin_url( 'post.php?post=12&action=edit' );
		openstation_pulse_on_shutdown();
		$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ) );
	}

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 */
	public function test_other_users_admin_traffic_is_team() {
		$this->listen_as( self::$admin_id );
		wp_set_current_user( self::$editor_id );
		set_current_screen( 'edit-post' );
		openstation_pulse_on_shutdown();
		set_current_screen( 'front' );

		$entries = $this->log_entries();
		$this->assertSame( 'team', $entries[0]['kind'] );
		$this->assertSame( self::$editor_id, $entries[0]['user'] );
	}

	/**
	 * @covers ::openstation_pulse_record
	 * @covers ::openstation_pulse_on_comment
	 */
	public function test_explicit_events_replace_the_request_kind() {
		$this->listen_as( self::$admin_id );
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		openstation_pulse_on_shutdown();

		$kinds = wp_list_pluck( $this->log_entries(), 'kind' );
		$this->assertContains( 'comments', $kinds );
		$this->assertNotContains( 'visitors', $kinds );
	}

	/**
	 * @covers ::openstation_pulse_on_comment
	 */
	public function test_bookkeeping_comment_types_do_not_beat() {
		$this->listen_as( self::$admin_id );
		$post_id = self::factory()->post->create();
		openstation_pulse_reset(); // Publishing the post beat already.
		self::factory()->comment->create(
			array(
				'comment_post_ID' => $post_id,
				'comment_type'    => 'order_note',
			)
		);
		$state = openstation_pulse_state();
		$this->assertSame( array(), $state['events'], 'A WooCommerce order note is not a comment.' );

		self::factory()->comment->create(
			array(
				'comment_post_ID' => $post_id,
				'comment_type'    => 'review',
			)
		);
		$state = openstation_pulse_state();
		$this->assertSame( array( 'comments' ), wp_list_pluck( $state['events'], 'kind' ), 'A product review is.' );
	}

	/**
	 * @covers ::openstation_pulse_on_transition_post_status
	 */
	public function test_publishing_beats_once() {
		$this->listen_as( self::$admin_id );
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		openstation_pulse_reset();
		wp_publish_post( $post_id );
		wp_update_post( array( 'ID' => $post_id, 'post_title' => 'Edited' ) );
		openstation_pulse_on_shutdown();

		$this->assertSame( array( 'publish' ), wp_list_pluck( $this->log_entries(), 'kind' ) );
	}

	/**
	 * @covers ::openstation_pulse_record
	 */
	public function test_failed_login_is_an_error_beat() {
		$this->listen_as( self::$admin_id );
		do_action( 'wp_login_failed', 'nobody', new WP_Error() );
		openstation_pulse_on_shutdown();

		$entries = $this->log_entries();
		$this->assertSame( 'logins', $entries[0]['kind'] );
		$this->assertTrue( $entries[0]['error'] );
	}

	/**
	 * @covers ::openstation_pulse_record
	 */
	public function test_record_rejects_non_slug_kinds() {
		$this->assertFalse( openstation_pulse_record( '' ) );
		$this->assertFalse( openstation_pulse_record( array( 'x' ) ) );
		$this->assertTrue( openstation_pulse_record( 'My-Kind' ) );
	}

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 */
	public function test_event_filter_can_drop_and_relabel() {
		$this->listen_as( self::$admin_id );
		$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0';
		add_filter(
			'openstation_pulse_event',
			function ( $row ) {
				return 'visitors' === $row['kind'] ? false : $row;
			}
		);
		openstation_pulse_on_shutdown();
		$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ) );

		remove_all_filters( 'openstation_pulse_event' );
		add_filter(
			'openstation_pulse_request_kind',
			function () {
				return 'orders';
			}
		);
		openstation_pulse_on_shutdown();
		$this->assertSame( 'orders', $this->log_entries()[0]['kind'] );
	}

	/**
	 * @covers ::openstation_pulse_append
	 */
	public function test_log_is_pruned_by_count_and_age() {
		$now  = (int) round( microtime( true ) * 1000 );
		$rows = array_fill(
			0,
			OPENSTATION_PULSE_LOG_MAX + 25,
			array(
				'kind'   => 'visitors',
				'status' => 200,
				'error'  => false,
				'user'   => 0,
			)
		);
		openstation_pulse_append( $rows, $now );
		$this->assertCount( OPENSTATION_PULSE_LOG_MAX, $this->log_entries() );

		openstation_pulse_append( array( $rows[0] ), $now + OPENSTATION_PULSE_LOG_WINDOW_MS + 1 );
		$this->assertCount( 1, $this->log_entries() );
		$this->assertSame( OPENSTATION_PULSE_LOG_MAX + 26, $this->log_entries()[0]['seq'] );
	}

	/* ---------------------------------------------------------------------
	 * Front-end cost
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 * @covers ::openstation_pulse_counts_visitors
	 */
	public function test_page_views_are_not_counted_by_default() {
		remove_all_filters( 'openstation_pulse_count_visitors' );
		$this->listen_as( self::$admin_id );
		$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15';
		openstation_pulse_on_shutdown();

		$this->assertFalse( openstation_pulse_counts_visitors() );
		$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ), 'A page view writes nothing.' );
		$this->assertFalse( get_option( OPENSTATION_PULSE_GATE_OPTION ) );

		openstation_save_extended_options( array( 'pulse_visitors' => true ) );
		openstation_pulse_on_shutdown();
		$this->assertSame( array( 'visitors' ), wp_list_pluck( $this->log_entries(), 'kind' ), 'The extended option turns them on.' );
	}

	/**
	 * @covers ::openstation_pulse_on_shutdown
	 * @covers ::openstation_pulse_claim_write
	 */
	public function test_ordinary_traffic_writes_at_most_once_per_interval() {
		$this->listen_as( self::$admin_id );
		openstation_pulse_on_shutdown();
		openstation_pulse_on_shutdown();
		$this->assertCount( 1, $this->log_entries(), 'The second page view inside the interval is sampled out.' );

		do_action( 'wp_login_failed', 'nobody', new WP_Error() );
		openstation_pulse_on_shutdown();
		$this->assertCount( 1, $this->log_entries(), 'Failures are sampled too: a login attack is not a write per attempt.' );

		openstation_pulse_record( 'comments' );
		openstation_pulse_on_shutdown();
		$this->assertSame( array( 'bots', 'comments' ), wp_list_pluck( $this->log_entries(), 'kind' ), 'A comment always writes.' );

		update_option( OPENSTATION_PULSE_GATE_OPTION, (int) round( microtime( true ) * 1000 ) - OPENSTATION_PULSE_WRITE_INTERVAL_MS - 1 );
		openstation_pulse_on_shutdown();
		$this->assertCount( 3, $this->log_entries(), 'The next interval writes again.' );
	}

	/**
	 * @covers ::openstation_pulse_append
	 * @covers ::openstation_pulse_read_log
	 */
	public function test_object_cache_keeps_the_log_out_of_the_database() {
		$was = wp_using_ext_object_cache( true );
		try {
			$this->listen_as( self::$admin_id );
			openstation_pulse_on_shutdown();
			openstation_pulse_on_shutdown();

			$this->assertFalse( get_option( OPENSTATION_PULSE_LOG_OPTION ) );
			$this->assertFalse( get_option( OPENSTATION_PULSE_GATE_OPTION ), 'The gate lives in the cache too.' );
			$log = openstation_pulse_read_log( (int) round( microtime( true ) * 1000 ) );
			$this->assertSame( 1, $log['seq'], 'The cache gate samples the second page view out.' );
			$this->assertCount( 1, $log['entries'] );
		} finally {
			wp_using_ext_object_cache( (bool) $was ); // Passing null would leave it on.
		}
	}

	/* ---------------------------------------------------------------------
	 * Heartbeat relay
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_read_log
	 */
	public function test_read_log_returns_the_sequence_and_the_windowed_rows() {
		$now = (int) round( microtime( true ) * 1000 );
		update_option(
			OPENSTATION_PULSE_LOG_OPTION,
			array(
				'seq'     => 7,
				'entries' => array(
					array( 'seq' => 6, 'ts' => $now - OPENSTATION_PULSE_LOG_WINDOW_MS - 1, 'kind' => 'visitors' ),
					array( 'seq' => 7, 'ts' => $now - 1000, 'kind' => 'bots' ),
					'not a row',
				),
			)
		);

		$log = openstation_pulse_read_log( $now );
		$this->assertSame( 7, $log['seq'] );
		$this->assertSame( array( 'bots' ), wp_list_pluck( $log['entries'], 'kind' ) );

		delete_option( OPENSTATION_PULSE_LOG_OPTION );
		$this->assertSame( array( 'seq' => 0, 'entries' => array() ), openstation_pulse_read_log( $now ) );
	}

	/**
	 * @covers ::openstation_pulse_heartbeat_received
	 */
	public function test_heartbeat_without_opt_in_is_untouched() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( array( 'x' => 1 ), openstation_pulse_heartbeat_received( array( 'x' => 1 ), array() ) );
	}

	/**
	 * @covers ::openstation_pulse_heartbeat_received
	 */
	public function test_heartbeat_requires_capability() {
		wp_set_current_user( self::$editor_id );
		$response = openstation_pulse_heartbeat_received( array(), array( 'openstation_pulse' => array( 'since' => 0 ) ) );
		$this->assertArrayNotHasKey( 'openstation_pulse', $response );
		$this->assertFalse( openstation_pulse_is_listening(), 'A denied user does not open a lease.' );

		add_filter(
			'openstation_pulse_capability',
			function () {
				return 'edit_posts';
			}
		);
		$response = openstation_pulse_heartbeat_received( array(), array( 'openstation_pulse' => array( 'since' => 0 ) ) );
		$this->assertArrayHasKey( 'openstation_pulse', $response );
	}

	/**
	 * @covers ::openstation_pulse_heartbeat_received
	 */
	public function test_heartbeat_relays_fresh_events_from_other_users_only() {
		$now = (int) round( microtime( true ) * 1000 );
		openstation_pulse_append(
			array(
				array( 'kind' => 'visitors', 'status' => 200, 'error' => false, 'user' => 0 ),
				array( 'kind' => 'team', 'status' => 200, 'error' => false, 'user' => self::$admin_id ),
				array( 'kind' => 'bots', 'status' => 503, 'error' => true, 'user' => 0 ),
			),
			$now
		);
		wp_set_current_user( self::$admin_id );

		$first = openstation_pulse_heartbeat_received( array(), array( 'openstation_pulse' => array( 'since' => 0 ) ) );
		$this->assertSame( 3, $first['openstation_pulse']['seq'] );
		$this->assertSame( array(), $first['openstation_pulse']['events'], 'The first tick does not replay history.' );
		$this->assertTrue( openstation_pulse_is_listening(), 'An opted-in tick opens a lease.' );

		$next   = openstation_pulse_heartbeat_received( array(), array( 'openstation_pulse' => array( 'since' => 1 ) ) );
		$events = $next['openstation_pulse']['events'];
		$this->assertSame( array( 'bots' ), wp_list_pluck( $events, 'kind' ) );
		$this->assertTrue( $events[0]['error'] );
		$this->assertArrayNotHasKey( 'user', $events[0], 'User ids never leave the server.' );
	}

	/**
	 * @covers ::openstation_pulse_heartbeat_received
	 */
	public function test_heartbeat_relays_everything_after_a_log_reset() {
		wp_set_current_user( self::$admin_id );
		// The client's cursor is from before the log was deleted.
		openstation_pulse_append(
			array(
				array( 'kind' => 'visitors', 'status' => 200, 'error' => false, 'user' => 0 ),
				array( 'kind' => 'comments', 'status' => 302, 'error' => false, 'user' => 0 ),
			),
			(int) round( microtime( true ) * 1000 )
		);

		$tick = openstation_pulse_heartbeat_received( array(), array( 'openstation_pulse' => array( 'since' => 500 ) ) );
		$this->assertSame( array( 'visitors', 'comments' ), wp_list_pluck( $tick['openstation_pulse']['events'], 'kind' ) );
		$this->assertSame( 2, $tick['openstation_pulse']['seq'], 'The cursor comes back down with the response.' );
	}

	/* ---------------------------------------------------------------------
	 * Health snapshot
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_health_snapshot
	 */
	public function test_health_snapshot_reads_site_health_and_failures() {
		set_transient(
			'health-check-site-status-result',
			wp_json_encode(
				array(
					'good'        => 12,
					'recommended' => 3,
					'critical'    => 1,
				)
			)
		);
		$snapshot = openstation_pulse_health_snapshot(
			array(
				array( 'error' => true ),
				array( 'error' => false ),
			)
		);
		$this->assertSame( array( 'good' => 12, 'recommended' => 3, 'critical' => 1 ), $snapshot['siteHealth'] );
		$this->assertSame( 2, $snapshot['requests'] );
		$this->assertSame( 1, $snapshot['failures'] );
		$this->assertIsInt( $snapshot['cronLate'] );
		$this->assertSame( array( 'siteHealth', 'requests', 'failures', 'cronLate' ), array_keys( $snapshot ) );
	}

	/**
	 * @covers ::openstation_pulse_health_snapshot
	 */
	public function test_health_snapshot_is_filterable() {
		add_filter(
			'openstation_pulse_health',
			function ( $snapshot ) {
				$snapshot['failures'] = 99;
				return $snapshot;
			}
		);
		$this->assertSame( 99, openstation_pulse_health_snapshot( array() )['failures'] );
		$this->assertNull( openstation_pulse_health_snapshot( array() )['siteHealth'] );
	}

	/* ---------------------------------------------------------------------
	 * Registration
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_pulse_register_assets
	 */
	public function test_one_script_serves_both_faces() {
		openstation_pulse_register_assets();
		$this->assertTrue( wp_script_is( 'os-pulse-monitor', 'registered' ) );
		$this->assertContains( 'heartbeat', wp_scripts()->registered['os-pulse-monitor']->deps );
		$this->assertSame( 10, has_filter( 'heartbeat_received', 'openstation_pulse_heartbeat_received' ) );
		$this->assertSame( PHP_INT_MAX, has_action( 'shutdown', 'openstation_pulse_on_shutdown' ), 'Last, so closing the response cuts nobody short.' );
	}

	/**
	 * @covers ::openstation_pulse_register_widget
	 */
	public function test_widget_is_registered_on_the_shared_script() {
		openstation_pulse_register_widget();
		$widget = openstation_desktop_widget_registry( 'desktop-mode/pulse' );
		$this->assertIsArray( $widget );
		$this->assertSame( 'os-pulse-monitor', $widget['script'] );
		$this->assertTrue( $widget['resizable'] );
	}
}
