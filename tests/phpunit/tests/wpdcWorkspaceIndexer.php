<?php
/**
 * Tests for the workspace PHP symbol indexer — the Phase 5b layer
 * that scans the user's plugins/themes for functions, classes,
 * interfaces, traits, and locally-declared hooks. Uses a
 * temp-directory fixture pinned via the `wpdc_workspace_root`
 * filter so we can exercise the real walker + tokenizer without
 * touching the live workspace.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-code-editor
 */
class Tests_DesktopMode_WpdcWorkspaceIndexer extends WP_UnitTestCase {

	private $tmp_root = '';

	public function set_up() {
		parent::set_up();
		$this->tmp_root = sys_get_temp_dir() . '/wpdc-ws-' . uniqid();
		mkdir( $this->tmp_root, 0755, true );
		mkdir( $this->tmp_root . '/plugin-a', 0755, true );

		add_filter( 'wpdc_workspace_root', array( $this, 'set_workspace_root' ) );
		// Each test starts with a clean cache.
		wpdc_flush_workspace_index();
	}

	public function tear_down() {
		remove_filter( 'wpdc_workspace_root', array( $this, 'set_workspace_root' ) );
		remove_all_filters( 'wpdc_workspace_index_skip_dirs' );
		remove_all_filters( 'wpdc_workspace_index_skip_filename_re' );
		wpdc_flush_workspace_index();
		$this->rrmdir( $this->tmp_root );
		parent::tear_down();
	}

