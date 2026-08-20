<?php
/**
 * Tile stylesheet cascade order.
 *
 * `desktop-files.css` declares the canonical `.os-file-tile` chrome —
 * `position: absolute`, a fixed 88x104 box, a 48px visual. Surfaces
 * that reuse `<os-tile>` in a different layout override those
 * declarations from their own stylesheet, and they do it at EQUAL
 * specificity (`.os-my-wordpress__media-tile` vs `.os-file-tile`).
 *
 * Equal specificity means the later stylesheet wins, so "later" has to
 * be guaranteed rather than assumed. It is not guaranteed by enqueue
 * priority: `WP_Dependencies::all_deps()` walks the queue in order and
 * pushes each handle's dependencies ahead of it, so a handle enqueued
 * at priority 5 that depends on a tile-restyling stylesheet drags that
 * stylesheet into `$to_do` before `openstation_enqueue_assets()` (at
 * priority 10) ever gets to enqueue `os-files`.
 *
 * That is not hypothetical. `os-my-wordpress-woocommerce` is enqueued
 * at priority 5 and depends on `desktop-mode-my-wordpress`; on a store
 * it printed `my-wordpress.css` first, `desktop-files.css` second, and
 * every tile in the Explorer's Media grid went back to
 * `position: absolute` with no offsets — the whole grid stacked in one
 * corner, one icon over another.
 *
 * The fix is a declared dependency. These tests hold it, and the last
 * one generalises it to any future stylesheet that touches a tile.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-tile-styles
 */
class Tests_OpenStation_TileStylesheetOrder extends WP_UnitTestCase {

	/** Handle that declares the canonical tile chrome. */
	const TILE_CHROME_HANDLE = 'os-files';

	public function set_up() {
		parent::set_up();
		$this->ensure_styles_registered();
	}

	/**
	 * The plugin registers its handles on `init`, which has already
	 * fired by the time a test runs — but a sibling test class may
	 * have emptied the registry, so re-run the registrars when the
	 * handles we care about are gone.
	 */
	private function ensure_styles_registered() {
		if ( wp_style_is( self::TILE_CHROME_HANDLE, 'registered' )
			&& wp_style_is( 'desktop-mode-my-wordpress', 'registered' ) ) {
			return;
		}
		if ( function_exists( 'openstation_register_assets' ) ) {
			openstation_register_assets();
		}
		if ( function_exists( 'openstation_my_wordpress_register_assets' ) ) {
			openstation_my_wordpress_register_assets();
		}
	}

	/**
	 * Every handle `$handle` depends on, directly or through another
	 * dependency.
	 *
	 * @param string $handle Style handle.
	 * @param array  $seen   Recursion guard.
	 * @return string[] Dependency handles.
	 */
	private function transitive_deps( $handle, &$seen = array() ) {
		$styles = wp_styles();
		if ( isset( $seen[ $handle ] ) || ! isset( $styles->registered[ $handle ] ) ) {
			return array();
		}
		$seen[ $handle ] = true;

		$deps = (array) $styles->registered[ $handle ]->deps;
		foreach ( $deps as $dep ) {
			$deps = array_merge( $deps, $this->transitive_deps( $dep, $seen ) );
		}

		return array_values( array_unique( $deps ) );
	}

	/**
	 * Local filesystem path for a style registered from this plugin,
	 * or an empty string for core / third-party handles.
	 *
	 * @param string $handle Style handle.
	 * @return string Absolute path, or '' when the handle isn't ours.
	 */
	private function plugin_css_path( $handle ) {
		$styles = wp_styles();
		if ( ! isset( $styles->registered[ $handle ] ) ) {
			return '';
		}
		$src = (string) $styles->registered[ $handle ]->src;
		if ( '' === $src || 0 !== strpos( $src, OPENSTATION_URL ) ) {
			return '';
		}

		$path = OPENSTATION_DIR . substr( $src, strlen( OPENSTATION_URL ) );
		return file_exists( $path ) ? $path : '';
	}

	/**
	 * CSS with comments stripped, so a `.os-file-tile` mentioned in a
	 * docblock doesn't read as a rule that restyles one.
	 *
	 * @param string $path Absolute path to a stylesheet.
	 * @return string
	 */
	private function css_without_comments( $path ) {
		$css = (string) file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local test fixture read, not an HTTP request.
		return (string) preg_replace( '#/\*.*?\*/#s', '', $css );
	}

