<?php
/**
 * Tests for stylesheet cache-busting.
 *
 * ## History, because it explains the shape of these tests
 *
 * `windows.css` used to `@import` six sub-sheets and ship them under
 * a single `os-windows` handle. An `@import` URL carries no
 * `?ver=`, so when a sub-sheet changed there was no URL anywhere for
 * the browser to invalidate. `openstation_css_subtree_version()` was
 * the mitigation: stamp the PARENT with the max mtime of the whole
 * import subtree.
 *
 * That was never a real fix. Changing the parent's `?ver=` makes the
 * browser re-fetch and re-parse `windows.css`, and it then requests
 * each sub-sheet at a completely unchanged URL — free to be served
 * from its heuristic cache. Edits to a sub-sheet kept needing a hard
 * refresh, and rules were twice relocated INTO `windows.css` purely
 * to dodge it.
 *
 * Every window sheet is now registered as its own handle with its own
 * `filemtime` stamp. These tests pin BOTH halves of that: the helper
 * still works for anyone with an `@import`ing sheet, and — more
 * importantly — the window sheets no longer rely on it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-assets
 */
class Tests_OpenStation_CssSubtreeVersion extends WP_UnitTestCase {

	/**
	 * Ordered chain of window stylesheets. Order is the contract:
	 * WordPress prints dependencies before dependents, so this list
	 * reproduces the cascade the `@import` block used to define.
	 *
	 * @var array<string,string>
	 */
	private static $chain = array(
		'os-window-chrome' => 'assets/css/window-chrome.css',
		'os-window-states' => 'assets/css/window-states.css',
		'os-effects'       => 'assets/css/effects.css',
		'os-window-links'  => 'assets/css/window-links.css',
	);

	/**
	 * Registered AFTER `os-windows` so they can load
	 * deferred — the OS Settings panel and the window overview are
	 * lazy-loaded UI that cannot be on screen at first paint. They
	 * still need their own filemtime stamp, which is what this file
	 * is about; they just are not part of the critical chain.
	 *
	 * @var array<string,string>
	 */
	private static $deferred = array(
		'os-window-overview' => 'assets/css/window-overview.css',
		'os-settings'     => 'assets/css/os-settings.css',
	);

	public function set_up() {
		parent::set_up();
		openstation_register_assets();
	}

	// ------------------------------------------------------------------
	// The regression this whole file exists for.
	// ------------------------------------------------------------------

	/**
	 * No window stylesheet may go back to `@import`. An `@import`ed
	 * sheet cannot be cache-busted — that is the entire bug.
	 *
	 * @covers ::openstation_register_assets
	 */
	public function test_window_sheets_do_not_use_import() {
		$sheets = array_merge(
			array( 'assets/css/windows.css' ),
			array_values( self::$chain ),
			array_values( self::$deferred )
		);
		foreach ( $sheets as $relative ) {
			$path = OPENSTATION_DIR . $relative;
			$this->assertFileExists( $path );
			$css = (string) file_get_contents( $path );
			// Strip comments first — these files discuss `@import` at
			// length in their docblocks, and that prose is not a rule.
			$code = (string) preg_replace( '#/\*.*?\*/#s', '', $css );
			$this->assertDoesNotMatchRegularExpression(
				'/^\s*@import/m',
				$code,
				"{$relative} uses @import — its edits can be served stale forever."
			);
		}
	}

	/**
	 * Every window sheet is registered on its own handle, stamped
	 * with its own `filemtime`, so each has a real cache key.
	 *
	 * @covers ::openstation_register_assets
	 */
	public function test_each_window_sheet_has_its_own_filemtime_stamp() {
		$styles = wp_styles();
		$all = self::$chain + self::$deferred;
		$all['os-windows'] = 'assets/css/windows.css';

		foreach ( $all as $handle => $relative ) {
			$this->assertArrayHasKey(
				$handle,
				$styles->registered,
				"{$handle} is not registered."
			);
			$this->assertSame(
				(string) filemtime( OPENSTATION_DIR . $relative ),
				(string) $styles->registered[ $handle ]->ver,
				"{$handle} is not stamped with its own filemtime."
			);
		}
	}

	/**
	 * The dependency chain reproduces the old `@import` order, and
	 * `os-windows` still sits at the end so its own rules
	 * keep winning ties.
	 *
	 * @covers ::openstation_register_assets
	 */
	public function test_dependency_chain_preserves_cascade_order() {
		$styles   = wp_styles();
		$previous = null;

		foreach ( array_keys( self::$chain ) as $handle ) {
			$deps = $styles->registered[ $handle ]->deps;
			if ( null === $previous ) {
				$this->assertContains( 'os-variables', $deps );
			} else {
				$this->assertContains(
					$previous,
					$deps,
					"{$handle} must depend on {$previous} to hold its place in the cascade."
				);
			}
			$previous = $handle;
		}

		$this->assertContains(
			$previous,
			$styles->registered['os-windows']->deps,
			'os-windows must depend on the tail of the chain.'
		);

		// The deferred pair hangs off the entry point so it prints
		// after it, holding the cascade position it had as an
		// `@import`.
		foreach ( array_keys( self::$deferred ) as $handle ) {
			$this->assertContains(
				'os-windows',
				$styles->registered[ $handle ]->deps,
				"{$handle} must depend on os-windows to print after it."
			);
		}
	}

	/**
	 * Enqueuing the one entry-point handle must still pull in every
	 * window sheet — that is what callers had when these were
	 * `@import`s, and `includes/render/assets.php` still enqueues
	 * only `os-windows`.
	 *
	 * @covers ::openstation_register_assets
	 */
	public function test_entry_handle_pulls_in_the_whole_chain() {
		$styles = wp_styles();
		$styles->all_deps( array( 'os-windows' ) );

		foreach ( array_keys( self::$chain ) as $handle ) {
			$this->assertContains(
				$handle,
				$styles->to_do,
				"Enqueuing os-windows did not pull in {$handle}."
			);
		}
	}

	// ------------------------------------------------------------------
	// The helper itself — still supported for `@import`ing sheets.
	// ------------------------------------------------------------------

	/**
	 * Built against a temporary fixture rather than a shipped file:
	 * no plugin stylesheet uses `@import` any more, and pinning this
	 * to one that did would re-introduce the coupling we just removed.
	 *
	 * @covers ::openstation_css_subtree_version
	 */
	public function test_version_covers_imported_sub_sheets() {
		$dir    = OPENSTATION_DIR . 'assets/css';
		$parent = $dir . '/__test-parent.css';
		$child  = $dir . '/__test-child.css';

		file_put_contents( $child, "/* child */\n" );
		file_put_contents( $parent, "@import url( \"__test-child.css\" );\n" );
		// Make the CHILD the newer of the two, so a parent-only stamp
		// would miss it.
		touch( $parent, time() - 500 );
		touch( $child, time() );

		$version = openstation_css_subtree_version( 'assets/css/__test-parent.css', '0' );

		$this->assertGreaterThanOrEqual(
			(int) filemtime( $child ),
			(int) $version,
			'The stamp must cover the imported sub-sheet, not just the parent.'
		);

		unlink( $parent );
		unlink( $child );
	}

	/**
	 * @covers ::openstation_css_subtree_version
	 */
	public function test_missing_file_falls_back() {
		$this->assertSame(
			'fallback',
			openstation_css_subtree_version( 'assets/css/does-not-exist.css', 'fallback' )
		);
	}
}
