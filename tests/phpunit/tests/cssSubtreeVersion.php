<?php

class Tests_OpenStation_CssSubtreeVersion extends WP_UnitTestCase {

	private static $chain = array(
		'os-window-chrome' => 'assets/css/window-chrome.css',
		'os-window-states' => 'assets/css/window-states.css',
		'os-effects'       => 'assets/css/effects.css',
		'os-window-links'  => 'assets/css/window-links.css',
	);

	private static $deferred = array(
		'os-window-overview' => 'assets/css/window-overview.css',
	);

	public function set_up() {
		parent::set_up();
		openstation_register_assets();
	}

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

			$code = (string) preg_replace( '#/\*.*?\*/#s', '', $css );
			$this->assertDoesNotMatchRegularExpression(
				'/^\s*@import/m',
				$code,
				"{$relative} uses @import — its edits can be served stale forever."
			);
		}
	}

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

		foreach ( array_keys( self::$deferred ) as $handle ) {
			$this->assertContains(
				'os-windows',
				$styles->registered[ $handle ]->deps,
				"{$handle} must depend on os-windows to print after it."
			);
		}
	}

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

	public function test_version_covers_imported_sub_sheets() {
		$dir    = OPENSTATION_DIR . 'assets/css';
		$parent = $dir . '/__test-parent.css';
		$child  = $dir . '/__test-child.css';

		file_put_contents( $child, "/* child */\n" );
		file_put_contents( $parent, "@import url( \"__test-child.css\" );\n" );

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

	public function test_missing_file_falls_back() {
		$this->assertSame(
			'fallback',
			openstation_css_subtree_version( 'assets/css/does-not-exist.css', 'fallback' )
		);
	}
}
