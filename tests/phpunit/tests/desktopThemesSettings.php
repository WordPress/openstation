<?php
/**
 * Tests for the `desktopTheme` OS-settings key.
 *
 * The sanitizer is deliberately a PATTERN check, not an allow-list —
 * validating against the installed-theme option on every settings
 * write would load and unserialize whole manifests for a value the
 * enqueue path re-checks anyway.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesSettings extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$user_id, OPENSTATION_OS_SETTINGS_META_KEY );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_default_is_the_system_theme() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'desktopTheme', $defaults );
		$this->assertSame( '', $defaults['desktopTheme'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_valid_slug_round_trips() {
		$clean = openstation_sanitize_os_settings( array( 'desktopTheme' => 'acme-neon' ) );
		$this->assertSame( 'acme-neon', $clean['desktopTheme'] );
	}

	/**
	 * Empty is a REAL value (the system default), not a missing one —
	 * the JS `_parseRaw` mirror uses `*` rather than `+` for the same
	 * reason.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_empty_string_is_preserved() {
		$clean = openstation_sanitize_os_settings( array( 'desktopTheme' => '' ) );
		$this->assertSame( '', $clean['desktopTheme'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_missing_key_falls_back_to_default() {
		$clean = openstation_sanitize_os_settings( array() );
		$this->assertSame( '', $clean['desktopTheme'] );
	}

	/**
	 * @dataProvider data_dirty_slugs
	 * @covers ::openstation_sanitize_os_settings
	 *
	 * @param mixed  $raw      Raw input.
	 * @param string $expected Sanitized result.
	 */
	public function test_dirty_values_are_sanitized( $raw, $expected ) {
		$clean = openstation_sanitize_os_settings( array( 'desktopTheme' => $raw ) );
		$this->assertSame( $expected, $clean['desktopTheme'] );
	}

	public function data_dirty_slugs() {
		return array(
			'uppercase'  => array( 'Acme-Neon', 'acme-neon' ),
			'slash'      => array( 'acme/neon', 'acmeneon' ),
			'traversal'  => array( '../../etc', 'etc' ),
			'markup'     => array( '<script>', 'script' ),
			'non string' => array( array( 'x' ), '' ),
			'null'       => array( null, '' ),
		);
	}

	/**
	 * An unknown slug is stored as-is. The enqueue-side existence
	 * check is the safety net, which is what lets a deleted theme
	 * degrade silently instead of requiring a user-meta rewrite.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_unknown_slug_is_kept_not_rejected() {
		$clean = openstation_sanitize_os_settings( array( 'desktopTheme' => 'not-installed' ) );
		$this->assertSame( 'not-installed', $clean['desktopTheme'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
	public function test_persists_through_user_meta() {
		openstation_save_os_settings( self::$user_id, array( 'desktopTheme' => 'acme-neon' ) );
		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'acme-neon', $loaded['desktopTheme'] );
	}

	/**
	 * The PHP sanitizer and the JS `_parseRaw` mirror must agree on
	 * the charset — a value one accepts and the other rewrites would
	 * make the setting flip on every reload.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_php_and_js_patterns_agree() {
		$state = OPENSTATION_DIR . 'src/settings/state.ts';
		$this->assertFileExists( $state );
		$source = file_get_contents( $state );

		$this->assertStringContainsString(
			'desktopTheme: matching( /^[a-z0-9_-]*$/ )',
			$source,
			'The JS mirror must accept the empty string (note the `*`, not `+`).'
		);
	}

	// ------------------------------------------------------------------
	// appliedThemeRecommendations — the "seed a theme's recommended
	// layout exactly once" ledger.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_recommendation_ledger_defaults_to_empty() {
		$defaults = openstation_default_os_settings();
		$this->assertArrayHasKey( 'appliedThemeRecommendations', $defaults );
		$this->assertSame( array(), $defaults['appliedThemeRecommendations'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_recommendation_ledger_round_trips_and_dedupes() {
		$clean = openstation_sanitize_os_settings(
			array(
				'appliedThemeRecommendations' => array(
					'acme-neon',
					'Acme-Neon',
					'other-theme',
					'',
					42,
					array( 'nope' ),
				),
			)
		);

		$this->assertSame(
			array( 'acme-neon', 'other-theme' ),
			$clean['appliedThemeRecommendations']
		);
	}

	/**
	 * The cap keeps the MOST RECENT entries. The client appends, so
	 * trimming from the front would drop the slug just written and
	 * let that theme re-seed on the next activation — precisely the
	 * "a theme overwrote my settings again" bug the ledger exists to
	 * prevent.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_recommendation_ledger_cap_keeps_the_newest() {
		$slugs = array();
		for ( $i = 0; $i < 70; $i++ ) {
			$slugs[] = 'theme-' . $i;
		}

		$clean = openstation_sanitize_os_settings(
			array( 'appliedThemeRecommendations' => $slugs )
		);

		$ledger = $clean['appliedThemeRecommendations'];
		$this->assertCount( 64, $ledger );
		$this->assertSame( 'theme-69', end( $ledger ) );
		$this->assertNotContains( 'theme-0', $ledger );
	}

	/**
	 * Slugs of themes that are no longer installed stay in the
	 * ledger. Forgetting one would let a delete-then-reinstall
	 * re-seed over settings the user has since chosen.
	 *
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
	public function test_recommendation_ledger_persists_unknown_slugs() {
		openstation_save_os_settings(
			self::$user_id,
			array( 'appliedThemeRecommendations' => array( 'deleted-theme' ) )
		);

		$loaded = openstation_get_os_settings( self::$user_id );
		$this->assertSame(
			array( 'deleted-theme' ),
			$loaded['appliedThemeRecommendations']
		);
	}

	/**
	 * A payload that omits the key entirely — every client build
	 * older than this feature — leaves the ledger at its default
	 * rather than erroring.
	 *
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_missing_recommendation_ledger_falls_back_to_default() {
		$clean = openstation_sanitize_os_settings( array( 'dockSize' => 'large' ) );
		$this->assertSame( array(), $clean['appliedThemeRecommendations'] );
	}
}
