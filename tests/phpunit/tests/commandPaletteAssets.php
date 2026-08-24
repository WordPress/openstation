<?php
/**
 * The Core command-palette runtime is a manifest, not a boot cost.
 *
 * `wp_enqueue_command_palette_assets()` pulls the whole Gutenberg
 * runtime (~800 KB gzipped) through its dependency chain. The shell
 * no longer enqueues it: `openstation_build_command_palette_assets_payload()`
 * lets Core run, unwinds the enqueue, and serializes the ordered
 * chain for the client to replay on first palette invocation. These
 * tests pin the unwind (nothing leaks into the boot queues), the
 * ordering, and the one inline snippet everything depends on — the
 * `initializeCommandPalette` call that seeds the store.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-command-palette-assets
 */
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

	/**
	 * The unwind: building the manifest must leave the request's
	 * enqueue state exactly as it found it — the whole point is that
	 * NOTHING from the palette chain prints at boot.
	 *
	 * @covers ::openstation_build_command_palette_assets_payload
	 */
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

	/**
	 * The manifest carries the roots, in dependency order — every
	 * entry's declared deps appear earlier in the list, which is the
	 * exact contract the client's sequential replay relies on.
	 *
	 * @covers ::openstation_build_command_palette_assets_payload
	 */
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
					// A dep outside the manifest (no src, no data) is
					// fine — nothing to execute for it.
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

	/**
	 * The store seed rides along: Core's
	 * `wp.coreCommands.initializeCommandPalette( … )` inline lands in
	 * the `wp-core-commands` entry. Without it the runtime loads and
	 * the store stays empty — the palette would list nothing.
	 *
	 * @covers ::openstation_build_command_palette_assets_payload
	 */
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

	/**
	 * The palette stylesheet chain rides too — an unstyled Core
	 * palette flashing over the desktop would read as broken.
	 *
	 * @covers ::openstation_build_command_palette_assets_payload
	 */
	public function test_manifest_carries_the_style_chain() {
		$payload = openstation_build_command_palette_assets_payload();
		$this->assertNotNull( $payload );
		$this->assertContains( 'wp-commands', wp_list_pluck( $payload['styles'], 'handle' ) );
	}

	/**
	 * WP 7.0 auto-enqueues the palette on every admin page; on a
	 * shell page that default must come off (the shell suppresses
	 * Core's palette UI, so its runtime can never be shown there) —
	 * otherwise the roots are queued before the manifest builder
	 * runs, the diff comes back empty, and nothing is deferred.
	 * Chromeless iframes keep the default: their runtime powers the
	 * command harvest the bridge streams to the parent.
	 *
	 * @covers ::openstation_defer_core_command_palette
	 */
	public function test_core_default_enqueue_is_unhooked_on_shell_pages_only() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		// Simulate Core 7.0's default wiring regardless of the
		// environment's own version.
		add_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );

		// Shell request → unhooked.
		openstation_defer_core_command_palette();
		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' ),
			'Core\'s boot-time palette enqueue must come off shell pages.'
		);

		// Chromeless request → left alone.
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
