<?php
/**
 * Tests for the desktop-theme manifest sanitizer.
 *
 * The sanitizer is the whole security boundary of the feature — it is
 * the only thing between an uploaded JSON file and a stylesheet the
 * browser executes. These tests are organised around its two tiers:
 * structural fields are FATAL, everything else DROPS AND CONTINUES.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesManifest extends WP_UnitTestCase {

	/**
	 * Local recursive delete. The module's own `_rmdir()` refuses to
	 * act outside the themes base dir (by design), and these resolver
	 * fixtures live in the system temp dir.
	 */
	private function rrmdir( $dir ) {
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			is_dir( $entry ) ? $this->rrmdir( $entry ) : unlink( $entry );
		}
		rmdir( $dir );
	}

	/** Resolver that accepts anything — isolates non-asset assertions. */
	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function valid_manifest( $overrides = array() ) {
		return array_merge(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'name'            => 'Neon',
			),
			$overrides
		);
	}

	private function sanitize( $raw, $resolver = null ) {
		return desktop_mode_sanitize_desktop_theme_manifest(
			$raw,
			$resolver ? $resolver : $this->permissive_resolver()
		);
	}

	// ------------------------------------------------------------------
	// Fatal fields.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_valid_manifest_sanitizes() {
		$out = $this->sanitize( $this->valid_manifest() );
		$this->assertIsArray( $out );
		$this->assertSame( 'acme/neon', $out['id'] );
		$this->assertSame( 'acme-neon', $out['slug'], 'Slug flattens the namespace slash.' );
		$this->assertSame( 'Neon', $out['name'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_non_array_manifest_is_fatal() {
		$this->assertWPError( $this->sanitize( 'not-a-manifest' ) );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_wrong_manifest_version_is_fatal() {
		$error = $this->sanitize( $this->valid_manifest( array( 'manifestVersion' => 3 ) ) );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_bad_version', $error->get_error_code() );
	}

	/**
	 * Version 2 is the current manifest revision — it exists so an
	 * author can declare `recommendedOsSettings`. It must sanitize
	 * exactly like a v1 manifest otherwise, and round-trip its own
	 * version number rather than being rewritten to 1.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_manifest_version_two_is_accepted() {
		$manifest = $this->sanitize( $this->valid_manifest( array( 'manifestVersion' => 2 ) ) );
		$this->assertNotWPError( $manifest );
		$this->assertSame( 2, $manifest['manifestVersion'] );
		$this->assertSame( 'acme/neon', $manifest['id'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_missing_manifest_version_is_fatal() {
		$raw = $this->valid_manifest();
		unset( $raw['manifestVersion'] );
		$this->assertWPError( $this->sanitize( $raw ) );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_missing_name_is_fatal() {
		$raw = $this->valid_manifest();
		unset( $raw['name'] );
		$error = $this->sanitize( $raw );
		$this->assertWPError( $error );
		$this->assertSame( 'desktop_mode_desktop_theme_missing_name', $error->get_error_code() );
	}

	/**
	 * @dataProvider data_bad_ids
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 *
	 * @param string $id Candidate id.
	 */
	public function test_bad_ids_are_fatal( $id ) {
		$error = $this->sanitize( $this->valid_manifest( array( 'id' => $id ) ) );
		$this->assertWPError( $error, "Expected id '{$id}' to be rejected." );
		$this->assertSame( 'desktop_mode_desktop_theme_bad_id', $error->get_error_code() );
	}

	public function data_bad_ids() {
		return array(
			'empty'          => array( '' ),
			'uppercase'      => array( 'Neon' ),
			'traversal'      => array( '../evil' ),
			'absolute'       => array( '/etc/passwd' ),
			'two slashes'    => array( 'a/b/c' ),
			'spaces'         => array( 'neon glass' ),
			'too long'       => array( str_repeat( 'a', 65 ) ),
			'trailing slash' => array( 'acme/' ),
		);
	}

	// ------------------------------------------------------------------
	// Tokens.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_tokens
	 */
	public function test_valid_tokens_survive() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'tokens' => array(
				'--desktop-mode-window-radius' => '14px',
				'--wp-admin-theme-color'       => '#7c5cff',
				'--desktop-mode-dock-bg'       => 'rgba( 12, 12, 30, 0.72 )',
			),
		) ) );
		$this->assertCount( 3, $out['tokens'] );
		$this->assertSame( '14px', $out['tokens']['--desktop-mode-window-radius'] );
	}

	/**
	 * Property names outside the plugin's namespace are dropped — a
	 * theme must not be able to reach properties the shell never meant
	 * to expose.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_tokens
	 */
	public function test_out_of_namespace_token_keys_are_dropped() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'tokens' => array(
				'--evil'                       => 'red',
				'color'                        => 'red',
				'--wp-something-else'          => 'red',
				'--desktop-mode-window-radius' => '4px',
			),
		) ) );
		$this->assertSame(
			array( '--desktop-mode-window-radius' => '4px' ),
			$out['tokens']
		);
	}

	/**
	 * The `--wpd-*` namespace is the component kit's theming
	 * contract, and window BODIES are built entirely from those
	 * components. Blocking it would leave a theme able to restyle
	 * the chrome around a window but nothing inside it.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_tokens
	 */
	public function test_wpd_component_tokens_are_accepted() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'tokens' => array(
				'--wpd-surface'       => '#161634',
				'--wpd-fg'            => '#e9e7ff',
				'--wpd-fg-muted'      => '#a5a1cc',
				'--wpd-border'        => '#2f2a63',
				'--wpd-border-strong' => '#453e8c',
				'--wpd-hover'         => 'rgba( 124, 92, 255, 0.16 )',
				'--wpd-scrim'         => 'rgba( 6, 4, 24, 0.68 )',
				'--wpd-accent'        => '#7c5cff',
				'--wpd-danger'        => '#ff6b81',
				'--wpd-warning-bg'    => '#33280d',
			),
		) ) );
		$this->assertCount( 10, $out['tokens'] );
		$this->assertSame( '#161634', $out['tokens']['--wpd-surface'] );
	}

	/**
	 * `--wpd-*` widens the namespace but not the VALUE grammar — a
	 * component token is validated exactly like a shell token.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_tokens
	 */
	public function test_wpd_tokens_still_obey_the_value_grammar() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'tokens' => array(
				'--wpd-surface' => 'red; background: url(//evil)',
				'--wpd-fg'      => 'var(--secret)',
				'--wpd-border'  => '#2f2a63',
			),
		) ) );
		$this->assertSame( array( '--wpd-border' => '#2f2a63' ), $out['tokens'] );
	}

	/**
	 * @dataProvider data_unsafe_css_values
	 * @covers ::desktop_mode_desktop_theme_is_safe_css_value
	 *
	 * @param string $value Candidate value.
	 */
	public function test_unsafe_css_values_are_rejected( $value ) {
		$this->assertFalse(
			desktop_mode_desktop_theme_is_safe_css_value( $value ),
			"Expected value to be rejected: {$value}"
		);
	}

	public function data_unsafe_css_values() {
		return array(
			'declaration escape' => array( 'red; background: url(//evil)' ),
			'block escape'       => array( 'red } body { display: none' ),
			'at-rule'            => array( 'red } @import "//evil.css"' ),
			'important'          => array( 'red !important' ),
			'markup breakout'    => array( 'red</style><script>x()</script>' ),
			'url'                => array( 'url(//evil/x.png)' ),
			'uppercase url'      => array( 'URL(//evil/x.png)' ),
			'image-set'          => array( 'image-set("//evil/x.png" 1x)' ),
			'element'            => array( 'element(#x)' ),
			'attr'               => array( 'attr(data-x)' ),
			'var alias'          => array( 'var(--secret)' ),
			'expression'         => array( 'expression(alert(1))' ),
			'comment open'       => array( '4px /* x' ),
			'comment close'      => array( '4px */ x' ),
			'backslash escape'   => array( '\\75 rl(//evil)' ),
			'unbalanced open'    => array( 'rgba( 1, 2, 3' ),
			'unbalanced close'   => array( 'rgba 1, 2, 3 )' ),
			'empty'              => array( '' ),
			'too long'           => array( str_repeat( 'a', 257 ) ),
			'non string'         => array( 42 ),
		);
	}

	/**
	 * @dataProvider data_safe_css_values
	 * @covers ::desktop_mode_desktop_theme_is_safe_css_value
	 *
	 * @param string $value Candidate value.
	 */
	public function test_safe_css_values_are_accepted( $value ) {
		$this->assertTrue(
			desktop_mode_desktop_theme_is_safe_css_value( $value ),
			"Expected value to be accepted: {$value}"
		);
	}

	public function data_safe_css_values() {
		return array(
			'hex'        => array( '#1a1a2e' ),
			'length'     => array( '14px' ),
			'rgba'       => array( 'rgba( 12, 12, 30, 0.72 )' ),
			'gradient'   => array( 'linear-gradient( 135deg, #1d2327 0%, #2c3338 100% )' ),
			'calc'       => array( 'calc( 100% - 12px )' ),
			'shorthand'  => array( '0 2px 8px rgba( 0, 0, 0, 0.3 )' ),
			'two-value'  => array( '4px / 8px' ),
			'font stack' => array( '"Inter", system-ui, sans-serif' ),
			'keyword'    => array( 'none' ),
		);
	}

	// ------------------------------------------------------------------
	// Icons.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_icons
	 */
	public function test_known_icon_slots_survive() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'icons' => array(
				'WINDOW_CONTROL_CLOSE' => array( 'type' => 'image', 'path' => 'icons/close.svg' ),
				'OS_SETTINGS'          => array( 'type' => 'dashicon', 'name' => 'dashicons-admin-generic' ),
				'APP:edit-php'         => array( 'type' => 'dashicon', 'name' => 'dashicons-edit-large' ),
			),
		) ) );
		$this->assertCount( 3, $out['icons'] );
		$this->assertSame( 'image', $out['icons']['WINDOW_CONTROL_CLOSE']['type'] );
		$this->assertSame( 'dashicons-edit-large', $out['icons']['APP:edit-php']['name'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_icons
	 */
	public function test_unknown_icon_slot_is_dropped() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'icons' => array(
				'NOT_A_SLOT'  => array( 'type' => 'dashicon', 'name' => 'dashicons-star-filled' ),
				'OS_SETTINGS' => array( 'type' => 'dashicon', 'name' => 'dashicons-star-filled' ),
			),
		) ) );
		$this->assertSame( array( 'OS_SETTINGS' ), array_keys( $out['icons'] ) );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_icons
	 */
	public function test_bad_dashicon_name_is_dropped() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'icons' => array(
				'OS_SETTINGS' => array( 'type' => 'dashicon', 'name' => 'javascript:alert(1)' ),
			),
		) ) );
		$this->assertSame( array(), $out['icons'] );
	}

	/**
	 * The resolver returning `false` (file missing, outside the theme
	 * dir, wrong extension) drops just that entry.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_icons
	 */
	public function test_resolver_rejection_drops_only_that_icon() {
		$resolver = static function ( $path ) {
			return 'icons/ok.svg' === $path ? $path : false;
		};
		$out = $this->sanitize(
			$this->valid_manifest( array(
				'icons' => array(
					'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'icons/ok.svg' ),
					'RECYCLE_BIN' => array( 'type' => 'image', 'path' => '../../../wp-config.php' ),
				),
			) ),
			$resolver
		);
		$this->assertSame( array( 'OS_SETTINGS' ), array_keys( $out['icons'] ) );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_icons
	 */
	public function test_app_slot_slug_is_sanitized() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'icons' => array(
				'APP:Edit Php!' => array( 'type' => 'dashicon', 'name' => 'dashicons-edit' ),
			),
		) ) );
		$this->assertArrayHasKey( 'APP:editphp', $out['icons'] );
	}

	// ------------------------------------------------------------------
	// Textures.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_textures
	 */
	public function test_image_texture_grammar() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'textures' => array(
				'TITLEBAR' => array(
					'type'   => 'image',
					'path'   => 'textures/t.png',
					'repeat' => 'repeat-x',
					'size'   => 'auto 100%',
				),
			),
		) ) );
		$this->assertSame( 'repeat-x', $out['textures']['TITLEBAR']['repeat'] );
		$this->assertSame( 'auto 100%', $out['textures']['TITLEBAR']['size'] );
	}

	/**
	 * A bad presentational property drops on its own — the texture
	 * itself still applies, with the CSS initial value.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_textures
	 */
	public function test_bad_texture_property_drops_without_dropping_texture() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'textures' => array(
				'TITLEBAR' => array(
					'type'   => 'image',
					'path'   => 'textures/t.png',
					'repeat' => 'no-repeat; background: url(//evil)',
					'size'   => '12flurbles',
				),
			),
		) ) );
		$this->assertArrayHasKey( 'TITLEBAR', $out['textures'] );
		$this->assertArrayNotHasKey( 'repeat', $out['textures']['TITLEBAR'] );
		$this->assertArrayNotHasKey( 'size', $out['textures']['TITLEBAR'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_textures
	 */
	public function test_border_image_grammar() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'textures' => array(
				'WINDOW_FRAME' => array(
					'type'   => 'border-image',
					'path'   => 'textures/frame.png',
					'slice'  => '24 fill',
					'width'  => '12px',
					'repeat' => 'round',
				),
			),
		) ) );
		$entry = $out['textures']['WINDOW_FRAME'];
		$this->assertSame( '24 fill', $entry['slice'] );
		$this->assertSame( '12px', $entry['width'] );
		$this->assertSame( 'round', $entry['repeat'] );
	}

	/**
	 * Declaring the wrong `type` for a slot drops the whole entry —
	 * the compiler emits different properties per type and would
	 * otherwise produce nonsense.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_textures
	 */
	public function test_texture_type_must_match_the_slot() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'textures' => array(
				'TITLEBAR' => array( 'type' => 'border-image', 'path' => 'x.png' ),
			),
		) ) );
		$this->assertSame( array(), $out['textures'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_textures
	 */
	public function test_unknown_texture_slot_is_dropped() {
		$out = $this->sanitize( $this->valid_manifest( array(
			'textures' => array(
				'SIDEBAR' => array( 'type' => 'image', 'path' => 'x.png' ),
			),
		) ) );
		$this->assertSame( array(), $out['textures'] );
	}

	// ------------------------------------------------------------------
	// Resolvers.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_staging_asset_resolver
	 */
	public function test_staging_resolver_containment() {
		$base = get_temp_dir() . 'dm-theme-resolver-' . wp_generate_uuid4();
		wp_mkdir_p( $base . '/icons' );
		file_put_contents( $base . '/icons/ok.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>' );
		file_put_contents( $base . '/notes.txt', 'nope' );

		$resolve = desktop_mode_desktop_theme_staging_asset_resolver( $base );

		$this->assertSame( 'icons/ok.svg', $resolve( 'icons/ok.svg' ) );
		$this->assertFalse( $resolve( '../outside.png' ), 'Traversal rejected.' );
		$this->assertFalse( $resolve( '/etc/passwd' ), 'Absolute path rejected.' );
		$this->assertFalse( $resolve( 'icons\\ok.svg' ), 'Backslash rejected.' );
		$this->assertFalse( $resolve( "icons/ok.svg\0.php" ), 'NUL byte rejected.' );
		$this->assertFalse( $resolve( 'notes.txt' ), 'Non-image extension rejected.' );
		$this->assertFalse( $resolve( 'icons/missing.png' ), 'Missing file rejected.' );
		$this->assertFalse( $resolve( '' ), 'Empty path rejected.' );

		$this->rrmdir( $base );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_url_asset_resolver
	 */
	public function test_url_resolver() {
		$resolve = desktop_mode_desktop_theme_url_asset_resolver();

		$this->assertSame(
			'https://example.com/x.png',
			$resolve( 'https://example.com/x.png' )
		);
		$this->assertFalse( $resolve( 'javascript:alert(1)' ) );
		$this->assertFalse( $resolve( 'https://example.com/x.css' ) );
		$this->assertFalse( $resolve( 'https://example.com/x.js' ) );
		$this->assertFalse( $resolve( '/relative/x.png' ) );
		$this->assertFalse( $resolve( 'data:image/svg+xml;base64,AAAA' ) );
	}

	// ------------------------------------------------------------------
	// Filter.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_manifest_filter_receives_raw_and_slug() {
		$seen = array();
		add_filter(
			'desktop_mode_desktop_theme_manifest',
			function ( $manifest, $raw, $slug ) use ( &$seen ) {
				$seen = compact( 'raw', 'slug' );
				$manifest['name'] = 'Filtered';
				return $manifest;
			},
			10,
			3
		);

		$out = $this->sanitize( $this->valid_manifest() );

		$this->assertSame( 'Filtered', $out['name'] );
		$this->assertSame( 'acme-neon', $seen['slug'] );
		$this->assertSame( 'acme/neon', $seen['raw']['id'] );

		remove_all_filters( 'desktop_mode_desktop_theme_manifest' );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_icon_slots
	 */
	public function test_icon_slot_allowlist_is_filterable() {
		add_filter(
			'desktop_mode_desktop_theme_icon_slots',
			static function ( $slots ) {
				$slots[] = 'ACME_CUSTOM';
				return $slots;
			}
		);

		$out = $this->sanitize( $this->valid_manifest( array(
			'icons' => array(
				'ACME_CUSTOM' => array( 'type' => 'dashicon', 'name' => 'dashicons-star-filled' ),
			),
		) ) );
		$this->assertArrayHasKey( 'ACME_CUSTOM', $out['icons'] );

		remove_all_filters( 'desktop_mode_desktop_theme_icon_slots' );
	}

	/**
	 * The PHP allowlist and the TS constants are a single contract —
	 * a slot on one side only is silently dropped at upload time or
	 * silently never consulted at render time. Parse the TS source to
	 * hold both halves together.
	 *
	 * @covers ::desktop_mode_desktop_theme_icon_slots
	 */
	public function test_php_and_ts_slot_lists_match() {
		$ts = DESKTOP_MODE_DIR . 'src/desktop-themes/slots.ts';
		$this->assertFileExists( $ts );

		$source = file_get_contents( $ts );
		$start  = strpos( $source, 'export const DESKTOP_THEME_SLOTS' );
		$end    = strpos( $source, '} as const;', $start );
		$block  = substr( $source, $start, $end - $start );

		preg_match_all( '/^\t([A-Z][A-Z0-9_]*):/m', $block, $matches );
		$ts_slots = $matches[1];

		sort( $ts_slots );
		$php_slots = desktop_mode_desktop_theme_icon_slots();
		sort( $php_slots );

		$this->assertSame(
			$php_slots,
			$ts_slots,
			'desktop_mode_desktop_theme_icon_slots() and DESKTOP_THEME_SLOTS have drifted.'
		);
	}
}
