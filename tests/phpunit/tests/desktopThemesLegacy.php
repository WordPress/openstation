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
		openstation_register_builtin_desktop_themes();
	}

	public function tear_down() {
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		remove_all_filters( 'openstation_legacy_theme_manifest_path' );
		parent::tear_down();
	}

	/** The raw manifest, straight off disk. */
	private function manifest() {
		$path = OPENSTATION_DIR . 'assets/desktop-themes/legacy/theme.json';
		$this->assertFileExists( $path, 'The Legacy theme manifest ships with the plugin.' );
		$manifest = wp_json_file_decode( $path, array( 'associative' => true ) );
		$this->assertIsArray( $manifest, 'theme.json is valid JSON.' );
		return $manifest;
	}

	/**
	 * @covers ::openstation_register_builtin_desktop_themes
	 */
	public function test_legacy_is_registered_as_a_code_theme() {
		$entry = openstation_desktop_theme_registry( self::SLUG );

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
		$this->assertFileExists( OPENSTATION_DIR . 'assets/desktop-themes/legacy/preview.svg' );

		$entry = openstation_desktop_theme_registry( self::SLUG );
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
	 * @covers ::openstation_desktop_theme_sanitize_svg
	 */
	public function test_preview_artwork_survives_the_svg_sanitizer() {
		$copy = get_temp_dir() . 'legacy-preview-' . wp_generate_password( 8, false ) . '.svg';
		copy( OPENSTATION_DIR . 'assets/desktop-themes/legacy/preview.svg', $copy );

		$result = openstation_desktop_theme_sanitize_svg( $copy );
		$after  = file_get_contents( $copy );
		unlink( $copy );

		$this->assertTrue( $result );
		$this->assertStringContainsString( 'Desktop Mode (Legacy)', $after, 'The label survives sanitization.' );
	}

	/**
	 * @covers ::openstation_build_desktop_themes_payload
	 */
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

	/**
	 * The whole point of the theme: it cannot be removed.
	 *
	 * @covers ::openstation_desktop_theme_delete
	 */
	public function test_legacy_cannot_be_deleted() {
		$deleted = openstation_desktop_theme_delete( self::SLUG );

		$this->assertWPError( $deleted );
		$this->assertSame( 'openstation_desktop_theme_not_found', $deleted->get_error_code() );
		$this->assertIsArray(
			openstation_desktop_theme_registry( self::SLUG ),
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
	 * @covers ::openstation_sanitize_desktop_theme_manifest
	 */
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

	/**
	 * The snapshot does not move.
	 *
	 * Legacy exists so that someone who picks it keeps the look they
	 * know while the shell's own defaults move on. Re-collecting it
	 * from today's stylesheets would take that away one release at a
	 * time — so a change to an existing value should fail loudly and
	 * be answered with a NEW snapshot theme under a new id, never with
	 * a rewrite of this one.
	 *
	 * **Adding a token the snapshot never had is a different act, and
	 * it is allowed.** The freeze protects values that were collected;
	 * a token minted after the snapshot has no collected value to
	 * protect, and leaving it out does not preserve the old look — it
	 * hands that name to whatever the palette declares, which is the
	 * brand. `--os-tabs-bg-unfocused` is the case that proved it: the
	 * strip Legacy paints `#f6f7f7` came back Void on every unfocused
	 * window, because the palette declared a name Legacy could not
	 * have known to answer. See `test_no_brand_value_reaches_legacy`.
	 *
	 * So the count below rises when the token surface grows, and the
	 * per-token assertions are what actually hold the line: those
	 * values are the snapshot and they do not move.
	 */
	public function test_the_snapshot_is_frozen() {
		$tokens = $this->manifest()['tokens'];
		$why    = 'Legacy is a frozen snapshot — mint a new theme instead of moving it.';

		$this->assertCount( 469, $tokens, $why );
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
	 * Every token the palette declares, Legacy answers.
	 *
	 * This is the guard for the whole class of bug, and it is worth
	 * being precise about why a `var()` fallback does not cover it.
	 *
	 * A consuming rule reads `var( --os-tabs-bg-unfocused, var(
	 * --os-tabs-bg, … ) )`, and the palette's own comment promises
	 * that a theme naming only `--os-tabs-bg` "resolves through it in
	 * both states". It does not. A `var()` fallback fires only when
	 * the name is **undeclared**, and `variables.css` declares it on
	 * `body.os-active`. A theme compiles onto
	 * `body.os-desktop-theme-<slug>`; a name it omits is not undeclared,
	 * it is inherited from the palette. The fallback never runs and
	 * the theme's base colour is bypassed.
	 *
	 * So every palette token is a token a theme MUST answer, and a new
	 * one added to `variables.css` without a Legacy entry silently
	 * repaints part of Legacy in the brand. That is invisible in
	 * review, invisible in the JS suite, and shows up as a user
	 * reporting that a strip went black.
	 *
	 * The fix when this fails is to add the token to the manifest at
	 * the value its consuming rule's fallback literal resolves to —
	 * which, per the standing rule that those literals stay at the
	 * pre-brand WordPress-admin value, IS the Legacy value.
	 *
	 * **This applies to LITERALS only, and the exclusion is the more
	 * important half of the rule.** Where the palette declares a token
	 * by computing it from another token —
	 *
	 *     --os-ui-tab-wash: linear-gradient( 90deg,
	 *         color-mix( in srgb, var( --os-ui-accent-dim ) 16%, … ) );
	 *
	 * — that declaration is not a colour Legacy needs to answer. It is
	 * a *rule* that already resolves correctly under Legacy, because
	 * the accent it reads is the one Legacy declares. Pinning a literal
	 * over it does not restore anything; it severs the chain, and the
	 * accent picker — which writes `--os-ui-accent` / `-dim` inline on
	 * `<body>` and `.os-shell`, see `applyOsSettings()` — stops
	 * reaching the wash, the bloom, the glows and the rails. The user
	 * picks teal and the selected sidebar row stays WordPress blue.
	 *
	 * So the guard checks only what the palette states outright. A
	 * derivation is a token the palette is already answering on
	 * Legacy's behalf, correctly, for every accent.
	 */
	public function test_legacy_answers_every_palette_literal() {
		$css = file_get_contents( OPENSTATION_DIR . 'assets/css/variables.css' );
		$this->assertIsString( $css, 'The palette stylesheet ships with the plugin.' );

		// Comments carry token names in prose; strip before matching.
		$css = preg_replace( '~/\*.*?\*/~s', '', $css );

		preg_match_all( '/(--os-[a-z0-9-]+)\s*:\s*([^;]+);/', $css, $m, PREG_SET_ORDER );

		$literals = array();
		foreach ( $m as $decl ) {
			// A value naming another custom property is a derivation —
			// it follows whatever Legacy (or the picker) sets upstream,
			// and pinning it would freeze that.
			if ( false !== strpos( $decl[2], 'var(' ) || false !== strpos( $decl[2], 'var (' ) ) {
				continue;
			}
			$literals[ $decl[1] ] = true;
		}

		/*
		 * `--os-ui-accent-dim` is a literal in the palette and still
		 * must not be pinned: the accent picker owns the
		 * accent/accent-dim pair at runtime and REMOVES the inline
		 * `-dim` for the brand's own Pulse, so the palette's
		 * hand-mixed twin can show through. A Legacy answer would
		 * win that removal and split one pick into two colours.
		 * Asserted from the other side in
		 * `test_accent_driven_tokens_are_left_to_derive`.
		 */
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

	/**
	 * The accent picker still reaches everything it drives.
	 *
	 * The counterpart to the test above, and the one that would have
	 * caught the regression it describes. Every token here is declared
	 * by the palette as a function of the accent; Legacy must leave
	 * each alone so a pick propagates. `--os-ui-accent-dim` is in the
	 * list for a subtler reason: `applyOsSettings()` *removes* its
	 * inline value when the pick is the brand's own Pulse, expecting
	 * the palette's hand-mixed twin to show through — a Legacy pin
	 * would answer that with WordPress blue and leave a pink accent
	 * sitting on a blue ambient layer.
	 */
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

	/**
	 * The tab strip is one surface in both focus states.
	 *
	 * The reported symptom: an unfocused window's tab strip came back
	 * near-black on a Legacy desktop, because the palette declares
	 * `--os-tabs-bg-unfocused` (Void) and Legacy — written before that
	 * token existed — answered only `--os-tabs-bg`. Pinned here
	 * because the pair is the case that makes the general rule above
	 * concrete, and because a strip that disagrees with itself across
	 * focus is exactly what Legacy exists to prevent.
	 */
	public function test_legacy_tab_strip_holds_one_colour_across_focus() {
		$tokens = $this->manifest()['tokens'];

		$this->assertSame( '#f6f7f7', $tokens['--os-tabs-bg'] );
		$this->assertSame(
			$tokens['--os-tabs-bg'],
			$tokens['--os-tabs-bg-unfocused'],
			'Legacy names one strip colour; both focus states wear it.'
		);
		// The mesh crown and the frosted face are brand-era layers
		// with no pre-brand counterpart — off, not recoloured. Both
		// are `background-image` over `--os-tabs-active-bg`, so `none`
		// costs a decoration and nothing else.
		$this->assertSame( 'none', $tokens['--os-tabs-active-crown'] );
		$this->assertSame( 'none', $tokens['--os-tabs-active-frost'] );
		// The rail is NOT one of those: it traces the active tab in
		// the accent, so it is left to derive and follows the picker.
		$this->assertArrayNotHasKey( '--os-tabs-rail', $tokens );
	}

	/**
	 * Switching a brand layer off means `none` for an OVERLAY, never
	 * for a surface that carries state.
	 *
	 * Legacy drops the iridescence, and for a `::before` film or a
	 * `::after` stroke that is simply `none` — the control keeps the
	 * background it already had and loses a decoration. The tokens
	 * below are not that. Each is the fill of an element whose CSS
	 * sets `background-color: transparent` (or nothing at all) and
	 * paints the state entirely through this one image:
	 *
	 *   - `--os-ui-holo-fill` is the surface of `<os-button
	 *     variant="holo">` and `<os-switch>`. `none` renders them
	 *     invisible, not flat.
	 *   - `--os-tabs-active-bg` is the active tab's plate, and the
	 *     joint that fillets it into the page reads the same token.
	 *
	 * The selected settings row went the same way — `--os-ui-tab-wash`
	 * and `-bloom` answered with `none` left a sidebar with no
	 * selection at all. Those are not asserted here: they derive from
	 * the accent, so the fix was to stop answering them entirely. See
	 * `test_accent_driven_tokens_are_left_to_derive`, which is the
	 * form this guard takes for anything the picker drives.
	 *
	 * The distinction is "is this token the surface, or over it?", and
	 * it is not visible from the token's name. Check the consuming
	 * rule before answering one with `none`.
	 */
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

	/**
	 * No brand colour reaches a Legacy surface.
	 *
	 * Legacy is the pre-brand look, so none of the brand's own hexes
	 * belong in it. Worth asserting separately from the values above:
	 * a token added at its consuming rule's fallback is only correct
	 * if that fallback was itself kept at the pre-brand value, and
	 * several had already drifted to the brand palette by the time
	 * this sweep ran.
	 */
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

	/**
	 * @covers ::openstation_desktop_theme_compile_css
	 */
	public function test_compiled_css_declares_every_token() {
		$entry = openstation_desktop_theme_registry( self::SLUG );
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
	 * what puts the "Apply Desktop Mode (Legacy)'s recommended layout
	 * and effects" button on the card.
	 *
	 * @covers ::openstation_sanitize_desktop_theme_recommended_os_settings
	 */
	public function test_legacy_recommends_the_wordpress_blue_accent() {
		$raw = $this->manifest();
		$this->assertSame( 2, $raw['manifestVersion'], 'v2 declares a recommendation block.' );
		$this->assertSame( 'wp-blue', $raw['recommendedOsSettings']['accent'] );

		// Survives the sanitizer's allow-list, which is the part that
		// would silently drop it if `accent` left the schema.
		$entry = openstation_desktop_theme_registry( self::SLUG );
		$this->assertSame(
			'wp-blue',
			$entry['manifest']['recommendedOsSettings']['accent'],
			'`accent` is in the recommended-OS-settings schema.'
		);
	}

	/**
	 * @covers ::openstation_desktop_theme_recommended_os_settings_schema
	 */
	public function test_accent_is_a_registry_slug_in_the_schema() {
		$schema = openstation_desktop_theme_recommended_os_settings_schema();

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
	 * @covers ::openstation_legacy_theme_manifest_path
	 */
	public function test_manifest_path_is_filterable() {
		add_filter( 'openstation_legacy_theme_manifest_path', static function () {
			return '/nonexistent/theme.json';
		} );

		$this->assertSame( '/nonexistent/theme.json', openstation_legacy_theme_manifest_path() );
	}
}
