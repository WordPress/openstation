<?php

class Tests_OpenStation_RebrandNotice extends WP_UnitTestCase {

	private function make_prior_user() {
		$user_id = self::factory()->user->create();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		return $user_id;
	}

	private function is_flagged( $user_id ) {
		return (bool) get_user_meta( (int) $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true );
	}

	public function test_prior_user_is_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue(
			$this->is_flagged( $user_id ),
			'Someone using Desktop Mode at the rename should be told about it.'
		);
	}

	public function test_user_who_switched_back_to_classic_is_flagged() {
		$user_id = self::factory()->user->create();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		update_user_meta( $user_id, 'desktop_mode_mode', '' );

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue( $this->is_flagged( $user_id ) );
	}

	public function test_user_with_saved_settings_is_flagged() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings( $user_id, array( 'wallpaper' => 'custom-gradient' ) );

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertTrue( $this->is_flagged( $user_id ) );
	}

	public function test_user_who_never_used_it_is_not_flagged() {
		$user_id = self::factory()->user->create();

		openstation_migrate_flag_rebrand_notice( 3 );

		$this->assertFalse(
			$this->is_flagged( $user_id ),
			'Someone who never used Desktop Mode has no rename to hear about.'
		);
	}

	public function test_fresh_install_is_not_flagged() {

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

	public function test_pre_runner_install_is_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 0 );

		$this->assertTrue(
			$this->is_flagged( $user_id ),
			'A 0.9.0 install has no migration version but plenty of history.'
		);
	}

	public function test_post_rebrand_install_is_not_flagged() {
		$user_id = $this->make_prior_user();

		openstation_migrate_flag_rebrand_notice( 4 );

		$this->assertFalse(
			$this->is_flagged( $user_id ),
			'Migration 4 having run means the rebrand already landed here.'
		);
	}

	public function test_no_flag_means_no_notice() {
		wp_set_current_user( self::factory()->user->create() );

		$this->assertFalse( openstation_should_show_rebrand_notice() );
	}

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

	public function test_logged_out_gets_no_notice() {
		$this->make_prior_user();
		openstation_migrate_flag_rebrand_notice( 3 );
		wp_set_current_user( 0 );

		$this->assertFalse( openstation_should_show_rebrand_notice() );
	}
}
