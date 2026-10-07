<?php

class Tests_OpenStation_DesktopThemesLegacy extends WP_UnitTestCase {

	const SLUG = 'desktop-mode-legacy';

	public function set_up() {
		parent::set_up();

		openstation_register_builtin_desktop_themes();
	}

	public function tear_down() {
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'openstation_legacy_theme_manifest_path' );
		parent::tear_down();
	}

	private function manifest() {
		$path = OPENSTATION_DIR . 'assets/desktop-themes/legacy/theme.json';
		$this->assertFileExists( $path, 'The Legacy theme manifest ships with the plugin.' );
		$manifest = wp_json_file_decode( $path, array( 'associative' => true ) );
		$this->assertIsArray( $manifest, 'theme.json is valid JSON.' );
		return $manifest;
	}

	public function test_legacy_is_registered_as_a_code_theme() {
		$entry = openstation_desktop_theme_registry( self::SLUG );

		$this->assertIsArray( $entry );
		$this->assertSame( self::SLUG, $entry['slug'] );
		$this->assertSame( 'Desktop Mode (Legacy)', $entry['manifest']['name'] );
		$this->assertSame( 'desktop-mode/legacy', $entry['manifest']['id'] );
		$this->assertNotSame( '', (string) $entry['cssText'], 'A code theme carries its compiled CSS inline.' );
	}

	public function test_legacy_ships_preview_artwork() {
		$this->assertFileExists( OPENSTATION_DIR . 'assets/desktop-themes/legacy/preview.svg' );

		$entry = openstation_desktop_theme_registry( self::SLUG );
		$this->assertStringEndsWith(
			'assets/desktop-themes/legacy/preview.svg',
			(string) $entry['manifest']['preview'],
			'The preview URL survived sanitization.'
		);
	}

	public function test_preview_artwork_survives_the_svg_sanitizer() {
		$copy = get_temp_dir() . 'legacy-preview-' . wp_generate_password( 8, false ) . '.svg';
		copy( OPENSTATION_DIR . 'assets/desktop-themes/legacy/preview.svg', $copy );

		$result = openstation_desktop_theme_sanitize_svg( $copy );
		$after  = file_get_contents( $copy );
		unlink( $copy );

		$this->assertTrue( $result );
		$this->assertStringContainsString( 'Desktop Mode (Legacy)', $after, 'The label survives sanitization.' );
	}

	public function test_legacy_reaches_the_shell_payload() {
		$payload = openstation_build_desktop_themes_payload();
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

	public function test_legacy_cannot_be_deleted() {
		$deleted = openstation_desktop_theme_delete( self::SLUG );

		$this->assertWPError( $deleted );
		$this->assertSame( 'openstation_desktop_theme_not_found', $deleted->get_error_code() );
		$this->assertIsArray(
			openstation_desktop_theme_registry( self::SLUG ),
			'A failed delete leaves the registration untouched.'
		);
	}

	public function test_no_token_is_dropped_by_the_sanitizer() {
		$raw   = $this->manifest();
		$entry = openstation_desktop_theme_registry( self::SLUG );

		$kept    = array_keys( $entry['manifest']['tokens'] );
		$dropped = array_diff( array_keys( $raw['tokens'] ), $kept );

		$this->assertSame(
			array(),
			array_values( $dropped ),
			'Every declared token satisfies the value grammar: ' . implode( ', ', $dropped )
		);
		$this->assertGreaterThan( 380, count( $kept ), 'The manifest covers the token surface.' );
	}

	public function test_the_snapshot_is_frozen() {
		$tokens = $this->manifest()['tokens'];
		$why    = 'Legacy is a frozen snapshot — mint a new theme instead of moving it.';

		$this->assertCount( 517, $tokens, $why );
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

			'--os-titlebar-bg-focused'    => '#2271b1',
			'--os-titlebar-color-focused' => '#fff',
		) as $name => $value ) {
			$this->assertSame( $value, $tokens[ $name ], $name . ': ' . $why );
		}
	}

	private function palette_literals( $css ) {
		$css = preg_replace( '~/\*.*?\*/~s', '', $css );
		preg_match_all( '/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER );
		$literals = array();
		foreach ( $rules as $rule ) {
			if ( ! $this->has_palette_selector( $rule[1] ) ) {
				continue;
			}
			preg_match_all( '/(--os-[a-z0-9-]+)\s*:\s*([^;]+);/', $rule[2], $declarations, PREG_SET_ORDER );
			foreach ( $declarations as $declaration ) {

				if ( false !== strpos( $declaration[2], 'var(' ) || false !== strpos( $declaration[2], 'var (' ) ) {
					continue;
				}
				$literals[ $declaration[1] ] = true;
			}
		}
		return $literals;
	}

	private function has_palette_selector( $selectors ) {
		$outer = '';
		$depth = 0;
		$quote = '';
		for ( $index = 0, $length = strlen( $selectors ); $index < $length; $index++ ) {
			$char = $selectors[ $index ];
			if ( '\\' === $char ) {
				$index++;
				if ( 0 === $depth && '' === $quote ) {
					$outer .= '_';
				}
				continue;
			}
			if ( '' !== $quote ) {
				if ( $quote === $char ) {
					$quote = '';
				}
				continue;
			}
			if ( '"' === $char || "'" === $char ) {
				$quote = $char;
			} elseif ( '(' === $char || '[' === $char ) {
				$depth++;
			} elseif ( ')' === $char || ']' === $char ) {
				$depth--;
			} elseif ( 0 === $depth ) {
				$outer .= $char;
			}
		}
		foreach ( explode( ',', $outer ) as $selector ) {
			$selector = trim( $selector );
			if ( '' !== $selector && ! preg_match( '/[\s>+~|]/', $selector ) ) {
				return true;
			}
		}
		return false;
	}

	public function test_palette_literal_scope_excludes_component_overrides() {
		$css = '
			/* body.os-active { --os-comment: red; } */
			body.os-active {
				--os-global: #123456;
				--os-derived: var(--os-global);
			}
			body.os-active .os-mio-callout {
				--os-ui-button-border: 0;
				--os-ui-button-bg: transparent;
				--os-global: var(--os-local);
			}
			body.os-active-other { --os-unrelated: red; }
			body.os-active .first, body.os-active .second { --os-local: red; }
			body.os-active, .another-root { --os-grouped: blue; }
		';
		$this->assertSame(
			array( '--os-global' => true, '--os-unrelated' => true, '--os-grouped' => true ),
			$this->palette_literals( $css )
		);
	}

	public function test_palette_literals_include_compound_window_rules() {
		$css = '
			.os-window:not( .os-window--native ) { --os-window-reveal-surface: #fff; }
			.os-window:is( .a, :not( .b ) ) { --os-nested: red; }
			.os-window[data-label="one, two > three"] { --os-attribute: blue; }
			body.os-active > .os-mio-callout { --os-child: red; }
			.os-window + .os-mio-callout { --os-adjacent: red; }
			.os-window ~ .os-mio-callout { --os-sibling: red; }
			body.os-active .os-window:not( .native, .other ) { --os-descendant: red; }
			body.os-active .local, .os-window:not( .native ) { --os-mixed-list: blue; }
		';
		$this->assertSame(
			array( '--os-window-reveal-surface' => true, '--os-nested' => true, '--os-attribute' => true, '--os-mixed-list' => true ),
			$this->palette_literals( $css )
		);
		$palette = file_get_contents( OPENSTATION_DIR . 'assets/css/variables.css' );
		$this->assertArrayHasKey( '--os-window-reveal-surface', $this->palette_literals( $palette ) );
	}

	public function test_legacy_answers_every_palette_literal() {
		$css = file_get_contents( OPENSTATION_DIR . 'assets/css/variables.css' );
		$this->assertIsString( $css, 'The palette stylesheet ships with the plugin.' );

		$literals = $this->palette_literals( $css );

		unset( $literals['--os-ui-accent-dim'] );

		$literals = array_keys( $literals );
		$this->assertNotEmpty( $literals, 'The palette declares literal tokens.' );

		$tokens     = $this->manifest()['tokens'];
		$unanswered = array_values( array_diff( $literals, array_keys( $tokens ) ) );

		$this->assertSame(
			array(),
			$unanswered,
			"Legacy leaves these palette literals to the brand: \n  "
				. implode( "\n  ", $unanswered )
				. "\nAdd each to assets/desktop-themes/legacy/theme.json at the "
				. 'value its consuming rule falls back to.'
		);
	}

	public function test_accent_driven_tokens_are_left_to_derive() {
		$tokens = $this->manifest()['tokens'];

		foreach ( array(
			'--os-ui-accent-dim',
			'--os-ui-tab-wash',
			'--os-ui-tab-bloom',
			'--os-ui-tab-edge',
			'--os-ui-focus-ring',
			'--os-ui-focus-ring-field',
			'--os-ui-holo-glow',
			'--os-ui-holo-glow-strong',
			'--os-tabs-rail',
			'--os-dock-divider',
			'--os-cn-beam',
			'--os-titlebar-activity-color',
			'--os-titlebar-activity-saved-color',
		) as $name ) {
			$this->assertArrayNotHasKey(
				$name,
				$tokens,
				$name . ' derives from the accent — pinning it stops the picker reaching it.'
			);
		}
	}

	public function test_legacy_tab_strip_holds_one_colour_across_focus() {
		$tokens = $this->manifest()['tokens'];

		$this->assertSame( '#f6f7f7', $tokens['--os-tabs-bg'] );
		$this->assertSame(
			$tokens['--os-tabs-bg'],
			$tokens['--os-tabs-bg-unfocused'],
			'Legacy names one strip colour; both focus states wear it.'
		);

		$this->assertSame( 'none', $tokens['--os-tabs-active-crown'] );
		$this->assertSame( 'none', $tokens['--os-tabs-active-frost'] );

		$this->assertArrayNotHasKey( '--os-tabs-rail', $tokens );
	}

	public function test_state_carrying_fills_are_not_switched_off() {
		$tokens = $this->manifest()['tokens'];

		foreach ( array(
			'--os-ui-holo-fill',
			'--os-tabs-active-bg',
			'--os-tabs-bg',
			'--os-tabs-bg-unfocused',
		) as $name ) {
			$value = strtolower( trim( $tokens[ $name ] ) );

			$this->assertNotSame(
				'none',
				$value,
				$name . ' paints a state, not a decoration — `none` erases the state.'
			);
			$this->assertNotSame( 'transparent', $value, $name . ' must paint something.' );
		}
	}

	public function test_no_brand_value_reaches_legacy() {
		$brand = array(
			'#f252fc' => 'Pulse',
			'#d92ee3' => 'Pulse (dim)',
			'#fffbff' => 'Starlight',
			'#0c0b0f' => 'Void',
			'#1a1721' => 'Obsidian',
			'242, 82, 252'  => 'Pulse (rgb)',
			'217, 46, 227'  => 'Pulse dim (rgb)',
			'255, 251, 255' => 'Starlight (rgb)',
			'12, 11, 15'    => 'Void (rgb)',
		);

		foreach ( $this->manifest()['tokens'] as $name => $value ) {
			foreach ( $brand as $needle => $label ) {
				$this->assertStringNotContainsStringIgnoringCase(
					$needle,
					$value,
					$name . ' carries ' . $label . ' (' . $needle . '); Legacy predates the brand.'
				);
			}
		}
	}

	public function test_compiled_css_declares_every_token() {
		$entry = openstation_desktop_theme_registry( self::SLUG );
		$css   = (string) $entry['cssText'];

		$this->assertStringContainsString( 'os-desktop-theme-' . self::SLUG, $css );
		foreach ( $entry['manifest']['tokens'] as $name => $value ) {
			$this->assertStringContainsString( $name . ':', $css, $name . ' reaches the stylesheet.' );
		}
	}

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

	public function test_the_accent_is_not_declared_as_a_token() {
		$this->assertArrayNotHasKey(
			'--wp-admin-theme-color',
			$this->manifest()['tokens']
		);
	}

	public function test_legacy_recommends_the_wordpress_blue_accent() {
		$raw = $this->manifest();
		$this->assertSame( 2, $raw['manifestVersion'], 'v2 declares a recommendation block.' );
		$this->assertSame( 'wp-blue', $raw['recommendedOsSettings']['accent'] );

		$entry = openstation_desktop_theme_registry( self::SLUG );
		$this->assertSame(
			'wp-blue',
			$entry['manifest']['recommendedOsSettings']['accent'],
			'`accent` is in the recommended-OS-settings schema.'
		);
	}

	public function test_accent_is_a_registry_slug_in_the_schema() {
		$schema = openstation_desktop_theme_recommended_os_settings_schema();

		$this->assertArrayHasKey( 'accent', $schema );
		$this->assertTrue(
			! empty( $schema['accent']['slug'] ),
			'Accent ids resolve against the filterable swatch list, not a fixed enum.'
		);
	}

	public function test_no_texture_slot_properties_are_declared() {
		foreach ( array_keys( $this->manifest()['tokens'] ) as $name ) {
			$this->assertDoesNotMatchRegularExpression(
				'/-image(-|$)/',
				$name,
				$name . ' is a texture-slot property, not a token.'
			);
		}
	}

	public function test_every_token_is_in_a_themable_namespace() {
		foreach ( array_keys( $this->manifest()['tokens'] ) as $name ) {
			$this->assertMatchesRegularExpression(
				'/^--os-[a-z0-9-]+$/',
				$name
			);
		}
	}

	public function test_manifest_path_is_filterable() {
		add_filter( 'openstation_legacy_theme_manifest_path', static function () {
			return '/nonexistent/theme.json';
		} );

		$this->assertSame( '/nonexistent/theme.json', openstation_legacy_theme_manifest_path() );
	}
}
