<?php
/**
 * Tests for the accent-color, toast-type, and default-wallpaper
 * filters that let plugins and themes extend the shell config
 * without touching the TypeScript bundle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-config-filters
 */
class Tests_DesktopMode_ConfigFilters extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'desktop_mode_accent_colors' );
		remove_all_filters( 'desktop_mode_toast_types' );
		remove_all_filters( 'desktop_mode_default_wallpaper' );
		parent::tear_down();
	}

	// --------------------------------------------------------------
	// Accent colors
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_default_shape() {
		$colors = desktop_mode_get_accent_colors();

		$this->assertIsArray( $colors );
		$this->assertNotEmpty( $colors );
		foreach ( $colors as $entry ) {
			$this->assertArrayHasKey( 'id', $entry );
			$this->assertArrayHasKey( 'label', $entry );
			$this->assertArrayHasKey( 'value', $entry );
			$this->assertMatchesRegularExpression( '/^#[0-9a-fA-F]{3,8}$/', $entry['value'] );
		}
	}

	/**
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_filter_can_add_entry() {
		add_filter( 'desktop_mode_accent_colors', static function ( $colors ) {
			$colors[] = array(
				'id'    => 'brand',
				'label' => 'Brand',
				'value' => '#ff00ff',
			);
			return $colors;
		} );

		$colors = desktop_mode_get_accent_colors();
		$ids    = wp_list_pluck( $colors, 'id' );

		$this->assertContains( 'brand', $ids );
	}

	/**
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_filter_rejects_invalid_hex() {
		add_filter( 'desktop_mode_accent_colors', static function () {
			return array(
				array( 'id' => 'bad', 'label' => 'Bad', 'value' => 'javascript:alert(1)' ),
				array( 'id' => 'ok',  'label' => 'OK',  'value' => '#abcdef' ),
			);
		} );

		$colors = desktop_mode_get_accent_colors();
		$ids    = wp_list_pluck( $colors, 'id' );

		$this->assertNotContains( 'bad', $ids );
		$this->assertContains( 'ok', $ids );
	}

	/**
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_non_array_filter_return_falls_back() {
		add_filter( 'desktop_mode_accent_colors', static function () {
			return 'broken';
		} );

		$colors = desktop_mode_get_accent_colors();

		$this->assertIsArray( $colors );
		$this->assertNotEmpty( $colors );
	}

	/**
	 * Duplicate ids coming back from the filter are deduplicated —
	 * first write wins. Prevents a plugin from shadowing the built-in
	 * `wp-blue` entry by accident.
	 *
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_filter_deduplicates_ids() {
		add_filter( 'desktop_mode_accent_colors', static function () {
			return array(
				array( 'id' => 'x', 'label' => 'First',  'value' => '#111111' ),
				array( 'id' => 'x', 'label' => 'Second', 'value' => '#222222' ),
			);
		} );

		$colors = desktop_mode_get_accent_colors();
		$labels = wp_list_pluck( $colors, 'label' );

		$this->assertContains( 'First',  $labels );
		$this->assertNotContains( 'Second', $labels );
	}

	/**
	 * A filter that drops every entry must not leave the shell with
	 * an empty picker — we fall back to the built-in defaults.
	 *
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_accent_colors_empty_after_filter_falls_back() {
		add_filter( 'desktop_mode_accent_colors', static function () {
			return array();
		} );

		$colors = desktop_mode_get_accent_colors();
		$this->assertNotEmpty( $colors );
	}

	// --------------------------------------------------------------
	// Toast types
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_get_toast_types
	 */
	public function test_toast_types_defaults_include_core_set() {
		$types = desktop_mode_get_toast_types();
		$ids   = wp_list_pluck( $types, 'id' );

		$this->assertContains( 'success', $ids );
		$this->assertContains( 'warning', $ids );
		$this->assertContains( 'error', $ids );
		$this->assertContains( 'shell-error', $ids );
	}

	/**
	 * @covers ::desktop_mode_get_toast_types
	 */
	public function test_toast_types_filter_can_add_custom_type() {
		add_filter( 'desktop_mode_toast_types', static function ( $types ) {
			$types[] = array(
				'id'    => 'update-available',
				'label' => 'Update available',
				'icon'  => 'dashicons-update',
				'tone'  => 'neutral',
			);
			return $types;
		} );

		$ids = wp_list_pluck( desktop_mode_get_toast_types(), 'id' );

		$this->assertContains( 'update-available', $ids );
	}

	/**
	 * Only `positive|warning|critical|neutral` tones are accepted —
	 * anything else is dropped to prevent a plugin shipping an
	 * unmappable color to the shell.
	 *
	 * @covers ::desktop_mode_get_toast_types
	 */
	public function test_toast_types_filter_rejects_invalid_tone() {
		add_filter( 'desktop_mode_toast_types', static function () {
			return array(
				array( 'id' => 'rainbow', 'label' => 'Rainbow', 'icon' => 'dashicons-art', 'tone' => 'magic' ),
			);
		} );

		$types = desktop_mode_get_toast_types();
		$ids   = wp_list_pluck( $types, 'id' );

		// Fallback to defaults because every filtered entry was rejected.
		$this->assertNotContains( 'rainbow', $ids );
		$this->assertContains( 'success', $ids );
	}

	/**
	 * @covers ::desktop_mode_get_toast_types
	 */
	public function test_toast_types_non_array_falls_back() {
		add_filter( 'desktop_mode_toast_types', static function () {
			return null;
		} );

		$types = desktop_mode_get_toast_types();
		$this->assertNotEmpty( $types );
	}

	// --------------------------------------------------------------
	// Default wallpaper
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_get_default_wallpaper
	 */
	public function test_default_wallpaper_builtin_value() {
		$this->assertSame( 'dark', desktop_mode_get_default_wallpaper() );
	}

	/**
	 * @covers ::desktop_mode_get_default_wallpaper
	 */
	public function test_default_wallpaper_filter_override() {
		add_filter( 'desktop_mode_default_wallpaper', static function () {
			return 'aurora';
		} );

		$this->assertSame( 'aurora', desktop_mode_get_default_wallpaper() );
	}

	/**
	 * @covers ::desktop_mode_get_default_wallpaper
	 */
	public function test_default_wallpaper_non_string_returns_empty() {
		add_filter( 'desktop_mode_default_wallpaper', static function () {
			return array( 'not', 'a', 'string' );
		} );

		$this->assertSame( '', desktop_mode_get_default_wallpaper() );
	}

	/**
	 * Invalid-slug returns are normalised via `sanitize_key()` — the
	 * shell treats the returned value as a registry key, so anything
	 * that survives sanitize_key is acceptable for downstream lookup.
	 *
	 * @covers ::desktop_mode_get_default_wallpaper
	 */
	public function test_default_wallpaper_normalises_uppercase_slug() {
		add_filter( 'desktop_mode_default_wallpaper', static function () {
			return 'My-Plugin/Brand';
		} );

		$this->assertSame( 'my-pluginbrand', desktop_mode_get_default_wallpaper() );
	}
}
