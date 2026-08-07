<?php
/**
 * Tests for a desktop theme's `recommendedOsSettings` block.
 *
 * The block is the one place where a theme reaches at a user's own
 * preferences, so the sanitizer is deliberately narrow: a closed
 * allow-list of presentation keys, closed enums for the three whose
 * values PHP knows in full, and a charset check for the one
 * (`dockRailRenderer`) that only the JS registry can resolve.
 *
 * Backwards compatibility is a first-class assertion here: a v1
 * manifest that never heard of the block must sanitize to exactly
 * what it did before, and one that ships the block anyway must still
 * be honoured.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesRecommendedOsSettings extends WP_UnitTestCase {

	public function tear_down() {
		foreach ( array_keys( openstation_desktop_theme_registry() ) as $slug ) {
			openstation_unregister_desktop_theme( $slug );
		}
		remove_all_filters( 'openstation_desktop_theme_recommended_os_settings_schema' );
		parent::tear_down();
	}

	/** Resolver that accepts anything — no asset assertions here. */
	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function sanitize_manifest( $raw ) {
		return openstation_sanitize_desktop_theme_manifest(
			$raw,
			$this->permissive_resolver()
		);
	}

	private function manifest_with( $recommended, $version = 2 ) {
		return $this->sanitize_manifest(
			array(
				'manifestVersion'       => $version,
				'id'                    => 'acme/neon',
				'name'                  => 'Neon',
				'recommendedOsSettings' => $recommended,
			)
		);
	}

	// ------------------------------------------------------------------
	// Schema.
	// ------------------------------------------------------------------

	/**
	 * The schema is the allow-list. Its enums must equal the OS
	 * settings sanitizer's own constants, or a theme could recommend
	 * a value the settings layer would then reject.
	 *
	 * @covers ::openstation_desktop_theme_recommended_os_settings_schema
	 */
	public function test_schema_mirrors_the_os_settings_enums() {
		$schema = openstation_desktop_theme_recommended_os_settings_schema();

		$this->assertSame(
			OPENSTATION_OS_SETTINGS_DOCK_SIZES,
			$schema['dockSize']['enum']
		);
		$this->assertSame(
			OPENSTATION_OS_SETTINGS_DESKTOP_LAYOUTS,
			$schema['desktopLayout']['enum']
		);
		$this->assertSame(
			OPENSTATION_OS_SETTINGS_WINDOW_RADII,
			$schema['windowRadius']['enum']
		);
		$this->assertTrue( $schema['dockRailRenderer']['slug'] );
		$this->assertTrue( $schema['windowReveal']['slug'] );
		$this->assertSame(
			array(
				'min' => OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN,
				'max' => OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MAX,
			),
			$schema['windowRevealDuration']['int']
		);
	}

	/**
	 * The `int` grammar is filterable like the other two, and a
	 * malformed range drops rather than reaching the sanitizer.
	 *
	 * @covers ::openstation_desktop_theme_recommended_os_settings_schema
	 */
	public function test_int_rules_are_filterable_and_validated() {
		add_filter(
			'openstation_desktop_theme_recommended_os_settings_schema',
			static function ( $schema ) {
				$schema['acmeDelay']    = array( 'int' => array( 'min' => 0, 'max' => 500 ) );
				$schema['acmeNoRange']  = array( 'int' => true );
				$schema['acmeBackward'] = array( 'int' => array( 'min' => 900, 'max' => 100 ) );
				return $schema;
			}
		);

		$schema = openstation_desktop_theme_recommended_os_settings_schema();
		$this->assertSame(
			array( 'min' => 0, 'max' => 500 ),
			$schema['acmeDelay']['int']
		);
		$this->assertArrayNotHasKey( 'acmeNoRange', $schema );
		$this->assertArrayNotHasKey( 'acmeBackward', $schema );
	}

	/**
	 * @covers ::openstation_desktop_theme_recommended_os_settings_schema
	 */
	public function test_schema_is_filterable_and_malformed_entries_drop() {
		add_filter(
			'openstation_desktop_theme_recommended_os_settings_schema',
			static function ( $schema ) {
				$schema['acmeDensity'] = array( 'enum' => array( 'cosy', 'roomy' ) );
				$schema['acmeBroken']  = array( 'enum' => 'not-a-list' );
				$schema['acmeAlsoBad'] = 'not-a-rule';
				return $schema;
			}
		);

		$schema = openstation_desktop_theme_recommended_os_settings_schema();
		$this->assertSame( array( 'cosy', 'roomy' ), $schema['acmeDensity']['enum'] );
		$this->assertArrayNotHasKey( 'acmeBroken', $schema );
		$this->assertArrayNotHasKey( 'acmeAlsoBad', $schema );
	}

	// ------------------------------------------------------------------
	// Sanitizer.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_every_core_key_round_trips() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array(
				'dockSize'             => 'large',
				'desktopLayout'        => 'unified',
				'windowRadius'         => 'round',
				'dockRailRenderer'     => 'default',
				'windowReveal'         => 'iris',
				'windowRevealDuration' => 700,
			)
		);

		$this->assertSame(
			array(
				'dockSize'             => 'large',
				'desktopLayout'        => 'unified',
				'windowRadius'         => 'round',
				'dockRailRenderer'     => 'default',
				'windowReveal'         => 'iris',
				'windowRevealDuration' => 700,
			),
			$clean
		);
	}

	/**
	 * A numeric recommendation is CLAMPED rather than dropped: a theme
	 * asking for something outside the playable range is still
	 * expressing a direction, and the nearest playable value is the
	 * honest reading of it.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_int_recommendations_clamp_rather_than_drop() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array( 'windowRevealDuration' => 999999 )
		);
		$this->assertSame(
			OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MAX,
			$clean['windowRevealDuration']
		);

		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array( 'windowRevealDuration' => 1 )
		);
		$this->assertSame(
			OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN,
			$clean['windowRevealDuration']
		);
	}

	/**
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_non_numeric_int_recommendation_drops() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array(
				'windowRevealDuration' => 'quick',
				'windowReveal'         => 'iris',
			)
		);
		$this->assertSame( array( 'windowReveal' => 'iris' ), $clean );
	}

	/**
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_out_of_enum_values_drop_and_the_rest_survive() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array(
				'dockSize'      => 'enormous',
				'desktopLayout' => 'spatial',
				'windowRadius'  => 'squircle',
			)
		);

		$this->assertSame( array( 'desktopLayout' => 'spatial' ), $clean );
	}

	/**
	 * A theme must not be able to reach a setting that isn't
	 * presentation — feature switches, capability-adjacent flags, or
	 * anything else on the OS settings object.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_keys_outside_the_schema_are_dropped() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array(
				'dockSize'              => 'compact',
				'nativePluginsEnabled'  => 'true',
				'foldersSharingEnabled' => 'false',
				'ai'                    => 'enabled',
				'desktopTheme'          => 'someone-elses-theme',
			)
		);

		$this->assertSame( array( 'dockSize' => 'compact' ), $clean );
	}

	/**
	 * `dockRailRenderer` is a charset check, not an allow-list: only
	 * the JS registry knows which renderers exist, and the shell drops
	 * the key at apply time when nothing answers to the id.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_dock_rail_renderer_is_sanitized_as_a_slug() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array( 'dockRailRenderer' => 'Orbit Rail!' )
		);
		$this->assertSame( array( 'dockRailRenderer' => 'orbitrail' ), $clean );

		$empty = openstation_sanitize_desktop_theme_recommended_os_settings(
			array( 'dockRailRenderer' => '!!!' )
		);
		$this->assertSame( array(), $empty );
	}

	/**
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_non_string_and_non_array_input_yields_an_empty_set() {
		$this->assertSame(
			array(),
			openstation_sanitize_desktop_theme_recommended_os_settings( 'large' )
		);
		$this->assertSame(
			array(),
			openstation_sanitize_desktop_theme_recommended_os_settings( null )
		);
		$this->assertSame(
			array(),
			openstation_sanitize_desktop_theme_recommended_os_settings(
				array(
					'dockSize'      => array( 'large' ),
					'desktopLayout' => 5,
					'windowRadius'  => true,
				)
			)
		);
	}

	/**
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_whitespace_is_trimmed_before_matching() {
		$clean = openstation_sanitize_desktop_theme_recommended_os_settings(
			array( 'dockSize' => "  large\n" )
		);
		$this->assertSame( array( 'dockSize' => 'large' ), $clean );
	}

	// ------------------------------------------------------------------
	// Manifest integration + backwards compatibility.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_sanitize_desktop_theme_manifest
	 */
	public function test_manifest_carries_the_sanitized_block() {
		$manifest = $this->manifest_with(
			array(
				'dockSize'      => 'large',
				'desktopLayout' => 'unified',
				'windowRadius'  => 'nope',
			)
		);

		$this->assertNotWPError( $manifest );
		$this->assertSame(
			array(
				'dockSize'      => 'large',
				'desktopLayout' => 'unified',
			),
			$manifest['recommendedOsSettings']
		);
	}

	/**
	 * A v1 manifest that never mentions the block is unchanged: the
	 * key exists and is empty, which is the same "recommends nothing"
	 * state every pre-existing theme is in.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_manifest
	 */
	public function test_manifest_without_the_block_recommends_nothing() {
		$manifest = $this->sanitize_manifest(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'name'            => 'Neon',
			)
		);

		$this->assertNotWPError( $manifest );
		$this->assertSame( array(), $manifest['recommendedOsSettings'] );
		$this->assertSame( 1, $manifest['manifestVersion'] );
	}

	/**
	 * A v1 manifest that ships the block anyway is honoured. Ignoring
	 * a valid, individually-sanitized field over a version number
	 * would contradict the drop-and-continue contract the rest of the
	 * sanitizer follows.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_manifest
	 */
	public function test_version_one_manifest_may_still_recommend() {
		$manifest = $this->manifest_with( array( 'dockSize' => 'compact' ), 1 );

		$this->assertNotWPError( $manifest );
		$this->assertSame(
			array( 'dockSize' => 'compact' ),
			$manifest['recommendedOsSettings']
		);
	}

	/**
	 * @covers ::openstation_sanitize_desktop_theme_manifest
	 */
	public function test_a_garbage_block_does_not_fail_the_upload() {
		$manifest = $this->manifest_with( 'dockSize=large' );

		$this->assertNotWPError( $manifest );
		$this->assertSame( array(), $manifest['recommendedOsSettings'] );
		$this->assertSame( 'Neon', $manifest['name'] );
	}

	// ------------------------------------------------------------------
	// Code registration + payload.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_code_registration_accepts_recommendations() {
		$this->assertTrue(
			openstation_register_desktop_theme(
				'acme/neon',
				array(
					'name'                  => 'Neon',
					'recommendedOsSettings' => array(
						'dockSize'      => 'large',
						'desktopLayout' => 'unified',
					),
				)
			)
		);

		$entry = openstation_desktop_theme_registry( 'acme-neon' );
		$this->assertSame(
			array(
				'dockSize'      => 'large',
				'desktopLayout' => 'unified',
			),
			$entry['manifest']['recommendedOsSettings']
		);
	}

	/**
	 * @covers ::openstation_register_desktop_theme
	 */
	public function test_code_registration_without_recommendations_still_works() {
		$this->assertTrue(
			openstation_register_desktop_theme( 'acme/plain', array( 'name' => 'Plain' ) )
		);

		$entry = openstation_desktop_theme_registry( 'acme-plain' );
		$this->assertSame( array(), $entry['manifest']['recommendedOsSettings'] );
	}

	/**
	 * @covers ::openstation_shape_desktop_theme_payload_entry
	 */
	public function test_payload_exposes_the_recommendations() {
		openstation_register_desktop_theme(
			'acme/neon',
			array(
				'name'                  => 'Neon',
				'recommendedOsSettings' => array( 'windowRadius' => 'round' ),
			)
		);

		$payload = openstation_build_desktop_themes_payload();
		$this->assertCount( 1, $payload );
		$this->assertSame(
			array( 'windowRadius' => 'round' ),
			$payload[0]['recommendedOsSettings']
		);
	}

	/**
	 * A stored manifest can predate a schema change. The payload
	 * shaper re-sanitizes on the way out so the shell is never handed
	 * a value this build no longer understands.
	 *
	 * @covers ::openstation_shape_desktop_theme_payload_entry
	 */
	public function test_payload_resanitizes_a_stale_stored_block() {
		$shaped = openstation_shape_desktop_theme_payload_entry(
			array(
				'slug'     => 'acme-neon',
				'manifest' => array(
					'id'                    => 'acme/neon',
					'slug'                  => 'acme-neon',
					'name'                  => 'Neon',
					'recommendedOsSettings' => array(
						'dockSize'             => 'gigantic',
						'windowRadius'         => 'sharp',
						'nativePluginsEnabled' => 'true',
					),
				),
			),
			'code'
		);

		$this->assertSame(
			array( 'windowRadius' => 'sharp' ),
			$shaped['recommendedOsSettings']
		);
	}

	/**
	 * An entry whose stored manifest has no block at all — every
	 * theme installed before this feature existed — shapes to an
	 * empty set rather than a missing key.
	 *
	 * @covers ::openstation_shape_desktop_theme_payload_entry
	 */
	public function test_payload_key_is_always_present() {
		$shaped = openstation_shape_desktop_theme_payload_entry(
			array(
				'slug'     => 'acme-legacy',
				'manifest' => array(
					'id'   => 'acme/legacy',
					'slug' => 'acme-legacy',
					'name' => 'Legacy',
				),
			),
			'code'
		);

		$this->assertArrayHasKey( 'recommendedOsSettings', $shaped );
		$this->assertSame( array(), $shaped['recommendedOsSettings'] );
	}
}
