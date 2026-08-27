<?php
/**
 * Tests for `openstation_script_dependency_closure()` and
 * `openstation_resolve_script_dependencies()`.
 *
 * A handle delivered only through `loadVendorScript()` never goes
 * through `wp_print_scripts()`, so the packages it declares have to be
 * resolved and shipped alongside it. Getting that list wrong is a
 * silent failure: the bundle loads, a `wp.*` global it declared is
 * undefined, and it throws at mount.
 *
 * The regression these tests pin is the one that made the list
 * *conditionally* wrong. The closure used to come from
 * `WP_Scripts::all_deps( $deps, true )`, and with `$recursion = true`
 * Core aborts the entire call the moment one handle fails — abandoning
 * every handle after it in the list (see `all_deps()` in
 * `wp-includes/class-wp-dependencies.php`). One stale registration
 * anywhere in the graph therefore truncated the answer, and the caller
 * could not tell a truncated list from a complete one.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-resolve-script-dependencies
 */
class Tests_OpenStation_ResolveScriptDependencies extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// `wp_scripts()` is process-global; prior tests leak handles.
		wp_scripts()->registered = array();
	}

	/**
	 * Registers a handle with a real `src`, so the payload filter in
	 * `openstation_resolve_script_dependencies()` keeps it.
	 *
	 * @param string   $handle Handle to register.
	 * @param string[] $deps   Declared dependencies.
	 */
	private function register( $handle, $deps = array() ) {
		wp_register_script( $handle, 'https://example.test/' . $handle . '.js', $deps, '1.0.0', true );
	}

	/**
	 * The handles named in a resolved dependency payload, in order.
	 *
	 * @param string $handle Handle to resolve.
	 * @return string[]
	 */
	private function resolved_handles( $handle ) {
		return wp_list_pluck( openstation_resolve_script_dependencies( $handle ), 'handle' );
	}

	/**
	 * @covers ::openstation_script_dependency_closure
	 */
	public function test_closure_emits_dependencies_before_dependents() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-mid', array( 'os-test-base' ) );
		$this->register( 'os-test-top', array( 'os-test-mid' ) );

		$this->assertSame(
			array( 'os-test-base', 'os-test-mid', 'os-test-top' ),
			openstation_script_dependency_closure( wp_scripts(), array( 'os-test-top' ) )
		);
	}

	/**
	 * The regression. A broken sibling must not cost the others.
	 *
	 * `os-test-broken` declares a handle nobody registered. Under
	 * `all_deps( …, true )` that returned false on the first list
	 * entry, so `os-test-late` — which is perfectly fine and is the
	 * package the widget actually needed — never made it into the
	 * payload, and the widget threw on an undefined global at mount.
	 *
	 * @covers ::openstation_resolve_script_dependencies
	 */
	public function test_unregistered_dependency_does_not_truncate_the_rest() {
		$this->register( 'os-test-broken', array( 'os-test-never-registered' ) );
		$this->register( 'os-test-late' );
		$this->register( 'os-test-widget', array( 'os-test-broken', 'os-test-late' ) );

		$resolved = $this->resolved_handles( 'os-test-widget' );

		$this->assertContains(
			'os-test-late',
			$resolved,
			'A sibling after the broken handle was dropped — the closure truncated.'
		);
		// The broken handle is registered and has a file of its own, so
		// it is still worth delivering: its missing dependency costs it
		// one tag, not its existence. Losing it silently is the failure
		// mode this whole mechanism exists to prevent.
		$this->assertContains( 'os-test-broken', $resolved );
		$this->assertNotContains( 'os-test-never-registered', $resolved );
	}

	/**
	 * The walk is read-only analysis and must stay quiet.
	 *
	 * `all_deps()` reports missing dependencies through
	 * `_doing_it_wrong()`. `WP_UnitTestCase` fails a test that triggers
	 * one without declaring it, so this method passing at all is the
	 * assertion: the old implementation raised the notice here, and
	 * turned another plugin's pre-existing registration mistake into
	 * our warning.
	 *
	 * @covers ::openstation_script_dependency_closure
	 */
	public function test_walk_does_not_raise_doing_it_wrong_for_missing_deps() {
		$this->register( 'os-test-broken', array( 'os-test-never-registered' ) );

		$this->assertSame(
			array( 'os-test-broken' ),
			openstation_script_dependency_closure( wp_scripts(), array( 'os-test-broken' ) )
		);
	}

	/**
	 * @covers ::openstation_script_dependency_closure
	 */
	public function test_dependency_cycle_terminates() {
		$this->register( 'os-test-a', array( 'os-test-b' ) );
		$this->register( 'os-test-b', array( 'os-test-a' ) );

		$closure = openstation_script_dependency_closure( wp_scripts(), array( 'os-test-a' ) );

		sort( $closure );
		$this->assertSame( array( 'os-test-a', 'os-test-b' ), $closure );
	}

	/**
	 * @covers ::openstation_script_dependency_closure
	 */
	public function test_shared_dependency_is_emitted_once() {
		$this->register( 'os-test-shared' );
		$this->register( 'os-test-left', array( 'os-test-shared' ) );
		$this->register( 'os-test-right', array( 'os-test-shared' ) );

		$this->assertSame(
			array( 'os-test-shared', 'os-test-left', 'os-test-right' ),
			openstation_script_dependency_closure(
				wp_scripts(),
				array( 'os-test-left', 'os-test-right' )
			)
		);
	}

	/**
	 * @covers ::openstation_resolve_script_dependencies
	 */
	public function test_resolves_transitively_and_excludes_the_handle_itself() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-mid', array( 'os-test-base' ) );
		$this->register( 'os-test-widget', array( 'os-test-mid' ) );

		$this->assertSame(
			array( 'os-test-base', 'os-test-mid' ),
			$this->resolved_handles( 'os-test-widget' )
		);
	}

	/**
	 * A payload entry carries what the lazy loader needs to inject.
	 *
	 * @covers ::openstation_resolve_script_dependencies
	 */
	public function test_payload_entries_carry_url_and_inline_data() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-widget', array( 'os-test-base' ) );
		wp_add_inline_script( 'os-test-base', 'window.osTestBefore = 1;', 'before' );

		$resolved = openstation_resolve_script_dependencies( 'os-test-widget' );

		$this->assertCount( 1, $resolved );
		$this->assertSame( 'os-test-base', $resolved[0]['handle'] );
		$this->assertStringContainsString( 'os-test-base.js', $resolved[0]['url'] );
		$this->assertContains( 'window.osTestBefore = 1;', $resolved[0]['before'] );
	}

	/**
	 * @covers ::openstation_resolve_script_dependencies
	 */
	public function test_returns_empty_for_unregistered_or_dependency_free_handles() {
		$this->register( 'os-test-standalone' );

		$this->assertSame( array(), openstation_resolve_script_dependencies( 'os-test-standalone' ) );
		$this->assertSame( array(), openstation_resolve_script_dependencies( 'os-test-nope' ) );
		$this->assertSame( array(), openstation_resolve_script_dependencies( '' ) );
	}
}
