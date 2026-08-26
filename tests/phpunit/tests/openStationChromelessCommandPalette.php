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
		remove_all_filters( 'openstation_command_palette_contributors' );
		remove_all_filters( 'openstation_command_palette_contributor_owns_screen' );
		remove_all_filters( 'openstation_command_palette_trim_dependents' );
		unset( $_GET['page'] );
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
	 *   os-test-unrelated -> (nothing)            (must be left alone)
	 */
	private function register_graph() {
		// This WordPress may predate the Core command palette, in which
		// case `wp-commands` is unregistered and enqueuing anything that
		// depends on it trips `_doing_it_wrong`. Stub the root at its
		// real Core path so the graph is well-formed either way — and so
		// it is correctly seen as a Core package, not a contributor.
		if ( ! wp_script_is( 'wp-commands', 'registered' ) ) {
			wp_register_script( 'wp-commands', includes_url( 'js/dist/commands.js' ), array(), '1', true );
		}
		// Deliberately generic names: conviction must never depend on
		// what a handle is called, so the fixtures do not hint.
		wp_register_script( 'os-test-direct', 'https://example.org/d.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-indirect', 'https://example.org/i.js', array( 'os-test-direct' ), '1', true );
		// No deps at all: its only job is to be a handle that does not
		// reach the palette. Naming a real Core handle here coupled the
		// fixture to whatever else the suite had registered by then.
		wp_register_script( 'os-test-unrelated', 'https://example.org/u.js', array(), '1', true );
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
	 * The Connectors regression, in its exact shape.
	 *
	 * Gutenberg's Settings → Connectors screen registers a src-LESS
	 * handle carrying its boot module's dependency list — which names
	 * `wp-commands`, because the UI needs the commands store — and hangs
	 * the app's whole bootstrap on it as an inline script. Convicting it
	 * dequeued the handle, the inline never printed, and the page
	 * rendered blank.
	 *
	 * A handle with no `src` has no file to reclaim, so trimming it is
	 * pure downside however its dependencies read.
	 *
	 * @covers ::openstation_handle_has_no_src
	 * @covers ::openstation_command_palette_family
	 */
	public function test_a_srcless_bootstrap_handle_is_never_convicted() {
		wp_register_script(
			'os-test-connectors-prerequisites',
			'',
			array( 'react', 'wp-components', 'wp-editor', 'wp-commands', 'wp-data' ),
			'1',
			true
		);
		wp_add_inline_script(
			'os-test-connectors-prerequisites',
			'import("@wordpress/boot").then(m=>m.initSinglePage({}));'
		);

		$family = openstation_command_palette_family(
			wp_scripts(),
			array( 'os-test-connectors-prerequisites' )
		);

		$this->assertNotContains( 'os-test-connectors-prerequisites', $family );
	}

	/**
	 * The Gutenberg plugin re-registers the whole `wp-*` family from
	 * `/wp-content/plugins/gutenberg/build/scripts/…` through its own
	 * `$scripts->add()`. A Core-package test that looked at the SRC
	 * path answered false for every package on such a site, retiring
	 * the guard exactly where it mattered and convicting the entire
	 * editor stack.
	 *
	 * @covers ::openstation_is_core_package_handle
	 */
	public function test_core_packages_are_recognised_when_gutenberg_serves_them() {
		wp_register_script(
			'wp-block-editor',
			'https://example.org/wp-content/plugins/gutenberg/build/scripts/block-editor/index.min.js',
			array( 'wp-commands' ),
			'1',
			true
		);

		$this->assertTrue(
			openstation_is_core_package_handle( wp_scripts(), 'wp-block-editor' )
		);

		$family = openstation_command_palette_family( wp_scripts(), array( 'wp-block-editor' ) );
		$this->assertNotContains( 'wp-block-editor', $family );
	}

	/**
	 * The Customizer regression, in its shape.
	 *
	 * `customize-widgets` survives the trim and depends on
	 * `wp-block-editor`, which depends on `wp-commands`. Dropping the
	 * palette out from under a package that still prints strands it —
	 * the Widgets panel rendered nothing while its own script had
	 * loaded. Whatever we believe a handle is FOR, if something still
	 * printing needs it, it has to stay.
	 *
	 * @covers ::openstation_protect_survivor_dependencies
	 * @covers ::openstation_chromeless_command_palette_drops
	 */
	public function test_a_surviving_handles_dependency_is_never_dropped() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();
		wp_register_script(
			'wp-customize-widgets',
			'https://example.org/wp-content/plugins/gutenberg/build/scripts/customize-widgets/index.min.js',
			array( 'wp-commands' ),
			'1',
			true
		);

		$drops = openstation_chromeless_command_palette_drops(
			wp_scripts(),
			array( 'wp-customize-widgets', 'os-test-direct' )
		);

		$this->assertNotContains(
			'wp-commands',
			$drops,
			'a survivor still depends on it'
		);
	}

	/**
	 * The protection must not blunt the trim: when nothing surviving
	 * needs the palette, it still goes.
	 *
	 * @covers ::openstation_protect_survivor_dependencies
	 */
	public function test_protection_does_not_spare_a_palette_nothing_needs() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();

		$drops = openstation_chromeless_command_palette_drops(
			wp_scripts(),
			array( 'os-test-direct', 'os-test-unrelated' )
		);

		$this->assertContains( 'wp-commands', $drops );
		$this->assertContains( 'os-test-direct', $drops );
		$this->assertNotContains( 'os-test-unrelated', $drops );
	}

	/**
	 * Conviction must never turn on what a handle is called. Two
	 * handles with identical graphs and different names get the same
	 * verdict — otherwise the rule stops being about the site in front
	 * of it and starts being about a list of plugins somebody knew
	 * about.
	 *
	 * @covers ::openstation_command_palette_family
	 */
	public function test_conviction_ignores_the_handles_name() {
		wp_register_script( 'os-test-command-palette-thing', 'https://example.org/command-palette.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-anonymous-thing', 'https://example.org/x9f2.js', array( 'wp-commands' ), '1', true );

		$family = openstation_command_palette_family(
			wp_scripts(),
			array( 'os-test-command-palette-thing', 'os-test-anonymous-thing' )
		);

		$this->assertContains( 'os-test-command-palette-thing', $family );
		$this->assertContains( 'os-test-anonymous-thing', $family );
	}

	/**
	 * The escape hatch that does not guess: a site knows its own
	 * handles and can spare one the framework has no way to infer.
	 *
	 * @covers ::openstation_command_palette_family
	 */
	public function test_a_site_can_spare_one_of_its_own_handles() {
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
	 * @covers ::openstation_command_palette_trims_dependents
	 */
	public function test_dependent_trimming_can_be_turned_off_entirely() {
		$this->register_graph();
		add_filter( 'openstation_command_palette_trim_dependents', '__return_false' );

		$family = openstation_command_palette_family( wp_scripts(), array( 'os-test-direct' ) );

		$this->assertNotContains( 'os-test-direct', $family );
		$this->assertContains( 'wp-commands', $family );
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

	/**
	 * The roots are the palette; they are not *contributors* to it.
	 *
	 * @covers ::openstation_command_palette_contributors
	 */
	public function test_contributors_never_include_the_roots() {
		$this->register_graph();

		$contributors = openstation_command_palette_contributors(
			wp_scripts(),
			array( 'wp-commands', 'wp-core-commands', 'os-test-direct' )
		);

		$this->assertSame( array( 'os-test-direct' ), $contributors );
	}

	/**
	 * Rule 3's exemption: on the plugin's own route its palette script
	 * stays, because that is where it registers screen-specific
	 * commands rather than the site-wide ones the shell already carries.
	 *
	 * @covers ::openstation_command_palette_owns_screen
	 */
	public function test_a_plugin_owns_a_page_slug_prefixed_by_its_folder() {
		wp_register_script(
			'os-test-owned',
			'https://example.org/wp-content/plugins/acme-crm/palette.js',
			array( 'wp-commands' ),
			'1',
			true
		);
		$_GET['page'] = 'acme-crm-dashboard';

		$owns = openstation_command_palette_owns_screen( wp_scripts(), 'os-test-owned' );

		unset( $_GET['page'] );
		$this->assertTrue( $owns );
	}

	/**
	 * @covers ::openstation_command_palette_owns_screen
	 */
	public function test_a_plugin_does_not_own_an_unrelated_screen() {
		wp_register_script(
			'os-test-owned',
			'https://example.org/wp-content/plugins/acme-crm/palette.js',
			array( 'wp-commands' ),
			'1',
			true
		);
		$_GET['page'] = 'some-other-plugin';

		$owns = openstation_command_palette_owns_screen( wp_scripts(), 'os-test-owned' );

		unset( $_GET['page'] );
		$this->assertFalse( $owns );
	}

	/**
	 * Keeping a contributor means keeping the roots it depends on —
	 * so the whole drop set collapses to nothing on an owned route.
	 * That is the deliberate price of the exemption.
	 *
	 * @covers ::openstation_chromeless_command_palette_drops
	 */
	public function test_nothing_is_dropped_when_a_contributor_owns_the_screen() {
		$this->enter_chromeless();
		set_current_screen( 'toplevel_page_acme-crm' );
		wp_register_script(
			'os-test-owned',
			'https://example.org/wp-content/plugins/acme-crm/palette.js',
			array( 'wp-commands' ),
			'1',
			true
		);
		$_GET['page'] = 'acme-crm';

		$drops = openstation_chromeless_command_palette_drops(
			wp_scripts(),
			array( 'os-test-owned' )
		);

		unset( $_GET['page'] );
		$this->assertSame( array(), $drops );
	}

	/**
	 * @covers ::openstation_command_palette_owns_screen
	 */
	public function test_screen_ownership_is_filterable() {
		$this->register_graph();
		add_filter( 'openstation_command_palette_contributor_owns_screen', '__return_true' );

		$this->assertTrue(
			openstation_command_palette_owns_screen( wp_scripts(), 'os-test-direct' )
		);
	}

	/**
	 * The shell hoist: contributors leave the boot document and land in
	 * the deferred manifest, so their commands reach the palette on the
	 * first ⌘K instead of being registered at boot against a
	 * `core/commands` store that does not exist yet.
	 *
	 * @covers ::openstation_shell_hoist_command_palette_contributors
	 */
	public function test_shell_hoist_moves_contributors_into_the_manifest() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// Shell, not a window: no chromeless flag.
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		$this->assertContains(
			'os-test-direct',
			openstation_command_palette_contributors( wp_scripts(), wp_scripts()->queue ),
			'precondition: the contributor is detected'
		);

		openstation_shell_hoist_command_palette_contributors();

		$this->assertFalse(
			wp_script_is( 'os-test-direct', 'enqueued' ),
			'the contributor must not print at boot'
		);
		$inline = wp_scripts()->get_data( 'openstation', 'before' );
		$this->assertStringContainsString(
			'os-test-direct',
			is_array( $inline ) ? implode( '', $inline ) : (string) $inline,
			'the contributor must be appended to the deferred manifest'
		);
	}

	/**
	 * The fallback the hoist documents as load-bearing.
	 *
	 * `WP_Dependencies::all_deps()` bails out wholesale when any single
	 * dependency is unregistered — and every contributor depends on
	 * `wp-commands`, which a site predating the Core palette simply does
	 * not have. The resolved chain therefore comes back empty, and the
	 * contributor still has to reach the manifest on its own: its Core
	 * dependencies are already carried by the Core manifest this list is
	 * appended to, so the contributor script is the only part that has
	 * to come from here.
	 *
	 * @covers ::openstation_shell_hoist_command_palette_contributors
	 */
	public function test_shell_hoist_survives_an_unregistered_palette_root() {
		// WordPress rightly complains about the dependency it cannot
		// resolve. That complaint IS the scenario — a palette extension
		// declares `wp-commands` unconditionally, so any site without
		// the Core palette produces exactly this notice — and the point
		// of the test is that the hoist still does its job around it.
		$this->setExpectedIncorrectUsage( 'WP_Scripts::add' );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );
		// Enqueue first, then take the root away: this is a pre-6.9
		// site, where `wp-commands` was never registered at all.
		wp_deregister_script( 'wp-commands' );

		$this->assertFalse( wp_script_is( 'wp-commands', 'registered' ) );

		openstation_shell_hoist_command_palette_contributors();

		$inline = wp_scripts()->get_data( 'openstation', 'before' );
		$this->assertStringContainsString(
			'os-test-direct',
			is_array( $inline ) ? implode( '', $inline ) : (string) $inline,
			'the contributor must still reach the manifest'
		);
		$this->assertFalse( wp_script_is( 'os-test-direct', 'enqueued' ) );
	}

	/**
	 * @covers ::openstation_shell_hoist_command_palette_contributors
	 */
	public function test_shell_hoist_does_not_run_inside_a_window() {
		$this->enter_chromeless();
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		openstation_shell_hoist_command_palette_contributors();

		// The window path owns this handle; the shell hoist must keep
		// its hands off, or the two would fight over the same queue.
		$this->assertTrue( wp_script_is( 'os-test-direct', 'enqueued' ) );
	}
}
