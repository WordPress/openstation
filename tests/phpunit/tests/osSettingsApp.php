<?php

class Tests_OpenStation_OsSettingsApp extends WP_UnitTestCase {

	const APP_ID = 'desktop-mode-os-settings';

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	protected function dispatch( $action, array $state = array(), array $args = array(), array $params = array() ) {
		return openstation_apps_runtime()->dispatch(
			self::APP_ID,
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
				'params' => $params,
			),
			openstation_apps_os()
		);
	}

	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'OpenStation Preferences', $manifest['title'] );
		$this->assertSame( 820, $manifest['width'] );
		$this->assertSame( 720, $manifest['height'] );
		$this->assertSame( 560, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );

		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertNull( $manifest['desktop_icon'] );

		$this->assertSame( 'any', $manifest['admin'] );

		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['icon'] );
		$this->assertStringContainsString( 'currentColor', (string) $manifest['icon_svg'] );

		$this->assertSame( array( 'tab' => 'appearance' ), $manifest['state'] );

		$this->assertSame(
			array( 'extended', 'reset-intros', 'purge-shares', 'focus' ),
			$manifest['actions']
		);
		$this->assertSame( array( 'focus' ), $manifest['lifecycle'] );

		foreach ( array( 'mediaUrl', 'desktopThemesUrl', 'aboutFeedUrl', 'pluginUrl', 'pluginVersion' ) as $key ) {
			$this->assertArrayHasKey( $key, $manifest['config'] );
		}
		$this->assertStringContainsString( 'openstation_about_feed', $manifest['config']['aboutFeedUrl'] );

		$this->assertStringEndsWith( 'os-settings.os.ts', $manifest['client_source'] );
		$this->assertStringEndsWith( 'apps/os-settings/os-settings.css', (string) $manifest['style'] );
		$this->assertFileExists( (string) $manifest['style'] );
	}

	public function test_data_is_prefetched_into_the_window_config() {
		$app      = openstation_apps_registry()->get( self::APP_ID );
		$manifest = $app->manifest();
		$this->assertTrue( $manifest['prefetch'] );

		$config = openstation_apps_client_config( $manifest, __FILE__, $app );
		$this->assertArrayHasKey( 'data', $config );
		$this->assertTrue( $config['data']['isAdmin'] );
		$this->assertArrayHasKey( 'aiAssistant', $config['data'] );

		$this->assertArrayNotHasKey( 'data', openstation_apps_client_config( $manifest, '', $app ) );
	}

	public function test_every_shell_user_may_open_it_but_not_an_anonymous_visitor() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( self::$editor_id );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( 0 );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	public function test_mount_lands_on_the_deep_linked_tab() {
		$response = $this->dispatch( 'mount', array(), array(), array( 'tab' => 'features' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'features', $response['state']['tab'] );

		$plain = $this->dispatch( 'mount' );
		$this->assertSame( 'appearance', $plain['state']['tab'] );
	}

	public function test_data_carries_the_caps_and_the_admin_facts() {
		$data = $this->dispatch( 'mount' )['data'];
		$this->assertTrue( $data['isAdmin'] );
		$this->assertTrue( $data['canUpload'] );
		$this->assertIsBool( $data['canManageDesktopThemes'] );
		$this->assertIsArray( $data['extendedOptions'] );
		$this->assertArrayHasKey( 'games', $data['extendedOptions'] );

		wp_set_current_user( self::$editor_id );
		$data = $this->dispatch( 'mount' )['data'];
		$this->assertFalse( $data['isAdmin'] );

		$this->assertNull( $data['extendedOptions'] );
	}

	public function test_extended_saves_the_site_options_and_spends_a_menu_refresh() {
		$response = $this->dispatch(
			'extended',
			array(),
			array( 'options' => array( 'games' => true ) )
		);
		$this->assertTrue( $response['ok'] );
		$this->assertTrue( $response['data']['extendedOptions']['games'] );
		$this->assertTrue( openstation_get_extended_options()['games'] );

		$this->assertTrue( openstation_get_extended_options()['media_library_enhanced'] );
		$this->assertContains( 'refresh_menu', wp_list_pluck( $response['effects'], 'type' ) );
	}

	public function test_site_truth_actions_refuse_a_non_admin() {
		wp_set_current_user( self::$editor_id );
		foreach ( array( 'extended', 'purge-shares' ) as $action ) {
			$response = $this->dispatch( $action, array(), array( 'enabled' => true, 'options' => array( 'games' => true ) ) );
			$this->assertFalse( $response['ok'], "$action must refuse an editor" );
			$this->assertSame( 500, $response['status'] );
		}
		$this->assertFalse( openstation_get_extended_options()['games'] );
	}

	public function test_reset_intros_clears_the_users_seen_list() {
		openstation_mark_intro_seen( self::$admin_id, 'welcome' );
		$this->assertContains( 'welcome', openstation_get_seen_intros( self::$admin_id ) );

		$response = $this->dispatch( 'reset-intros' );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( array(), openstation_get_seen_intros( self::$admin_id ) );
	}

	public function test_focus_only_recomputes_the_facts() {
		$response = $this->dispatch( 'focus', array( 'tab' => 'windows' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'windows', $response['state']['tab'] );
		$this->assertArrayHasKey( 'aiAssistant', $response['data'] );
	}

	public function test_the_app_stays_under_its_line_budget() {
		$dir   = OPENSTATION_DIR . 'apps/os-settings';
		$files = array_merge(
			glob( $dir . '/*.os.php' ),
			glob( $dir . '/*.os.ts' ),
			array_filter( glob( $dir . '/parts/*.ts' ), static function ( $file ) {
				return ! str_ends_with( $file, '.test.ts' );
			} )
		);
		$lines = 0;
		$mio_lines = 0;
		foreach ( $files as $file ) {
			$count  = count( file( $file ) );
			if ( str_starts_with( basename( $file ), 'mio' ) ) {
				$mio_lines += $count;
			} else {
				$lines += $count;
			}
			$this->assertLessThan(
				1000,
				$count,
				sprintf( '%s outgrew the 1,000-line ceiling — split it along its seams (see docs/app-framework.md, "Splitting a large app").', basename( $file ) )
			);
		}

		$this->assertLessThan( 850, $mio_lines, 'Keep the MIO Preferences adapter focused; generic conversation machinery belongs in src/mio.' );
		$this->assertLessThan( 5000, $lines, sprintf( 'OpenStation Preferences is %d lines; the budget is under 5,000 — two thirds of the panel bundle it replaced.', $lines ) );

		$this->assertCount( 1, glob( $dir . '/*.os.ts' ) );
		$this->assertSame( array(), glob( $dir . '/*.js' ) );
	}
}
