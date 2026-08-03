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
 *   - **The accent-derived chrome IS declared.** The focused title
 *     bar and its relatives resolve through `--wp-admin-theme-color`,
 *     which the manifest grammar cannot express — so they have to be
 *     captured as the literal behind that chain, WordPress blue.
 *     Leave them out and Legacy silently keeps the station's grey
 *     title bar, which is the one thing everybody notices.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesLegacy extends WP_UnitTestCase {

	/** Storage slug: the manifest id with `/` flattened. */
	const SLUG = 'desktop-mode-legacy';

	public function set_up() {
		parent::set_up();
		// Other suites unregister every code theme in tear_down, and
		// `init` has already fired for this process — re-assert it.
		open_station_register_builtin_desktop_themes();
	}

	public function tear_down() {
		delete_option( OPEN_STATION_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'open_station_legacy_theme_manifest_path' );
		parent::tear_down();
	}

	/** The raw manifest, straight off disk. */
	private function manifest() {
		$path = OPEN_STATION_DIR . 'assets/desktop-themes/legacy/theme.json';
		$this->assertFileExists( $path, 'The Legacy theme manifest ships with the plugin.' );
		$manifest = wp_json_file_decode( $path, array( 'associative' => true ) );
		$this->assertIsArray( $manifest, 'theme.json is valid JSON.' );
		return $manifest;
	}

	/**
	 * @covers ::open_station_register_builtin_desktop_themes
	 */
	public function test_legacy_is_registered_as_a_code_theme() {
		$entry = open_station_desktop_theme_registry( self::SLUG );

		$this->assertIsArray( $entry );
		$this->assertSame( self::SLUG, $entry['slug'] );
		$this->assertSame( 'OpenStation (Legacy)', $entry['manifest']['name'] );
		$this->assertSame( 'desktop-mode/legacy', $entry['manifest']['id'] );
		$this->assertNotSame( '', (string) $entry['cssText'], 'A code theme carries its compiled CSS inline.' );
	}

	/**
	 * Without a preview the card falls back to two initials — "DE" —
	 * which tells a user nothing. The artwork is the theme previewing
	 * itself, so it also has to survive the asset resolver.
	 */
	public function test_legacy_ships_preview_artwork() {
		$this->assertFileExists( OPEN_STATION_DIR . 'assets/desktop-themes/legacy/preview.svg' );

		$entry = open_station_desktop_theme_registry( self::SLUG );
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
	 * @covers ::open_station_desktop_theme_sanitize_svg
	 */
	public function test_preview_artwork_survives_the_svg_sanitizer() {
		$copy = get_temp_dir() . 'legacy-preview-' . wp_generate_password( 8, false ) . '.svg';
		copy( OPEN_STATION_DIR . 'assets/desktop-themes/legacy/preview.svg', $copy );

		$result = open_station_desktop_theme_sanitize_svg( $copy );
		$after  = file_get_contents( $copy );
		unlink( $copy );

		$this->assertTrue( $result );
		$this->assertStringContainsString( 'OpenStation (Legacy)', $after, 'The label survives sanitization.' );
	}

	/**
	 * @covers ::open_station_build_desktop_themes_payload
	 */
	public function test_legacy_reaches_the_shell_payload() {
		$payload = open_station_build_desktop_themes_payload();
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
	 * @covers ::open_station_desktop_theme_delete
	 */
	public function test_legacy_cannot_be_deleted() {
		$deleted = open_station_desktop_theme_delete( self::SLUG );

		$this->assertWPError( $deleted );
		$this->assertSame( 'open_station_desktop_theme_not_found', $deleted->get_error_code() );
		$this->assertIsArray(
			open_station_desktop_theme_registry( self::SLUG ),
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
	 * @covers ::open_station_sanitize_desktop_theme_manifest
	 */
	public function test_no_token_is_dropped_by_the_sanitizer() {
		$raw   = $this->manifest();
		$entry = open_station_desktop_theme_registry( self::SLUG );

		$kept    = array_keys( $entry['manifest']['tokens'] );
		$dropped = array_diff( array_keys( $raw['tokens'] ), $kept );

		$this->assertSame(
			array(),
			array_values( $dropped ),
			'Every declared token satisfies the value grammar: ' . implode( ', ', $dropped )
		);
		$this->assertGreaterThan( 380, count( $kept ), 'The manifest covers the token surface.' );
	}

	/**
	 * The snapshot does not move.
	 *
	 * Legacy exists so that someone who picks it keeps the look they
	 * know while the shell's own defaults move on. Re-collecting it
	 * from today's stylesheets would take that away one release at a
	 * time — so a change here should fail loudly and be answered with
	 * a NEW snapshot theme under a new id, never with a rewrite of
	 * this one.
	 */
	public function test_the_snapshot_is_frozen() {
		$tokens = $this->manifest()['tokens'];
		$why    = 'Legacy is a frozen snapshot — mint a new theme instead of moving it.';

		$this->assertCount( 392, $tokens, $why );
		foreach ( array(
			'--os-bg'             => 'linear-gradient( 135deg, #1d2327 0%, #2c3338 50%, #1d2327 100% )',
			'--os-titlebar-bg'    => '#f0f0f1',
			'--os-dock-bg'        => 'rgba( 0, 0, 0, 0.4 )',
			'--os-window-radius'  => '8px',
			'--os-ui-surface'                 => '#fff',
			'--os-ui-fg'                      => '#1d2327',
			'--os-ui-fg-muted'                => '#50575e',
			'--os-ui-border'                  => '#dcdcde',
			'--os-ui-accent'                  => '#2271b1',
			'--os-ui-danger'                  => '#d63638',
			// The one everybody recognises. It resolved through
			// `--wp-admin-theme-color`, which the manifest grammar has
			// no way to express, so the snapshot names the literal —
			// otherwise Legacy silently keeps the station's grey.
			'--os-titlebar-bg-focused'    => '#2271b1',
			'--os-titlebar-color-focused' => '#fff',
		) as $name => $value ) {
			$this->assertSame( $value, $tokens[ $name ], $name . ': ' . $why );
		}
	}

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_compiled_css_declares_every_token() {
		$entry = open_station_desktop_theme_registry( self::SLUG );
		$css   = (string) $entry['cssText'];

		$this->assertStringContainsString( 'os-desktop-theme-' . self::SLUG, $css );
		foreach ( $entry['manifest']['tokens'] as $name => $value ) {
			$this->assertStringContainsString( $name . ':', $css, $name . ' reaches the stylesheet.' );
		}
	}

	/**
	 * The chrome that used to follow the admin colour scheme is
	 * captured as WordPress blue.
	 *
	 * `var()` is not in the manifest's value grammar, so a theme
	 * cannot say "whatever the accent is". For Legacy that trade is
	 * the right one — it exists to reproduce a look people remember,
	 * and what they remember is a blue title bar.
	 */
	public function test_accent_derived_chrome_is_wordpress_blue() {
		$tokens = $this->manifest()['tokens'];

		foreach ( array(
			'--os-titlebar-bg-focused',
			'--os-tile-focus-ring',
			'--os-window-link-color',
			'--os-window-link-color-active',
			'--os-window-link-accent',
			'--os-ui-card-border-selected',
			'--os-ui-notice-link',
			'--os-ui-progress-fill',
			'--os-ui-ribbon-bg',
			'--os-ui-save-status-bg',
			'--os-ui-spinner-color',
			'--os-ui-step-chip-bg',
		) as $name ) {
			$this->assertSame( '#2271b1', $tokens[ $name ], $name . ' is WordPress blue' );
		}
	}

	/**
	 * The accent is not a TOKEN — OS Settings writes it as an inline
	 * style that no stylesheet can reach, so a theme cannot declare it
	 * and have it stick.
	 */
	public function test_the_accent_is_not_declared_as_a_token() {
		$this->assertArrayNotHasKey(
			'--wp-admin-theme-color',
			$this->manifest()['tokens']
		);
	}

	/**
	 * …it is a RECOMMENDATION instead, which is the one channel that
	 * can move a user setting.
	 *
	 * Without it, wearing Legacy would restore the whole pre-brand
	 * palette and leave Pulse on every focus ring, tab underline and
	 * sort arrow — the one thing the theme exists to undo. It is also
	 * what puts the "Apply OpenStation (Legacy)'s recommended layout
	 * and effects" button on the card.
	 *
	 * @covers ::open_station_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_legacy_recommends_the_wordpress_blue_accent() {
		$raw = $this->manifest();
		$this->assertSame( 2, $raw['manifestVersion'], 'v2 declares a recommendation block.' );
		$this->assertSame( 'wp-blue', $raw['recommendedOsSettings']['accent'] );

		// Survives the sanitizer's allow-list, which is the part that
		// would silently drop it if `accent` left the schema.
		$entry = open_station_desktop_theme_registry( self::SLUG );
		$this->assertSame(
			'wp-blue',
			$entry['manifest']['recommendedOsSettings']['accent'],
			'`accent` is in the recommended-OS-settings schema.'
		);
	}

	/**
	 * @covers ::open_station_desktop_theme_recommended_os_settings_schema
	 */
	public function test_accent_is_a_registry_slug_in_the_schema() {
		$schema = open_station_desktop_theme_recommended_os_settings_schema();

		$this->assertArrayHasKey( 'accent', $schema );
		$this->assertTrue(
			! empty( $schema['accent']['slug'] ),
			'Accent ids resolve against the filterable swatch list, not a fixed enum.'
		);
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
				'/^--os-[a-z0-9-]+$/',
				$name
			);
		}
	}

	/**
	 * @covers ::open_station_legacy_theme_manifest_path
	 */
	public function test_manifest_path_is_filterable() {
		add_filter( 'open_station_legacy_theme_manifest_path', static function () {
			return '/nonexistent/theme.json';
		} );

		$this->assertSame( '/nonexistent/theme.json', open_station_legacy_theme_manifest_path() );
	}
}
