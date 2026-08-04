<?php
/**
 * Tests for the rebrand announcement gate (migration v5).
 *
 * Migration 5 records whether this install was already running before
 * Desktop Mode became OpenStation, which is the only thing standing
 * between "explain the rename to the people it happened to" and
 * "interrupt every fresh install with the history of a name they never
 * saw". The distinction lives entirely in the stored migration version,
 * so it is worth pinning each value of it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group migrations
 */
class Tests_OpenStation_RebrandNotice extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( OPENSTATION_REBRAND_NOTICE_OPTION );
	}

	public function tear_down() {
		delete_option( OPENSTATION_REBRAND_NOTICE_OPTION );
		remove_all_filters( 'openstation_install_predates_rebrand' );
		parent::tear_down();
	}

	/**
	 * An install that ran migrations under the old name is flagged.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_pre_rebrand_install_is_flagged() {
		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue(
			(bool) get_option( OPENSTATION_REBRAND_NOTICE_OPTION ),
			'An install at migration 3 predates the rebrand and should be flagged.'
		);
	}

	/**
	 * A fresh install has no rename to explain.
	 *
	 * `0` means no migration has ever run here, which is exactly what a
	 * brand-new install looks like on its first admin load.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_fresh_install_is_not_flagged() {
		openstation_migrate_flag_rebrand_notice( 0 );

		$this->assertFalse(
			(bool) get_option( OPENSTATION_REBRAND_NOTICE_OPTION ),
			'A fresh install has only ever known OpenStation.'
		);
	}

	/**
	 * An install that already ran the rebrand migration is not flagged.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_post_rebrand_install_is_not_flagged() {
		openstation_migrate_flag_rebrand_notice( 4 );

		$this->assertFalse(
			(bool) get_option( OPENSTATION_REBRAND_NOTICE_OPTION ),
			'Migration 4 having run means the rebrand already landed here.'
		);
	}

	/**
	 * The filter can opt a site out wholesale.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_filter_can_suppress_the_flag() {
		add_filter( 'openstation_install_predates_rebrand', '__return_false' );

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertFalse( (bool) get_option( OPENSTATION_REBRAND_NOTICE_OPTION ) );
	}

	/**
	 * With no flag, nobody is offered the announcement.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_no_flag_means_no_notice() {
		wp_set_current_user( self::factory()->user->create() );

		$this->assertFalse( openstation_should_show_rebrand_notice() );
	}

	/**
	 * A flagged install offers the announcement to a user who has not
	 * dismissed it, and stops once they have.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_notice_is_offered_once_per_user() {
		update_option( OPENSTATION_REBRAND_NOTICE_OPTION, 1 );
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );

		$this->assertTrue(
			openstation_should_show_rebrand_notice(),
			'A user on a pre-rebrand install should be told once.'
		);

		openstation_mark_intro_seen( $user_id, OPENSTATION_REBRAND_INTRO_SLUG );

		$this->assertFalse(
			openstation_should_show_rebrand_notice(),
			'Dismissal should stick.'
		);
	}

	/**
	 * Dismissal is per-user, not per-site.
	 *
	 * The flag lives on the install, so the obvious wrong implementation
	 * clears it on first dismissal and silences the announcement for
	 * every other user on a multi-author site.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_one_users_dismissal_does_not_silence_another() {
		update_option( OPENSTATION_REBRAND_NOTICE_OPTION, 1 );
		$first  = self::factory()->user->create();
		$second = self::factory()->user->create();

		wp_set_current_user( $first );
		openstation_mark_intro_seen( $first, OPENSTATION_REBRAND_INTRO_SLUG );
		$this->assertFalse( openstation_should_show_rebrand_notice() );

		wp_set_current_user( $second );
		$this->assertTrue(
			openstation_should_show_rebrand_notice(),
			'An editor who has not seen the announcement is still owed it.'
		);
	}

	/**
	 * Logged-out requests never qualify.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_logged_out_gets_no_notice() {
		update_option( OPENSTATION_REBRAND_NOTICE_OPTION, 1 );
		wp_set_current_user( 0 );

		$this->assertFalse( openstation_should_show_rebrand_notice() );
	}
}
