<?php
/**
 * Tests for `openstation_register_window_tab()` — the API that lets
 * plugins attach extra tabs to a native window, mirroring how
 * submenu registrations auto-become tabs on legacy iframe windows.
 *
 * Covers registration validation, cross-plugin extension,
 * `main_tab_label` defaults, the `openstation_window_tabs` filter,
 * tab-aware template-HTML generation, and per-tab script enqueue.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-window-tabs
 */
class Tests_OpenStation_WindowTabs extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_actions( 'openstation_window_tab_registered' );
		remove_all_filters( 'openstation_window_tabs' );
		parent::tear_down();
	}

	private function register_demo_window( $id = 'demo' ) {
		$args = array(
			'title'    => 'Demo',
			'script'   => 'demo-script',
			'template' => static function () {
				echo '<p class="main">MAIN</p>';
			},
		);
		$this->assertTrue( openstation_register_window( $id, $args ) );
	}

	// --------------------------------------------------------------
	// Registration validation
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_success_on_well_formed_args() {
		$this->register_demo_window( 'demo-ok' );

		$result = openstation_register_window_tab( 'demo-ok', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {
				echo '<p>about body</p>';
			},
		) );

		$this->assertTrue( $result );
		$entry = openstation_desktop_window_tab_registry( 'demo-ok', 'about' );
		$this->assertSame( 'About', $entry['label'] );
		$this->assertIsCallable( $entry['template'] );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_missing_window_id_returns_wp_error() {
		$result = openstation_register_window_tab( '', array(
			'value'    => 'x',
			'label'    => 'X',
			'template' => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_window_id', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_missing_tab_value_returns_wp_error() {
		$this->register_demo_window( 'demo-missing-value' );

		$result = openstation_register_window_tab( 'demo-missing-value', array(
			'label'    => 'X',
			'template' => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_tab_value', $result->get_error_code() );
	}

	/**
	 * The reserved `main` value can't be used as a tab id — that's
	 * how the shell keys the window's own template tab.
	 *
	 * @covers ::openstation_register_window_tab
	 */
	public function test_reserved_value_main_returns_wp_error() {
		$this->register_demo_window( 'demo-reserved' );

		$result = openstation_register_window_tab( 'demo-reserved', array(
			'value'    => 'main',
			'label'    => 'X',
			'template' => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_reserved_tab_value', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_missing_label_returns_wp_error() {
		$this->register_demo_window( 'demo-no-label' );

		$result = openstation_register_window_tab( 'demo-no-label', array(
			'value'    => 'about',
			'template' => static function () {},
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_non_callable_template_returns_wp_error() {
		$this->register_demo_window( 'demo-bad-template' );

		$result = openstation_register_window_tab( 'demo-bad-template', array(
			'value'    => 'x',
			'label'    => 'X',
			'template' => 'not callable',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_invalid_template', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_capability_gate_denies_subscriber() {
		$this->register_demo_window( 'demo-cap' );
		wp_set_current_user( self::$subscriber_id );

		$result = openstation_register_window_tab( 'demo-cap', array(
			'value'        => 'x',
			'label'        => 'X',
			'template'     => static function () {},
			'capabilities' => array( 'manage_options' ),
		) );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
	}

	// --------------------------------------------------------------
	// Tab listing, ordering, and filter
	// --------------------------------------------------------------

	/**
	 * `openstation_get_native_window_tabs()` always returns the main tab
	 * first, then additional tabs in `position` order.
	 *
	 * @covers ::openstation_get_native_window_tabs
	 */
	public function test_tabs_are_sorted_with_main_first() {
		$this->register_demo_window( 'demo-order' );
		openstation_register_window_tab( 'demo-order', array(
			'value'    => 'z',
			'label'    => 'Z',
			'template' => static function () {},
			'position' => 30,
		) );
		openstation_register_window_tab( 'demo-order', array(
			'value'    => 'a',
			'label'    => 'A',
			'template' => static function () {},
			'position' => 10,
		) );

		$tabs = openstation_get_native_window_tabs( 'demo-order' );
		$values = wp_list_pluck( $tabs, 'value' );

		$this->assertSame( array( 'main', 'a', 'z' ), $values );
		$this->assertTrue( $tabs[0]['is_main'] );
		$this->assertFalse( $tabs[1]['is_main'] );
	}

	/**
	 * Main tab label falls back to the window title when
	 * `main_tab_label` isn't provided.
	 *
	 * @covers ::openstation_get_native_window_tabs
	 */
	public function test_main_tab_label_defaults_to_title() {
		openstation_register_window( 'demo-default-label', array(
			'title'    => 'Shortcuts',
			'script'   => 'x',
			'template' => static function () {},
		) );

		$tabs = openstation_get_native_window_tabs( 'demo-default-label' );
		$this->assertSame( 'Shortcuts', $tabs[0]['label'] );
	}

	/**
	 * Explicit `main_tab_label` overrides the title fallback.
	 *
	 * @covers ::openstation_get_native_window_tabs
	 */
	public function test_main_tab_label_honours_window_registration() {
		openstation_register_window( 'demo-explicit-label', array(
			'title'          => 'Jorvy',
			'main_tab_label' => 'Quotes',
			'script'         => 'x',
			'template'       => static function () {},
		) );

		$tabs = openstation_get_native_window_tabs( 'demo-explicit-label' );
		$this->assertSame( 'Quotes', $tabs[0]['label'] );
	}

	/**
	 * `openstation_window_tabs` filter lets late-loading plugins
	 * reorder, hide, or relabel tabs the window owner registered.
	 *
	 * @covers ::openstation_get_native_window_tabs
	 */
	public function test_filter_can_reorder_tabs() {
		$this->register_demo_window( 'demo-filter' );
		openstation_register_window_tab( 'demo-filter', array(
			'value'    => 'first',
			'label'    => 'First',
			'template' => static function () {},
		) );
		openstation_register_window_tab( 'demo-filter', array(
			'value'    => 'second',
			'label'    => 'Second',
			'template' => static function () {},
		) );

		add_filter( 'openstation_window_tabs', static function ( $tabs ) {
			// Reverse the non-main tabs.
			$main   = array_shift( $tabs );
			$extras = array_reverse( $tabs );
			return array_merge( array( $main ), $extras );
		} );

		$values = wp_list_pluck(
			openstation_get_native_window_tabs( 'demo-filter' ),
			'value'
		);
		$this->assertSame( array( 'main', 'second', 'first' ), $values );
	}

	// --------------------------------------------------------------
	// Cross-plugin extension
	// --------------------------------------------------------------

	/**
	 * A second "plugin" registering a tab on someone else's window
	 * should succeed and appear in the tab list alongside the
	 * original author's tabs.
	 *
	 * @covers ::openstation_register_window_tab
	 */
	public function test_cross_plugin_tab_addition() {
		$this->register_demo_window( 'demo-xplugin' );

		// "Plugin A" registers its own tab.
		openstation_register_window_tab( 'demo-xplugin', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );
		// "Plugin B" attaches to the same window.
		openstation_register_window_tab( 'demo-xplugin', array(
			'value'    => 'stats',
			'label'    => 'Stats',
			'template' => static function () {},
		) );

		$values = wp_list_pluck(
			openstation_get_native_window_tabs( 'demo-xplugin' ),
			'value'
		);
		$this->assertContains( 'about', $values );
		$this->assertContains( 'stats', $values );
	}

	// --------------------------------------------------------------
	// Template HTML wrapping
	// --------------------------------------------------------------

	/**
	 * Single-pane windows (no additional tabs) render the plugin's
	 * template markup directly — the backwards-compatible fast path.
	 *
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_template_html_without_tabs_is_flat() {
		$this->register_demo_window( 'demo-flat' );

		$entry = openstation_native_window_registry( 'demo-flat' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( '<p class="main">MAIN</p>', $html );
		$this->assertStringNotContainsString( '<os-tabs', $html );
		$this->assertStringNotContainsString( '<os-tabpanel', $html );
	}

	/**
	 * Once at least one additional tab is registered the shell
	 * wraps the whole body in `<os-stack>` + `<os-tabs>` +
	 * `<os-tabpanel>`s. Plugin authors never hand-write this
	 * markup.
	 *
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_template_html_wraps_with_tabs_when_extras_exist() {
		$this->register_demo_window( 'demo-wrap' );
		openstation_register_window_tab( 'demo-wrap', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {
				echo '<p class="about">ABOUT</p>';
			},
		) );

		$entry = openstation_native_window_registry( 'demo-wrap' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( '<os-tabs value="main">', $html );
		$this->assertStringContainsString( '<os-tab value="main">', $html );
		$this->assertStringContainsString( '<os-tab value="about">About</os-tab>', $html );
		// Main panel is the active one — no `hidden` attribute.
		$this->assertStringContainsString( '<os-tabpanel for="main">', $html );
		$this->assertStringContainsString( '<p class="main">MAIN</p>', $html );
		// Non-active panel ships with `hidden` so first paint is
		// correct regardless of custom-element upgrade order — see
		// the Phase A DX fix in `openstation_build_native_window_template_html`.
		$this->assertStringContainsString( '<os-tabpanel for="about" hidden>', $html );
		$this->assertStringContainsString( '<p class="about">ABOUT</p>', $html );
	}

	/**
	 * The auto-tab wrap exposes a configurable padding. Default is
	 * 16. Callers opt into edge-to-edge
	 * content by passing `main_tab_padding => 0` when registering
	 * the window — CSS-as-attribute applies the value as an inline
	 * style on the wrap's `<os-stack>`.
	 *
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_tab_wrap_padding_defaults_to_16() {
		$this->register_demo_window( 'demo-wrap-default' );
		openstation_register_window_tab( 'demo-wrap-default', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );

		$entry = openstation_native_window_registry( 'demo-wrap-default' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( 'padding="16"', $html );
		$this->assertStringNotContainsString(
			'style="padding:16px',
			$html,
			'Expected the wrap padding to flow through the attribute path, not inline style.'
		);
	}

	/**
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_tab_wrap_padding_honours_window_registration() {
		openstation_register_window( 'demo-wrap-zero', array(
			'title'            => 'Zero',
			'script'           => 'x',
			'template'         => static function () {},
			'main_tab_padding' => 0,
		) );
		openstation_register_window_tab( 'demo-wrap-zero', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );

		$entry = openstation_native_window_registry( 'demo-wrap-zero' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( 'padding="0"', $html );
	}

	/**
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_tab_wrap_padding_filter_overrides_default() {
		$this->register_demo_window( 'demo-wrap-filter' );
		openstation_register_window_tab( 'demo-wrap-filter', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );

		add_filter( 'openstation_native_window_tab_wrap_padding',
			static function ( $px, $window_id ) {
				return 'demo-wrap-filter' === $window_id ? 24 : $px;
			},
			10,
			2
		);

		$entry = openstation_native_window_registry( 'demo-wrap-filter' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( 'padding="24"', $html );

		remove_all_filters( 'openstation_native_window_tab_wrap_padding' );
	}

	/**
	 * Negative values are clamped to zero to prevent an inline
	 * `padding="-8"` from reaching the DOM.
	 *
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_tab_wrap_padding_clamps_negative_values() {
		openstation_register_window( 'demo-wrap-neg', array(
			'title'            => 'Neg',
			'script'           => 'x',
			'template'         => static function () {},
			'main_tab_padding' => -8,
		) );
		openstation_register_window_tab( 'demo-wrap-neg', array(
			'value'    => 'x',
			'label'    => 'X',
			'template' => static function () {},
		) );

		$entry = openstation_native_window_registry( 'demo-wrap-neg' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringContainsString( 'padding="0"', $html );
		$this->assertStringNotContainsString( 'padding="-', $html );
	}

	/**
	 * Tab labels with special characters are escaped — the shell
	 * emits them into HTML attributes and tag bodies, so a plugin
	 * that passes `<script>` via `label` must not break out.
	 *
	 * @covers ::openstation_build_native_window_template_html
	 */
	public function test_template_html_escapes_tab_labels() {
		$this->register_demo_window( 'demo-escape' );
		openstation_register_window_tab( 'demo-escape', array(
			'value'    => 'x',
			'label'    => '<script>alert(1)</script>',
			'template' => static function () {},
		) );

		$entry = openstation_native_window_registry( 'demo-escape' );
		$html  = openstation_build_native_window_template_html( $entry );

		$this->assertStringNotContainsString( '<script>alert(1)</script>', $html );
		$this->assertStringContainsString( '&lt;script&gt;', $html );
	}

	// --------------------------------------------------------------
	// Action fire
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_registered_action_fires_on_success() {
		$this->register_demo_window( 'demo-action' );
		$calls = array();
		add_action(
			'openstation_window_tab_registered',
			static function ( $window_id, $value, $entry ) use ( &$calls ) {
				$calls[] = compact( 'window_id', 'value', 'entry' );
			},
			10,
			3
		);

		openstation_register_window_tab( 'demo-action', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );

		$this->assertCount( 1, $calls );
		$this->assertSame( 'demo-action', $calls[0]['window_id'] );
		$this->assertSame( 'about', $calls[0]['value'] );
	}

	/**
	 * @covers ::openstation_register_window_tab
	 */
	public function test_registered_action_does_not_fire_on_error() {
		$this->register_demo_window( 'demo-no-fire' );
		$count = 0;
		add_action( 'openstation_window_tab_registered', static function () use ( &$count ) {
			$count++;
		} );

		openstation_register_window_tab( 'demo-no-fire', array(
			// missing label — returns WP_Error.
			'value'    => 'x',
			'template' => static function () {},
		) );

		$this->assertSame( 0, $count );
	}

	// --------------------------------------------------------------
	// Payload integration
	// --------------------------------------------------------------

	/**
	 * The native-windows payload shipped to the shell via
	 * `openStationConfig.nativeWindows` carries a `tabs` descriptor
	 * array so subscribers that want to inspect tabs without
	 * re-parsing the template HTML can do so.
	 *
	 * @covers ::openstation_build_native_windows_payload
	 */
	public function test_payload_includes_tabs_descriptor() {
		$this->register_demo_window( 'demo-payload' );
		openstation_register_window_tab( 'demo-payload', array(
			'value'    => 'about',
			'label'    => 'About',
			'template' => static function () {},
		) );

		$payload = openstation_build_native_windows_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'demo-payload' === $row['id'] ) {
				$entry = $row;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertArrayHasKey( 'tabs', $entry );
		$this->assertCount( 2, $entry['tabs'] );
		$this->assertTrue( $entry['tabs'][0]['isMain'] );
		$this->assertFalse( $entry['tabs'][1]['isMain'] );
	}
}
