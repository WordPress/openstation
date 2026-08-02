<?php
/**
 * Tests for the built-in "Legacy" desktop theme.
 *
 * Legacy is the plugin's own defaults expressed as a theme manifest,
 * registered from code so it is always present and cannot be deleted.
 * Two properties are worth defending with tests, because both fail
 * silently:
 *
 *   - **Nothing is dropped.** The manifest is generated from the
 *     stylesheets, so a value that does not satisfy the token grammar
 *     would vanish during sanitization with no error anywhere. The
 *     count assertion below is what turns that into a red test.
 *   - **Nothing scheme-derived is declared.** A hex for the admin
 *     accent (or anything that resolves through it) would pin every
 *     WordPress colour scheme to Fresh blue for anyone wearing the
 *     theme.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesLegacy extends WP_UnitTestCase {

	/** Storage slug: the manifest id with `/` flattened. */
	const SLUG = 'desktop-mode-legacy';

	public function set_up() {
		parent::set_up();
		// Other suites unregister every code theme in tear_down, and
		// `init` has already fired for this process — re-assert it.
		desktop_mode_register_builtin_desktop_themes();
	}

	public function tear_down() {
		delete_option( DESKTOP_MODE_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'desktop_mode_legacy_theme_manifest_path' );
		parent::tear_down();
	}

	/** The raw manifest, straight off disk. */
	private function manifest() {
		$path = DESKTOP_MODE_DIR . 'assets/desktop-themes/legacy/theme.json';
		$this->assertFileExists( $path, 'The Legacy theme manifest ships with the plugin.' );
		$manifest = wp_json_file_decode( $path, array( 'associative' => true ) );
		$this->assertIsArray( $manifest, 'theme.json is valid JSON.' );
		return $manifest;
	}

	/**
	 * @covers ::desktop_mode_register_builtin_desktop_themes
	 */
	public function test_legacy_is_registered_as_a_code_theme() {
		$entry = desktop_mode_desktop_theme_registry( self::SLUG );

		$this->assertIsArray( $entry );
		$this->assertSame( self::SLUG, $entry['slug'] );
		$this->assertSame( 'Desktop Mode (Legacy)', $entry['manifest']['name'] );
		$this->assertSame( 'desktop-mode/legacy', $entry['manifest']['id'] );
		$this->assertNotSame( '', (string) $entry['cssText'], 'A code theme carries its compiled CSS inline.' );
	}

	/**
	 * Without a preview the card falls back to two initials — "DE" —
	 * which tells a user nothing. The artwork is the theme previewing
	 * itself, so it also has to survive the asset resolver.
	 */
	public function test_legacy_ships_preview_artwork() {
		$this->assertFileExists( DESKTOP_MODE_DIR . 'assets/desktop-themes/legacy/preview.svg' );

		$entry = desktop_mode_desktop_theme_registry( self::SLUG );
		$this->assertStringEndsWith(
			'assets/desktop-themes/legacy/preview.svg',
			(string) $entry['manifest']['preview'],
			'The preview URL survived sanitization.'
		);
	}

	/**
	 * The packaged ZIP is advertised as installable, so the artwork
	 * has to pass the same SVG sanitizer an uploaded theme's would —
	 * which parses with DOMDocument and therefore rejects, among
	 * other things, a stray `--` inside an XML comment.
	 *
	 * @covers ::desktop_mode_desktop_theme_sanitize_svg
	 */
	public function test_preview_artwork_survives_the_svg_sanitizer() {
		$copy = get_temp_dir() . 'legacy-preview-' . wp_generate_password( 8, false ) . '.svg';
		copy( DESKTOP_MODE_DIR . 'assets/desktop-themes/legacy/preview.svg', $copy );

		$result = desktop_mode_desktop_theme_sanitize_svg( $copy );
		$after  = file_get_contents( $copy );
		unlink( $copy );

		$this->assertTrue( $result );
		$this->assertStringContainsString( 'Desktop Mode (Legacy)', $after, 'The label survives sanitization.' );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_themes_payload
	 */
	public function test_legacy_reaches_the_shell_payload() {
		$payload = desktop_mode_build_desktop_themes_payload();
		$found   = null;
		foreach ( $payload as $entry ) {
			if ( self::SLUG === $entry['slug'] ) {
				$found = $entry;
			}
		}

		$this->assertNotNull( $found, 'Legacy is in the theme library the shell receives.' );
		$this->assertSame( 'code', $found['source'] );
		$this->assertSame( '', $found['cssUrl'], 'Code themes have no stylesheet file to link.' );
		$this->assertNotSame( '', $found['previewUrl'], 'The card renders artwork, not initials.' );
	}

	/**
	 * The whole point of the theme: it cannot be removed.
	 *
	 * @covers ::desktop_mode_desktop_theme_delete
	 */
	public function test_legacy_cannot_be_deleted() {
		$deleted = desktop_mode_desktop_theme_delete( self::SLUG );

		$this->assertWPError( $deleted );
		$this->assertSame( 'desktop_mode_desktop_theme_not_found', $deleted->get_error_code() );
		$this->assertIsArray(
			desktop_mode_desktop_theme_registry( self::SLUG ),
			'A failed delete leaves the registration untouched.'
		);
	}

	/**
	 * Every token in the manifest survives the sanitizer.
	 *
	 * A dropped entry is invisible at runtime — the shell simply keeps
	 * the built-in value — so nothing but this count would ever tell
	 * us that a generated value stopped satisfying the grammar.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_no_token_is_dropped_by_the_sanitizer() {
		$raw   = $this->manifest();
		$entry = desktop_mode_desktop_theme_registry( self::SLUG );

		$kept    = array_keys( $entry['manifest']['tokens'] );
		$dropped = array_diff( array_keys( $raw['tokens'] ), $kept );

		$this->assertSame(
			array(),
			array_values( $dropped ),
			'Every declared token satisfies the value grammar: ' . implode( ', ', $dropped )
		);
		$this->assertGreaterThan( 300, count( $kept ), 'The manifest covers the token surface.' );
	}

	/**
	 * The snapshot does not move.
	 *
	 * Legacy exists so that someone who picks it keeps the look they
	 * know while the shell's own defaults move on. Regenerating it
	 * from today's stylesheets would take that away one release at a
	 * time — so a change here should fail loudly and be answered with
	 * a NEW snapshot theme under a new id, never with a rewrite of
	 * this one. See the header of
	 * `bin/build-legacy-theme-manifest.mjs`.
	 */
	public function test_the_snapshot_is_frozen() {
		$tokens = $this->manifest()['tokens'];
		$why    = 'Legacy is a frozen snapshot — mint a new theme instead of moving it.';

		$this->assertCount( 377, $tokens, $why );
		foreach ( array(
			'--desktop-mode-bg'             => 'linear-gradient( 135deg, #1d2327 0%, #2c3338 50%, #1d2327 100% )',
			'--desktop-mode-titlebar-bg'    => '#f0f0f1',
			'--desktop-mode-dock-bg'        => 'rgba( 0, 0, 0, 0.4 )',
			'--desktop-mode-window-radius'  => '8px',
			'--wpd-surface'                 => '#fff',
			'--wpd-fg'                      => '#1d2327',
			'--wpd-fg-muted'                => '#50575e',
			'--wpd-border'                  => '#dcdcde',
			'--wpd-accent'                  => '#2271b1',
			'--wpd-danger'                  => '#d63638',
		) as $name => $value ) {
			$this->assertSame( $value, $tokens[ $name ], $name . ': ' . $why );
		}
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_compiled_css_declares_every_token() {
		$entry = desktop_mode_desktop_theme_registry( self::SLUG );
		$css   = (string) $entry['cssText'];

		$this->assertStringContainsString( 'desktop-mode-desktop-theme-' . self::SLUG, $css );
		foreach ( $entry['manifest']['tokens'] as $name => $value ) {
			$this->assertStringContainsString( $name . ':', $css, $name . ' reaches the stylesheet.' );
		}
	}

	/**
	 * Nothing that tracks the user's WordPress admin colour scheme may
	 * be frozen into a literal.
	 */
	public function test_scheme_derived_tokens_are_not_declared() {
		$tokens = $this->manifest()['tokens'];

		foreach ( array(
			'--wp-admin-theme-color',
			'--desktop-mode-titlebar-bg-focused',
			'--desktop-mode-window-link-color',
			'--desktop-mode-tile-focus-ring',
		) as $name ) {
			$this->assertArrayNotHasKey(
				$name,
				$tokens,
				$name . ' follows the admin colour scheme and must stay undeclared.'
			);
		}
	}

	/**
	 * Texture slots are written by the manifest's `textures` block.
	 * A `tokens` entry for one would be a category error, and the
	 * grammar would reject the `url()` it needs anyway.
	 */
	public function test_no_texture_slot_properties_are_declared() {
		foreach ( array_keys( $this->manifest()['tokens'] ) as $name ) {
			$this->assertDoesNotMatchRegularExpression(
				'/-image(-|$)/',
				$name,
				$name . ' is a texture-slot property, not a token.'
			);
		}
	}

	/**
	 * Every key is inside one of the three namespaces the sanitizer
	 * accepts — the cheap way to catch a typo in the generator.
	 */
	public function test_every_token_is_in_a_themable_namespace() {
		foreach ( array_keys( $this->manifest()['tokens'] ) as $name ) {
			$this->assertMatchesRegularExpression(
				'/^--(desktop-mode|wpd)-[a-z0-9-]+$/',
				$name
			);
		}
	}

	/**
	 * @covers ::desktop_mode_legacy_theme_manifest_path
	 */
	public function test_manifest_path_is_filterable() {
		add_filter( 'desktop_mode_legacy_theme_manifest_path', static function () {
			return '/nonexistent/theme.json';
		} );

		$this->assertSame( '/nonexistent/theme.json', desktop_mode_legacy_theme_manifest_path() );
	}
}
