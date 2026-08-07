<?php
/**
 * Tests for running the migrations at activation.
 *
 * Migration 5 reconstructs who used the shell before the rename from
 * user meta, and that only holds while the meta is older than the
 * runner. On a new install it need not be: activation may run no
 * `admin_init` at all (WP-CLI, a Playground Blueprint, a provisioning
 * script), leaving the runner pending until after the portal has
 * auto-enabled the shell and written the very key it scans for. Running
 * at activation is what keeps a minute-old site from being told about a
 * rename it never lived through.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group migrations
 */
class Tests_OpenStation_MigrationActivation extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Every test starts before activation.
		delete_option( OPENSTATION_MIGRATION_OPTION );
	}

	/** The stored high-water mark, or null when nothing is stored. */
	private function stored_version() {
		$stored = get_option( OPENSTATION_MIGRATION_OPTION, false );
		return false === $stored ? null : (int) $stored;
	}

	/**
	 * The runner is wired to activation.
	 *
	 * Every other test here calls the function directly, so they would
	 * all pass with the hook unregistered.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_runner_is_registered_on_activation() {
		$this->assertNotFalse(
			has_action(
				'activate_' . plugin_basename( OPENSTATION_FILE ),
				'openstation_run_migrations_on_activation'
			)
		);
	}

	/**
	 * The registration is reachable from a non-admin request.
	 *
	 * The assertion above cannot catch this: `WP_TESTS_DOMAIN` makes
	 * `openstation_request_needs_admin_modules()` true for the whole
	 * suite, so the hook is registered here however the loader is
	 * written. Read the loader instead, and pin the require ahead of the
	 * admin-only block. Move it inside and a Playground-style activation
	 * silently stops running migrations.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
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

	/**
	 * A site with no history records the shipped version at activation.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_activation_records_the_shipped_version() {
		self::factory()->user->create();

		openstation_run_migrations_on_activation();

		$this->assertSame( OPENSTATION_MIGRATION_VERSION, $this->stored_version() );
	}

	/**
	 * Every migration runs, not just the one the gate is about.
	 *
	 * The gate reads user meta, and site-level leftovers are invisible to
	 * it: a stored AI credential (migration 3) outlives the user who
	 * saved it, since deleting a user drops their meta. Retiring the
	 * runner without running it would leave that key in the database
	 * forever.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
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

	/**
	 * Queued AI cron events are unscheduled too.
	 *
	 * Same shape as the credential: migration 2's work is site-level and
	 * no user meta predicts it.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_activation_still_unschedules_stale_ai_cron() {
		wp_schedule_single_event( time() + HOUR_IN_SECONDS, 'desktop_mode_ai_analyze_post', array( 1 ) );
		self::factory()->user->create();

		openstation_run_migrations_on_activation();

		$this->assertFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 1 ) ),
			'Migration 2 should have unscheduled the leftover event.'
		);
	}

	/**
	 * Activation leaves nothing for the `admin_init` runner to do.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_activated_install_runs_no_further_migration() {
		$user_id = self::factory()->user->create();
		openstation_run_migrations_on_activation();

		// The runner would flag this user if it ran again.
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		openstation_maybe_run_migrations();

		$this->assertFalse(
			(bool) get_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true )
		);
	}

	/**
	 * The regression: a programmatic install whose first admin load
	 * arrives via the portal.
	 *
	 * Activation runs no `admin_init`; `/openstation/` then auto-enables
	 * the shell on the front end and writes `desktop_mode_mode`; the
	 * redirect into wp-admin is the first `admin_init`. Run only there,
	 * migration 5 reads meta written seconds earlier as proof of years of
	 * use, and the desk opens on the rebrand announcement.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_portal_auto_enable_after_activation_earns_no_notice() {
		$user_id = self::factory()->user->create();

		openstation_run_migrations_on_activation();          // Activation.
		update_user_meta( $user_id, 'desktop_mode_mode', '1' ); // Portal.
		openstation_maybe_run_migrations();                    // First admin_init.

		wp_set_current_user( $user_id );
		$this->assertFalse(
			openstation_should_show_rebrand_notice(),
			'A site created minutes ago has only ever been OpenStation.'
		);
	}

	/**
	 * An install that has already run migrations keeps its own version.
	 *
	 * Activation fires on a plain deactivate/reactivate too, and the
	 * stored mark is the truth there.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
	public function test_existing_version_is_never_moved() {
		update_option( OPENSTATION_MIGRATION_OPTION, 2, false );

		openstation_run_migrations_on_activation();

		$this->assertSame( 2, $this->stored_version() );
	}

	/**
	 * A pre-runner install being reactivated is left to `admin_init`, and
	 * its users still get the announcement.
	 *
	 * The runner shipped in 0.9.1, so a site coming from 0.9.0 has no
	 * stored version either. Only the users tell the two apart.
	 *
	 * @covers ::openstation_run_migrations_on_activation
	 */
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

	/**
	 * Saved settings count as prior use on their own.
	 *
	 * Someone who used the shell, customized it and switched back to
	 * classic has an empty `desktop_mode_mode` but a stored snapshot.
	 *
	 * @covers ::openstation_users_with_prior_desktop_use
	 */
	public function test_saved_settings_alone_defer_to_admin_init() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings( $user_id, array( 'wallpaper' => 'custom-gradient' ) );

		openstation_run_migrations_on_activation();

		$this->assertNull( $this->stored_version() );
	}
}
