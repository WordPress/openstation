<?php

class Tests_OpenStation_ResolveScriptDependencies extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		wp_scripts()->registered = array();
	}

	private function register( $handle, $deps = array() ) {
		wp_register_script( $handle, 'https://example.test/' . $handle . '.js', $deps, '1.0.0', true );
	}

	private function resolved_handles( $handle ) {
		return wp_list_pluck( openstation_resolve_script_dependencies( $handle ), 'handle' );
	}

	public function test_closure_emits_dependencies_before_dependents() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-mid', array( 'os-test-base' ) );
		$this->register( 'os-test-top', array( 'os-test-mid' ) );

		$this->assertSame(
			array( 'os-test-base', 'os-test-mid', 'os-test-top' ),
			openstation_script_dependency_closure( wp_scripts(), array( 'os-test-top' ) )
		);
	}

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

		$this->assertContains( 'os-test-broken', $resolved );
		$this->assertNotContains( 'os-test-never-registered', $resolved );
	}

	public function test_walk_does_not_raise_doing_it_wrong_for_missing_deps() {
		$this->register( 'os-test-broken', array( 'os-test-never-registered' ) );

		$this->assertSame(
			array( 'os-test-broken' ),
			openstation_script_dependency_closure( wp_scripts(), array( 'os-test-broken' ) )
		);
	}

	public function test_dependency_cycle_terminates() {
		$this->register( 'os-test-a', array( 'os-test-b' ) );
		$this->register( 'os-test-b', array( 'os-test-a' ) );

		$closure = openstation_script_dependency_closure( wp_scripts(), array( 'os-test-a' ) );

		sort( $closure );
		$this->assertSame( array( 'os-test-a', 'os-test-b' ), $closure );
	}

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

	public function test_resolves_transitively_and_excludes_the_handle_itself() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-mid', array( 'os-test-base' ) );
		$this->register( 'os-test-widget', array( 'os-test-mid' ) );

		$this->assertSame(
			array( 'os-test-base', 'os-test-mid' ),
			$this->resolved_handles( 'os-test-widget' )
		);
	}

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

	public function test_every_entry_names_its_handle() {
		$this->register( 'os-test-base' );
		$this->register( 'os-test-mid', array( 'os-test-base' ) );
		$this->register( 'os-test-widget', array( 'os-test-mid' ) );

		$resolved = openstation_resolve_script_dependencies( 'os-test-widget' );

		$this->assertNotEmpty( $resolved );
		foreach ( $resolved as $entry ) {
			$this->assertArrayHasKey(
				'handle',
				$entry,
				'A dependency payload without its handle cannot be recognized once Core concatenates it.'
			);
			$this->assertNotSame( '', $entry['handle'] );
		}
	}

	public function test_returns_empty_for_unregistered_or_dependency_free_handles() {
		$this->register( 'os-test-standalone' );

		$this->assertSame( array(), openstation_resolve_script_dependencies( 'os-test-standalone' ) );
		$this->assertSame( array(), openstation_resolve_script_dependencies( 'os-test-nope' ) );
		$this->assertSame( array(), openstation_resolve_script_dependencies( '' ) );
	}

	public function test_alias_dependency_keeps_its_inline_data() {
		wp_register_script( 'os-test-config', false, array(), '1.0.0', true );
		wp_add_inline_script( 'os-test-config', 'window.osTestConfig={a:1};', 'before' );
		wp_add_inline_script( 'os-test-config', 'window.osTestConfigReady=true;', 'after' );
		wp_localize_script( 'os-test-config', 'osTestL10n', array( 'b' => '2' ) );
		$this->register( 'os-test-bundle', array( 'os-test-config' ) );

		$resolved = openstation_resolve_script_dependencies( 'os-test-bundle' );

		$this->assertCount( 1, $resolved );
		$this->assertSame( 'os-test-config', $resolved[0]['handle'] );

		$this->assertSame( '', $resolved[0]['url'] );
		$this->assertSame( array( 'window.osTestConfig={a:1};' ), $resolved[0]['before'] );
		$this->assertSame( array( 'window.osTestConfigReady=true;' ), $resolved[0]['after'] );
		$this->assertCount( 1, $resolved[0]['l10n'] );
		$this->assertStringContainsString( 'osTestL10n', $resolved[0]['l10n'][0] );
	}

	public function test_empty_alias_dependency_is_dropped() {
		wp_register_script( 'os-test-empty-alias', false, array(), '1.0.0', true );
		$this->register( 'os-test-bundle', array( 'os-test-empty-alias' ) );

		$this->assertSame( array(), openstation_resolve_script_dependencies( 'os-test-bundle' ) );
	}

	public function test_alias_dependency_still_walks_through_to_its_own_deps() {
		$this->register( 'os-test-base' );
		wp_register_script( 'os-test-group', false, array( 'os-test-base' ), '1.0.0', true );
		$this->register( 'os-test-bundle', array( 'os-test-group' ) );

		$this->assertSame( array( 'os-test-base' ), $this->resolved_handles( 'os-test-bundle' ) );
	}
}
