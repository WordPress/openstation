<?php

class Tests_OpenStation_DesktopThemesAssets extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		openstation_register_assets();
	}

	public function tear_down() {
		wp_dequeue_style( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE );
		wp_deregister_style( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE );
		foreach ( array_keys( openstation_desktop_theme_registry() ) as $slug ) {
			openstation_unregister_desktop_theme( $slug );
		}
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, OPENSTATION_OS_SETTINGS_META_KEY );
		unset( $_GET['openstation_chromeless'] );
		parent::tear_down();
	}

	private function seed_upload( $slug = 'house-style' ) {
		$index = openstation_desktop_themes_index();
		$index[ $slug ] = array(
			'slug'        => $slug,
			'installedAt' => 1700000000,
			'manifest'    => array(
				'manifestVersion' => 1,
				'id'              => $slug,
				'slug'            => $slug,
				'name'            => 'House Style',
				'version'         => '1.0.0',
				'author'          => '',
				'description'     => '',
				'preview'         => '',
				'tokens'          => array(),
				'icons'           => array(),
				'textures'        => array(),
			),
		);
		openstation_desktop_themes_put_index( $index );
	}

	private function select( $slug ) {
		openstation_save_os_settings( self::$admin_id, array( 'desktopTheme' => $slug ) );
	}

	public function test_no_selection_resolves_to_empty() {
		$this->assertSame( '', openstation_active_desktop_theme_slug( self::$admin_id ) );
	}

	public function test_installed_selection_resolves() {
		$this->seed_upload();
		$this->select( 'house-style' );
		$this->assertSame( 'house-style', openstation_active_desktop_theme_slug( self::$admin_id ) );
	}

	public function test_code_registered_selection_resolves() {
		openstation_register_desktop_theme( 'acme/neon', array( 'name' => 'Neon' ) );
		$this->select( 'acme-neon' );
		$this->assertSame( 'acme-neon', openstation_active_desktop_theme_slug( self::$admin_id ) );
	}

	public function test_orphaned_selection_degrades_to_empty() {
		$this->select( 'was-deleted' );
		$this->assertSame( '', openstation_active_desktop_theme_slug( self::$admin_id ) );

		$stored = openstation_get_os_settings( self::$admin_id );
		$this->assertSame(
			'was-deleted',
			$stored['desktopTheme'],
			'The stored selection is left alone — the theme may come back.'
		);
	}

	public function test_nothing_is_enqueued_without_a_theme() {
		openstation_enqueue_desktop_theme_style();
		$this->assertFalse( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );
		$this->assertFalse( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'registered' ) );
	}

	public function test_nothing_is_enqueued_for_an_orphaned_selection() {
		$this->select( 'was-deleted' );
		openstation_enqueue_desktop_theme_style();
		$this->assertFalse( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );
	}

	public function test_uploaded_theme_enqueues_the_compiled_file() {
		$this->seed_upload();
		$this->select( 'house-style' );
		openstation_enqueue_desktop_theme_style();

		$this->assertTrue( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );

		$style = wp_styles()->registered[ OPENSTATION_DESKTOP_THEME_STYLE_HANDLE ];
		$this->assertStringContainsString( 'house-style/theme.css', $style->src );
		$this->assertSame( '1700000000', $style->ver, 'installedAt busts the cache.' );
	}

	public function test_style_depends_on_openstation_variables() {
		$this->seed_upload();
		$this->select( 'house-style' );
		openstation_enqueue_desktop_theme_style();

		$style = wp_styles()->registered[ OPENSTATION_DESKTOP_THEME_STYLE_HANDLE ];
		$this->assertContains(
			'os-variables',
			$style->deps,
			'The dependency is load-bearing, not decoration — see compile.php.'
		);
	}

	public function test_code_theme_inlines_its_compiled_css() {
		openstation_register_desktop_theme( 'acme/neon', array(
			'name'   => 'Neon',
			'tokens' => array( '--os-window-radius' => '14px' ),
		) );
		$this->select( 'acme-neon' );
		openstation_enqueue_desktop_theme_style();

		$this->assertTrue( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );

		$style = wp_styles()->registered[ OPENSTATION_DESKTOP_THEME_STYLE_HANDLE ];
		$this->assertFalse( $style->src );
		$this->assertContains( 'os-variables', $style->deps );

		$inline = implode( '', (array) $style->extra['after'] );
		$this->assertStringContainsString( '--os-window-radius: 14px;', $inline );
	}

	public function test_nothing_is_enqueued_in_chromeless_requests() {
		$this->seed_upload();
		$this->select( 'house-style' );
		$_GET['openstation_chromeless'] = '1';

		openstation_enqueue_desktop_theme_style();
		$this->assertFalse( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );
	}

	public function test_nothing_is_enqueued_when_openstation_is_off() {
		$this->seed_upload();
		$this->select( 'house-style' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		openstation_enqueue_desktop_theme_style();
		$this->assertFalse( wp_style_is( OPENSTATION_DESKTOP_THEME_STYLE_HANDLE, 'enqueued' ) );
	}

	public function test_body_class_is_appended_as_a_string() {
		$this->seed_upload();
		$this->select( 'house-style' );

		$classes = openstation_desktop_theme_body_class( 'existing-class' );
		$this->assertIsString( $classes, 'admin_body_class is a STRING filter.' );
		$this->assertStringContainsString( 'existing-class', $classes );
		$this->assertStringContainsString( 'os-desktop-theme-house-style', $classes );
	}

	public function test_body_class_is_untouched_without_a_theme() {
		$this->assertSame( 'existing-class', openstation_desktop_theme_body_class( 'existing-class' ) );
	}

	public function test_shell_stamps_the_theme_attribute() {
		$this->seed_upload();
		$this->select( 'house-style' );

		ob_start();
		openstation_render_shell();
		$html = ob_get_clean();

		$this->assertStringContainsString(
			'data-os-desktop-theme="house-style"',
			$html
		);
	}

	public function test_shell_omits_the_attribute_without_a_theme() {
		ob_start();
		openstation_render_shell();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'id="os-shell"', $html );
		$this->assertStringNotContainsString( 'data-os-desktop-theme', $html );
	}

	public function test_shell_config_carries_capability_and_url() {
		$config = openstation_desktop_theme_inject_shell_config( array() );

		$this->assertTrue( $config['canManageDesktopThemes'] );
		$this->assertStringContainsString(
			'desktop-mode/v1/desktop-themes',
			$config['desktopThemesUrl']
		);
	}

	public function test_shell_config_carries_the_theme_library() {
		openstation_register_desktop_theme( 'acme/neon', array( 'name' => 'Neon' ) );

		$config = openstation_build_menu_payload();
		$this->assertArrayHasKey( 'serverDesktopThemes', $config );

		$shell = apply_filters( 'openstation_shell_config', array() );
		$this->assertArrayHasKey( 'canManageDesktopThemes', $shell );

		$source = file_get_contents( OPENSTATION_DIR . 'includes/render/assets.php' );
		$this->assertStringContainsString(
			"'serverDesktopThemes'",
			$source,
			'The shell config must ship the theme library or the client registry seeds empty.'
		);

		openstation_unregister_desktop_theme( 'acme-neon' );
	}

	public function test_non_admin_cannot_manage() {
		wp_set_current_user( self::$editor_id );
		$config = openstation_desktop_theme_inject_shell_config( array() );
		$this->assertFalse( $config['canManageDesktopThemes'] );
	}
}
