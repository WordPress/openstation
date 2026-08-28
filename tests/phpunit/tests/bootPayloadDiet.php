<?php
/**
 * The boot config ships references, not copies.
 *
 * Two payload families used to serialize data into the boot document
 * that the boot page already delivers another way:
 *
 *   - `nativeWindows[].templateHtml` — every window's template is
 *     server-printed as a real `<template>` tag (admin_footer @ 20),
 *     and `ensureTemplate()` adopts it by id; the payload copy is
 *     only for MID-SESSION activations, which arrive via bridge /
 *     probe payloads.
 *   - `serverDesktopThemes[].cssText` / `.tokens` — the ACTIVE
 *     theme's stylesheet is server-enqueued at boot, and an inactive
 *     theme's CSS matters only when the user picks it, at which
 *     point `ensureFullDesktopThemes()` fetches the full entries
 *     from `GET desktop-mode/v1/desktop-themes`.
 *
 * These tests pin the diet: slim on the boot config, full on the
 * bridge payload and the REST route, and the boot page's own
 * delivery still intact.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-boot-payload-diet
 */
class Tests_OpenStation_BootPayloadDiet extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// A previous test's localize data on the shell handle would
		// bleed into the blob assertions — start each case clean.
		wp_scripts()->add_data( 'openstation', 'data', '' );
	}

	public function tear_down() {
		openstation_unregister_desktop_theme( 'diet-theme' );
		parent::tear_down();
	}

	/** The localized boot config, as the JSON blob the page carries. */
	private function boot_config_blob() {
		openstation_enqueue_assets();
		return (string) wp_scripts()->get_data( 'openstation', 'data' );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_boot_config_strips_template_html_the_page_already_prints() {
		$registered = openstation_register_window(
			'diet-window',
			array(
				'title'    => 'Diet',
				'template' => static function () {
					echo '<p>diet-template-marker</p>';
				},
			)
		);
		$this->assertTrue( $registered );

		$blob = $this->boot_config_blob();
		$this->assertStringContainsString( '"diet-window"', $blob );
		$this->assertStringNotContainsString(
			'diet-template-marker',
			$blob,
			'The boot config must not carry template markup — the page prints it as a real <template> tag.'
		);

		// The page's own delivery: the admin_footer printer still
		// emits the markup the config no longer duplicates.
		ob_start();
		openstation_render_native_window_templates();
		$printed = (string) ob_get_clean();
		$this->assertStringContainsString( 'diet-template-marker', $printed );

		// And the MID-SESSION path keeps its copy: a bridge / probe
		// payload delivers windows to a page that printed nothing.
		$payload = openstation_build_menu_payload();
		$entry   = null;
		foreach ( $payload['nativeWindows'] as $row ) {
			if ( 'diet-window' === $row['id'] ) {
				$entry = $row;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'diet-template-marker', $entry['templateHtml'] );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_boot_config_slims_desktop_theme_entries() {
		openstation_register_desktop_theme(
			'diet/theme',
			array(
				'name'   => 'Diet Theme',
				'tokens' => array( '--os-window-bg' => '#123456' ),
			)
		);

		$blob = $this->boot_config_blob();
		$this->assertStringContainsString( '"Diet Theme"', $blob );
		$this->assertStringContainsString( '"cssDeferred":true', $blob );
		$this->assertStringNotContainsString(
			'#123456',
			$blob,
			'Neither the compiled CSS nor the token map belongs in the boot config.'
		);

		// The bridge payload keeps the full entry.
		$payload = openstation_build_menu_payload();
		$full    = null;
		foreach ( $payload['serverDesktopThemes'] as $row ) {
			if ( 'diet-theme' === $row['slug'] ) {
				$full = $row;
			}
		}
		$this->assertNotNull( $full );
		$this->assertStringContainsString( '#123456', $full['cssText'] );
		$this->assertSame( '#123456', $full['tokens']['--os-window-bg'] );
	}

	/**
	 * @covers ::openstation_rest_list_desktop_themes
	 */
	public function test_desktop_themes_get_route_serves_the_full_entries() {
		openstation_register_desktop_theme(
			'diet/theme',
			array(
				'name'   => 'Diet Theme',
				'tokens' => array( '--os-window-bg' => '#123456' ),
			)
		);

		do_action( 'rest_api_init' );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/desktop-themes' )
		);
		$this->assertSame( 200, $response->get_status() );

		$data  = $response->get_data();
		$found = null;
		foreach ( $data['themes'] as $row ) {
			if ( 'diet-theme' === $row['slug'] ) {
				$found = $row;
			}
		}
		$this->assertNotNull( $found, 'The GET route must serve the registered theme.' );
		$this->assertStringContainsString( '#123456', $found['cssText'] );
		$this->assertArrayNotHasKey( 'cssDeferred', $found, 'The route serves FULL entries — no deferral marker.' );
	}

	/**
	 * The read gate is the shell's own, not the manage capability —
	 * the same entries used to ride the boot payload to every
	 * desktop user, so the route exposes nothing new. A user without
	 * OpenStation enabled is still refused.
	 *
	 * @covers ::openstation_rest_list_desktop_themes
	 */
	public function test_desktop_themes_get_route_requires_the_shell() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		do_action( 'rest_api_init' );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/desktop-themes' )
		);
		$this->assertNotSame(
			200,
			$response->get_status(),
			'A user without desktop mode enabled must not read the theme library.'
		);
	}
}
