<?php

class Tests_OpenStation_OsSettingsMigration extends WP_UnitTestCase {

	private $flags = array(
		'nativePostsEnabled',
		'nativePagesEnabled',
		'nativeUsersEnabled',
		'nativePluginsEnabled',
		'nativeCommentsEnabled',
	);

	public function set_up() {
		parent::set_up();

		delete_option( OPENSTATION_MIGRATION_OPTION );
	}

	public function test_migration_clears_flags_but_preserves_other_settings() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
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

		openstation_migrate_os_settings_optin();

		$loaded = openstation_get_os_settings( $user_id );
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

	public function test_migration_skips_users_without_meta() {
		$user_id = self::factory()->user->create();

		openstation_migrate_os_settings_optin();

		$raw = get_user_meta( $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		$this->assertSame( '', $raw, 'No meta row should be created for an untouched user.' );

		$loaded = openstation_get_os_settings( $user_id );
		$this->assertFalse( $loaded['nativePostsEnabled'] );
	}

	public function test_migration_is_guarded_and_does_not_re_run() {
		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		openstation_maybe_run_migrations();

		$this->assertSame(
			OPENSTATION_MIGRATION_VERSION,
			(int) get_option( OPENSTATION_MIGRATION_OPTION ),
			'The migration high-water mark should be stamped after running.'
		);
		$this->assertFalse( openstation_get_os_settings( $user_id )['nativePostsEnabled'] );

		openstation_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		openstation_maybe_run_migrations();

		$this->assertTrue(
			openstation_get_os_settings( $user_id )['nativePostsEnabled'],
			'A re-opt-in after the migration must not be clobbered by a second run.'
		);
	}

	public function test_maybe_run_is_noop_when_already_current() {
		update_option( OPENSTATION_MIGRATION_OPTION, OPENSTATION_MIGRATION_VERSION, false );

		$user_id = self::factory()->user->create();
		openstation_save_os_settings(
			$user_id,
			array( 'nativePostsEnabled' => true )
		);

		openstation_maybe_run_migrations();

		$this->assertTrue(
			openstation_get_os_settings( $user_id )['nativePostsEnabled'],
			'With the option already current the migration must not run.'
		);
	}
}
