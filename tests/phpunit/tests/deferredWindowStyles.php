<?php

class Tests_OpenStation_DeferredWindowStyles extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	private $icon_ids_before = array();

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		$this->icon_ids_before = array_keys( (array) openstation_desktop_icon_registry() );
	}

	public function tear_down() {
		foreach ( array_keys( (array) openstation_desktop_icon_registry() ) as $icon_id ) {
			if ( ! in_array( $icon_id, $this->icon_ids_before, true ) ) {
				openstation_unregister_icon( $icon_id );
			}
		}
		parent::tear_down();
	}

	private function register_built_in_windows() {
		$registrars = array(
			'openstation_posts_window_register_window',
			'openstation_pages_window_register_window',
			'openstation_users_window_register_window',
			'openstation_user_edit_window_register_window',
			'openstation_comments_window_register_window',
			'openstation_plugins_window_register_window',
			'openstation_content_graph_register_window',
			'openstation_games_register_window',
			'openstation_agent_run_window_register',

			'openstation_apps_register_windows',
			'openstation_my_wordpress_woo_customer_window_register',
		);
		foreach ( $registrars as $registrar ) {
			if ( function_exists( $registrar ) ) {
				$registrar();
			}
		}
	}

	const DEFERRED_WINDOW_IDS = array(
		'my-wordpress',
		'desktop-mode-posts',
		'desktop-mode-pages',
		'desktop-mode-users',
		'desktop-mode-user-edit',
		'desktop-mode-comments',
		'desktop-mode-plugins',
		'desktop-mode-content-graph',
		'desktop-mode-games',
		'desktop-mode-dashboard',
		'desktop-mode-agent-run',
		'openstation-code-blue',
		'desktop-mode-woo-customer',
	);

	const ALWAYS_PRESENT = array(
		'my-wordpress',
		'desktop-mode-posts',
		'desktop-mode-pages',
		'desktop-mode-comments',
		'desktop-mode-plugins',
		'desktop-mode-dashboard',
	);

	public function test_built_in_window_styles_ride_the_companion_list() {
		$this->register_built_in_windows();

		$payload = openstation_build_native_windows_payload();
		$by_id   = array();
		foreach ( $payload as $entry ) {
			$by_id[ $entry['id'] ] = $entry;
		}

		foreach ( self::ALWAYS_PRESENT as $id ) {
			$this->assertArrayHasKey( $id, $by_id, "$id must register for an administrator." );
		}

		foreach ( self::DEFERRED_WINDOW_IDS as $id ) {
			if ( ! isset( $by_id[ $id ] ) ) {
				continue;
			}
			$entry = $by_id[ $id ];
			$this->assertSame(
				'',
				$entry['styleUrl'],
				"$id declares `style`, which the shell injects at BOOT — its sheet belongs in the `styles` companion list, loaded on first open."
			);
			$this->assertNotEmpty(
				$entry['companionStyles'],
				"$id ships no companion stylesheet at all — its window would render unstyled."
			);
		}
	}

	public function test_recycle_bin_stylesheet_stays_on_the_boot_path() {
		$this->assertNotFalse(
			has_action( 'admin_enqueue_scripts', 'openstation_recycle_bin_enqueue_style' ),
			'The recycle-bin boot attach vanished — if its enqueue moved, the dock drop-target styling moved with it.'
		);
	}

	public function test_deferred_styles_map_resolves_url_and_inline() {
		wp_register_style( 'os-test-deferred', 'https://example.test/deferred.css', array(), '1.0.0' );
		wp_add_inline_style( 'os-test-deferred', '.demo{color:red}' );

		$map = openstation_build_deferred_styles( array( 'os-test-deferred', 'never-registered' ) );

		$this->assertSame( array( 'os-test-deferred' ), array_keys( $map ) );
		$this->assertStringContainsString( 'deferred.css', $map['os-test-deferred']['url'] );
		$this->assertSame( array( '.demo{color:red}' ), $map['os-test-deferred']['inline'] );

		wp_deregister_style( 'os-test-deferred' );
	}

	public function test_shell_surface_handles_resolve_into_the_map() {
		$map = openstation_build_deferred_styles(
			array( 'desktop-mode-ai-assistant', 'desktop-mode-bug-report' )
		);

		$this->assertSame(
			array( 'desktop-mode-ai-assistant', 'desktop-mode-bug-report' ),
			array_keys( $map ),
			'A shell-surface stylesheet handle stopped resolving — its surface will open unstyled.'
		);
	}
}
