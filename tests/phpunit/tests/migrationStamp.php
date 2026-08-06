<?php
/**
 * Tests for the activation-time migration stamp.
 *
 * Every migration in `includes/migrations.php` reconstructs something
 * about a site's past, and migration 5 does it by reading user meta.
 * That only holds while the meta predates the runner, and on a fresh
 * install it need not: activation may run no `admin_init` at all (
 * WP-CLI, a Playground Blueprint, a provisioning script), leaving the
 * runner pending until after the portal has auto-enabled the shell and
 * written the very key it scans for. Stamping the shipped version at
 * activation is what keeps a minute-old site from being told about a
 * rename it never lived through.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group migrations
 */
class Tests_OpenStation_MigrationStamp extends WP_UnitTestCase {

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
	 * The stamp is wired to activation.
	 *
	 * Every other test here calls the function directly, so they would
	 * all pass with the hook unregistered. `includes/migrations.php`
	 * loads unconditionally for this reason: a programmatic activation
	 * need not look like an admin request, and a hook registered only on
	 * admin requests would miss exactly the installs this fixes.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_stamp_is_registered_on_activation() {
		$this->assertNotFalse(
			has_action(
				'activate_' . plugin_basename( OPENSTATION_FILE ),
				'openstation_stamp_migrations_on_fresh_install'
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
	 * silently stops stamping.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
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
	 * A genuinely fresh install records the shipped version outright.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_fresh_install_is_stamped_at_the_shipped_version() {
		self::factory()->user->create();

		openstation_stamp_migrations_on_fresh_install();

		$this->assertSame( OPENSTATION_MIGRATION_VERSION, $this->stored_version() );
	}

	/**
	 * The stamp leaves nothing for the runner to do.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_stamped_install_runs_no_migration() {
		$user_id = self::factory()->user->create();
		openstation_stamp_migrations_on_fresh_install();

		// The runner would flag this user if it ran at all.
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
	 * redirect into wp-admin is the first `admin_init`. Without the
	 * stamp, migration 5 reads meta written seconds earlier as proof of
	 * years of use, and the desk opens on the rebrand announcement.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_portal_auto_enable_after_activation_earns_no_notice() {
		$user_id = self::factory()->user->create();

		openstation_stamp_migrations_on_fresh_install();      // Activation.
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
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_existing_version_is_never_moved() {
		update_option( OPENSTATION_MIGRATION_OPTION, 2, false );

		openstation_stamp_migrations_on_fresh_install();

		$this->assertSame( 2, $this->stored_version() );
	}

	/**
	 * A pre-runner install being reactivated is not mistaken for a fresh
	 * one, and its users still get the announcement.
	 *
	 * The runner shipped in 0.9.1, so a site coming from 0.9.0 has no
	 * stored version either. Only the users tell the two apart.
	 *
	 * @covers ::openstation_stamp_migrations_on_fresh_install
	 */
	public function test_prior_use_blocks_the_stamp() {
		$user_id = self::factory()->user->create();
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );

		openstation_stamp_migrations_on_fresh_install();

		$this->assertNull(
			$this->stored_version(),
			'A site with history has migrations to run.'
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
	public function test_saved_settings_alone_block_the_stamp() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings( $user_id, array( 'wallpaper' => 'custom-gradient' ) );

		openstation_stamp_migrations_on_fresh_install();

		$this->assertNull( $this->stored_version() );
	}
}
