<?php
/**
 * Tests for the Divi script-dependency compat shim.
 *
 * Divi's `et-builder-gutenberg` bundle calls `wp.data.select(
 * 'core/editor' ).isCleanNewPost` at module-load time but only
 * declares `[ jquery, wp-hooks ]` as deps. When script load order
 * resolves against Divi, the call throws and Divi's React
 * integration never mounts. We add `wp-data` + `wp-editor` to the
 * existing registration so the loader prints the `core/editor`
 * store first. See includes/compat/divi.php.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 *
 * @covers ::desktop_mode_compat_divi_fix_gutenberg_deps
 */
class Tests_DesktopMode_DiviCompat extends WP_UnitTestCase {

	public function tear_down() {
		wp_deregister_script( 'et-builder-gutenberg' );
		unset( $_GET['desktop_mode_chromeless'] );
		parent::tear_down();
	}

	/**
	 * Helper: simulate a chromeless request by priming the query
	 * arg + user meta that `desktop_mode_is_chromeless_request()`
	 * checks. Caller is responsible for unsetting state in
	 * `tear_down`.
	 */
	private function force_chromeless() {
		$_GET['desktop_mode_chromeless'] = '1';
		$user_id                         = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		update_user_meta( $user_id, 'wp_desktop_mode', '1' );
	}

	/**
	 * Simulate Divi's registration shape, fire the compat hook,
	 * and assert the deps were extended.
	 */
	public function test_injects_missing_wp_editor_and_wp_data_deps() {
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$deps = wp_scripts()->registered['et-builder-gutenberg']->deps;

		$this->assertContains( 'wp-data', $deps, 'wp-data must be injected so core/editor store registers first.' );
		$this->assertContains( 'wp-editor', $deps, 'wp-editor must be injected so the data store is populated before Divi runs.' );
		// Original deps survive the merge.
		$this->assertContains( 'jquery', $deps );
		$this->assertContains( 'wp-hooks', $deps );
	}

	/**
	 * Shim must be a no-op when Divi isn't installed — the script
	 * handle simply isn't registered.
	 */
	public function test_no_op_when_divi_not_registered() {
		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );

		do_action( 'enqueue_block_editor_assets' );

		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );
	}

	/**
	 * Idempotent: if Divi later fixes their deps upstream (or the
	 * shim runs twice for any reason), we must not duplicate the
	 * injected entries.
	 */
	public function test_does_not_duplicate_deps_when_already_present() {
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks', 'wp-data', 'wp-editor' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );
		do_action( 'enqueue_block_editor_assets' );

		$deps = wp_scripts()->registered['et-builder-gutenberg']->deps;

		$this->assertSame( 1, count( array_keys( $deps, 'wp-data', true ) ) );
		$this->assertSame( 1, count( array_keys( $deps, 'wp-editor', true ) ) );
	}

	/**
	 * Inside a chromeless iframe, we must append an inline `before`
	 * script that re-points `window.et_gb` at the iframe's own
	 * window. Divi's webpack externals resolve `@wordpress/data`
	 * via `window.et_gb.wp.data`, and Divi's own inline `before`
	 * sets `et_gb = window.top` — which is our desktop shell, a
	 * different document. We must override that assignment.
	 */
	public function test_chromeless_request_appends_et_gb_window_override() {
		$this->force_chromeless();
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$before_inlines = (array) wp_scripts()->get_data( 'et-builder-gutenberg', 'before' );
		$joined         = implode( "\n", $before_inlines );

		$this->assertStringContainsString( 'window.et_gb = window;', $joined );
	}

	/**
	 * In classic (non-chromeless) requests we must NOT override
	 * `window.et_gb` — Divi's original logic correctly points it at
	 * `window.top` for the Cypress-iframe case and at `window` for
	 * top-level page loads. Our override would clobber that.
	 */
	public function test_classic_request_does_not_append_et_gb_override() {
		// Ensure the chromeless query flag is not set; current user has no desktop meta.
		wp_set_current_user( 0 );
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$before_inlines = (array) wp_scripts()->get_data( 'et-builder-gutenberg', 'before' );
		$joined         = implode( "\n", $before_inlines );

		$this->assertStringNotContainsString( 'window.et_gb = window;', $joined );
	}
}
