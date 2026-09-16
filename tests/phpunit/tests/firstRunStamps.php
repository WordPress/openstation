<?php
/**
 * Tests for the first-run module: the install / first-enable stamps,
 * the activation nudge's gates, the plugin row action and migration 9.
 *
 * The stamps are the foundation the activation funnel and every
 * age-based gate read, so they are pinned at the helper level; the
 * nudge is pinned on its "stop nagging" rules; migration 9 on
 * "existing users do not get the tour".
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
		if ( is_multisite() ) {
			// `activate_plugins` belongs to the super admin on a network.
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		delete_option( OPENSTATION_INSTALLED_AT_OPTION );
		delete_option( OPENSTATION_FIRST_ENABLED_AT_OPTION );
		foreach ( array( self::$admin_id, self::$subscriber_id ) as $user_id ) {
			delete_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY );
			delete_user_meta( $user_id, 'desktop_mode_mode' );
			openstation_clear_seen_intros( $user_id );
		}
		wp_set_current_user( 0 );
	}

	public function tear_down() {
		set_current_screen( 'front' );
		remove_all_filters( 'openstation_show_activation_nudge' );
		remove_all_actions( 'openstation_user_enabled' );
		parent::tear_down();
	}

	/** Write an install stamp `$days` ago. */
	private function install( $days, $via = 'activation' ) {
		update_option(
			OPENSTATION_INSTALLED_AT_OPTION,
			array(
				'at'  => time() - $days * DAY_IN_SECONDS,
				'via' => $via,
			),
			false
		);
	}

	/** The state the nudge is for: an admin on the Dashboard, fresh install. */
	private function nudge_baseline() {
		wp_set_current_user( self::$admin_id );
		set_current_screen( 'dashboard' );
		$this->install( 1 );
	}

	// ------------------------------------------------------------------
	// Stamps
	// ------------------------------------------------------------------

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

	/**
	 * @covers ::openstation_activation_within
	 */
	public function test_activation_within_reads_both_stamps() {
		// Nobody yet, window still open: unknown.
		$this->install( 2 );
		$this->assertNull( openstation_activation_within( 7 ) );

		// Nobody, window closed: no.
		$this->install( 20 );
		$this->assertFalse( openstation_activation_within( 7 ) );

		// Enabled three days after a ten-day-old install: yes for 7, no for 2.
		$this->install( 10 );
		update_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => time() - 7 * DAY_IN_SECONDS,
				'via' => 'activation',
			),
			false
		);
		$this->assertTrue( openstation_activation_within( 7 ) );
		$this->assertFalse( openstation_activation_within( 2 ) );

		// A backfilled first-enable (migration 9) is unknown.
		update_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => 0,
				'via' => 'backfill',
			),
			false
		);
		$this->assertNull( openstation_activation_within( 7 ) );
	}

	// ------------------------------------------------------------------
	// The nudge
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_shows_for_an_admin_on_the_dashboard_of_a_fresh_install() {
		$this->nudge_baseline();
		$this->assertTrue( openstation_should_show_activation_nudge() );

		set_current_screen( 'plugins' );
		$this->assertTrue( openstation_should_show_activation_nudge() );

		set_current_screen( 'edit' );
		$this->assertFalse( openstation_should_show_activation_nudge(), 'Only Dashboard and Plugins.' );
	}

	/**
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_never_shows_to_a_subscriber() {
		$this->nudge_baseline();
		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( openstation_should_show_activation_nudge() );
	}

	/**
	 * One enabled user is an activated install: the nudge stops for
	 * every admin, including the ones who never saw it.
	 *
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_stops_once_anyone_on_the_site_enables() {
		$this->nudge_baseline();
		openstation_record_user_enabled( self::$subscriber_id );
		$this->assertFalse( openstation_should_show_activation_nudge() );
	}

	/**
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_stops_after_not_now() {
		$this->nudge_baseline();
		openstation_mark_intro_seen( self::$admin_id, OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG );
		$this->assertFalse( openstation_should_show_activation_nudge() );
	}

	/**
	 * Old installs are not nagged, and a backfilled stamp IS an old install.
	 *
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_stops_when_the_install_is_old_or_backfilled() {
		$this->nudge_baseline();
		$this->install( OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS );
		$this->assertFalse( openstation_should_show_activation_nudge() );

		$this->install( 1, 'backfill' );
		$this->assertFalse( openstation_should_show_activation_nudge() );

		delete_option( OPENSTATION_INSTALLED_AT_OPTION );
		$this->assertFalse( openstation_should_show_activation_nudge() );
	}

	/**
	 * @covers ::openstation_should_show_activation_nudge
	 */
	public function test_nudge_filter_can_suppress_it() {
		$this->nudge_baseline();
		add_filter( 'openstation_show_activation_nudge', '__return_false' );
		$this->assertFalse( openstation_should_show_activation_nudge() );
	}

	/**
	 * @covers ::openstation_render_activation_nudge
	 */
	public function test_nudge_markup_carries_the_portal_link_and_the_dismiss_button() {
		$this->nudge_baseline();
		ob_start();
		openstation_render_activation_nudge();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'id="os-activation-nudge"', $html );
		$this->assertStringContainsString( esc_url( openstation_portal_url() ), $html );
		$this->assertStringContainsString( 'os-activation-nudge__dismiss', $html );
		$this->assertStringContainsString( OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG, $html );
	}

	// ------------------------------------------------------------------
	// The row action
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_plugin_row_action_links
	 */
	public function test_row_action_offers_turn_on_then_open() {
		wp_set_current_user( self::$admin_id );
		$hook = 'plugin_action_links_' . plugin_basename( OPENSTATION_FILE );

		$links = apply_filters( $hook, array( 'deactivate' => '<a href="#">Deactivate</a>' ) );
		$this->assertSame( array( 'openstation', 'deactivate' ), array_keys( $links ) );
		$this->assertStringContainsString( esc_url( openstation_portal_url() ), $links['openstation'] );
		$this->assertStringContainsString( 'Turn on OpenStation', $links['openstation'] );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$links = apply_filters( $hook, array() );
		$this->assertStringContainsString( 'Open OpenStation', $links['openstation'] );
		$this->assertStringNotContainsString( openstation_portal_url(), $links['openstation'] );
	}

	// ------------------------------------------------------------------
	// Migration 9
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_migrate_first_run_stamps
	 */
	public function test_migration_marks_the_tour_seen_for_prior_users_only() {
		$prior = self::factory()->user->create();
		$fresh = self::factory()->user->create();
		update_user_meta( $prior, 'desktop_mode_mode', '1' );

		openstation_migrate_first_run_stamps();

		$this->assertTrue( openstation_has_seen_intro( $prior, OPENSTATION_SHELL_TOUR_INTRO_SLUG ) );
		$this->assertFalse( openstation_has_seen_intro( $fresh, OPENSTATION_SHELL_TOUR_INTRO_SLUG ) );

		$site = openstation_get_first_enabled_stamp();
		$this->assertSame( 0, $site['at'] );
		$this->assertSame( 'backfill', $site['via'] );
		// The install stamp is the lazy backfill's, not the migration's.
		$this->assertNull( openstation_get_install_stamp() );
	}

	/**
	 * A site with no history is a fresh install: nothing to record, and
	 * the activation hook stamps the real install moment right after.
	 *
	 * @covers ::openstation_migrate_first_run_stamps
	 */
	public function test_migration_writes_nothing_on_a_site_with_no_history() {
		openstation_migrate_first_run_stamps();

		$this->assertNull( openstation_get_first_enabled_stamp() );
		$this->assertNull( openstation_get_install_stamp() );
	}
}
