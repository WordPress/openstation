<?php
/**
 * Tests for the rendering helpers: body classes, shell injection,
 * chromeless bridge script, and the admin-bar suppression that
 * replaces the core is_admin_bar_showing() short-circuit.
 *
 * @package WPDesktopMode
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_Render extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( 'dashboard' );
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['desktop_mode_chromeless'], $_GET[ DESKTOP_MODE_CLASSIC_FLAG ] );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_body_class_unchanged_when_mode_off() {
		$this->assertSame( 'foo', desktop_mode_admin_body_classes( 'foo' ) );
	}

	/**
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_body_class_adds_active_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertStringContainsString( 'desktop-mode-active', desktop_mode_admin_body_classes( '' ) );
	}

	/**
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_body_class_adds_chromeless_when_iframed() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
		$this->assertStringContainsString( 'desktop-mode-chromeless', desktop_mode_admin_body_classes( '' ) );
	}

	/**
	 * Per-request classic override must suppress the `desktop-mode-active`
	 * body class so the classic admin chrome isn't hidden in the detached
	 * tab — even when the user's account still has desktop mode enabled.
	 *
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_body_class_omits_active_when_classic_flag_present() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';

		$classes = desktop_mode_admin_body_classes( 'foo' );

		$this->assertSame( 'foo', $classes );
		$this->assertStringNotContainsString( 'desktop-mode-active', $classes );
	}

	/**
	 * Classic override must not short-circuit chromeless tagging —
	 * defense in depth in case both flags land on the same request.
	 *
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_classic_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless']              = '1';
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';

		$classes = desktop_mode_admin_body_classes( '' );

		$this->assertStringContainsString( 'desktop-mode-chromeless', $classes );
		$this->assertStringNotContainsString( 'desktop-mode-active', $classes );
	}

	/**
	 * Chromeless wins over active — inside an iframe we want the
	 * chromeless class, never the shell class.
	 *
	 * @covers ::desktop_mode_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_active() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';
		$classes            = desktop_mode_admin_body_classes( '' );

		$this->assertStringContainsString( 'desktop-mode-chromeless', $classes );
		$this->assertStringNotContainsString( 'desktop-mode-active', $classes );
	}

	/**
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_render_shell_emits_nothing_when_mode_off() {
		ob_start();
		desktop_mode_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_render_shell_emits_nothing_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		ob_start();
		desktop_mode_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Per-request classic override must skip shell injection even with
	 * desktop mode enabled on the account — otherwise the detached tab
	 * would render both the classic chrome and the floating shell.
	 *
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_render_shell_emits_nothing_on_classic_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';

		ob_start();
		desktop_mode_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_render_shell_emits_markup_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		desktop_mode_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'desktop-mode-shell', $output );
		$this->assertStringContainsString( 'desktop-mode-dock', $output );
		$this->assertStringContainsString( 'desktop-mode-area', $output );
	}

	/**
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_shell_before_and_after_actions_fire() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$order = array();
		add_action(
			'desktop_mode_shell_before',
			function () use ( &$order ) {
				$order[] = 'before';
			}
		);
		add_action(
			'desktop_mode_shell_after',
			function () use ( &$order ) {
				$order[] = 'after';
			}
		);

		ob_start();
		desktop_mode_render_shell();
		ob_end_clean();

		$this->assertSame( array( 'before', 'after' ), $order );

		remove_all_actions( 'desktop_mode_shell_before' );
		remove_all_actions( 'desktop_mode_shell_after' );
	}

	/**
	 * @covers ::desktop_mode_render_shell
	 */
	public function test_render_shell_is_wired_to_in_admin_header() {
		$this->assertSame(
			5,
			has_action( 'in_admin_header', 'desktop_mode_render_shell' )
		);
	}

	/**
	 * The classic `wp_admin_bar_render` action must be detached inside
	 * chromeless iframes — the filter alone can't stop it because
	 * `is_admin_bar_showing()` returns true unconditionally in admin.
	 *
	 * @covers ::desktop_mode_chromeless_suppress_admin_bar
	 */
	public function test_chromeless_detaches_admin_bar_render_action() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		desktop_mode_chromeless_suppress_admin_bar();

		$this->assertFalse( has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
	}

	/**
	 * @covers ::desktop_mode_chromeless_suppress_admin_bar
	 */
	public function test_non_chromeless_leaves_admin_bar_render_wired() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		desktop_mode_chromeless_suppress_admin_bar();

		$this->assertSame( 0, has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
	}

	/**
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_nothing_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_postmessage_glue_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'desktop-mode-screen-meta', $output );
		$this->assertStringContainsString( 'postMessage', $output );
	}

	/**
	 * Link interceptor must be inside the bridge script so stray clicks on
	 * `<a href="/wp-admin/...">` don't kick the iframe out of chromeless mode.
	 *
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_link_interceptor_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		$this->assertStringContainsString( "'desktop_mode_chromeless'", $output );
	}

	/**
	 * @covers ::desktop_mode_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_nothing_without_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		desktop_mode_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::desktop_mode_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_script_when_flag_present() {
		$_GET[ DESKTOP_MODE_CLASSIC_FLAG ] = '1';

		ob_start();
		desktop_mode_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertStringContainsString( '<script>', $output );
		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		// The rewritten URL must carry the same flag the server checks for.
		$this->assertStringContainsString( '"' . DESKTOP_MODE_CLASSIC_FLAG . '"', $output );
	}

	/**
	 * The interceptor is what keeps the detached tab classic across
	 * navigations. It must be wired on admin_footer or the first click
	 * would escape back into the desktop shell.
	 *
	 * @covers ::desktop_mode_classic_link_interceptor
	 */
	public function test_classic_interceptor_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'desktop_mode_classic_link_interceptor' )
		);
	}

	/**
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_chromeless_after_action_fires_in_iframes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		$fired = false;
		add_action(
			'desktop_mode_chromeless_after',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		ob_start();
		desktop_mode_chromeless_bridge_script();
		ob_end_clean();

		$this->assertTrue( $fired );
		remove_all_actions( 'desktop_mode_chromeless_after' );
	}
}
