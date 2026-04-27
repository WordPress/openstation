<?php
/**
 * Tests for the WP core PHP symbol indexer + the read-side query
 * helper. The full index build is exercised end-to-end (it's
 * lightning fast in CI because PHPUnit boots WP core anyway), so
 * these tests double as a smoke check that real WP core functions
 * + canonical hooks like `init` actually land in the index.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-code-editor
 */
class Tests_DesktopMode_WpdcPhpIndexer extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Force a fresh build for every test — the cached transient
		// from a previous test would mask regressions.
		wpdc_flush_wp_core_index();
	}

	public function tear_down() {
		wpdc_flush_wp_core_index();
		remove_all_filters( 'wpdc_php_index_extra_symbols' );
		remove_all_filters( 'wpdc_php_completion_max_results' );
		parent::tear_down();
	}

	// -----------------------------------------------------------------
	// Build
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_get_wp_core_index
	 * @covers ::wpdc_index_wp_core_functions
	 */
	public function test_index_includes_canonical_wp_functions() {
		$index = wpdc_get_wp_core_index();
		$this->assertArrayHasKey( 'functions', $index );
		$this->assertArrayHasKey( 'wp_get_current_user', $index['functions'] );

		$entry = $index['functions']['wp_get_current_user'];
		$this->assertSame( 'function', $entry['kind'] );
		$this->assertNotEmpty( $entry['signature'] );
		$this->assertNotEmpty( $entry['source'] );
	}

	/**
	 * @covers ::wpdc_index_wp_core_hooks
	 * @covers ::wpdc_scan_hooks_in_file
	 */
	public function test_index_includes_canonical_hooks() {
		$index = wpdc_get_wp_core_index();
		$this->assertArrayHasKey( 'hooks', $index );

		// `init` is fired in wp-includes/load.php — it has to be
		// in any non-broken index.
		$this->assertArrayHasKey( 'init', $index['hooks'] );
		$this->assertSame( 'action', $index['hooks']['init']['kind'] );
	}

	/**
	 * @covers ::wpdc_get_wp_core_index
	 *
	 * The cache is keyed by WP version; the second call should hit
	 * the transient and skip rebuilding. We can't cheaply prove the
	 * skip, but we can prove the result is identity-stable.
	 */
	public function test_index_is_cached_across_calls() {
		$first  = wpdc_get_wp_core_index();
		$second = wpdc_get_wp_core_index();
		$this->assertSame( $first, $second );
	}

	// -----------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_query_php_symbols
	 */
	public function test_prefix_match_filters_to_matching_names() {
		$matches = wpdc_query_php_symbols( 'wp_get_current_user' );
		$this->assertNotEmpty( $matches );
		foreach ( $matches as $entry ) {
			$this->assertStringStartsWith( 'wp_get_current_user', strtolower( $entry['name'] ) );
		}
	}

	/**
	 * @covers ::wpdc_query_php_symbols
	 */
	public function test_kind_filter_excludes_other_kinds() {
		$only_actions = wpdc_query_php_symbols( '', array( 'action' ), 100 );
		foreach ( $only_actions as $entry ) {
			$this->assertSame( 'action', $entry['kind'] );
		}
	}

	/**
	 * @covers ::wpdc_query_php_symbols
	 */
	public function test_results_are_sorted_alphabetically() {
		$matches = wpdc_query_php_symbols( 'wp_', array( 'function' ), 20 );
		$names   = array_map( static fn( $e ) => $e['name'], $matches );
		$sorted  = $names;
		sort( $sorted, SORT_STRING );
		$this->assertSame( $sorted, $names );
	}

	/**
	 * @covers ::wpdc_query_php_symbols
	 */
	public function test_limit_caps_result_count() {
		$matches = wpdc_query_php_symbols( '', array(), 5 );
		$this->assertLessThanOrEqual( 5, count( $matches ) );
	}

	/**
	 * @covers ::wpdc_get_php_symbol
	 */
	public function test_detail_lookup_returns_full_record() {
		$entry = wpdc_get_php_symbol( 'wp_get_current_user' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'wp_get_current_user', $entry['name'] );
		$this->assertArrayHasKey( 'doc', $entry );
		$this->assertArrayHasKey( 'params', $entry );
	}

	/**
	 * @covers ::wpdc_get_php_symbol
	 */
	public function test_detail_lookup_returns_null_for_unknown_symbol() {
		$this->assertNull( wpdc_get_php_symbol( 'definitely_not_a_wp_symbol_xyz' ) );
	}

	// -----------------------------------------------------------------
	// Extensibility
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_query_php_symbols
	 *
	 * The `wpdc_php_index_extra_symbols` filter is the seam Phase 5b
	 * (workspace symbols) and third-party dictionaries (ACF /
	 * WooCommerce) hook into. Validate it actually injects into the
	 * pool.
	 */
	public function test_extra_symbols_filter_injects_entries() {
		add_filter(
			'wpdc_php_index_extra_symbols',
			static function ( $pool ) {
				$pool[] = array(
					'name'      => 'my_plugin_helper',
					'kind'      => 'function',
					'signature' => 'my_plugin_helper(): void',
					'doc'       => 'Custom plugin helper.',
					'since'     => '1.0.0',
					'source'    => 'plugins/my/file.php',
				);
				return $pool;
			}
		);

		$matches = wpdc_query_php_symbols( 'my_plugin_helper' );
		$names   = array_map( static fn( $e ) => $e['name'], $matches );
		$this->assertContains( 'my_plugin_helper', $names );
	}

	// -----------------------------------------------------------------
	// PHPDoc parsing
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_phpdoc_summary
	 */
	public function test_phpdoc_summary_strips_delimiters_and_collapses_whitespace() {
		$doc = "/**\n * Retrieve a user.\n *\n * Longer details below.\n *\n * @since 1.0.0\n */";
		$this->assertSame( 'Retrieve a user.', wpdc_phpdoc_summary( $doc ) );
	}

	/**
	 * @covers ::wpdc_phpdoc_summary
	 *
	 * WP docblocks routinely omit the blank line before tag lines —
	 * our parser has to stop the summary at the first `@tag`.
	 */
	public function test_phpdoc_summary_terminates_at_first_tag_without_blank_line() {
		$doc = "/**\n * Retrieve a user.\n * @since 1.0.0\n */";
		$this->assertSame( 'Retrieve a user.', wpdc_phpdoc_summary( $doc ) );
	}

	/**
	 * @covers ::wpdc_phpdoc_tag
	 */
	public function test_phpdoc_tag_extracts_first_value() {
		$doc = "/**\n * @since 4.5.0\n * @return WP_User\n */";
		$this->assertSame( '4.5.0', wpdc_phpdoc_tag( $doc, 'since' ) );
		$this->assertSame( 'WP_User', wpdc_phpdoc_tag( $doc, 'return' ) );
	}
}