	public function set_workspace_root( $root ) {
		return $this->tmp_root;
	}

	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$it = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ( $it as $entry ) {
			if ( $entry->isLink() || $entry->isFile() ) {
				@unlink( $entry->getPathname() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
			} else {
				@rmdir( $entry->getPathname() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
			}
		}
		@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	private function write( $rel, $content ) {
		$abs = $this->tmp_root . '/' . $rel;
		$dir = dirname( $abs );
		if ( ! is_dir( $dir ) ) {
			mkdir( $dir, 0755, true );
		}
		file_put_contents( $abs, $content );
		return $abs;
	}

	private function find_symbol( array $symbols, $name ) {
		foreach ( $symbols as $sym ) {
			if ( ( $sym['name'] ?? null ) === $name ) {
				return $sym;
			}
		}
		return null;
	}

	// -----------------------------------------------------------------
	// File-level scan
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_scan_workspace_file
	 */
	public function test_scan_extracts_top_level_function() {
		$abs = $this->write(
			'plugin-a/main.php',
			"<?php\n\nfunction my_helper( \$a ) {\n    return \$a;\n}\n"
		);
		$symbols = wpdc_scan_workspace_file( $abs );
		$entry = $this->find_symbol( $symbols, 'my_helper' );

		$this->assertNotNull( $entry );
		$this->assertSame( 'function', $entry['kind'] );
		$this->assertSame( 'plugin-a/main.php', $entry['file'] );
		$this->assertSame( 3, $entry['line'] );
	}

	/**
	 * @covers ::wpdc_scan_workspace_file
	 */
	public function test_scan_extracts_class_with_namespace() {
		$abs = $this->write(
			'plugin-a/foo.php',
			"<?php\n\nnamespace Foo\\Sub;\n\nclass Bar {}\n"
		);
		$symbols = wpdc_scan_workspace_file( $abs );
		$entry = $this->find_symbol( $symbols, 'Foo\\Sub\\Bar' );

		$this->assertNotNull( $entry );
		$this->assertSame( 'class', $entry['kind'] );
	}

	/**
	 * @covers ::wpdc_scan_workspace_file
	 */
	public function test_scan_skips_class_methods() {
		$abs = $this->write(
			'plugin-a/cls.php',
			"<?php\n\nclass Wrapper {\n    public function do_thing() {}\n}\n"
		);
		$symbols = wpdc_scan_workspace_file( $abs );
		$method = $this->find_symbol( $symbols, 'do_thing' );

		// The class itself IS recorded; its methods are not. Phase 5b
		// scopes the index to top-level entries only.
		$this->assertNull( $method );
		$this->assertNotNull( $this->find_symbol( $symbols, 'Wrapper' ) );
	}

	/**
	 * @covers ::wpdc_scan_workspace_file
	 */
	public function test_scan_extracts_local_hook_declarations() {
		$abs = $this->write(
			'plugin-a/hooks.php',
			"<?php\n\ndo_action( 'my_plugin_init' );\napply_filters( 'my_plugin_label', 'default' );\n"
		);
		$symbols = wpdc_scan_workspace_file( $abs );

		$action = $this->find_symbol( $symbols, 'my_plugin_init' );
		$filter = $this->find_symbol( $symbols, 'my_plugin_label' );

		$this->assertNotNull( $action );
		$this->assertSame( 'action', $action['kind'] );
		$this->assertNotNull( $filter );
		$this->assertSame( 'filter', $filter['kind'] );
	}

	/**
	 * @covers ::wpdc_scan_workspace_file
	 *
	 * Closures (`function () {}`) and anonymous classes
	 * (`new class {}`) must NOT pollute the function/class index —
	 * they have no name to resolve from elsewhere in the workspace.
	 */
	public function test_scan_skips_closures_and_anonymous_classes() {
		$abs = $this->write(
			'plugin-a/anon.php',
			"<?php\n\$cb = function () { return 1; };\n\$obj = new class { public \$x = 1; };\n"
		);
		$symbols = wpdc_scan_workspace_file( $abs );

		// Only the names we declared end up in the list.
		foreach ( $symbols as $sym ) {
			$this->assertNotEmpty( $sym['name'] );
		}
		// And there shouldn't be an anonymous-named entry pointing at
		// either of those constructs.
		$this->assertCount( 0, $symbols );
	}

	// -----------------------------------------------------------------
	// Walker / refresh / invalidation
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_refresh_workspace_index
	 */
	public function test_refresh_walks_workspace_and_indexes_files() {
		$this->write( 'plugin-a/main.php', "<?php\nfunction my_helper() {}\n" );
		$this->write( 'plugin-a/util.php', "<?php\nfunction my_other() {}\n" );

		$index = wpdc_refresh_workspace_index();

		$this->assertArrayHasKey( 'plugin-a/main.php', $index['files'] );
		$this->assertArrayHasKey( 'plugin-a/util.php', $index['files'] );
	}

	/**
	 * @covers ::wpdc_refresh_workspace_file
	 */
	public function test_per_file_refresh_after_save_updates_symbols() {
		$abs = $this->write( 'plugin-a/main.php', "<?php\nfunction old_name() {}\n" );
		wpdc_refresh_workspace_index();
		// Ensure the new mtime differs (filesystems with second-resolution
		// mtimes round to whole seconds; sleep keeps the comparison honest).
		sleep( 1 );
		file_put_contents( $abs, "<?php\nfunction new_name() {}\n" );
		wpdc_refresh_workspace_file( $abs );

		$index = wpdc_get_workspace_index();
		$entry = $index['files']['plugin-a/main.php'];
		$names = array_map( static fn( $s ) => $s['name'], $entry['symbols'] );

		$this->assertNotContains( 'old_name', $names );
		$this->assertContains( 'new_name', $names );
	}

	/**
	 * @covers ::wpdc_refresh_workspace_index
	 */
	public function test_refresh_drops_entries_for_deleted_files() {
		$abs = $this->write( 'plugin-a/main.php', "<?php\nfunction my_helper() {}\n" );
		wpdc_refresh_workspace_index();
		$this->assertArrayHasKey( 'plugin-a/main.php', wpdc_get_workspace_index()['files'] );

		unlink( $abs );
		wpdc_refresh_workspace_index();

		$this->assertArrayNotHasKey( 'plugin-a/main.php', wpdc_get_workspace_index()['files'] );
	}

	/**
	 * @covers ::wpdc_refresh_workspace_index
	 */
	public function test_skip_dirs_filter_excludes_vendor_and_node_modules() {
		$this->write( 'plugin-a/vendor/lib.php', "<?php\nfunction skipped_vendor() {}\n" );
		$this->write( 'plugin-a/node_modules/x.php', "<?php\nfunction skipped_node() {}\n" );
		$this->write( 'plugin-a/main.php', "<?php\nfunction kept() {}\n" );

		$index = wpdc_refresh_workspace_index();

		$this->assertArrayNotHasKey( 'plugin-a/vendor/lib.php', $index['files'] );
		$this->assertArrayNotHasKey( 'plugin-a/node_modules/x.php', $index['files'] );
		$this->assertArrayHasKey( 'plugin-a/main.php', $index['files'] );
	}

	/**
	 * @covers ::wpdc_workspace_extend_symbols
	 *
	 * The filter wires workspace symbols into the merged php-symbols
	 * pool the Monaco completion provider queries.
	 */
	public function test_query_merges_workspace_into_pool() {
		$this->write( 'plugin-a/main.php', "<?php\nfunction my_zzz_helper() {}\n" );
		// Force the index to seed.
		wpdc_refresh_workspace_index();

		$matches = wpdc_query_php_symbols( 'my_zzz_', array( 'function' ), 10 );
		$names   = array_map( static fn( $e ) => $e['name'], $matches );
		$this->assertContains( 'my_zzz_helper', $names );
	}

	/**
	 * @covers ::wpdc_get_workspace_symbol
	 *
	 * The detail lookup path checks workspace first; collisions with
	 * WP-core land on the local definition because that's what the
	 * user is almost always trying to navigate to.
	 */
	public function test_workspace_lookup_returns_local_symbol() {
		$this->write(
			'plugin-a/dup.php',
			"<?php\nfunction my_local_function() {}\n"
		);
		wpdc_refresh_workspace_index();

		$entry = wpdc_get_workspace_symbol( 'my_local_function' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'plugin-a/dup.php', $entry['file'] );
		$this->assertGreaterThan( 0, $entry['line'] );
	}

	/**
	 * @covers ::wpdc_get_workspace_symbol
	 */
	public function test_workspace_lookup_returns_null_for_unknown() {
		$this->assertNull( wpdc_get_workspace_symbol( 'definitely_not_a_workspace_symbol' ) );
	}
}
