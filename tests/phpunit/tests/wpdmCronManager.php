<?php
/**
 * Tests for the built-in Cron Manager.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-cron-manager
 */
class Tests_DesktopMode_CronManager extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	private $previous_cron;
	private $previous_custom_schedules;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		$this->previous_cron             = get_option( 'cron' );
		$this->previous_custom_schedules = get_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION );
		update_option( 'cron', array( 'version' => 2 ), false );
		delete_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION );
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		update_option( 'cron', $this->previous_cron, false );
		if ( false === $this->previous_custom_schedules ) {
			delete_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION );
		} else {
			update_option( WPDM_CRON_MANAGER_CUSTOM_SCHEDULES_OPTION, $this->previous_custom_schedules, false );
		}
		remove_all_filters( 'wp_desktop_cron_manager_user_can_use' );
		parent::tear_down();
	}

	/**
	 * @covers ::wpdm_cron_manager_create_event
	 * @covers ::wpdm_cron_manager_get_schedules_payload
	 */
	public function test_create_event_with_custom_schedule() {
		$result = wpdm_cron_manager_create_event(
			array(
				'hook'           => 'wpdm_test_custom_schedule',
				'timestamp'      => time() + 600,
				'args'           => array( 123, 'abc' ),
				'customSchedule' => array(
					'slug'     => 'wpdm_every_five_minutes',
					'interval' => 300,
					'display'  => 'Every five minutes',
				),
			)
		);

		$this->assertNotWPError( $result );

		$schedules = wpdm_cron_manager_get_schedules_payload();
		$slugs     = wp_list_pluck( $schedules, 'slug' );
		$this->assertContains( 'wpdm_every_five_minutes', $slugs );

		$events = wpdm_cron_manager_list_events();
		$this->assertCount( 1, $events );
		$this->assertSame( 'wpdm_test_custom_schedule', $events[0]['hook'] );
		$this->assertSame( 'wpdm_every_five_minutes', $events[0]['schedule'] );
		$this->assertTrue( $events[0]['recurring'] );
		$this->assertSame( array( 123, 'abc' ), $events[0]['args'] );
	}

	/**
	 * @covers ::wpdm_cron_manager_delete_event
	 * @covers ::wpdm_cron_manager_find_event
	 */
	public function test_delete_uses_exact_args_hash_identity() {
		$timestamp = time() + 900;
		wpdm_cron_manager_create_event(
			array(
				'hook'      => 'wpdm_test_exact_delete',
				'timestamp' => $timestamp,
				'args'      => array( 'first' ),
			)
		);
		wpdm_cron_manager_create_event(
			array(
				'hook'      => 'wpdm_test_exact_delete',
				'timestamp' => $timestamp,
				'args'      => array( 'second' ),
			)
		);

		$result = wpdm_cron_manager_delete_event(
			array(
				'timestamp' => $timestamp,
				'hook'      => 'wpdm_test_exact_delete',
				'argsHash'  => wpdm_cron_manager_args_hash( array( 'first' ) ),
			)
		);

		$this->assertNotWPError( $result );

		$events = wpdm_cron_manager_list_events();
		$this->assertCount( 1, $events );
		$this->assertSame( array( 'second' ), $events[0]['args'] );
	}

	/**
	 * @covers ::wpdm_cron_manager_update_event
	 */
	public function test_update_replaces_old_event() {
		$timestamp = time() + 1200;
		wpdm_cron_manager_create_event(
			array(
				'hook'      => 'wpdm_test_old_hook',
				'timestamp' => $timestamp,
				'args'      => array( 'old' ),
			)
		);

		$result = wpdm_cron_manager_update_event(
			array(
				'timestamp' => $timestamp,
				'hook'      => 'wpdm_test_old_hook',
				'argsHash'  => wpdm_cron_manager_args_hash( array( 'old' ) ),
			),
			array(
				'hook'      => 'wpdm_test_new_hook',
				'timestamp' => $timestamp + HOUR_IN_SECONDS,
				'schedule'  => 'hourly',
				'args'      => array( 'new' ),
			)
		);

		$this->assertNotWPError( $result );

		$events = wpdm_cron_manager_list_events();
		$this->assertCount( 1, $events );
		$this->assertSame( 'wpdm_test_new_hook', $events[0]['hook'] );
		$this->assertSame( 'hourly', $events[0]['schedule'] );
		$this->assertSame( array( 'new' ), $events[0]['args'] );
	}

	/**
	 * @covers ::wpdm_cron_manager_run_event_now
	 */
	public function test_run_now_executes_callbacks_without_scheduling_duplicate() {
		$timestamp = time() + HOUR_IN_SECONDS;
		$ran       = null;
		$callback  = static function ( $value ) use ( &$ran ) {
			$ran = $value;
		};

		add_action( 'wpdm_test_run_now', $callback );

		wpdm_cron_manager_create_event(
			array(
				'hook'      => 'wpdm_test_run_now',
				'timestamp' => $timestamp,
				'args'      => array( 'payload' ),
				'schedule'  => 'hourly',
			)
		);

		$result = wpdm_cron_manager_run_event_now(
			array(
				'timestamp' => $timestamp,
				'hook'      => 'wpdm_test_run_now',
				'argsHash'  => wpdm_cron_manager_args_hash( array( 'payload' ) ),
			)
		);

		remove_action( 'wpdm_test_run_now', $callback );

		$this->assertNotWPError( $result );
		$this->assertSame( 'payload', $ran );

		$events = wpdm_cron_manager_list_events();
		$this->assertCount( 1, $events );
		$this->assertSame( $timestamp, $events[0]['timestamp'] );
		$this->assertSame( 'hourly', $events[0]['schedule'] );
	}

	/**
	 * @covers ::wpdm_cron_manager_rest_permission
	 */
	public function test_rest_permission_requires_admin_capability() {
		wp_set_current_user( self::$subscriber_id );

		$result = wpdm_cron_manager_rest_permission();

		$this->assertWPError( $result );
		$this->assertSame( 'wpdm_cron_forbidden', $result->get_error_code() );
	}
}
