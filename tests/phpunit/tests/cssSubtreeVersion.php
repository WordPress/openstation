<?php
/**
 * Tests for `desktop_mode_css_subtree_version()` — the cache-buster
 * that stamps an `@import`ing stylesheet with the max mtime of its
 * whole import subtree.
 *
 * Regression context: `windows.css` was stamped with only its OWN
 * mtime while `@import`ing `os-settings.css` et al. — an edit to a
 * sub-sheet changed no URL the browser knew about, so users kept
 * stale CSS until an unrelated parent edit came along.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-assets
 */
class Tests_DesktopMode_CssSubtreeVersion extends WP_UnitTestCase {

	/**
	 * @covers ::desktop_mode_css_subtree_version
	 */
	public function test_version_covers_imported_sub_sheets() {
		$version = desktop_mode_css_subtree_version( 'assets/css/windows.css', '0' );

		// The stamp must be at least as new as EVERY member of the
		// subtree — the parent and each @import'd sub-sheet.
		// (`window-overview.css` and `os-settings.css` left the subtree
		// for their own deferred handles, each stamped with its own
		// filemtime — see desktop_mode_register_assets().)
		$members = array(
			'assets/css/windows.css',
			'assets/css/window-chrome.css',
			'assets/css/window-states.css',
			'assets/css/effects.css',
		);
		foreach ( $members as $relative ) {
			$path = DESKTOP_MODE_DIR . $relative;
			$this->assertFileExists( $path );
			$this->assertGreaterThanOrEqual(
				(int) filemtime( $path ),
				(int) $version,
				"{$relative} is newer than the subtree stamp — its edits would never cache-bust"
			);
		}
	}

	/**
	 * @covers ::desktop_mode_css_subtree_version
	 */
	public function test_missing_file_falls_back() {
		$this->assertSame(
			'fallback',
			desktop_mode_css_subtree_version( 'assets/css/does-not-exist.css', 'fallback' )
		);
	}

	/**
	 * The registered handle actually uses the subtree stamp — pinning
	 * the wiring, not just the helper.
	 *
	 * @covers ::desktop_mode_register_assets
	 */
	public function test_windows_style_is_registered_with_subtree_version() {
		$styles = wp_styles();
		$this->assertArrayHasKey( 'desktop-mode-windows', $styles->registered );
		$this->assertSame(
			desktop_mode_css_subtree_version( 'assets/css/windows.css', DESKTOP_MODE_VERSION ),
			(string) $styles->registered['desktop-mode-windows']->ver
		);
	}
}
