<?php
/**
 * Tests for the desktop-theme ZIP installer.
 *
 * Fixture archives are built with ZipArchive at run time so the
 * hostile cases (traversal entries, forbidden extensions, script-
 * bearing SVGs) are expressed in the test rather than committed as
 * opaque binaries.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesInstall extends WP_UnitTestCase {

	/** @var string[] Temp files to unlink on teardown. */
	private $temp_files = array();

	public function set_up() {
		parent::set_up();
		if ( ! class_exists( 'ZipArchive' ) ) {
			$this->markTestSkipped( 'ZipArchive is required for the theme installer.' );
		}
		delete_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION );
	}

	public function tear_down() {
		foreach ( $this->temp_files as $file ) {
			if ( file_exists( $file ) ) {
				unlink( $file );
			}
		}
		$this->temp_files = array();

		$base = desktop_mode_desktop_themes_dir();
		if ( is_dir( $base ) ) {
			$this->rrmdir( $base );
		}
		delete_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'desktop_mode_desktop_theme_zip_caps' );
		remove_all_actions( 'desktop_mode_desktop_theme_installed' );
		remove_all_actions( 'desktop_mode_desktop_theme_deleted' );
		parent::tear_down();
	}

	/**
	 * Recursive delete for test fixtures. `scandir`, not `glob()` with
	 * `GLOB_BRACE` — that flag is absent on the musl/Alpine PHP builds
	 * wp-env uses, and dotfiles (`.htaccess`) have to be swept too.
	 */
	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( (array) scandir( $dir ) as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$path = $dir . '/' . $item;
			is_dir( $path ) ? $this->rrmdir( $path ) : unlink( $path );
		}
		@rmdir( $dir );
	}

	/** A 1x1 transparent PNG. */
	private function png_bytes() {
		return base64_decode(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
		);
	}

	private function manifest_json( $overrides = array() ) {
		return wp_json_encode( array_merge(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'name'            => 'Neon',
				'version'         => '1.0.0',
			),
			$overrides
		) );
	}

	/**
	 * Build a ZIP from `entryName => bytes`.
	 *
	 * @param array $entries Map of entry name to file contents.
	 * @return string Absolute path of the archive.
	 */
	private function make_zip( array $entries ) {
		$path = get_temp_dir() . 'dm-theme-' . wp_generate_uuid4() . '.zip';
		$zip  = new ZipArchive();
		$this->assertTrue( true === $zip->open( $path, ZipArchive::CREATE ) );
		foreach ( $entries as $name => $bytes ) {
			$zip->addFromString( $name, $bytes );
		}
		$zip->close();
		$this->temp_files[] = $path;
		return $path;
	}

	// ------------------------------------------------------------------
	// Happy path.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_installs_a_valid_theme() {
		$zip = $this->make_zip( array(
			'theme.json'          => $this->manifest_json( array(
				'preview'  => 'preview.png',
				'tokens'   => array( '--desktop-mode-window-radius' => '14px' ),
				'textures' => array(
					'TITLEBAR' => array( 'type' => 'image', 'path' => 'textures/t.png' ),
				),
			) ),
			'preview.png'         => $this->png_bytes(),
			'textures/t.png'      => $this->png_bytes(),
		) );

		$entry = desktop_mode_desktop_theme_install_from_zip( $zip );

		$this->assertIsArray( $entry, is_wp_error( $entry ) ? $entry->get_error_message() : '' );
		$this->assertSame( 'acme-neon', $entry['slug'] );

		$dir = desktop_mode_desktop_themes_dir( 'acme-neon' );
		$this->assertFileExists( $dir . '/theme.css' );
		$this->assertFileExists( $dir . '/textures/t.png' );
		$this->assertFileExists( $dir . '/preview.png' );

		$css = file_get_contents( $dir . '/theme.css' );
		$this->assertStringContainsString( '--desktop-mode-window-radius: 14px;', $css );

		$index = desktop_mode_desktop_themes_index();
		$this->assertArrayHasKey( 'acme-neon', $index );
	}

	/**
	 * A theme.json one directory deep is what "Compress this folder"
	 * produces on macOS and Windows — the common case, not an edge one.
	 *
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_manifest_one_directory_deep_is_accepted() {
		$zip = $this->make_zip( array(
			'neon/theme.json' => $this->manifest_json(),
		) );
		$entry = desktop_mode_desktop_theme_install_from_zip( $zip );
		$this->assertIsArray( $entry );
		$this->assertSame( 'acme-neon', $entry['slug'] );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_installed_action_fires() {
		$seen = array();
		add_action(
			'desktop_mode_desktop_theme_installed',
			static function ( $slug, $entry ) use ( &$seen ) {
				$seen = array( $slug, $entry );
			},
			10,
			2
		);
		desktop_mode_desktop_theme_install_from_zip(
			$this->make_zip( array( 'theme.json' => $this->manifest_json() ) )
		);
		$this->assertSame( 'acme-neon', $seen[0] );
		$this->assertArrayHasKey( 'installedAt', $seen[1] );
	}

	/**
	 * Re-uploading the same id is an UPDATE, and the old directory is
	 * dropped wholesale so removed assets don't linger.
	 *
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_reupload_updates_and_prunes_stale_assets() {
		desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'     => $this->manifest_json( array(
				'textures' => array(
					'TITLEBAR' => array( 'type' => 'image', 'path' => 'textures/old.png' ),
				),
			) ),
			'textures/old.png' => $this->png_bytes(),
		) ) );

		$dir = desktop_mode_desktop_themes_dir( 'acme-neon' );
		$this->assertFileExists( $dir . '/textures/old.png' );

		desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'       => $this->manifest_json( array(
				'version'  => '2.0.0',
				'textures' => array(
					'TITLEBAR' => array( 'type' => 'image', 'path' => 'textures/new.png' ),
				),
			) ),
			'textures/new.png' => $this->png_bytes(),
		) ) );

		$this->assertFileExists( $dir . '/textures/new.png' );
		$this->assertFileDoesNotExist( $dir . '/textures/old.png' );

		$index = desktop_mode_desktop_themes_index();
		$this->assertCount( 1, $index, 'Re-upload updates in place, never duplicates.' );
		$this->assertSame( '2.0.0', $index['acme-neon']['manifest']['version'] );
	}

	/**
	 * Re-uploading reuses the same file paths by design, so every
	 * generated asset URL must carry the install timestamp — otherwise
	 * an author fixes their artwork, re-uploads, and the browser
	 * serves the previous version's icons and textures from cache
	 * while the stylesheet (which IS versioned) refreshes around them.
	 *
	 * @covers ::desktop_mode_desktop_theme_asset_url
	 * @covers ::desktop_mode_shape_desktop_theme_payload_entry
	 */
	public function test_reupload_busts_every_asset_url() {
		$zip = $this->make_zip( array(
			'theme.json'  => $this->manifest_json( array(
				'preview'  => 'preview.png',
				'icons'    => array(
					'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/a.svg' ),
				),
				'textures' => array(
					'TITLEBAR' => array( 'type' => 'image', 'path' => 'textures/t.png' ),
				),
			) ),
			'preview.png'    => $this->png_bytes(),
			'icons/a.svg'    => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>',
			'textures/t.png' => $this->png_bytes(),
		) );

		$first  = desktop_mode_desktop_theme_install_from_zip( $zip );
		$this->assertIsArray( $first, is_wp_error( $first ) ? $first->get_error_message() : '' );
		$before = desktop_mode_shape_desktop_theme_payload_entry( $first, 'upload' );

		// `installedAt` is second-resolution; a real re-upload is
		// always at least a moment later.
		sleep( 1 );
		$second = desktop_mode_desktop_theme_install_from_zip( $zip );
		$after  = desktop_mode_shape_desktop_theme_payload_entry( $second, 'upload' );

		$this->assertStringContainsString( '?ver=', $before['icons']['OS_SETTINGS'] );
		$this->assertNotSame(
			$before['icons']['OS_SETTINGS'],
			$after['icons']['OS_SETTINGS'],
			'Icon URLs must change on re-upload.'
		);
		$this->assertNotSame(
			$before['previewUrl'],
			$after['previewUrl'],
			'Preview URL must change on re-upload.'
		);

		// Textures live inside the compiled stylesheet, so versioning
		// the stylesheet alone is not enough.
		$css = file_get_contents(
			desktop_mode_desktop_themes_dir( 'acme-neon' ) . '/theme.css'
		);
		$this->assertMatchesRegularExpression(
			'/textures\/t\.png\?ver=\d+/',
			$css,
			'Texture URLs inside the compiled CSS must be versioned too.'
		);
	}

	/**
	 * Only assets the SANITIZED manifest references cross into the
	 * live directory. Everything else dies with the staging dir.
	 *
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_unreferenced_assets_are_not_installed() {
		desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'    => $this->manifest_json(),
			'stowaway.png'  => $this->png_bytes(),
		) ) );
		$this->assertFileDoesNotExist(
			desktop_mode_desktop_themes_dir( 'acme-neon' ) . '/stowaway.png'
		);
	}

	// ------------------------------------------------------------------
	// Rejections.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_traversal_entry_rejects_the_archive() {
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'          => $this->manifest_json(),
			'../../evil.png'      => $this->png_bytes(),
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_unsafe_entry', $error->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_forbidden_extension_rejects_the_archive() {
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json' => $this->manifest_json(),
			'shell.php'  => '<?php echo 1;',
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_bad_extension', $error->get_error_code() );
	}

	/**
	 * CSS and JS are refused for the same reason PHP is: a theme is
	 * data, never code.
	 *
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_css_and_js_are_refused() {
		foreach ( array( 'extra.css' => 'body{}', 'extra.js' => 'alert(1)' ) as $name => $bytes ) {
			$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
				'theme.json' => $this->manifest_json(),
				$name        => $bytes,
			) ) );
			$this->assertWPError( $error, "Expected {$name} to be refused." );
		}
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_missing_manifest_rejects() {
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'preview.png' => $this->png_bytes(),
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_missing_manifest', $error->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_validate_zip
	 */
	public function test_two_manifests_reject() {
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'   => $this->manifest_json(),
			'b/theme.json' => $this->manifest_json(),
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_missing_manifest', $error->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_invalid_json_rejects() {
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json' => '{ not json',
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_bad_json', $error->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_zip_caps
	 */
	public function test_entry_count_cap_is_enforced_and_filterable() {
		add_filter( 'desktop_mode_desktop_theme_zip_caps', static function ( $caps ) {
			$caps['max_entries'] = 2;
			return $caps;
		} );
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json' => $this->manifest_json(),
			'a.png'      => $this->png_bytes(),
			'b.png'      => $this->png_bytes(),
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_too_many_entries', $error->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_zip_caps
	 */
	public function test_total_size_cap_is_enforced() {
		add_filter( 'desktop_mode_desktop_theme_zip_caps', static function ( $caps ) {
			$caps['max_uncompressed'] = 32;
			return $caps;
		} );
		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json' => $this->manifest_json(),
			'a.png'      => $this->png_bytes(),
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_archive_too_large', $error->get_error_code() );
	}

	/**
	 * macOS resource forks and dotfiles ride along in almost every
	 * archive a designer produces. Failing the upload over them would
	 * be hostile — they are ignored, not rejected.
	 *
	 * @covers ::desktop_mode_desktop_theme_zip_entry_ignored
	 */
	public function test_macosx_and_dotfiles_are_ignored_not_rejected() {
		$entry = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'              => $this->manifest_json(),
			'__MACOSX/._theme.json'   => 'junk',
			'.DS_Store'               => 'junk',
		) ) );
		$this->assertIsArray( $entry, is_wp_error( $entry ) ? $entry->get_error_message() : '' );
	}

	// ------------------------------------------------------------------
	// SVG sanitization.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_sanitize_svg
	 */
	public function test_svg_script_and_handlers_are_stripped() {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
			. '<script>alert(1)</script>'
			. '<rect width="10" height="10" onload="alert(2)" fill="red"/>'
			. '<a href="javascript:alert(3)"><circle r="1"/></a>'
			. '<use href="https://evil.test/x.svg#a"/>'
			. '<foreignObject><div/></foreignObject>'
			. '</svg>';

		$entry = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'     => $this->manifest_json( array(
				'icons' => array(
					'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/x.svg' ),
				),
			) ),
			'icons/x.svg'    => $svg,
		) ) );
		$this->assertIsArray( $entry, is_wp_error( $entry ) ? $entry->get_error_message() : '' );

		$clean = file_get_contents(
			desktop_mode_desktop_themes_dir( 'acme-neon' ) . '/icons/x.svg'
		);
		$this->assertStringNotContainsString( '<script', $clean );
		$this->assertStringNotContainsString( 'onload', $clean );
		$this->assertStringNotContainsString( 'javascript:', $clean );
		$this->assertStringNotContainsString( 'evil.test', $clean );
		$this->assertStringNotContainsString( 'foreignObject', $clean );
		$this->assertStringContainsString( '<rect', $clean, 'Legitimate markup survives.' );
	}

	/**
	 * Entity declarations are the billion-laughs / XXE vector. Reject
	 * before the parser ever sees them.
	 *
	 * @covers ::desktop_mode_desktop_theme_sanitize_svg
	 */
	public function test_svg_with_entities_rejects_the_upload() {
		$svg = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">]>'
			. '<svg xmlns="http://www.w3.org/2000/svg"><text>&lol;</text></svg>';

		$error = desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'  => $this->manifest_json( array(
				'icons' => array(
					'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/x.svg' ),
				),
			) ),
			'icons/x.svg' => $svg,
		) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_bad_svg', $error->get_error_code() );
	}

	/**
	 * An SVG we can't make safe aborts the whole install rather than
	 * installing with that icon quietly dropped.
	 *
	 * @covers ::desktop_mode_desktop_theme_install_from_zip
	 */
	public function test_unparseable_svg_aborts_install_and_cleans_up() {
		desktop_mode_desktop_theme_install_from_zip( $this->make_zip( array(
			'theme.json'  => $this->manifest_json( array(
				'icons' => array(
					'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/x.svg' ),
				),
			) ),
			'icons/x.svg' => '<svg><unclosed>',
		) ) );

		$this->assertSame( array(), desktop_mode_desktop_themes_index() );
		$this->assertDirectoryDoesNotExist( desktop_mode_desktop_themes_dir( 'acme-neon' ) );

		// No staging directories left behind on the failure path.
		$staging = glob( desktop_mode_desktop_themes_dir() . '/.staging-*' );
		$this->assertEmpty( $staging, 'Staging directory must be cleaned on every exit path.' );
	}

	// ------------------------------------------------------------------
	// Storage + delete.
	// ------------------------------------------------------------------

	/**
	 * The themes dir must be SERVABLE (assets are `<img src>` and CSS
	 * `url()` targets), so the deny-all `.htaccess` the stored-files
	 * module writes would be exactly wrong here.
	 *
	 * @covers ::desktop_mode_desktop_themes_ensure_dir
	 */
	public function test_protection_files_are_exec_off_not_deny_all() {
		desktop_mode_desktop_themes_ensure_dir();
		$base = desktop_mode_desktop_themes_dir();

		$this->assertFileExists( $base . '/index.php' );
		$this->assertFileExists( $base . '/.htaccess' );

		$rules = file_get_contents( $base . '/.htaccess' );
		$this->assertStringContainsString( 'php_flag engine off', $rules );
		$this->assertStringNotContainsString( "\n\tRequire all denied\n</IfModule>", $rules );
		$this->assertStringContainsString( 'FilesMatch', $rules );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_delete
	 */
	public function test_delete_removes_directory_index_entry_and_fires_action() {
		desktop_mode_desktop_theme_install_from_zip(
			$this->make_zip( array( 'theme.json' => $this->manifest_json() ) )
		);

		$fired = null;
		add_action(
			'desktop_mode_desktop_theme_deleted',
			static function ( $slug ) use ( &$fired ) {
				$fired = $slug;
			}
		);

		$this->assertTrue( desktop_mode_desktop_theme_delete( 'acme-neon' ) );
		$this->assertSame( 'acme-neon', $fired );
		$this->assertSame( array(), desktop_mode_desktop_themes_index() );
		$this->assertDirectoryDoesNotExist( desktop_mode_desktop_themes_dir( 'acme-neon' ) );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_delete
	 */
	public function test_delete_unknown_slug_is_a_404() {
		$error = desktop_mode_desktop_theme_delete( 'nope' );
		$this->assertWPError( $error );
		$this->assertSame( 404, $error->get_error_data()['status'] );
	}

	/**
	 * `_rmdir()` must never become an arbitrary-delete primitive.
	 *
	 * @covers ::desktop_mode_desktop_theme_rmdir
	 */
	public function test_rmdir_refuses_paths_outside_the_themes_base() {
		desktop_mode_desktop_themes_ensure_dir();
		$outside = get_temp_dir() . 'dm-outside-' . wp_generate_uuid4();
		wp_mkdir_p( $outside );

		$this->assertFalse( desktop_mode_desktop_theme_rmdir( $outside ) );
		$this->assertDirectoryExists( $outside );
		$this->assertFalse(
			desktop_mode_desktop_theme_rmdir( desktop_mode_desktop_themes_dir() ),
			'The base directory itself is never removable.'
		);

		rmdir( $outside );
	}
}
