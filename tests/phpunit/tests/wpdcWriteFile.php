<?php
/**
 * Save-flow tests for the code editor — `wpdc_write_file()` in
 * isolation, plus the `/code/file` POST route's mtime-conflict
 * branch end-to-end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-code-editor
 */
class Tests_DesktopMode_WpdcWriteFile extends WP_UnitTestCase {

	private $tmp_root = '';

	public function set_up() {
		parent::set_up();
		$this->tmp_root = sys_get_temp_dir() . '/wpdc-write-' . uniqid();
		mkdir( $this->tmp_root, 0755, true );
		mkdir( $this->tmp_root . '/plugin-a', 0755, true );
		file_put_contents( $this->tmp_root . '/plugin-a/main.php', "<?php\n// hello\n" );

		add_filter( 'wpdc_workspace_root', array( $this, 'set_workspace_root' ) );
	}

	public function tear_down() {
		remove_filter( 'wpdc_workspace_root', array( $this, 'set_workspace_root' ) );
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

	// -----------------------------------------------------------------
	// Happy path
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_writes_new_content_returns_fresh_mtime_and_size() {
		$abs   = $this->tmp_root . '/plugin-a/main.php';
		$mtime = filemtime( $abs );
		// Sleep so the new mtime is guaranteed to differ — filesystems
		// with second-resolution mtimes round to whole seconds.
		sleep( 1 );

		$result = wpdc_write_file( $abs, "<?php\n// updated\n", $mtime );

		$this->assertIsArray( $result );
		$this->assertSame( 'plugin-a/main.php', $result['path'] );
		$this->assertSame(
			"<?php\n// updated\n",
			file_get_contents( $abs )
		);
		$this->assertGreaterThan( $mtime, $result['mtime'] );
		$this->assertSame(
			strlen( "<?php\n// updated\n" ),
			$result['size']
		);
	}

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_zero_expected_mtime_skips_conflict_check() {
		$abs    = $this->tmp_root . '/plugin-a/main.php';
		$result = wpdc_write_file( $abs, "<?php\n// no expected mtime\n", 0 );

		$this->assertIsArray( $result );
		$this->assertSame(
			"<?php\n// no expected mtime\n",
			file_get_contents( $abs )
		);
	}

	// -----------------------------------------------------------------
	// Conflict
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_mtime_mismatch_returns_conflict_with_server_state() {
		$abs           = $this->tmp_root . '/plugin-a/main.php';
		$stale_mtime   = filemtime( $abs ) - 100;
		$server_bytes  = file_get_contents( $abs );

		$result = wpdc_write_file( $abs, "<?php\n// would clobber\n", $stale_mtime );

		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_conflict', $result->get_error_code() );

		$data = $result->get_error_data();
		$this->assertSame( 409, $data['status'] );
		$this->assertSame( filemtime( $abs ), $data['server_mtime'] );
		$this->assertSame( $server_bytes, $data['server_content'] );

		// File contents must not have been touched.
		$this->assertSame( $server_bytes, file_get_contents( $abs ) );
	}

	// -----------------------------------------------------------------
	// Existence + path semantics
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_write_file
	 *
	 * Phase 3 doesn't create new files — that's a separate route
	 * (filename picker, parent-dir capability, etc.) coming later.
	 * Saving to a path that doesn't exist must fail closed.
	 */
	public function test_writing_to_a_missing_file_returns_error() {
		$abs    = $this->tmp_root . '/plugin-a/never-existed.php';
		$result = wpdc_write_file( $abs, "<?php\n", 0 );

		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_write_target_missing', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_empty_path_is_rejected() {
		$result = wpdc_write_file( '', 'whatever', 0 );
		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_write_invalid_path', $result->get_error_code() );
	}

	// -----------------------------------------------------------------
	// Action / filter surface
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_save_content_filter_can_transform_payload() {
		add_filter(
			'wpdc_save_content',
			static function ( $content ) {
				return rtrim( $content, "\n" ) . "\n// formatted\n";
			}
		);

		$abs    = $this->tmp_root . '/plugin-a/main.php';
		$result = wpdc_write_file( $abs, "<?php\n// raw\n", 0 );

		$this->assertIsArray( $result );
		$this->assertStringContainsString( '// formatted', file_get_contents( $abs ) );

		remove_all_filters( 'wpdc_save_content' );
	}

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_save_content_filter_returning_wp_error_aborts_the_save() {
		add_filter(
			'wpdc_save_content',
			static function () {
				return new WP_Error( 'lint_failed', 'boom' );
			}
		);

		$abs        = $this->tmp_root . '/plugin-a/main.php';
		$before     = file_get_contents( $abs );
		$result     = wpdc_write_file( $abs, "<?php\n// rejected\n", 0 );

		$this->assertWPError( $result );
		$this->assertSame( 'lint_failed', $result->get_error_code() );
		$this->assertSame( $before, file_get_contents( $abs ) );

		remove_all_filters( 'wpdc_save_content' );
	}

	/**
	 * @covers ::wpdc_write_file
	 */
	public function test_before_and_after_save_actions_fire_with_context() {
		$before_calls = array();
		$after_calls  = array();

		$before = static function ( $abs, $content, $context ) use ( &$before_calls ) {
			$before_calls[] = array( $abs, $content, $context );
		};
		$after = static function ( $abs, $content, $context ) use ( &$after_calls ) {
			$after_calls[] = array( $abs, $content, $context );
		};

		add_action( 'wpdc_before_save', $before, 10, 3 );
		add_action( 'wpdc_after_save', $after, 10, 3 );

		$abs = $this->tmp_root . '/plugin-a/main.php';
		wpdc_write_file( $abs, "<?php\n// hooks\n", 0 );

		$this->assertCount( 1, $before_calls );
		$this->assertCount( 1, $after_calls );
		$this->assertSame( $abs, $before_calls[0][0] );
		$this->assertSame( $abs, $after_calls[0][0] );
		$this->assertArrayHasKey( 'mtime', $after_calls[0][2] );

		remove_action( 'wpdc_before_save', $before, 10 );
		remove_action( 'wpdc_after_save', $after, 10 );
	}
}
