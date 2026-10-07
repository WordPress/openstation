<?php

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

	private function enter_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	private function register_graph() {

		if ( ! wp_script_is( 'wp-commands', 'registered' ) ) {
			wp_register_script( 'wp-commands', includes_url( 'js/dist/commands.js' ), array(), '1', true );
		}

		wp_register_script( 'os-test-direct', 'https://example.org/d.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-indirect', 'https://example.org/i.js', array( 'os-test-direct' ), '1', true );

		wp_register_script( 'os-test-unrelated', 'https://example.org/u.js', array(), '1', true );
	}

	public function test_roots_are_the_two_core_palette_packages() {
		$roots = openstation_command_palette_root_handles();

		$this->assertContains( 'wp-commands', $roots );
		$this->assertContains( 'wp-core-commands', $roots );
	}

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

	public function test_core_packages_are_never_trimmed_as_dependents() {
		$scripts = wp_scripts();

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

	public function test_a_palette_extension_behind_its_own_script_is_still_caught() {
		wp_register_script( 'os-test-base', 'https://example.org/b.js', array( 'wp-commands' ), '1', true );
		wp_register_script( 'os-test-ext', 'https://example.org/e.js', array( 'os-test-base' ), '1', true );

		$family = openstation_command_palette_family( wp_scripts(), array( 'os-test-ext' ) );

		$this->assertContains( 'os-test-ext', $family );
	}

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

	public function test_dependent_trimming_can_be_turned_off_entirely() {
		$this->register_graph();
		add_filter( 'openstation_command_palette_trim_dependents', '__return_false' );

		$family = openstation_command_palette_family( wp_scripts(), array( 'os-test-direct' ) );

		$this->assertNotContains( 'os-test-direct', $family );
		$this->assertContains( 'wp-commands', $family );
	}

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

	public function test_no_trim_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

	public function test_trims_on_an_ordinary_window_screen() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$this->assertTrue( openstation_chromeless_should_trim_command_palette() );
	}

	public function test_block_editor_screens_keep_the_palette() {
		$this->enter_chromeless();
		set_current_screen( 'post' );
		get_current_screen()->is_block_editor( true );

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

	public function test_site_editor_is_treated_as_a_block_editor_screen() {
		global $pagenow;
		$this->enter_chromeless();
		$previous = $pagenow;
		$pagenow  = 'site-editor.php';

		$uses_editor = openstation_chromeless_screen_uses_block_editor();

		$pagenow = $previous;
		$this->assertTrue( $uses_editor );
	}

	public function test_trim_can_be_filtered_off() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		add_filter( 'openstation_chromeless_trim_command_palette', '__return_false' );

		$this->assertFalse( openstation_chromeless_should_trim_command_palette() );
	}

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

	public function test_trim_dequeues_without_deregistering() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		openstation_chromeless_trim_command_palette();

		$this->assertTrue( wp_script_is( 'os-test-direct', 'registered' ) );
	}

	public function test_print_list_filter_strips_the_family() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );
		$this->register_graph();

		$filtered = openstation_chromeless_filter_palette_print_list(
			array( 'os-test-direct', 'os-test-unrelated', 'wp-commands' )
		);

		$this->assertSame( array( 'os-test-unrelated' ), $filtered );
	}

	public function test_style_print_list_filter_strips_the_roots() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$filtered = openstation_chromeless_filter_palette_style_print_list(
			array( 'wp-commands', 'common', 'wp-core-commands', 'forms' )
		);

		$this->assertSame( array( 'common', 'forms' ), $filtered );
	}

	public function test_style_print_list_filter_is_inert_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		$handles = array( 'wp-commands', 'common' );

		$this->assertSame(
			$handles,
			openstation_chromeless_filter_palette_style_print_list( $handles )
		);
	}

	public function test_style_print_list_filter_survives_a_non_array() {
		$this->enter_chromeless();
		set_current_screen( 'options-general' );

		$this->assertSame( 'nope', openstation_chromeless_filter_palette_style_print_list( 'nope' ) );
	}

	public function test_print_list_filter_is_inert_outside_a_window() {
		wp_set_current_user( self::$admin_id );
		$handles = array( 'os-test-direct', 'wp-commands' );

		$this->assertSame(
			$handles,
			openstation_chromeless_filter_palette_print_list( $handles )
		);
	}

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

	public function test_contributors_never_include_the_roots() {
		$this->register_graph();

		$contributors = openstation_command_palette_contributors(
			wp_scripts(),
			array( 'wp-commands', 'wp-core-commands', 'os-test-direct' )
		);

		$this->assertSame( array( 'os-test-direct' ), $contributors );
	}

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

	public function test_screen_ownership_is_filterable() {
		$this->register_graph();
		add_filter( 'openstation_command_palette_contributor_owns_screen', '__return_true' );

		$this->assertTrue(
			openstation_command_palette_owns_screen( wp_scripts(), 'os-test-direct' )
		);
	}

	public function test_shell_hoist_moves_contributors_into_the_manifest() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
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

	public function test_shell_hoist_survives_an_unregistered_palette_root() {

		$this->setExpectedIncorrectUsage( 'WP_Scripts::add' );
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

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

	public function test_shell_hoist_leaves_contributors_alone_with_no_core_palette() {
		if ( function_exists( 'wp_enqueue_command_palette_assets' ) ) {
			$this->markTestSkipped( 'This WordPress has the Core command palette.' );
		}
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		openstation_shell_hoist_command_palette_contributors();

		$this->assertTrue(
			wp_script_is( 'os-test-direct', 'enqueued' ),
			'the contributor must keep printing when it cannot be replayed'
		);
	}

	public function test_shell_hoist_does_not_run_inside_a_window() {
		$this->enter_chromeless();
		wp_register_script( 'openstation', 'https://example.org/desktop.js', array(), '1', true );
		wp_enqueue_script( 'openstation' );
		$this->register_graph();
		wp_enqueue_script( 'os-test-direct' );

		openstation_shell_hoist_command_palette_contributors();

		$this->assertTrue( wp_script_is( 'os-test-direct', 'enqueued' ) );
	}
}
