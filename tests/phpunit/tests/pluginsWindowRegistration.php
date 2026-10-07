<?php

class Tests_OpenStation_PluginsWindowRegistration extends WP_UnitTestCase {

	private $admin_id;
	private $editor_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id     = self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		if ( is_multisite() ) {
			grant_super_admin( $this->admin_id );
		}
	}

	public function tear_down() {

		remove_all_filters( 'openstation_plugins_window_user_can_register' );
		remove_all_filters( 'openstation_plugins_window_user_can_use' );
		remove_all_filters( 'openstation_plugins_window_auto_updates_enabled' );
		remove_all_filters( 'openstation_plugins_window_refresh_updates' );
		remove_all_filters( 'openstation_plugins_window_icon_url' );
		remove_all_filters( 'openstation_plugins_window_local_icon_candidates' );
		remove_all_filters( 'auto_update_plugin' );
		parent::tear_down();
	}

	public function test_register_gate_open_for_admin_without_opt_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertTrue( openstation_plugins_window_user_can_register() );
	}

	public function test_register_gate_closed_for_editor() {

		wp_set_current_user( $this->editor_id );
		$this->assertFalse( openstation_plugins_window_user_can_register() );
	}

	public function test_register_gate_closed_for_subscriber() {
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( openstation_plugins_window_user_can_register() );
	}

	public function test_register_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_plugins_window_user_can_register() );
	}

	public function test_register_filter_can_block_a_capable_user() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'openstation_plugins_window_user_can_register', '__return_false' );
		$this->assertFalse( openstation_plugins_window_user_can_register() );
	}

	public function test_gate_closed_by_default_until_admin_opts_in() {
		wp_set_current_user( $this->admin_id );
		$this->assertFalse( openstation_plugins_window_user_can_use() );

		openstation_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => true )
		);
		$this->assertTrue( openstation_plugins_window_user_can_use() );
	}

	public function test_gate_closes_when_admin_opts_out() {
		wp_set_current_user( $this->admin_id );
		openstation_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$this->assertFalse( openstation_plugins_window_user_can_use() );
	}

	public function test_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_plugins_window_user_can_use() );
	}

	public function test_filter_can_force_gate_open() {
		wp_set_current_user( $this->editor_id );

		$this->assertFalse( openstation_plugins_window_user_can_use() );

		add_filter( 'openstation_plugins_window_user_can_use', '__return_true' );
		$this->assertTrue( openstation_plugins_window_user_can_use() );
	}

	public function test_filter_can_force_gate_closed() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'openstation_plugins_window_user_can_use', '__return_false' );
		$this->assertFalse( openstation_plugins_window_user_can_use() );
	}

	public function test_caps_admin_has_every_action() {
		wp_set_current_user( $this->admin_id );
		$caps = openstation_plugins_window_caps();
		$this->assertTrue( $caps['activate'] );
		if ( is_multisite() ) {

			$this->assertFalse( $caps['install'] );
			$this->assertFalse( $caps['delete'] );
			$this->assertFalse( $caps['upload'] );
		} else {
			$this->assertTrue( $caps['install'] );
			$this->assertTrue( $caps['delete'] );
			$this->assertTrue( $caps['upload'] );
		}
	}

	public function test_caps_editor_has_no_plugin_actions() {
		wp_set_current_user( $this->editor_id );
		$caps = openstation_plugins_window_caps();
		$this->assertFalse( $caps['activate'] );
		$this->assertFalse( $caps['install'] );
		$this->assertFalse( $caps['delete'] );
		$this->assertFalse( $caps['upload'] );
	}

	public function test_caps_logged_out_user_returns_false_for_every_action() {
		wp_set_current_user( 0 );
		$caps = openstation_plugins_window_caps();
		$this->assertFalse( $caps['activate'] );
		$this->assertFalse( $caps['install'] );
		$this->assertFalse( $caps['delete'] );
		$this->assertFalse( $caps['upload'] );
	}

	public function test_editor_url_follows_cores_plugins_menu_row() {
		foreach ( array( 'twentytwentyone', 'twentytwentyfive' ) as $slug ) {
			if ( ! wp_get_theme( $slug )->exists() ) {
				$this->markTestSkipped( "Needs the {$slug} theme." );
			}
		}

		$this->use_theme( 'twentytwentyone' );
		$this->assertSame(
			is_multisite() ? '' : admin_url( 'plugin-editor.php' ),
			openstation_plugins_window_editor_url( $this->admin_id )
		);
		$this->assertSame( '', openstation_plugins_window_editor_url( $this->editor_id ) );

		$this->use_theme( 'twentytwentyfive' );
		$this->assertSame( '', openstation_plugins_window_editor_url( $this->admin_id ) );
	}

	private function use_theme( $slug ) {
		update_option( 'stylesheet', $slug );
		update_option( 'template', $slug );
		wp_clean_themes_cache();
	}

	public function test_native_plugins_enabled_round_trips_through_os_settings() {
		openstation_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => false )
		);
		$loaded = openstation_get_os_settings( $this->admin_id );
		$this->assertArrayHasKey( 'nativePluginsEnabled', $loaded );
		$this->assertFalse( $loaded['nativePluginsEnabled'] );

		openstation_save_os_settings(
			$this->admin_id,
			array( 'nativePluginsEnabled' => true )
		);
		$loaded = openstation_get_os_settings( $this->admin_id );
		$this->assertTrue( $loaded['nativePluginsEnabled'] );
	}

	public function test_native_plugins_enabled_defaults_off() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'nativePluginsEnabled', $defaults );
		$this->assertFalse( $defaults['nativePluginsEnabled'] );
	}

	public function test_can_manage_field_for_active_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'active',
		);
		$flags = openstation_plugins_window_field_can_manage( $row );
		$this->assertFalse( $flags['activate'] );
		$this->assertTrue( $flags['deactivate'] );
		$this->assertFalse( $flags['delete'] );
	}

	public function test_can_manage_field_for_inactive_plugin_row() {
		wp_set_current_user( $this->admin_id );
		$row = array(
			'plugin' => 'fake/fake.php',
			'status' => 'inactive',
		);
		$flags = openstation_plugins_window_field_can_manage( $row );
		$this->assertTrue( $flags['activate'] );
		$this->assertFalse( $flags['deactivate'] );

		$this->assertSame( ! is_multisite(), $flags['delete'] );
	}

	public function test_update_available_field_reports_false_when_no_update() {

		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
			)
		);
		$row = array( 'plugin' => 'never/installed.php' );
		$out = openstation_plugins_window_field_update_available( $row );
		$this->assertFalse( $out['available'] );
		$this->assertNull( $out['new_version'] );
	}

	public function test_update_available_field_reports_true_when_transient_has_entry() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(

					'hello-dolly/hello.php' => (object) array(
						'new_version' => '99.0.0',
						'package'     => 'https://downloads.wordpress.org/plugin/hello-dolly.99.0.0.zip',
						'slug'        => 'hello-dolly',
					),
				),
			)
		);

		$row = array( 'plugin' => 'hello-dolly/hello' );
		$out = openstation_plugins_window_field_update_available( $row );
		$this->assertTrue( $out['available'] );
		$this->assertSame( '99.0.0', $out['new_version'] );
		$this->assertSame(
			'https://downloads.wordpress.org/plugin/hello-dolly.99.0.0.zip',
			$out['package'],
			'`package` is the download URL the JS gates the Update button on.'
		);
		$this->assertSame( 'hello-dolly', $out['slug'] );
	}

	public function test_update_available_field_handles_missing_package() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(
					'premium/premium.php' => (object) array(
						'new_version' => '2.0',

					),
				),
			)
		);
		$row = array( 'plugin' => 'premium/premium' );
		$out = openstation_plugins_window_field_update_available( $row );
		$this->assertTrue( $out['available'] );
		$this->assertSame( '2.0', $out['new_version'] );
		$this->assertSame( '', $out['package'] );
	}

	public function test_caps_surface_includes_update_for_admins() {
		wp_set_current_user( $this->admin_id );
		$caps = openstation_plugins_window_caps();
		$this->assertArrayHasKey( 'update', $caps );
		$this->assertTrue( $caps['update'] );
	}

	public function test_caps_surface_denies_update_for_editor() {
		wp_set_current_user( $this->editor_id );
		$caps = openstation_plugins_window_caps();
		$this->assertFalse( $caps['update'] );
	}

	public function test_maybe_refresh_respects_12h_throttle() {
		$snapshot = (object) array(
			'last_checked' => time() - 60,
			'response'     => array( 'foo/foo.php' => (object) array( 'new_version' => '2.0' ) ),
		);
		set_site_transient( 'update_plugins', $snapshot );

		openstation_plugins_window_maybe_refresh_update_transient();

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals( $snapshot, $after, 'Fresh transient should not be refreshed.' );
	}

	public function test_maybe_refresh_filter_can_opt_out() {
		$snapshot = (object) array(
			'last_checked' => time() - DAY_IN_SECONDS,
			'response'     => array(),
		);
		set_site_transient( 'update_plugins', $snapshot );

		add_filter( 'openstation_plugins_window_refresh_updates', '__return_false' );
		openstation_plugins_window_maybe_refresh_update_transient();
		remove_filter( 'openstation_plugins_window_refresh_updates', '__return_false' );

		$after = get_site_transient( 'update_plugins' );
		$this->assertEquals(
			$snapshot,
			$after,
			'Filter returning false should skip the refresh and leave the stale snapshot untouched.'
		);
	}

	public function test_wporg_slug_reads_the_response_bucket() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(
					'hello.php' => (object) array(
						'new_version' => '99.0.0',
						'slug'        => 'hello-dolly',
					),
				),
			)
		);

		$this->assertSame(
			'hello-dolly',
			openstation_plugins_window_field_wporg_slug( array( 'plugin' => 'hello' ) )
		);
	}

	public function test_wporg_slug_reads_the_no_update_bucket() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);
		$this->assertSame(
			'akismet',
			openstation_plugins_window_field_wporg_slug(
				array( 'plugin' => 'akismet/akismet' )
			)
		);
	}

	public function test_wporg_slug_is_null_for_a_plugin_not_on_the_directory() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);
		$this->assertNull(
			openstation_plugins_window_field_wporg_slug(
				array(
					'plugin'     => 'acme-private-widgets/acme-private-widgets',
					'textdomain' => 'acme-private-widgets',
				)
			)
		);
	}

	public function test_wporg_slug_prefers_the_api_slug_over_the_folder_name() {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'wp-seo/wp-seo.php' => (object) array( 'slug' => 'wordpress-seo' ),
				),
			)
		);
		$this->assertSame(
			'wordpress-seo',
			openstation_plugins_window_field_wporg_slug(
				array( 'plugin' => 'wp-seo/wp-seo' )
			)
		);
	}

	public function test_wporg_slug_is_null_when_the_transient_is_empty() {
		set_site_transient(
			'update_plugins',
			(object) array( 'last_checked' => time() )
		);
		$this->assertNull(
			openstation_plugins_window_field_wporg_slug(
				array( 'plugin' => 'akismet/akismet' )
			)
		);
	}

	public function test_icon_url_derives_from_folder_slug() {
		$row = array(
			'plugin'     => 'akismet/akismet.php',
			'textdomain' => 'akismet',
		);
		$url = openstation_plugins_window_field_icon_url( $row );
		$this->assertSame(
			'https://ps.w.org/akismet/assets/icon.svg',
			$url
		);
	}

	public function test_icon_url_prefers_folder_over_mismatched_textdomain() {
		$row = array(
			'plugin'     => 'woocommerce/woocommerce.php',
			'textdomain' => 'woo',
		);
		$url = openstation_plugins_window_field_icon_url( $row );
		$this->assertSame(
			'https://ps.w.org/woocommerce/assets/icon.svg',
			$url
		);
	}

	public function test_icon_url_works_without_textdomain() {
		$row = array( 'plugin' => 'something/something.php' );
		$this->assertSame(
			'https://ps.w.org/something/assets/icon.svg',
			openstation_plugins_window_field_icon_url( $row )
		);
	}

	public function test_icon_url_single_file_uses_textdomain_fallback() {
		$row = array(
			'plugin'     => 'hello.php',
			'textdomain' => 'hello-dolly',
		);
		$this->assertSame(
			'https://ps.w.org/hello-dolly/assets/icon.svg',
			openstation_plugins_window_field_icon_url( $row )
		);

		$this->assertNull(
			openstation_plugins_window_field_icon_url( array( 'plugin' => 'hello.php' ) )
		);
	}

	public function test_icon_url_prefers_directory_icons_over_guess() {
		$icons = array(
			'1x' => 'https://ps.w.org/gutenberg/assets/icon-128x128.jpg',
			'2x' => 'https://ps.w.org/gutenberg/assets/icon-256x256.jpg?rev=1776042',
		);

		$this->prime_update_transient( 'gutenberg/gutenberg.php', $icons );
		$this->assertSame(
			$icons['2x'],
			openstation_plugins_window_field_icon_url(
				array( 'plugin' => 'gutenberg/gutenberg.php' )
			)
		);

		$icons['svg'] = 'https://ps.w.org/gutenberg/assets/icon.svg';
		$this->prime_update_transient( 'gutenberg/gutenberg.php', $icons );
		$this->assertSame(
			$icons['svg'],
			openstation_plugins_window_field_icon_url(
				array( 'plugin' => 'gutenberg/gutenberg.php' )
			)
		);
	}

	public function test_icon_url_survives_a_slug_that_is_not_the_folder() {
		$this->prime_update_transient(
			'hello.php',
			array( '2x' => 'https://ps.w.org/hello-dolly/assets/icon-256x256.jpg' ),
			'hello-dolly'
		);

		$this->assertSame(
			'https://ps.w.org/hello-dolly/assets/icon-256x256.jpg',
			openstation_plugins_window_field_icon_url(
				array( 'plugin' => 'hello.php' )
			)
		);
	}

	public function test_icon_url_is_null_when_wporg_reports_no_art() {
		$this->prime_update_transient(
			'plain/plain.php',
			array( 'default' => 'https://s.w.org/plugins/geopattern-icon/plain.svg' )
		);

		$this->assertNull(
			openstation_plugins_window_field_icon_url(
				array( 'plugin' => 'plain/plain.php' )
			)
		);
	}

	public function test_icon_url_still_guesses_when_wporg_says_nothing() {
		$this->prime_update_transient( 'plain/plain.php', array() );

		$this->assertSame(
			'https://ps.w.org/plain/assets/icon.svg',
			openstation_plugins_window_field_icon_url(
				array( 'plugin' => 'plain/plain.php' )
			)
		);
	}

	private function prime_update_transient( $plugin_file, $icons, $slug = '' ) {
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					$plugin_file => (object) array(
						'slug'  => '' !== $slug ? $slug : dirname( $plugin_file ),
						'icons' => $icons,
					),
				),
			)
		);
	}

	public function test_icon_url_filter_can_override() {
		add_filter(
			'openstation_plugins_window_icon_url',
			static function ( $url, $slug ) {
				return 'https://cdn.example.com/' . $slug . '.png';
			},
			10,
			2
		);
		$row = array(
			'plugin'     => 'custom/custom.php',
			'textdomain' => 'custom',
		);
		$url = openstation_plugins_window_field_icon_url( $row );
		$this->assertSame( 'https://cdn.example.com/custom.png', $url );
		remove_all_filters( 'openstation_plugins_window_icon_url' );
	}

	public function test_icon_url_prefers_local_assets_icon_svg() {
		$folder = 'dm-local-icon-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/assets' );
		file_put_contents( $root . '/assets/icon.svg', '<svg/>' );

		try {
			$url = openstation_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertSame(
				plugins_url( 'assets/icon.svg', WP_PLUGIN_DIR . '/' . $folder . '/' . $folder . '.php' ),
				$url
			);
			$this->assertStringContainsString( '/' . $folder . '/assets/icon.svg', (string) $url );
		} finally {
			unlink( $root . '/assets/icon.svg' );
			rmdir( $root . '/assets' );
			rmdir( $root );
		}
	}

	public function test_icon_url_falls_through_to_local_png_variants() {
		$folder = 'dm-local-icon-png-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/assets' );
		file_put_contents( $root . '/assets/icon-256x256.png', 'png' );

		try {
			$url = openstation_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertStringContainsString( '/' . $folder . '/assets/icon-256x256.png', (string) $url );
		} finally {
			unlink( $root . '/assets/icon-256x256.png' );
			rmdir( $root . '/assets' );
			rmdir( $root );
		}
	}

	public function test_icon_url_falls_back_to_wp_org_when_no_local_icon() {

		$row = array( 'plugin' => 'this-plugin-folder-does-not-exist-on-disk/main.php' );
		$this->assertSame(
			'https://ps.w.org/this-plugin-folder-does-not-exist-on-disk/assets/icon.svg',
			openstation_plugins_window_field_icon_url( $row )
		);
	}

	public function test_icon_url_local_candidates_filter() {
		$folder = 'dm-local-icon-custom-fixture';
		$root   = WP_PLUGIN_DIR . '/' . $folder;
		wp_mkdir_p( $root . '/branding' );
		file_put_contents( $root . '/branding/logo.svg', '<svg/>' );

		add_filter(
			'openstation_plugins_window_local_icon_candidates',
			static function ( $candidates ) {
				$candidates[] = 'branding/logo.svg';
				return $candidates;
			}
		);

		try {
			$url = openstation_plugins_window_field_icon_url(
				array( 'plugin' => $folder . '/' . $folder . '.php' )
			);
			$this->assertStringContainsString( '/' . $folder . '/branding/logo.svg', (string) $url );
		} finally {
			remove_all_filters( 'openstation_plugins_window_local_icon_candidates' );
			unlink( $root . '/branding/logo.svg' );
			rmdir( $root . '/branding' );
			rmdir( $root );
		}
	}

	public function test_icon_url_single_file_plugin_skips_local_probe() {
		$this->assertNull(
			openstation_plugins_window_local_icon_url( 'hello.php' )
		);
		$this->assertNull(
			openstation_plugins_window_local_icon_url( '' )
		);
	}

	public function test_auto_update_field_reports_enabled_when_in_option_and_supported() {
		update_site_option( 'auto_update_plugins', array( 'akismet/akismet.php' ) );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),

				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);

		$row = array(
			'plugin'     => 'akismet/akismet',
			'textdomain' => 'akismet',
		);
		$out = openstation_plugins_window_field_auto_update( $row );
		$this->assertTrue( $out['enabled'] );
		$this->assertTrue( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	public function test_auto_update_field_reports_disabled_when_not_in_option() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'akismet/akismet.php' => (object) array( 'slug' => 'akismet' ),
				),
			)
		);
		$row = array(
			'plugin'     => 'akismet/akismet',
			'textdomain' => 'akismet',
		);
		$out = openstation_plugins_window_field_auto_update( $row );
		$this->assertFalse( $out['enabled'] );
		$this->assertTrue( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	public function test_auto_update_field_reports_unsupported_when_not_in_transient() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(),
			)
		);
		$row = array( 'plugin' => 'premium/premium' );
		$out = openstation_plugins_window_field_auto_update( $row );
		$this->assertFalse( $out['enabled'] );
		$this->assertFalse( $out['supported'] );
		$this->assertNull( $out['forced'] );
	}

	public function test_auto_update_field_respects_filter_forcing_enabled() {
		update_site_option( 'auto_update_plugins', array() );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'forced/forced.php' => (object) array( 'slug' => 'forced' ),
				),
			)
		);
		$callback = static function ( $update, $item ) {
			if ( isset( $item->plugin ) && 'forced/forced.php' === $item->plugin ) {
				return true;
			}
			return $update;
		};
		add_filter( 'auto_update_plugin', $callback, 10, 2 );
		try {
			$row = array( 'plugin' => 'forced/forced' );
			$out = openstation_plugins_window_field_auto_update( $row );
			$this->assertTrue( $out['forced'] );
			$this->assertTrue(
				$out['enabled'],
				'A filter that pins forced=true must yield enabled=true even when the option is empty.'
			);
		} finally {
			remove_filter( 'auto_update_plugin', $callback, 10 );
		}
	}

	public function test_auto_update_field_respects_filter_forcing_disabled() {

		update_site_option( 'auto_update_plugins', array( 'forced/forced.php' ) );
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(
					'forced/forced.php' => (object) array( 'slug' => 'forced' ),
				),
			)
		);
		$callback = static function ( $update, $item ) {
			if ( isset( $item->plugin ) && 'forced/forced.php' === $item->plugin ) {
				return false;
			}
			return $update;
		};
		add_filter( 'auto_update_plugin', $callback, 10, 2 );
		try {
			$row = array( 'plugin' => 'forced/forced' );
			$out = openstation_plugins_window_field_auto_update( $row );
			$this->assertFalse( $out['forced'] );
			$this->assertFalse( $out['enabled'] );
		} finally {
			remove_filter( 'auto_update_plugin', $callback, 10 );
		}
	}

	public function test_auto_updates_enabled_filter_can_force_off() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'openstation_plugins_window_auto_updates_enabled', '__return_false' );
		try {
			$this->assertFalse( openstation_plugins_window_auto_updates_enabled() );
		} finally {
			remove_all_filters( 'openstation_plugins_window_auto_updates_enabled' );
		}
	}

	public function test_auto_updates_enabled_closed_for_users_without_update_cap() {
		wp_set_current_user( $this->editor_id );
		$this->assertFalse( openstation_plugins_window_auto_updates_enabled() );
		wp_set_current_user( 0 );
		$this->assertFalse( openstation_plugins_window_auto_updates_enabled() );
	}

	public function test_force_refresh_deletes_the_update_plugins_transient_and_calls_wp_update_plugins() {

		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'checked'      => array(),
			)
		);

		$http_attempts = 0;
		$blocker       = static function () use ( &$http_attempts ) {
			++$http_attempts;

			return new WP_Error( 'http_blocked', 'blocked in tests' );
		};
		add_filter( 'pre_http_request', $blocker );
		try {
			openstation_plugins_window_maybe_refresh_update_transient( true );
		} finally {
			remove_filter( 'pre_http_request', $blocker );
		}

		$this->assertGreaterThan(
			0,
			$http_attempts,
			'Force path must call wp_update_plugins() (an outbound api.wordpress.org request).'
		);

		$after = get_site_transient( 'update_plugins' );
		if ( is_object( $after ) ) {
			$this->assertEmpty(
				(array) ( $after->response ?? array() ),
				'Force path must clear the cached `response` map.'
			);
		} else {
			$this->assertFalse( $after );
		}
	}

	public function test_force_refresh_respects_short_circuit_filter() {
		$initial = (object) array(
			'last_checked' => time() - DAY_IN_SECONDS,
			'response'     => array(),
			'checked'      => array(),
		);
		set_site_transient( 'update_plugins', $initial );

		$saw_force = null;
		add_filter(
			'openstation_plugins_window_refresh_updates',
			static function ( $refresh, $force ) use ( &$saw_force ) {
				$saw_force = $force;
				return false;
			},
			10,
			2
		);

		try {
			openstation_plugins_window_maybe_refresh_update_transient( true );
		} finally {
			remove_all_filters( 'openstation_plugins_window_refresh_updates' );
		}

		$this->assertTrue( $saw_force, 'Filter must receive the force flag.' );

		$this->assertEquals(
			$initial,
			get_site_transient( 'update_plugins' ),
			'Filter must be able to suppress even the force-refresh path.'
		);
	}
}
