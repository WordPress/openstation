<?php
/**
 * Tests for the one-time OS-settings opt-in migration (migration v1).
 *
 * Migration 1 flips the native list windows from opt-out (default ON)
 * to opt-in Beta (default OFF) and clears the five `native*Enabled`
 * flags from every user who had them persisted, so an existing install
 * reverts to opt-in without losing the rest of each user's settings.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-os-settings
 */
class Tests_DesktopMode_OsSettingsMigration extends WP_UnitTestCase {

	/**
	 * The five native-window flags the migration clears.
	 *
	 * @var string[]
	 */
	private $flags = array(
		'nativePostsEnabled',
		'nativePagesEnabled',
		'nativeUsersEnabled',
		'nativePluginsEnabled',
		'nativeCommentsEnabled',
	);

	public function set_up() {
		parent::set_up();
		// Start every test from a pre-migration state.
		delete_option( DESKTOP_MODE_MIGRATION_OPTION );
	}

	/**
	 * A user who explicitly had the native windows on is reset to opt-in,
	 * and unrelated settings (wallpaper) survive untouched.
	 *
	 * @covers ::desktop_mode_migrate_os_settings_optin
	 */
	public function test_migration_clears_flags_but_preserves_other_settings() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array(
				'wallpaper'             => 'custom-gradient',
				'nativePostsEnabled'    => true,
				'nativePagesEnabled'    => true,
				'nativeUsersEnabled'    => true,
				'nativePluginsEnabled'  => true,
				'nativeCommentsEnabled' => true,
			)
		);

		desktop_mode_migrate_os_settings_optin();

		$loaded = desktop_mode_get_os_settings( $user_id );
		foreach ( $this->flags as $flag ) {
			$this->assertFalse(
				$loaded[ $flag ],
				"`$flag` should be reset to the opt-in default (false) after the migration."
			);
		}
		$this->assertSame(
			'custom-gradient',
			$loaded['wallpaper'],
			'Unrelated settings must survive the migration.'
		);
	}

	/**
	 * A user who never saved any OS settings has no meta row, so the
	 * migration leaves them alone — and they read the new default anyway.
	 *
	 * @covers ::desktop_mode_migrate_os_settings_optin
	 */
	public function test_migration_skips_users_without_meta() {
		$user_id = self::factory()->user->create();

		desktop_mode_migrate_os_settings_optin();

		$raw = get_user_meta( $user_id, DESKTOP_MODE_OS_SETTINGS_META_KEY, true );
		$this->assertSame( '', $raw, 'No meta row should be created for an untouched user.' );

		$loaded = desktop_mode_get_os_settings( $user_id );
		$this->assertFalse( $loaded['nativePostsEnabled'] );
	}

	/**
	 * The runner stamps the option to the shipped version so it never
	 * runs twice, and a user who re-opts-in after the migration keeps
	 * their choice — the guarded runner must not re-clear it.
	 *
	 * @covers ::desktop_mode_maybe_run_migrations
	 */
	public function test_migration_is_guarded_and_does_not_re_run() {
		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		desktop_mode_maybe_run_migrations();

		$this->assertSame(
			DESKTOP_MODE_MIGRATION_VERSION,
			(int) get_option( DESKTOP_MODE_MIGRATION_OPTION ),
			'The migration high-water mark should be stamped after running.'
		);
		$this->assertFalse( desktop_mode_get_os_settings( $user_id )['nativePostsEnabled'] );

		// User deliberately re-enables the native window post-migration.
		desktop_mode_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		// Re-running is a no-op now that the option is at the latest version.
		desktop_mode_maybe_run_migrations();

		$this->assertTrue(
			desktop_mode_get_os_settings( $user_id )['nativePostsEnabled'],
			'A re-opt-in after the migration must not be clobbered by a second run.'
		);
	}

	/**
	 * Running the migration when the option is already current must not
	 * touch user settings at all.
	 *
	 * @covers ::desktop_mode_maybe_run_migrations
	 */
	public function test_maybe_run_is_noop_when_already_current() {
		update_option( DESKTOP_MODE_MIGRATION_OPTION, DESKTOP_MODE_MIGRATION_VERSION, false );

		$user_id = self::factory()->user->create();
		desktop_mode_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		desktop_mode_maybe_run_migrations();

		$this->assertTrue(
			desktop_mode_get_os_settings( $user_id )['nativePostsEnabled'],
			'With the option already current the migration must not run.'
		);
	}
}
