<?php

class Tests_OpenStation_CommandPaletteAssets extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		if ( ! function_exists( 'wp_enqueue_command_palette_assets' ) ) {
			$this->markTestSkipped( 'Core command palette (WP 6.9+) not present in this environment.' );
		}
	}

	public function test_builder_leaves_the_boot_queues_untouched() {
		$scripts_before = wp_scripts()->queue;
		$styles_before  = wp_styles()->queue;
		$todo_before    = wp_scripts()->to_do;

		$payload = openstation_build_command_palette_assets_payload();

		$this->assertNotNull( $payload );
		$this->assertSame( $scripts_before, wp_scripts()->queue, 'A palette script leaked into the boot queue.' );
		$this->assertSame( $styles_before, wp_styles()->queue, 'A palette style leaked into the boot queue.' );
		$this->assertSame( $todo_before, wp_scripts()->to_do, 'The live $to_do was mutated — dependency resolution must run on a clone.' );
	}

	public function test_manifest_is_dependency_ordered_and_contains_the_roots() {
		$payload = openstation_build_command_palette_assets_payload();
		$this->assertNotNull( $payload );

		$handles = wp_list_pluck( $payload['scripts'], 'handle' );
		$this->assertContains( 'wp-commands', $handles );
		$this->assertContains( 'wp-core-commands', $handles );

		$position = array_flip( $handles );
		$registry = wp_scripts()->registered;
		foreach ( $handles as $handle ) {
			if ( ! isset( $registry[ $handle ] ) ) {
				continue;
			}
			foreach ( $registry[ $handle ]->deps as $dep ) {
				if ( ! isset( $position[ $dep ] ) ) {

					continue;
				}
				$this->assertLessThan(
					$position[ $handle ],
					$position[ $dep ],
					"$dep must execute before $handle."
				);
			}
		}
	}

	public function test_the_initialize_call_rides_the_core_commands_entry() {
		$payload = openstation_build_command_palette_assets_payload();
		$this->assertNotNull( $payload );

		$entry = null;
		foreach ( $payload['scripts'] as $script ) {
			if ( 'wp-core-commands' === $script['handle'] ) {
				$entry = $script;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString(
			'initializeCommandPalette',
			implode( "\n", array_merge( (array) $entry['before'], (array) $entry['after'] ) )
		);
	}

	public function test_the_menu_command_list_is_not_embedded_twice() {
		$payload = openstation_build_command_palette_assets_payload();
		$this->assertNotNull( $payload );

		$entry = null;
		foreach ( $payload['scripts'] as $script ) {
			if ( 'wp-core-commands' === $script['handle'] ) {
				$entry = $script;
			}
		}
		$this->assertNotNull( $entry );
		$inline = implode( "\n", array_merge( (array) $entry['before'], (array) $entry['after'] ) );
		$this->assertStringContainsString(
			'window.__openStationMenuCommands',
			$inline,
			'The synthesized init must read the list off the global the boot page already ships.'
		);
		$this->assertStringNotContainsString(
			'"menu_commands":[',
			$inline,
			'Core\'s embedded copy of the menu-command list must be stripped — it duplicates __openStationMenuCommands.'
		);
	}

	public function test_manifest_carries_the_style_chain() {
		$payload = openstation_build_command_palette_assets_payload();
		$this->assertNotNull( $payload );
		$this->assertContains( 'wp-commands', wp_list_pluck( $payload['styles'], 'handle' ) );
	}

	public function test_core_default_enqueue_is_unhooked_on_shell_pages_only() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		add_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );

		openstation_defer_core_command_palette();
		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' ),
			'Core\'s boot-time palette enqueue must come off shell pages.'
		);

		add_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
		$_GET['openstation_chromeless'] = '1';
		openstation_defer_core_command_palette();
		$this->assertNotFalse(
			has_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' ),
			'Chromeless iframes need Core\'s runtime for the command-harvest bridge.'
		);

		unset( $_GET['openstation_chromeless'] );
		remove_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
	}
}
