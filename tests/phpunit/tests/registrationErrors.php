<?php
/**
 * Tests for the `WP_Error` return contract on desktop-mode
 * registration functions.
 *
 * Every `desktop_mode_register_*()` function returns `true` on success
 * and a `WP_Error` on failure. The `WP_Error` carries a stable code
 * (documented in `docs/hooks-reference.md`) so plugin authors can
 * branch on why their registration was rejected.
 *
 * Also verifies backwards compatibility: legacy `if ( $result )`
 * truthy-checks still work because `WP_Error` is an object (truthy).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-registration-errors
 */
class Tests_DesktopMode_RegistrationErrors extends WP_UnitTestCase {

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

	private function valid_window_args( array $overrides = array() ) {
		return array_merge(
			array(
				'title'    => 'Test Window',
				'icon'     => 'dashicons-admin-generic',
				'template' => static function () {
					echo '<p>body</p>';
				},
				'script'   => 'test-handle',
			),
			$overrides
		);
	}

	private function valid_widget_args( array $overrides = array() ) {
		return array_merge(
			array(
				'label'       => 'Test Widget',
				'description' => 'desc',
				'icon'        => 'dashicons-admin-generic',
				'script'      => 'test-handle',
			),
			$overrides
		);
	}

	private function valid_wallpaper_args( array $overrides = array() ) {
		return array_merge(
			array(
				'label'   => 'Test Wallpaper',
				'preview' => '#ffffff',
				'type'    => 'canvas',
				'script'  => 'test-handle',
			),
			$overrides
		);
	}

	// --------------------------------------------------------------
	// Native windows
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_missing_id_returns_wp_error() {
		$result = desktop_mode_register_window( '', $this->valid_window_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_missing_title_returns_wp_error() {
		$result = desktop_mode_register_window(
			'no-title',
			$this->valid_window_args( array( 'title' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_title', $result->get_error_code() );
	}

	/**
	 * Native windows can register without a `script` handle — the
	 * cloned template IS the window for declarative-only plugins.
	 *
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_without_script_registers() {
		$result = desktop_mode_register_window(
			'declarative-only',
			$this->valid_window_args( array( 'script' => '' ) )
		);

		$this->assertTrue( $result );
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_non_callable_template_returns_wp_error() {
		$result = desktop_mode_register_window(
			'bad-template',
			$this->valid_window_args( array( 'template' => 'not a callable' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_invalid_template', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = desktop_mode_register_window(
			'cap-gated',
			$this->valid_window_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_capability_denied', $result->get_error_code() );
		$this->assertSame( 'manage_options', $result->get_error_data()['capability'] );
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_window_success_returns_true() {
		$result = desktop_mode_register_window( 'ok-window', $this->valid_window_args() );

		$this->assertTrue( $result );
		$this->assertNotNull( desktop_mode_native_window_registry( 'ok-window' ) );
	}

	// --------------------------------------------------------------
	// Widgets
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_missing_id_returns_wp_error() {
		$result = desktop_mode_register_widget( '', $this->valid_widget_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_missing_label_returns_wp_error() {
		$result = desktop_mode_register_widget(
			'no-label',
			$this->valid_widget_args( array( 'label' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = desktop_mode_register_widget(
			'cap-gated',
			$this->valid_widget_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_success_returns_true() {
		$result = desktop_mode_register_widget( 'ok-widget', $this->valid_widget_args() );

		$this->assertTrue( $result );
	}

	// --------------------------------------------------------------
	// Wallpapers
	// --------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_missing_id_returns_wp_error() {
		$result = desktop_mode_register_wallpaper( '', $this->valid_wallpaper_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_missing_label_returns_wp_error() {
		$result = desktop_mode_register_wallpaper(
			'no-label',
			$this->valid_wallpaper_args( array( 'label' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_label', $result->get_error_code() );
	}

	/**
	 * Canvas wallpapers must declare a script — the JS def (with its
	 * `mount` callback) lives on `window.wpDesktopWallpapers[ id ]`,
	 * published by that script. CSS wallpapers can omit it.
	 *
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_canvas_missing_script_returns_wp_error() {
		$result = desktop_mode_register_wallpaper(
			'no-script',
			$this->valid_wallpaper_args( array( 'type' => 'canvas', 'script' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_script', $result->get_error_code() );
	}

	/**
	 * CSS wallpapers don't need a JS script because the shell can
	 * render the gradient/color from `preview` alone. Registering
	 * without `script` should succeed.
	 *
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_css_without_script_succeeds() {
		$result = desktop_mode_register_wallpaper(
			'css-only',
			array(
				'label'   => 'CSS only',
				'preview' => '#000000',
				'type'    => 'css',
			)
		);

		$this->assertTrue( $result );
	}

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = desktop_mode_register_wallpaper(
			'cap-gated',
			$this->valid_wallpaper_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_success_returns_true() {
		$result = desktop_mode_register_wallpaper( 'ok-wallpaper', $this->valid_wallpaper_args() );

		$this->assertTrue( $result );
	}

	// --------------------------------------------------------------
	// Backwards-compatibility guarantee
	// --------------------------------------------------------------

	/**
	 * Legacy callers wrote `if ( desktop_mode_register_window( ... ) )`
	 * to guard against the old silent `false` return. `WP_Error` is
	 * an object (truthy), so the legacy `if` branch is still reached
	 * on failure — but the branch body now runs even though the
	 * registration didn't succeed. That's a behavior shift by design:
	 * failed registrations used to silently disappear, and any code
	 * that cared enough to write the if-check should now see the
	 * error. Plugin authors updating to the new contract should use
	 * `is_wp_error()` for the actual success branch.
	 *
	 * @covers ::desktop_mode_register_window
	 * @covers ::desktop_mode_register_widget
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wp_error_return_is_truthy_for_legacy_callers() {
		$w = desktop_mode_register_window( '', $this->valid_window_args() );
		$g = desktop_mode_register_widget( '', $this->valid_widget_args() );
		$p = desktop_mode_register_wallpaper( '', $this->valid_wallpaper_args() );

		// Objects are always truthy — legacy `if ( $r )` guards still
		// reach their body when a new WP_Error comes back.
		$this->assertTrue( (bool) $w );
		$this->assertTrue( (bool) $g );
		$this->assertTrue( (bool) $p );

		// And new-style checks cleanly distinguish the two states.
		$this->assertTrue( is_wp_error( $w ) );
		$this->assertTrue( is_wp_error( $g ) );
		$this->assertTrue( is_wp_error( $p ) );
	}
}
