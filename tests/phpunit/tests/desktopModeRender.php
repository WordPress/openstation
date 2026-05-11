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
	 * Cross-page admin-link routing depends on the chromeless bridge
	 * preventing the iframe's natural navigation; the parent shell
	 * decides between same-page in-iframe nav and a fresh window. If
	 * the bridge ever stops calling preventDefault on admin links,
	 * cross-page clicks would trash the source iframe before the
	 * parent could react.
	 *
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_prevents_default_on_admin_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		// Pin the admin-branch shape: the prevent-default must sit
		// inside the `kind === 'admin'` block, paired with the
		// admin-link postMessage. A regression that drops the
		// prevent-default would still emit the message, so we assert
		// both substrings are present.
		$this->assertStringContainsString( "kind === 'admin'", $output );
		$this->assertStringContainsString( 'desktop-mode-iframe-admin-link', $output );
		$this->assertMatchesRegularExpression(
			"/kind === 'admin'.*?e\\.preventDefault\\(\\).*?desktop-mode-iframe-admin-link/s",
			$output
		);
	}

	/**
	 * The capture-phase click handler runs BEFORE wp-admin/js/updates.js's
	 * own bubble-phase handler. If the bridge intercepts and preventDefaults
	 * a click on `.install-now` / `.update-link` / `.delete-plugin` etc.,
	 * core's AJAX install/update/delete flow never starts and the user is
	 * diverted to the no-JS update.php fallback — opened as a freshly
	 * spawned desktop window that takes seconds to load. Pin the skip list
	 * so a future refactor doesn't silently bring the regression back.
	 *
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_skips_wp_core_ajax_update_buttons() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		// Each class WP core's wp-admin/js/updates.js binds an AJAX
		// click handler to. The bridge must early-return on these so
		// updates.js's bubble handler can run.
		$ajax_classes = array(
			'install-now',
			'update-link',
			'update-now',
			'delete-plugin',
			'delete-theme',
			'install-theme',
		);
		foreach ( $ajax_classes as $class ) {
			$this->assertStringContainsString(
				"link.classList.contains( '{$class}' )",
				$output,
				"Bridge must skip clicks on .{$class} so wp-admin/js/updates.js can run."
			);
		}

		// The skip block must sit BEFORE the `kind === 'admin'`
		// branch — otherwise we'd preventDefault before the bail.
		$skip_pos  = strpos( $output, "link.classList.contains( 'install-now' )" );
		$admin_pos = strpos( $output, "kind === 'admin'" );
		$this->assertNotFalse( $skip_pos );
		$this->assertNotFalse( $admin_pos );
		$this->assertLessThan(
			$admin_pos,
			$skip_pos,
			'AJAX-class skip must run before the admin-link prevent-default block.'
		);
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
	 * The bridge script carries the link/form interceptor that keeps
	 * iframe navigations chromeless. If the function isn't actually
	 * hooked to admin_footer, the first click on any /wp-admin/ link
	 * inside an iframe re-renders the full desktop shell inside the
	 * iframe (inception bug). Calling the function directly in the
	 * other tests doesn't prove WordPress will call it — only this
	 * has_action check does.
	 *
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_chromeless_bridge_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'desktop_mode_chromeless_bridge_script' )
		);
	}

	/**
	 * @covers ::desktop_mode_chromeless_offset_neutralizer_script
	 */
	public function test_chromeless_offset_neutralizer_is_wired_on_admin_head() {
		$this->assertNotFalse(
			has_action( 'admin_head', 'desktop_mode_chromeless_offset_neutralizer_script' )
		);
	}

	/**
	 * The hidden refresh-probe iframe `wp.desktop.refreshMenu()` spawns
	 * lands on `admin.php?desktop_mode_chromeless=1&desktop_mode_menu_refresh=1`,
	 * which Core doesn't fire `admin_footer` for — so the
	 * admin-footer-hosted bridge never emits its payload. The
	 * `admin_init @ 99` handler short-circuits that request with the
	 * payload script directly. Catching the priority here so a refactor
	 * can't silently move it earlier than `wp-admin/menu.php` (which
	 * populates `$menu`).
	 *
	 * @covers ::desktop_mode_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_is_wired_on_admin_init() {
		$this->assertSame(
			99,
			has_action( 'admin_init', 'desktop_mode_emit_menu_refresh_probe' )
		);
	}

	/**
	 * Guard: when the refresh-probe flag isn't on the request, the
	 * handler must be a silent no-op so it doesn't slip into normal
	 * admin page loads.
	 *
	 * @covers ::desktop_mode_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_when_flag_missing() {
		unset( $_GET['desktop_mode_menu_refresh'] );

		ob_start();
		desktop_mode_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Guard: chromeless gate. A request with the flag but no
	 * `desktop_mode_chromeless=1` (and no Sec-Fetch fallback) must NOT
	 * emit the payload — the flag alone is forgeable from any tab.
	 *
	 * @covers ::desktop_mode_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_without_chromeless() {
		unset( $_GET['desktop_mode_chromeless'] );
		$_GET['desktop_mode_menu_refresh'] = '1';

		ob_start();
		desktop_mode_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );

		unset( $_GET['desktop_mode_menu_refresh'] );
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
