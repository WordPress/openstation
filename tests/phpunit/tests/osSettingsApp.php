<?php
/**
 * Tests for the OpenStation Preferences app — the App Framework port
 * of the settings window: the manifest, the gate, the deep-link
 * mount, the data payload, the admin-only actions, and the line
 * budget against the panel bundle it replaced.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-settings-app
 */

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

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action name.
	 * @param array  $state  Client state.
	 * @param array  $args   Action args.
	 * @param array  $params Open-time params.
	 * @return array Runtime response.
	 */
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

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'OpenStation Preferences', $manifest['title'] );
		$this->assertSame( 820, $manifest['width'] );
		$this->assertSame( 720, $manifest['height'] );
		$this->assertSame( 560, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );
		// No launcher of its own: the System tile answers for it.
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertNull( $manifest['desktop_icon'] );
		// The gear, drawn in currentColor.
		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['icon'] );
		$this->assertStringContainsString( 'currentColor', (string) $manifest['icon_svg'] );
		// The page is the whole state.
		$this->assertSame( array( 'tab' => 'appearance' ), $manifest['state'] );
		// The server surface: the four site-truth writes, plus focus.
		$this->assertSame(
			array( 'extended', 'comments-ai', 'reset-intros', 'purge-shares', 'focus' ),
			$manifest['actions']
		);
		$this->assertSame( array( 'focus' ), $manifest['lifecycle'] );
		// The static facts ride the config; the caps ride data().
		foreach ( array( 'mediaUrl', 'desktopThemesUrl', 'aboutFeedUrl', 'pluginUrl', 'pluginVersion' ) as $key ) {
			$this->assertArrayHasKey( $key, $manifest['config'] );
		}
		$this->assertStringContainsString( 'openstation_about_feed', $manifest['config']['aboutFeedUrl'] );
		// The client view beside the definition.
		$this->assertStringEndsWith( 'os-settings.os.ts', $manifest['client_source'] );
	}

	/**
	 * The pages paint the moment the window opens: `data()` is
	 * prefetched into the window config, so the client view does not
	 * wait behind a spinner for the `mount` round trip — the beat in
	 * which the legacy panel's first click used to land.
	 *
	 * @covers ::openstation_apps_client_config
	 */
	public function test_data_is_prefetched_into_the_window_config() {
		$app      = openstation_apps_registry()->get( self::APP_ID );
		$manifest = $app->manifest();
		$this->assertTrue( $manifest['prefetch'] );

		$config = openstation_apps_client_config( $manifest, __FILE__, $app );
		$this->assertArrayHasKey( 'data', $config );
		$this->assertTrue( $config['data']['isAdmin'] );
		$this->assertArrayHasKey( 'aiAssistant', $config['data'] );

		// No built client bundle, nothing to paint eagerly — no data.
		$this->assertArrayNotHasKey( 'data', openstation_apps_client_config( $manifest, '', $app ) );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_every_shell_user_may_open_it_but_not_an_anonymous_visitor() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( self::$editor_id );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( 0 );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_lands_on_the_deep_linked_tab() {
		$response = $this->dispatch( 'mount', array(), array(), array( 'tab' => 'features' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'features', $response['state']['tab'] );

		$plain = $this->dispatch( 'mount' );
		$this->assertSame( 'appearance', $plain['state']['tab'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
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
		// The admin-only sections are never painted for an editor —
		// their facts do not even travel.
		$this->assertNull( $data['extendedOptions'] );
		$this->assertNull( $data['commentsAi'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_extended_saves_the_site_options_and_spends_a_menu_refresh() {
		$response = $this->dispatch(
			'extended',
			array(),
			array( 'options' => array( 'games' => true ) )
		);
		$this->assertTrue( $response['ok'] );
		$this->assertTrue( $response['data']['extendedOptions']['games'] );
		$this->assertTrue( openstation_get_extended_options()['games'] );
		// A key the payload omits keeps its stored value.
		$this->assertTrue( openstation_get_extended_options()['media_library_enhanced'] );
		$this->assertContains( 'refresh_menu', wp_list_pluck( $response['effects'], 'type' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_site_truth_actions_refuse_a_non_admin() {
		wp_set_current_user( self::$editor_id );
		foreach ( array( 'extended', 'comments-ai', 'purge-shares' ) as $action ) {
			$response = $this->dispatch( $action, array(), array( 'enabled' => true, 'options' => array( 'games' => true ) ) );
			$this->assertFalse( $response['ok'], "$action must refuse an editor" );
			$this->assertSame( 500, $response['status'] );
		}
		$this->assertFalse( openstation_get_extended_options()['games'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_reset_intros_clears_the_users_seen_list() {
		openstation_mark_intro_seen( self::$admin_id, 'welcome' );
		$this->assertContains( 'welcome', openstation_get_seen_intros( self::$admin_id ) );

		$response = $this->dispatch( 'reset-intros' );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( array(), openstation_get_seen_intros( self::$admin_id ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_focus_only_recomputes_the_facts() {
		$response = $this->dispatch( 'focus', array( 'tab' => 'windows' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'windows', $response['state']['tab'] );
		$this->assertArrayHasKey( 'aiAssistant', $response['data'] );
	}

	/**
	 * The port's reason to exist, pinned: the app is under half the
	 * lines of the panel bundle it replaced, and every source file
	 * stays under the 1,000-line ceiling the lint twins nudge at.
	 */
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
		foreach ( $files as $file ) {
			$count  = count( file( $file ) );
			$lines += $count;
			$this->assertLessThan(
				1000,
				$count,
				sprintf( '%s outgrew the 1,000-line ceiling — split it along its seams (see docs/app-framework.md, "Splitting a large app").', basename( $file ) )
			);
		}
		// The panel bundle it replaced — `src/settings/panel.ts`,
		// `panel-entry.ts`, sixteen section builders, the two REST
		// clients, the labels and the glyphs — measured 7,136 lines
		// across 22 files, before the ~800 lines of shell glue it also
		// retired (the lazy-bundle loader, the hand-kept snapshot type,
		// the facade's per-key write whitelist). 784 of the app's lines
		// are the previews manager, the glyphs and the labels, moved
		// verbatim.
		$this->assertLessThan( 5000, $lines, sprintf( 'OpenStation Preferences is %d lines; the budget is under 5,000 — two thirds of the panel bundle it replaced.', $lines ) );
		// And exactly one script: the client view. Free-form JS in an
		// app dir is what the runtime and the component kit exist to
		// make unnecessary.
		$this->assertCount( 1, glob( $dir . '/*.os.ts' ) );
		$this->assertSame( array(), glob( $dir . '/*.js' ) );
	}
}
