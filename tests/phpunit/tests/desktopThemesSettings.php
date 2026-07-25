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
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesSettings extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$user_id, DESKTOP_MODE_OS_SETTINGS_META_KEY );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_default_is_the_system_theme() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertArrayHasKey( 'desktopTheme', $defaults );
		$this->assertSame( '', $defaults['desktopTheme'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_valid_slug_round_trips() {
		$clean = desktop_mode_sanitize_os_settings( array( 'desktopTheme' => 'acme-neon' ) );
		$this->assertSame( 'acme-neon', $clean['desktopTheme'] );
	}

	/**
	 * Empty is a REAL value (the system default), not a missing one —
	 * the JS `_parseRaw` mirror uses `*` rather than `+` for the same
	 * reason.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_empty_string_is_preserved() {
		$clean = desktop_mode_sanitize_os_settings( array( 'desktopTheme' => '' ) );
		$this->assertSame( '', $clean['desktopTheme'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_missing_key_falls_back_to_default() {
		$clean = desktop_mode_sanitize_os_settings( array() );
		$this->assertSame( '', $clean['desktopTheme'] );
	}

	/**
	 * @dataProvider data_dirty_slugs
	 * @covers ::desktop_mode_sanitize_os_settings
	 *
	 * @param mixed  $raw      Raw input.
	 * @param string $expected Sanitized result.
	 */
	public function test_dirty_values_are_sanitized( $raw, $expected ) {
		$clean = desktop_mode_sanitize_os_settings( array( 'desktopTheme' => $raw ) );
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
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_unknown_slug_is_kept_not_rejected() {
		$clean = desktop_mode_sanitize_os_settings( array( 'desktopTheme' => 'not-installed' ) );
		$this->assertSame( 'not-installed', $clean['desktopTheme'] );
	}

	/**
	 * @covers ::desktop_mode_save_os_settings
	 * @covers ::desktop_mode_get_os_settings
	 */
	public function test_persists_through_user_meta() {
		desktop_mode_save_os_settings( self::$user_id, array( 'desktopTheme' => 'acme-neon' ) );
		$loaded = desktop_mode_get_os_settings( self::$user_id );
		$this->assertSame( 'acme-neon', $loaded['desktopTheme'] );
	}

	/**
	 * The PHP sanitizer and the JS `_parseRaw` mirror must agree on
	 * the charset — a value one accepts and the other rewrites would
	 * make the setting flip on every reload.
	 *
	 * @covers ::desktop_mode_sanitize_os_settings
	 */
	public function test_php_and_js_patterns_agree() {
		$state = DESKTOP_MODE_DIR . 'src/settings/state.ts';
		$this->assertFileExists( $state );
		$source = file_get_contents( $state );

		$this->assertStringContainsString(
			'/^[a-z0-9_-]*$/.test( parsed.desktopTheme )',
			$source,
			'The JS mirror must accept the empty string (note the `*`, not `+`).'
		);
	}
}
