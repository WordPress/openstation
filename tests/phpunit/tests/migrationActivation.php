<?php

class Tests_OpenStation_MigrationActivation extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		delete_option( OPENSTATION_MIGRATION_OPTION );
	}

	private function stored_version() {
		$stored = get_option( OPENSTATION_MIGRATION_OPTION, false );
		return false === $stored ? null : (int) $stored;
	}

	public function test_runner_is_registered_on_activation() {
		$this->assertNotFalse(
			has_action(
				'activate_' . plugin_basename( OPENSTATION_FILE ),
				'openstation_run_migrations_on_activation'
			)
		);
	}

	public function test_migrations_load_outside_the_admin_module_guard() {
		$loader = file_get_contents( OPENSTATION_DIR . 'desktop-mode.php' );

		$require = strpos( $loader, "require_once OPENSTATION_DIR . 'includes/migrations.php';" );
		$guard   = strpos( $loader, 'if ( openstation_request_needs_admin_modules() ) {' );

		$this->assertNotFalse( $require, 'The loader must require the migrations module.' );
		$this->assertNotFalse( $guard, 'The admin-module guard moved; update this test.' );
		$this->assertLessThan(
			$guard,
			$require,
			'Migrations must load unconditionally, or activation cannot register its hook.'
		);
	}

	public function test_activation_records_the_shipped_version() {
		self::factory()->user->create();

		openstation_run_migrations_on_activation();

		$this->assertSame( OPENSTATION_MIGRATION_VERSION, $this->stored_version() );
	}

	public function test_activation_still_clears_site_level_leftovers() {
		update_option( 'desktop_mode_ai_platform', array( 'apiKey' => 'sk-secret-leftover' ) );
		self::factory()->user->create();

		openstation_run_migrations_on_activation();

		$this->assertFalse(
			get_option( 'desktop_mode_ai_platform', false ),
			'Migration 3 should have deleted the leftover provider credential.'
		);
		$this->assertSame( OPENSTATION_MIGRATION_VERSION, $this->stored_version() );
	}

	public function test_activation_still_unschedules_stale_ai_cron() {
		wp_schedule_single_event( time() + HOUR_IN_SECONDS, 'desktop_mode_ai_analyze_post', array( 1 ) );
		self::factory()->user->create();

		openstation_run_migrations_on_activation();

		$this->assertFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 1 ) ),
			'Migration 2 should have unscheduled the leftover event.'
		);
	}

	public function test_activated_install_runs_no_further_migration() {
		$user_id = self::factory()->user->create();
		openstation_run_migrations_on_activation();

		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		openstation_maybe_run_migrations();

		$this->assertFalse(
			(bool) get_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true )
		);
	}

	public function test_portal_auto_enable_after_activation_earns_no_notice() {
		$user_id = self::factory()->user->create();

		openstation_run_migrations_on_activation();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		openstation_maybe_run_migrations();

		wp_set_current_user( $user_id );
		$this->assertFalse(
			openstation_should_show_rebrand_notice(),
			'A site created minutes ago has only ever been OpenStation.'
		);
	}

	public function test_existing_version_is_never_moved() {
		update_option( OPENSTATION_MIGRATION_OPTION, 2, false );

		openstation_run_migrations_on_activation();

		$this->assertSame( 2, $this->stored_version() );
	}

	public function test_prior_use_defers_to_admin_init() {
		$user_id = self::factory()->user->create();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );

		openstation_run_migrations_on_activation();

		$this->assertNull(
			$this->stored_version(),
			'A site with history has migrations to run on its next admin load.'
		);

		openstation_maybe_run_migrations();

		wp_set_current_user( $user_id );
		$this->assertTrue(
			openstation_should_show_rebrand_notice(),
			'The people the rename happened to are still owed it.'
		);
	}

	public function test_saved_settings_alone_defer_to_admin_init() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings( $user_id, array( 'wallpaper' => 'custom-gradient' ) );

		openstation_run_migrations_on_activation();

		$this->assertNull( $this->stored_version() );
	}
}
