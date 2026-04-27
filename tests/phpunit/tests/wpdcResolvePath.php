<?php
/**
 * Path-safety tests for the code editor — `wpdc_resolve_path()`,
 * `wpdc_extension_allowed()`, and the workspace-root filter.
 *
 * The whole editor's filesystem surface bottlenecks through
 * `wpdc_resolve_path`. Every traversal class — `..` escape, NUL
 * truncation, symlink-out-of-workspace, disallowed extension — has
 * to fail closed, with a `WP_Error` whose `code` callers can branch
 * on.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-code-editor
 */
class Tests_DesktopMode_WpdcResolvePath extends WP_UnitTestCase {

	private $tmp_root = '';

	public function set_up() {
		parent::set_up();
		// Build a sandbox we can put symlinks + assorted files in,
		// without polluting the real wp-content. Filter
		// `wpdc_workspace_root` to point here.
		$this->tmp_root = sys_get_temp_dir() . '/wpdc-tests-' . uniqid();
		mkdir( $this->tmp_root, 0755, true );
		mkdir( $this->tmp_root . '/plugin-a', 0755, true );
		file_put_contents( $this->tmp_root . '/plugin-a/main.php', '<?php // hi' );
		file_put_contents( $this->tmp_root . '/plugin-a/style.css', 'body { color: red; }' );
		file_put_contents( $this->tmp_root . '/plugin-a/binary.bin', 'unused' );

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
	// Happy paths
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_empty_path_returns_workspace_root() {
		$resolved = wpdc_resolve_path( '' );
		$this->assertSame( realpath( $this->tmp_root ), $resolved );
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_resolves_a_legit_subpath() {
		$resolved = wpdc_resolve_path( 'plugin-a/main.php' );
		$this->assertSame(
			realpath( $this->tmp_root . '/plugin-a/main.php' ),
			$resolved
		);
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_resolves_a_directory() {
		$resolved = wpdc_resolve_path( 'plugin-a' );
		$this->assertSame(
			realpath( $this->tmp_root . '/plugin-a' ),
			$resolved
		);
	}

	// -----------------------------------------------------------------
	// Traversal rejections
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_dot_dot_escape_is_rejected() {
		$result = wpdc_resolve_path( '../etc/passwd' );
		$this->assertWPError( $result );
		// Either path-not-found or outside-workspace depending on
		// whether the synthetic path resolves on this filesystem;
		// both codes mean "fail closed".
		$this->assertContains(
			$result->get_error_code(),
			array( 'wpdc_path_not_found', 'wpdc_path_outside_workspace' )
		);
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_absolute_path_does_not_escape() {
		$result = wpdc_resolve_path( '/etc/passwd' );
		$this->assertWPError( $result );
		$this->assertContains(
			$result->get_error_code(),
			array( 'wpdc_path_not_found', 'wpdc_path_outside_workspace' )
		);
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_nul_byte_is_rejected() {
		$result = wpdc_resolve_path( "plugin-a/main.php\0fake" );
		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_path_invalid', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_missing_file_returns_404_error() {
		$result = wpdc_resolve_path( 'plugin-a/does-not-exist.php' );
		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_path_not_found', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdc_resolve_path
	 */
	public function test_disallowed_extension_is_rejected() {
		$result = wpdc_resolve_path( 'plugin-a/binary.bin' );
		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_extension_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::wpdc_resolve_path
	 *
	 * Symlink resolves outside the workspace via realpath() — should
	 * be rejected even though the symlink itself was inside the root.
	 */
	public function test_symlink_pointing_outside_workspace_is_rejected() {
		if ( ! function_exists( 'symlink' ) ) {
			$this->markTestSkipped( 'symlink() not available on this platform.' );
		}
		// /tmp is canonical-different from $tmp_root by construction.
		$target = sys_get_temp_dir();
		$link   = $this->tmp_root . '/plugin-a/escape';
		if ( ! @symlink( $target, $link ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors
			$this->markTestSkipped( 'symlink() failed (likely unprivileged on this OS).' );
		}

		$result = wpdc_resolve_path( 'plugin-a/escape' );
		$this->assertWPError( $result );
		$this->assertSame( 'wpdc_path_outside_workspace', $result->get_error_code() );
	}

	// -----------------------------------------------------------------
	// Allowlist behaviour
	// -----------------------------------------------------------------

	/**
	 * @covers ::wpdc_extension_allowlist
	 */
	public function test_extension_allowlist_filterable() {
		add_filter(
			'wpdc_extension_allowlist',
			static function () {
				return array( 'php', 'bin' );
			}
		);
		$resolved = wpdc_resolve_path( 'plugin-a/binary.bin' );
		$this->assertSame(
			realpath( $this->tmp_root . '/plugin-a/binary.bin' ),
			$resolved
		);
		remove_all_filters( 'wpdc_extension_allowlist' );
	}

	/**
	 * @covers ::wpdc_path_to_relative
	 */
	public function test_path_to_relative_strips_root_and_normalizes_slashes() {
		$abs = $this->tmp_root . '/plugin-a/main.php';
		$rel = wpdc_path_to_relative( $abs );
		$this->assertSame( 'plugin-a/main.php', $rel );
	}

	/**
	 * @covers ::wpdc_path_to_relative
	 */
	public function test_path_to_relative_returns_empty_for_root_itself() {
		$this->assertSame( '', wpdc_path_to_relative( $this->tmp_root ) );
	}
}
