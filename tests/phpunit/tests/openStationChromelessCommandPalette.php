<?php
/**
 * Tests for the command-palette trim inside windows.
 *
 * The shell owns ⌘K, and the parent only asks a window for its
 * commands when the palette is actually opened — yet every window
 * loaded the palette runtime (the Gutenberg chain) eagerly. These
 * tests pin the family walk that drops it, and the block-editor
 * exemption that keeps it where the chain loads anyway.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_ChromelessCommandPalette extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		remove_all_filters( 'openstation_chromeless_trim_command_palette' );
		remove_all_filters( 'openstation_command_palette_family' );
		remove_all_filters( 'openstation_command_palette_root_handles' );
		parent::tear_down();
	}

	/**
	 * Puts the request into the chromeless state a window creates.
	 */
	private function enter_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	/**
	 * Registers a throwaway script graph:
	 *
	 *   os-test-direct    -> wp-commands          (a palette contributor)
	 *   os-test-indirect  -> os-test-direct       (reaches it transitively)
	 *   os-test-unrelated -> jquery               (must be left alone)
	 */
	private function register_graph() {
		wp_register_script( 'os-test-direct', 'https://example.org/d.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-indirect', 'https://example.org/i.js', array( 'os-test-direct' ), '1', true );
		wp_register_script( 'os-test-unrelated', 'https://example.org/u.js', array( 'jquery' ), '1', true );
	}

	/**
	 * @covers ::openstation_command_palette_root_handles
	 */
	public function test_roots_are_the_two_core_palette_packages() {
		$roots = openstation_command_palette_root_handles();

		$this->assertContains( 'wp-commands', $roots );
		$this->assertContains( 'wp-core-commands', $roots );
	}

	/**
	 * The whole point of a family walk: dropping the roots while a
	 * dependent stays queued saves nothing, because `all_deps()` pulls
	 * the chain straight back in on the dependent's behalf.
	 *
	 * @covers ::openstation_command_palette_family
	 */
	public function test_family_covers_direct_and_transitive_dependents() {
		$this->register_graph();
		$scripts = wp_scripts();

		$family = openstation_command_palette_family(
			$scripts,
			array( 'os-test-direct', 'os-test-indirect', 'os-test-unrelated' )
		);

		$this->assertContains( 'wp-commands', $family );
		$this->assertContains( 'os-test-direct', $family );
		$this->assertContains( 'os-test-indirect', $family );
		$this->assertNotContains( 'os-test-unrelated', $family );
	}

	/**
	 * The regression this whole design turns on.
	 *
	 * `wp-block-editor` declares `wp-commands` directly — the editor
	 * *registers* commands, so the dependency runs opposite to a palette
	 * extension's. A naive closure walk therefore convicts the entire
	 * block-editor stack, and every plugin block script above it, of
	 * being palette contributors and drops them.
	 *
	 * @covers ::openstation_command_palette_family
	 * @covers ::openstation_is_core_package_handle
	 */
	public function test_core_packages_are_never_trimmed_as_dependents() {
		$scripts = wp_scripts();
		// Stand in for Core's real registration, which declares
		// `wp-commands` among `wp-block-editor`'s deps.
		wp_register_script(
			'os-test-core-pkg',
			includes_url( 'js/dist/block-editor.js' ),
			array( 'wp-commands' ),
			'1',
			true
		);

		$family = openstation_command_palette_family( $scripts, array( 'os-test-core-pkg' ) );

		$this->assertNotContains( 'os-test-core-pkg', $family );
	}

	/**
	 * A plugin's block script reaches `wp-commands` only by way of
	 * `wp-block-editor`. That says something about the editor, not about
	 * the block script — so the walk must not route through a Core
	 * package to convict it. Contact Form 7's block script is the real
	 * case this was found on.
	 *
	 * @covers ::openstation_command_palette_family
	 */
	public function test_a_plugin_script_is_not_convicted_through_a_core_package() {
		wp_register_script(
			'os-test-core-pkg',
			includes_url( 'js/dist/block-editor.js' ),
			array( 'wp-commands' ),
			'1',
			true
		);
		wp_register_script(
			'os-test-block-script',
			'https://example.org/block.js',
			array( 'os-test-core-pkg' ),
			'1',
			true
		);

		$family = openstation_command_palette_family(
			wp_scripts(),
			array( 'os-test-block-script' )
		);

		$this->assertNotContains( 'os-test-block-script', $family );
	}

	/**
	 * The other half of the same rule: a genuine palette extension names
	 * the palette in its own dependency chain, without a Core package in
	 * between, and must still be caught. Astra and WooCommerce both do.
	 *
	 * @covers ::openstation_command_palette_family
	 */
	public function test_a_palette_extension_behind_its_own_script_is_still_caught() {
		wp_register_script( 'os-test-base', 'https://example.org/b.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-ext', 'https://example.org/e.js', array( 'os-test-base' ), '1', true );

		$family = openstation_command_palette_family( wp_scripts(), array( 'os-test-ext' ) );

		$this->assertContains( 'os-test-ext', $family );
	}

	/**
	 * @covers ::openstation_command_palette_family
	 */
	public function test_family_is_filterable_to_protect_a_handle() {
		$this->register_graph();
		add_filter(
			'openstation_command_palette_family',
			static function ( $family ) {
				return array_values( array_diff( $family, array( 'os-test-direct' ) ) );
			}
		);

		$family = openstation_command_palette_family( wp_scripts(), array( 'os-test-direct' ) );

		$this->assertNotContains( 'os-test-direct', $family );
	}

	/**
	 * @covers ::openstation_chromeless_should_trim_command_palette
	 */
	public function test_no_trim_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// No chromeless flag: this is the shell, which has its own deferral.

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

	/**
	 * @covers ::openstation_chromeless_should_trim_command_palette
	 */
	public function test_trims_on_an_ordinary_window_screen() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$this->assertTrue( openstation_chromeless_should_trim_command_palette() );
	}

	/**
	 * On a block-editor screen the Gutenberg chain loads for the
	 * editor's own sake, so the palette rides along nearly free — and
	 * those are the screens whose commands are worth harvesting.
	 *
	 * @covers ::openstation_chromeless_should_trim_command_palette
	 * @covers ::openstation_chromeless_screen_uses_block_editor
	 */
	public function test_block_editor_screens_keep_the_palette() {
		$this->enter_chromeless();
		set_current_screen( 'post' );
		get_current_screen()->is_block_editor( true );

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

	/**
	 * @covers ::openstation_chromeless_screen_uses_block_editor
	 */
	public function test_site_editor_is_treated_as_a_block_editor_screen() {
		global $pagenow;
		$this->enter_chromeless();
		$previous = $pagenow;
		$pagenow  = 'site-editor.php';

		$uses_editor = openstation_chromeless_screen_uses_block_editor();

		$pagenow = $previous;
		$this->assertTrue( $uses_editor );
	}

	/**
	 * @covers ::openstation_chromeless_should_trim_command_palette
	 */
	public function test_trim_can_be_filtered_off() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		add_filter( 'openstation_chromeless_trim_command_palette', '__return_false' );

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

	/**
	 * @covers ::openstation_chromeless_trim_command_palette
	 */
	public function test_dequeues_the_family_in_a_window() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );
		wp_enqueue_script( 'os-test-indirect' );
		wp_enqueue_script( 'os-test-unrelated' );

		openstation_chromeless_trim_command_palette();

		$this->assertFalse( wp_script_is( 'os-test-direct', 'enqueued' ) );
		$this->assertFalse( wp_script_is( 'os-test-indirect', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'os-test-unrelated', 'enqueued' ) );
	}

	/**
	 * Dequeue, never deregister — a handle something genuinely needs
	 * must still resolve as a dependency.
	 *
	 * @covers ::openstation_chromeless_trim_command_palette
	 */
	public function test_trim_dequeues_without_deregistering() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		openstation_chromeless_trim_command_palette();

		$this->assertTrue( wp_script_is( 'os-test-direct', 'registered' ) );
	}

	/**
	 * The last word before output: late enqueues and dependency
	 * pull-back both survive the dequeue pass.
	 *
	 * @covers ::openstation_chromeless_filter_palette_print_list
	 */
	public function test_print_list_filter_strips_the_family() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();

		$filtered = openstation_chromeless_filter_palette_print_list(
			array( 'os-test-direct', 'os-test-unrelated', 'wp-commands' )
		);

		$this->assertSame( array( 'os-test-unrelated' ), $filtered );
	}

	/**
	 * The style counterpart of the print-list pass. Today it only ever
	 * removes the roots, but the moment a root or a family member ships
	 * a stylesheet this is the thing that has to catch it.
	 *
	 * @covers ::openstation_chromeless_filter_palette_style_print_list
	 */
	public function test_style_print_list_filter_strips_the_roots() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$filtered = openstation_chromeless_filter_palette_style_print_list(
			array( 'wp-commands', 'common', 'wp-core-commands', 'forms' )
		);

		$this->assertSame( array( 'common', 'forms' ), $filtered );
	}

	/**
	 * @covers ::openstation_chromeless_filter_palette_style_print_list
	 */
	public function test_style_print_list_filter_is_inert_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		$handles = array( 'wp-commands', 'common' );

		$this->assertSame(
			$handles,
			openstation_chromeless_filter_palette_style_print_list( $handles )
		);
	}

	/**
	 * @covers ::openstation_chromeless_filter_palette_style_print_list
	 */
	public function test_style_print_list_filter_survives_a_non_array() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$this->assertSame( 'nope', openstation_chromeless_filter_palette_style_print_list( 'nope' ) );
	}

	/**
	 * @covers ::openstation_chromeless_filter_palette_print_list
	 */
	public function test_print_list_filter_is_inert_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		$handles = array( 'os-test-direct', 'wp-commands' );

		$this->assertSame(
			$handles,
			openstation_chromeless_filter_palette_print_list( $handles )
		);
	}

	/**
	 * Unhooking Core's callback also skips the `$menu` / `$submenu`
	 * walk it runs before enqueuing anything, and the inline blob it
	 * serializes from it.
	 *
	 * @covers ::openstation_chromeless_defer_command_palette
	 */
	public function test_core_palette_enqueue_is_unhooked_in_a_window() {
		if ( ! function_exists( 'wp_enqueue_command_palette_assets' ) ) {
			$this->markTestSkipped( 'This WordPress has no Core command palette.' );
		}
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		add_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );

		openstation_chromeless_defer_command_palette();

		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' )
		);
	}
}
