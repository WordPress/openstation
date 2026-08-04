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

	public function tear_down() {
		remove_all_filters( 'openstation_install_predates_rebrand' );
		parent::tear_down();
	}

	/** A user who was using Desktop Mode when the rename landed. */
	private function make_prior_user() {
		$user_id = self::factory()->user->create();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		return $user_id;
	}

	/** Whether migration 5 flagged this user. */
	private function is_flagged( $user_id ) {
		return (bool) get_user_meta( (int) $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true );
	}

	/**
	 * A user who had opted into Desktop Mode is flagged.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_prior_user_is_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue(
			$this->is_flagged( $user_id ),
			'Someone using Desktop Mode at the rename should be told about it.'
		);
	}

	/**
	 * A user who customized the shell and has since switched back to
	 * classic is flagged too.
	 *
	 * They used it, so they are owed the explanation next time they come
	 * in, even though `desktop_mode_mode` is no longer set.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_user_with_saved_settings_is_flagged() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings( $user_id, array( 'wallpaper' => 'custom-gradient' ) );

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue( $this->is_flagged( $user_id ) );
	}

	/**
	 * A user who never turned OpenStation on is NOT flagged.
	 *
	 * This is the case the install-wide flag got wrong: an editor who
	 * joins an old site and enables the shell for the first time after
	 * the rename would be shown a dialog about a name they never saw.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_user_who_never_used_it_is_not_flagged() {
		$user_id = self::factory()->user->create();

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertFalse(
			$this->is_flagged( $user_id ),
			'Someone who never used Desktop Mode has no rename to hear about.'
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
		// No user carries either proof-of-use key, which is what a
		// genuinely new site looks like: its first `admin_init` runs on
		// the activation redirect, before anyone can open the shell.
		self::factory()->user->create();

		openstation_migrate_flag_rebrand_notice( 0 );

		$this->assertSame(
			array(),
			get_users(
				array(
					'fields'       => 'ID',
					'meta_key'     => OPENSTATION_REBRAND_NOTICE_META_KEY,
					'meta_compare' => 'EXISTS',
				)
			),
			'A fresh install has only ever known OpenStation.'
		);
	}

	/**
	 * An install predating the migration runner is flagged.
	 *
	 * The runner shipped in 0.9.1, so a site still on 0.9.0 that updates
	 * straight to the rebrand release has no stored version and arrives
	 * with `$from === 0`, looking exactly like a new install. Reading
	 * that as "fresh" would silence the installs that update rarely,
	 * which are the ones most likely to be blindsided by a rename. The
	 * user's own proof-of-use is what tells the two apart.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_pre_runner_install_is_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 0 );

		$this->assertTrue(
			$this->is_flagged( $user_id ),
			'A 0.9.0 install has no migration version but plenty of history.'
		);
	}

	/**
	 * An install that already ran the rebrand migration is not flagged.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_post_rebrand_install_is_not_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 4 );

		$this->assertFalse(
			$this->is_flagged( $user_id ),
			'Migration 4 having run means the rebrand already landed here.'
		);
	}

	/**
	 * The filter can opt a site out wholesale.
	 *
	 * @covers ::openstation_migrate_flag_rebrand_notice
	 */
	public function test_filter_can_suppress_the_flag() {
		$user_id = $this->make_prior_user();
		add_filter( 'openstation_install_predates_rebrand', '__return_false' );

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertFalse( $this->is_flagged( $user_id ) );
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
	 * A user who joins after the rename is never offered it, even on a
	 * site where other users were flagged.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_newcomer_on_an_old_site_gets_no_notice() {
		$old = $this->make_prior_user();
		openstation_migrate_flag_rebrand_notice( 3 );

		$newcomer = self::factory()->user->create();
		wp_set_current_user( $newcomer );
		$this->assertFalse(
			openstation_should_show_rebrand_notice(),
			'A newcomer has no rename to hear about.'
		);

		wp_set_current_user( $old );
		$this->assertTrue(
			openstation_should_show_rebrand_notice(),
			'The user who was actually here still gets it.'
		);
	}

	/**
	 * A flagged install offers the announcement to a user who has not
	 * dismissed it, and stops once they have.
	 *
	 * @covers ::openstation_should_show_rebrand_notice
	 */
	public function test_notice_is_offered_once_per_user() {
		$user_id = $this->make_prior_user();
		openstation_migrate_flag_rebrand_notice( 3 );
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
		$first  = $this->make_prior_user();
		$second = $this->make_prior_user();
		openstation_migrate_flag_rebrand_notice( 3 );

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
		$this->make_prior_user();
		openstation_migrate_flag_rebrand_notice( 3 );
		wp_set_current_user( 0 );

		$this->assertFalse( openstation_should_show_rebrand_notice() );
	}
}
