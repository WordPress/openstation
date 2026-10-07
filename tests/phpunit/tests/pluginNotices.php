<?php

if ( ! function_exists( 'as_get_datetime_object' ) ) {
	function as_get_datetime_object( $date = null, $timezone = 'UTC' ) {
		return new DateTime( '@' . (int) $date );
	}
}

if ( ! class_exists( 'ActionScheduler_Store' ) ) {

	class ActionScheduler_Store {
		const STATUS_PENDING = 'pending';

		public static $fake_count = 0;

		public static function instance() {
			return new self();
		}

		public function query_actions( $args, $mode = 'ids' ) {
			return self::$fake_count;
		}
	}
}

if ( ! class_exists( 'ActionScheduler_AdminView' ) ) {

	class ActionScheduler_AdminView {
		private static $instance;

		public static function instance() {
			if ( ! self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		public function maybe_check_pastdue_actions() {}
	}
}

class Tests_OpenStation_PluginNotices extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		ActionScheduler_Store::$fake_count = 0;
	}

	public function tear_down() {
		ActionScheduler_Store::$fake_count = 0;
		unset( $_GET['openstation_chromeless'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_plugin_notices' );
		parent::tear_down();
	}

	public function test_no_notice_when_no_pastdue_actions() {
		ActionScheduler_Store::$fake_count = 0;
		$this->assertNull( openstation_plugin_notice_action_scheduler() );
	}

	public function test_notice_reports_pastdue_count() {
		ActionScheduler_Store::$fake_count = 15;

		$notice = openstation_plugin_notice_action_scheduler();
		$this->assertIsArray( $notice );
		$this->assertSame( 'action-scheduler-pastdue', $notice['id'] );
		$this->assertStringContainsString( '15', $notice['message'] );
		$this->assertStringContainsString( 'action-scheduler', $notice['actionUrl'] );
		$this->assertStringContainsString( 'past-due', $notice['actionUrl'] );
	}

	public function test_no_notice_without_capability() {
		ActionScheduler_Store::$fake_count = 15;
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertNull( openstation_plugin_notice_action_scheduler() );
	}

	public function test_aggregate_includes_action_scheduler() {
		ActionScheduler_Store::$fake_count = 3;

		$ids = wp_list_pluck( openstation_get_plugin_notices(), 'id' );
		$this->assertContains( 'action-scheduler-pastdue', $ids );
	}

	public function test_filter_can_suppress_all() {
		ActionScheduler_Store::$fake_count = 3;
		add_filter( 'openstation_plugin_notices', '__return_empty_array' );

		$this->assertSame( array(), openstation_get_plugin_notices() );
	}

	public function test_suppressor_removes_notice_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		add_action(
			'admin_notices',
			array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
		);

		openstation_chromeless_suppress_plugin_notices();

		$this->assertFalse(
			has_action(
				'admin_notices',
				array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
			)
		);
	}

	public function test_suppressor_leaves_notice_when_not_chromeless() {
		add_action(
			'admin_notices',
			array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
		);

		openstation_chromeless_suppress_plugin_notices();

		$this->assertNotFalse(
			has_action(
				'admin_notices',
				array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
			)
		);

		remove_action(
			'admin_notices',
			array( ActionScheduler_AdminView::instance(), 'maybe_check_pastdue_actions' )
		);
	}
}