	/**
	 * Order the handles would print in, given a queue.
	 *
	 * Mirrors what `WP_Styles::do_items()` does: resolve the queue
	 * through `all_deps()` and read back `$to_do`.
	 *
	 * @param string[] $queue Handles in enqueue order.
	 * @return string[] Handles in print order.
	 */
	private function print_order( array $queue ) {
		$styles        = wp_styles();
		$saved_to_do   = $styles->to_do;
		$saved_done    = $styles->done;
		$styles->to_do = array();
		$styles->done  = array();

		$styles->all_deps( $queue );
		$order = $styles->to_do;

		$styles->to_do = $saved_to_do;
		$styles->done  = $saved_done;

		return $order;
	}

	// --------------------------------------------------------------
	// The declared dependency
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_my_wordpress_register_assets
	 */
	public function test_my_wordpress_style_declares_the_tile_chrome_dependency() {
		$this->assertContains(
			self::TILE_CHROME_HANDLE,
			$this->transitive_deps( 'desktop-mode-my-wordpress' ),
			'my-wordpress.css overrides `.os-file-tile` at equal specificity, so it must declare `os-files` as a dependency to be guaranteed to print after it.'
		);
	}

	// --------------------------------------------------------------
	// The order that dependency buys
	// --------------------------------------------------------------

	/**
	 * The plain case: the shell enqueues `os-files` first, the window
	 * stylesheet later. This order was always fine — pinned so the
	 * hostile case below can be read as the delta.
	 */
	public function test_tile_chrome_prints_before_the_window_stylesheet() {
		$order = $this->print_order(
			array( self::TILE_CHROME_HANDLE, 'desktop-mode-my-wordpress' )
		);

		$this->assertLessThan(
			array_search( 'desktop-mode-my-wordpress', $order, true ),
			array_search( self::TILE_CHROME_HANDLE, $order, true ),
			'desktop-files.css must print before my-wordpress.css.'
		);
	}

	/**
	 * The regression: a companion stylesheet enqueued EARLIER than the
	 * shell's own assets, declaring the window stylesheet as its
	 * dependency. This is the WooCommerce integration's shape
	 * (`admin_enqueue_scripts` priority 5, deps
	 * `desktop-mode-my-wordpress`), and before the declared dependency
	 * it inverted the cascade.
	 */
	public function test_tile_chrome_still_prints_first_when_a_dependent_is_enqueued_ahead_of_the_shell() {
		wp_register_style(
			'os-test-my-wordpress-companion',
			OPENSTATION_URL . 'assets/css/my-wordpress-woocommerce.css',
			array( 'desktop-mode-my-wordpress' ),
			'1.0.0'
		);

		// Priority 5 companion, then the shell's priority 10 batch,
		// then the window's own priority 30 enqueue.
		$order = $this->print_order(
			array(
				'os-test-my-wordpress-companion',
				self::TILE_CHROME_HANDLE,
				'desktop-mode-my-wordpress',
			)
		);

		$chrome = array_search( self::TILE_CHROME_HANDLE, $order, true );
		$window = array_search( 'desktop-mode-my-wordpress', $order, true );

		$this->assertNotFalse( $chrome, 'os-files did not make it into the print queue.' );
		$this->assertNotFalse( $window, 'desktop-mode-my-wordpress did not make it into the print queue.' );
		$this->assertLessThan(
			$window,
			$chrome,
			'A companion stylesheet enqueued before the shell pulled my-wordpress.css ahead of desktop-files.css — the Explorer media grid stacks in one corner when that happens.'
		);

		wp_deregister_style( 'os-test-my-wordpress-companion' );
	}

	// --------------------------------------------------------------
	// The general invariant
	// --------------------------------------------------------------

	/**
	 * Any of the plugin's own stylesheets that writes a rule against
	 * `.os-file-tile` is restyling a tile, and therefore has to print
	 * after the file that declares one. Generalises the two tests
	 * above to stylesheets that don't exist yet.
	 */
	public function test_every_stylesheet_that_restyles_a_tile_depends_on_the_tile_chrome() {
		$offenders = array();

		foreach ( array_keys( wp_styles()->registered ) as $handle ) {
			if ( self::TILE_CHROME_HANDLE === $handle ) {
				continue;
			}
			$path = $this->plugin_css_path( $handle );
			if ( '' === $path ) {
				continue;
			}
			if ( false === strpos( $this->css_without_comments( $path ), '.os-file-tile' ) ) {
				continue;
			}
			if ( in_array( self::TILE_CHROME_HANDLE, $this->transitive_deps( $handle ), true ) ) {
				continue;
			}
			$offenders[] = $handle . ' (' . basename( $path ) . ')';
		}

		$this->assertSame(
			array(),
			$offenders,
			"These stylesheets write `.os-file-tile` rules but don't declare `os-files` as a dependency, so whether their overrides win depends on enqueue order. Add 'os-files' to the handle's deps:\n" . implode( "\n", $offenders )
		);
	}
}
