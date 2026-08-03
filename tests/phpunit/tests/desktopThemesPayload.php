<?php
/**
 * Tests for code-registered desktop themes and the payload builder.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesPayload extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
	}

	public function tear_down() {
		foreach ( array_keys( openstation_desktop_theme_registry() ) as $slug ) {
			openstation_unregister_desktop_theme( $slug );
		}
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'openstation_desktop_themes' );
		remove_all_filters( 'openstation_desktop_themes_payload_cap' );
		remove_all_actions( 'openstation_desktop_theme_registered' );
		parent::tear_down();
	}

	private function register( $id, $overrides = array() ) {
		return openstation_register_desktop_theme( $id, array_merge(
			array(
				'name'    => 'Theme ' . $id,
				'version' => '1.0.0',
				'tokens'  => array( '--os-window-radius' => '14px' ),
			),
			$overrides
		) );
	}

	/** Seed the option index directly, as an install would. */
	private function seed_upload( $slug, $name = 'Uploaded' ) {
		$index = openstation_desktop_themes_index();
		$index[ $slug ] = array(
			'slug'        => $slug,
			'installedAt' => 1700000000,
			'manifest'    => array(
				'manifestVersion' => 1,
				'id'              => $slug,
				'slug'            => $slug,
				'name'            => $name,
				'version'         => '9.9.9',
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

	// ------------------------------------------------------------------
	// Registration.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_register_succeeds_and_compiles_css_text() {
		$this->assertTrue( $this->register( 'acme/neon' ) );

		$entry = openstation_desktop_theme_registry( 'acme-neon' );
		$this->assertIsArray( $entry );
		$this->assertStringContainsString(
			'--os-window-radius: 14px;',
			$entry['cssText']
		);
	}

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_register_returns_wp_error_on_bad_input() {
		$this->assertWPError( openstation_register_desktop_theme( 'Bad Id!', array( 'name' => 'x' ) ) );
		$this->assertWPError( openstation_register_desktop_theme( 'acme/neon', array( 'name' => '' ) ) );
	}

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_registered_action_fires_only_on_success() {
		$fired = array();
		add_action(
			'openstation_desktop_theme_registered',
			static function ( $slug ) use ( &$fired ) {
				$fired[] = $slug;
			}
		);
		openstation_register_desktop_theme( 'Bad Id!', array( 'name' => 'x' ) );
		$this->register( 'acme/neon' );

		$this->assertSame( array( 'acme-neon' ), $fired );
	}

	/**
	 * @covers ::openstation_unregister_desktop_theme
	 */
	public function test_unregister_accepts_id_or_slug() {
		$this->register( 'acme/neon' );
		openstation_unregister_desktop_theme( 'acme/neon' );
		$this->assertNull( openstation_desktop_theme_registry( 'acme-neon' ) );
	}

	/**
	 * Code themes go through the same sanitizer as uploads — a plugin
	 * doesn't get a wider grammar than an admin does.
	 *
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_code_themes_are_sanitized_like_uploads() {
		$this->register( 'acme/neon', array(
			'tokens' => array(
				'--os-window-radius' => '14px',
				'--evil'                       => 'red',
				'--os-bad'           => 'red; background: url(//evil)',
			),
		) );
		$css = openstation_desktop_theme_registry( 'acme-neon' )['cssText'];

		$this->assertStringContainsString( '--os-window-radius: 14px;', $css );
		$this->assertStringNotContainsString( '--evil', $css );
		$this->assertStringNotContainsString( 'evil', $css );
	}

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_code_theme_assets_must_be_absolute_urls() {
		$this->register( 'acme/neon', array(
			'icons' => array(
				'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/relative.svg' ),
				'RECYCLE_BIN' => array( 'type' => 'image', 'path' => 'https://cdn.test/bin.svg' ),
			),
		) );
		$icons = openstation_desktop_theme_registry( 'acme-neon' )['manifest']['icons'];

		$this->assertArrayNotHasKey( 'OS_SETTINGS', $icons );
		$this->assertSame( 'https://cdn.test/bin.svg', $icons['RECYCLE_BIN']['path'] );
	}

	// ------------------------------------------------------------------
	// Payload.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_build_desktop_themes_payload
	 */
	public function test_payload_is_empty_by_default() {
		$this->assertSame( array(), openstation_build_desktop_themes_payload() );
	}

	/**
	 * @covers ::openstation_build_desktop_themes_payload
	 */
	public function test_payload_merges_uploads_and_code_themes() {
		$this->register( 'acme/neon' );
		$this->seed_upload( 'house-style' );

		$payload = openstation_build_desktop_themes_payload();
		$slugs   = wp_list_pluck( $payload, 'slug' );

		$this->assertContains( 'acme-neon', $slugs );
		$this->assertContains( 'house-style', $slugs );
	}

	/**
	 * A site admin who installed a theme by hand outranks a plugin
	 * that later claims the same slug.
	 *
	 * @covers ::openstation_build_desktop_themes_payload
	 */
	public function test_uploads_win_on_slug_collision() {
		$this->register( 'acme-neon', array( 'name' => 'From code' ) );
		$this->seed_upload( 'acme-neon', 'From upload' );

		$payload = openstation_build_desktop_themes_payload();
		$this->assertCount( 1, $payload );
		$this->assertSame( 'From upload', $payload[0]['name'] );
		$this->assertSame( 'upload', $payload[0]['source'] );
	}

	/**
	 * Uploads link a compiled file; code themes inline the compiled
	 * text because they have no file to link.
	 *
	 * @covers ::openstation_shape_desktop_theme_payload_entry
	 */
	public function test_css_url_versus_css_text_by_source() {
		$this->register( 'acme/neon' );
		$this->seed_upload( 'house-style' );

		$payload = array();
		foreach ( openstation_build_desktop_themes_payload() as $entry ) {
			$payload[ $entry['slug'] ] = $entry;
		}

		$this->assertSame( '', $payload['acme-neon']['cssUrl'] );
		$this->assertNotSame( '', $payload['acme-neon']['cssText'] );

		$this->assertSame( '', $payload['house-style']['cssText'] );
		$this->assertStringContainsString( 'theme.css', $payload['house-style']['cssUrl'] );
		$this->assertStringContainsString(
			'ver=1700000000',
			$payload['house-style']['cssUrl'],
			'installedAt busts the cache on re-upload.'
		);
	}

	/**
	 * The shell only needs a paintable string per slot.
	 *
	 * @covers ::openstation_shape_desktop_theme_payload_entry
	 */
	public function test_icon_map_flattens_to_strings() {
		$this->register( 'acme/neon', array(
			'icons' => array(
				'OS_SETTINGS'          => array( 'type' => 'dashicon', 'name' => 'dashicons-admin-generic' ),
				'WINDOW_CONTROL_CLOSE' => array( 'type' => 'image', 'path' => 'https://cdn.test/close.svg' ),
			),
		) );
		$payload = openstation_build_desktop_themes_payload();

		$this->assertSame( 'dashicons-admin-generic', $payload[0]['icons']['OS_SETTINGS'] );
		$this->assertSame( 'https://cdn.test/close.svg', $payload[0]['icons']['WINDOW_CONTROL_CLOSE'] );
	}

	/**
	 * @covers ::openstation_build_desktop_themes_payload
	 */
	public function test_payload_filter_can_hide_entries() {
		$this->register( 'acme/neon' );
		$this->register( 'acme/other' );

		add_filter( 'openstation_desktop_themes', static function ( $themes ) {
			unset( $themes['acme-other'] );
			return $themes;
		} );

		$payload = openstation_build_desktop_themes_payload();
		$this->assertSame( array( 'acme-neon' ), wp_list_pluck( $payload, 'slug' ) );
	}

	/**
	 * @covers ::openstation_desktop_themes_payload_cap
	 */
	public function test_payload_cap_is_enforced_and_filterable() {
		for ( $i = 0; $i < 5; $i++ ) {
			$this->register( "acme/theme-{$i}" );
		}
		add_filter( 'openstation_desktop_themes_payload_cap', static function () {
			return 2;
		} );
		$this->assertCount( 2, openstation_build_desktop_themes_payload() );
	}

	/**
	 * @covers ::openstation_build_desktop_themes_payload
	 */
	public function test_payload_is_name_sorted() {
		$this->register( 'z-theme', array( 'name' => 'Alpha' ) );
		$this->register( 'a-theme', array( 'name' => 'Zulu' ) );

		$payload = openstation_build_desktop_themes_payload();
		$this->assertSame( array( 'Alpha', 'Zulu' ), wp_list_pluck( $payload, 'name' ) );
	}

	/**
	 * The builder must be registered in the shell payload's builder
	 * map, or the library never reaches the client.
	 *
	 * @covers ::openstation_build_menu_payload
	 */
	public function test_builder_is_wired_into_the_shell_payload() {
		$this->register( 'acme/neon' );
		$payload = openstation_build_menu_payload();

		$this->assertArrayHasKey( 'serverDesktopThemes', $payload );
		$this->assertSame(
			array( 'acme-neon' ),
			wp_list_pluck( $payload['serverDesktopThemes'], 'slug' )
		);
	}
}
