<?php
/**
 * Tests for the in-page `.page-title-action` de-duplication that runs
 * inside chromeless iframes.
 *
 * The interesting assertions here are the negative ones. Hiding a
 * button that duplicates a window tab is cosmetic; hiding one that
 * doesn't takes away the only route to a page (the Upload Plugin
 * regression these tests were written for).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::openstation_chromeless_submenu_tab_urls
 * @covers ::openstation_chromeless_title_action_css
 * @covers ::openstation_chromeless_css_attr_value
 */
class Tests_OpenStation_ChromelessTitleActions extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );

		// On multisite a plain administrator lacks the super-admin-only
		// capabilities these tests exercise (update_core, edit_users,
		// activate_plugins and friends). The admin fixture means "the
		// fully-capable admin", which multisite spells super admin.
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		unset( $GLOBALS['parent_file'] );
		unset( $GLOBALS['submenu'] );
		parent::tear_down();
	}

	/**
	 * Installs a `$submenu` fixture for one parent menu.
	 *
	 * @param string  $parent Parent menu slug.
	 * @param array[] $items  Raw `$submenu` rows: [ title, cap, slug ].
	 */
	private function set_menu( $parent, array $items ) {
		$GLOBALS['parent_file']      = $parent;
		$GLOBALS['submenu']          = array();
		$GLOBALS['submenu'][ $parent ] = $items;
	}

	/**
	 * Returns the emitted CSS for the current global menu state.
	 */
	private function css() {
		return openstation_chromeless_title_action_css(
			openstation_chromeless_submenu_tab_urls()
		);
	}

	/**
	 * The emitted selectors, parsed.
	 *
	 * The CSS is built entirely from tab URLs, so asserting on the raw
	 * string can only ever say what we put in. What decides whether a
	 * button survives is the `[href]` value plus the operator matching
	 * it, so tests assert on those.
	 *
	 * @return array[] One `{ operator, href }` per selector.
	 */
	private function selectors( $css ) {
		$parsed = array();

		foreach ( explode( ',', trim( strtok( $css, '{' ) ) ) as $selector ) {
			if ( preg_match( '/\[href([~^$*|]?=)"(.*)"\]/', trim( $selector ), $match ) ) {
				$parsed[] = array(
					'operator' => $match[1],
					'href'     => $match[2],
				);
			}
		}

		return $parsed;
	}

	/**
	 * The set of hrefs a rendered button would have to carry to be
	 * hidden. Only meaningful alongside an operator assertion: with
	 * `=` this is exactly the hidden set, with `^=` or `*=` it isn't.
	 */
	private function hidden_hrefs( $css ) {
		return wp_list_pluck( $this->selectors( $css ), 'href' );
	}

	/**
	 * Posts: the "Add New Post" button and the "Add New Post" tab
	 * resolve to the same URL, so the button is the redundant copy.
	 */
	public function test_hides_button_matching_a_submenu_tab() {
		$this->set_menu(
			'edit.php',
			array(
				array( 'All Posts', 'edit_posts', 'edit.php' ),
				array( 'Add New Post', 'edit_posts', 'post-new.php' ),
			)
		);

		$css = $this->css();

		$this->assertStringContainsString(
			'.page-title-action[href="' . admin_url( 'post-new.php' ) . '"]',
			$css
		);
	}

	/**
	 * Both spellings, because CSS attribute selectors compare the
	 * attribute as authored: core writes the absolute URL, plenty of
	 * plugins hand-write the admin-relative one.
	 */
	public function test_emits_absolute_and_relative_selectors() {
		$this->set_menu(
			'edit.php',
			array(
				array( 'Add New Post', 'edit_posts', 'post-new.php?post_type=page' ),
			)
		);

		$css = $this->css();

		$this->assertStringContainsString(
			'.page-title-action[href="' . admin_url( 'post-new.php?post_type=page' ) . '"]',
			$css
		);
		$this->assertStringContainsString(
			'.page-title-action[href="post-new.php?post_type=page"]',
			$css
		);
	}

	/**
	 * The regression this module exists to prevent.
	 *
	 * On `plugin-install.php` the parent menu is `plugins.php`, whose
	 * tabs include `plugin-install.php` ("Add Plugin"). The in-page
	 * button there is "Upload Plugin", pointing at
	 * `plugin-install.php?tab=upload`: same path, different
	 * destination, no tab of its own. A pathname compare removed it.
	 *
	 * The operator assertion is what makes this bite. The button's
	 * href never appears in the CSS whatever the matching strategy,
	 * so only "every selector matches with `=`" rules out the prefix
	 * and substring operators that would swallow it.
	 */
	public function test_keeps_upload_plugin_button() {
		$this->set_menu(
			'plugins.php',
			array(
				array( 'Installed Plugins', 'activate_plugins', 'plugins.php' ),
				array( 'Add Plugin', 'install_plugins', 'plugin-install.php' ),
				array( 'Plugin File Editor', 'edit_plugins', 'plugin-editor.php' ),
			)
		);

		$css = $this->css();

		$this->assertNotEmpty( $this->selectors( $css ) );
		foreach ( $this->selectors( $css ) as $selector ) {
			$this->assertSame(
				'=',
				$selector['operator'],
				'A prefix or substring match on href would hide Upload Plugin.'
			);
		}

		$hidden = $this->hidden_hrefs( $css );

		$this->assertContains( admin_url( 'plugin-install.php' ), $hidden );
		$this->assertNotContains( admin_url( 'plugin-install.php?tab=upload' ), $hidden );
		$this->assertNotContains( 'plugin-install.php?tab=upload', $hidden );
	}

	/**
	 * WooCommerce Orders: "Add order" carries `action=new`, the tab
	 * doesn't. Same page, different destination, button stays.
	 */
	public function test_keeps_button_whose_query_differs_from_the_tab() {
		$this->set_menu(
			'woocommerce',
			array(
				array( 'Orders', 'manage_options', 'wc-orders' ),
			)
		);

		$hidden = $this->hidden_hrefs( $this->css() );

		$this->assertContains( admin_url( 'admin.php?page=wc-orders' ), $hidden );
		$this->assertNotContains( admin_url( 'admin.php?page=wc-orders&action=new' ), $hidden );
	}

	/**
	 * A row with no usable title is dropped from the tab strip by
	 * `openstation_build_dock_items()` (WooCommerce's `wc-addons`
	 * registers `menu_title => null`). If it still produced a hide
	 * rule, the button would go with no tab taking its place.
	 */
	public function test_skips_tabs_with_no_title() {
		$this->set_menu(
			'plugins.php',
			array(
				array( 'Add Plugin', 'manage_options', 'plugin-install.php' ),
				array( null, 'manage_options', 'admin.php?page=hidden-row' ),
				array( '<span class="update-count">3</span>', 'manage_options', 'admin.php?page=badge-only' ),
			)
		);

		$hidden = $this->hidden_hrefs( $this->css() );

		$this->assertContains( admin_url( 'plugin-install.php' ), $hidden );
		$this->assertNotContains( admin_url( 'admin.php?page=hidden-row' ), $hidden );
		$this->assertNotContains( admin_url( 'admin.php?page=badge-only' ), $hidden );
	}

	/**
	 * The de-duplication reads `href` as "where this button goes".
	 * On core's in-page toggles it isn't — an in-page script
	 * preventDefaults the click and the href is only the no-JS
	 * fallback, so those anchors have to be excluded by class.
	 *
	 * Concretely: on `plugin-install.php?tab=upload` the "Browse
	 * Plugins" toggle points at `plugin-install.php`, byte-identical
	 * to the Add Plugin tab. Hiding it left no way back to the cards.
	 */
	public function test_excludes_in_page_toggles_from_every_selector() {
		$this->set_menu(
			'plugins.php',
			array(
				array( 'Add Plugin', 'install_plugins', 'plugin-install.php' ),
			)
		);

		$css = $this->css();

		foreach ( explode( ',', trim( strtok( $css, '{' ) ) ) as $selector ) {
			$this->assertStringContainsString( ':not( .upload-view-toggle )', $selector );
			$this->assertStringContainsString( ':not( .aria-button-if-js )', $selector );
		}
	}

	/**
	 * A plugin screen with no submenu strip has no tabs to duplicate,
	 * so it must contribute no rules at all — this is what keeps the
	 * add-new affordance on pages that only have the button.
	 */
	public function test_no_css_without_a_submenu_strip() {
		$GLOBALS['parent_file'] = 'my-standalone-plugin';
		$GLOBALS['submenu']     = array();

		$this->assertSame( array(), openstation_chromeless_submenu_tab_urls() );
		$this->assertSame( '', $this->css() );
	}

	/**
	 * Plugin screens reach `admin_enqueue_scripts` before core has
	 * resolved `$parent_file`. No parent means no rules, which is the
	 * safe answer rather than a broken one.
	 */
	public function test_no_css_without_a_parent_file() {
		unset( $GLOBALS['parent_file'] );
		$GLOBALS['submenu'] = array(
			'edit.php' => array( array( 'Add New Post', 'edit_posts', 'post-new.php' ) ),
		);

		$this->assertSame( array(), openstation_chromeless_submenu_tab_urls() );
	}

	/**
	 * A tab the user can't see isn't a duplicate of anything — the
	 * capability check has to match the one the dock builder runs.
	 */
	public function test_skips_tabs_the_current_user_cannot_access() {
		wp_set_current_user( self::$subscriber_id );

		$this->set_menu(
			'edit.php',
			array(
				array( 'Add New Post', 'publish_posts', 'post-new.php' ),
			)
		);

		$this->assertSame( array(), openstation_chromeless_submenu_tab_urls() );
	}

	/**
	 * A plugin-authored menu slug is the one part of these selectors
	 * we don't control, so it must not be able to close the `<style>`
	 * element it lands in.
	 */
	public function test_escapes_css_string_delimiters() {
		$escaped = openstation_chromeless_css_attr_value( 'admin.php?page=a"b</style>c\\d' );

		$this->assertStringNotContainsString( '<', $escaped );
		$this->assertStringNotContainsString( '>', $escaped );
		$this->assertStringContainsString( '\\"b', $escaped );
		$this->assertStringContainsString( '\\\\d', $escaped );
		// Every remaining quote is escaped, so none can end the value.
		$this->assertSame( 0, preg_match( '/(?<!\\\\)"/', $escaped ) );
	}

	/**
	 * The rules only make sense against the chromeless body class —
	 * they'd hide buttons in classic admin otherwise.
	 */
	public function test_rules_are_scoped_to_the_chromeless_body_class() {
		$this->set_menu(
			'edit.php',
			array( array( 'Add New Post', 'edit_posts', 'post-new.php' ) )
		);

		foreach ( explode( ',', trim( strtok( $this->css(), '{' ) ) ) as $selector ) {
			$this->assertStringStartsWith( '.os-chromeless ', trim( $selector ) );
		}
	}

	/**
	 * The styles hook onto the chromeless stylesheet and nothing else,
	 * so a classic admin load can never pick them up.
	 */
	public function test_styles_are_wired_to_the_chromeless_styles_action() {
		$this->assertNotFalse(
			has_action(
				'openstation_chromeless_styles',
				'openstation_chromeless_title_action_styles'
			)
		);
	}
}
