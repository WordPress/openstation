<?php
/**
 * Tests for the rendering helpers: body classes, shell injection,
 * chromeless bridge script, and the admin-bar suppression that
 * replaces the core is_admin_bar_showing() short-circuit.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_Render extends WP_UnitTestCase {

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
		delete_user_meta( self::$admin_id, OPEN_STATION_OS_SETTINGS_META_KEY );
		remove_all_filters( 'open_station_admin_bar_mode' );
		unset( $_GET['open_station_chromeless'], $_GET[ OPEN_STATION_CLASSIC_FLAG ] );
		parent::tear_down();
	}

	/**
	 * The admin-bar mode has to ride along on the body class rather
	 * than wait for the shell's JS apply pass — the bar has already
	 * painted by then, so a user who picked `hidden` would see it
	 * flash on every navigation.
	 *
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_carries_default_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertStringContainsString(
			'os-admin-bar-static',
			open_station_admin_body_classes( '' )
		);
	}

	/**
	 * @covers ::open_station_admin_body_classes
	 * @covers ::open_station_get_admin_bar_mode
	 */
	public function test_body_class_reflects_saved_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		open_station_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );

		$classes = open_station_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-admin-bar-dynamic', $classes );
		$this->assertStringNotContainsString( 'os-admin-bar-static', $classes );
	}

	/**
	 * Classic mode is vanilla admin — no shell, and therefore no
	 * business restyling the admin bar.
	 *
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_omits_admin_bar_mode_when_open_station_off() {
		open_station_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );

		$this->assertStringNotContainsString(
			'os-admin-bar-',
			open_station_admin_body_classes( '' )
		);
	}

	/**
	 * @covers ::open_station_get_admin_bar_mode
	 */
	public function test_admin_bar_mode_filter_overrides_the_user_pick() {
		open_station_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );
		add_filter( 'open_station_admin_bar_mode', static fn () => 'static' );

		$this->assertSame( 'static', open_station_get_admin_bar_mode() );
	}

	/**
	 * A filter returning something outside the enum fails closed to
	 * the always-visible mode, never to a class no CSS rule matches.
	 *
	 * @covers ::open_station_get_admin_bar_mode
	 */
	public function test_admin_bar_mode_filter_result_is_validated() {
		open_station_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );
		add_filter( 'open_station_admin_bar_mode', static fn () => 'peekaboo' );

		$this->assertSame( 'static', open_station_get_admin_bar_mode() );
	}

	/**
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_unchanged_when_mode_off() {
		$this->assertSame( 'foo', open_station_admin_body_classes( 'foo' ) );
	}

	/**
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_adds_active_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertStringContainsString( 'os-active', open_station_admin_body_classes( '' ) );
	}

	/**
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_adds_chromeless_when_iframed() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
		$this->assertStringContainsString( 'os-chromeless', open_station_admin_body_classes( '' ) );
	}

	/**
	 * Per-request classic override must suppress the `os-active`
	 * body class so the classic admin chrome isn't hidden in the detached
	 * tab — even when the user's account still has OpenStation enabled.
	 *
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_body_class_omits_active_when_classic_flag_present() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';

		$classes = open_station_admin_body_classes( 'foo' );

		$this->assertSame( 'foo', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * Classic override must not short-circuit chromeless tagging —
	 * defense in depth in case both flags land on the same request.
	 *
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_classic_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless']              = '1';
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';

		$classes = open_station_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * Chromeless wins over active — inside an iframe we want the
	 * chromeless class, never the shell class.
	 *
	 * @covers ::open_station_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_active() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
		$classes            = open_station_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * @covers ::open_station_render_shell
	 */
	public function test_render_shell_emits_nothing_when_mode_off() {
		ob_start();
		open_station_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::open_station_render_shell
	 */
	public function test_render_shell_emits_nothing_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Per-request classic override must skip shell injection even with
	 * OpenStation enabled on the account — otherwise the detached tab
	 * would render both the classic chrome and the floating shell.
	 *
	 * @covers ::open_station_render_shell
	 */
	public function test_render_shell_emits_nothing_on_classic_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';

		ob_start();
		open_station_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::open_station_render_shell
	 */
	public function test_render_shell_emits_markup_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		open_station_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'os-shell', $output );
		$this->assertStringContainsString( 'os-dock', $output );
		$this->assertStringContainsString( 'os-area', $output );
	}

	/**
	 * @covers ::open_station_render_shell
	 */
	public function test_shell_before_and_after_actions_fire() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$order = array();
		add_action(
			'open_station_shell_before',
			function () use ( &$order ) {
				$order[] = 'before';
			}
		);
		add_action(
			'open_station_shell_after',
			function () use ( &$order ) {
				$order[] = 'after';
			}
		);

		ob_start();
		open_station_render_shell();
		ob_end_clean();

		$this->assertSame( array( 'before', 'after' ), $order );

		remove_all_actions( 'open_station_shell_before' );
		remove_all_actions( 'open_station_shell_after' );
	}

	/**
	 * @covers ::open_station_render_shell
	 */
	public function test_render_shell_is_wired_to_in_admin_header() {
		$this->assertSame(
			5,
			has_action( 'in_admin_header', 'open_station_render_shell' )
		);
	}

	/**
	 * The classic `wp_admin_bar_render` action must be detached inside
	 * chromeless iframes — the filter alone can't stop it because
	 * `is_admin_bar_showing()` returns true unconditionally in admin.
	 *
	 * @covers ::open_station_chromeless_suppress_admin_bar
	 */
	public function test_chromeless_detaches_admin_bar_render_action() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		open_station_chromeless_suppress_admin_bar();

		$this->assertFalse( has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
	}

	/**
	 * @covers ::open_station_chromeless_suppress_admin_bar
	 */
	public function test_non_chromeless_leaves_admin_bar_render_wired() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		open_station_chromeless_suppress_admin_bar();

		$this->assertSame( 0, has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
	}

	/**
	 * Chromeless iframes must not load core's session-expired login
	 * modal — the parent shell owns the single prompt (DESKMOD-49).
	 *
	 * @covers ::open_station_chromeless_suppress_auth_check
	 */
	public function test_chromeless_suppresses_wp_auth_check_load() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		$this->assertFalse(
			open_station_chromeless_suppress_auth_check( true ),
			'Chromeless iframes must not load the wp-auth-check modal.'
		);
	}

	/**
	 * @covers ::open_station_chromeless_suppress_auth_check
	 */
	public function test_shell_keeps_wp_auth_check_load() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertTrue(
			open_station_chromeless_suppress_auth_check( true ),
			'The parent shell keeps core\'s modal — it is the single login prompt.'
		);
		$this->assertFalse(
			open_station_chromeless_suppress_auth_check( false ),
			'A false verdict from earlier filters must pass through unchanged.'
		);
	}

	/**
	 * @covers ::open_station_chromeless_suppress_auth_check
	 */
	public function test_auth_check_suppression_is_registered() {
		$this->assertNotFalse(
			has_filter(
				'wp_auth_check_load',
				'open_station_chromeless_suppress_auth_check'
			),
			'open_station_chromeless_suppress_auth_check should hook wp_auth_check_load.'
		);
	}

	/**
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_nothing_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_postmessage_glue_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'os-screen-meta', $output );
		$this->assertStringContainsString( 'postMessage', $output );
	}

	/**
	 * Link interceptor must be inside the bridge script so stray clicks on
	 * `<a href="/wp-admin/...">` don't kick the iframe out of chromeless mode.
	 *
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_link_interceptor_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		$this->assertStringContainsString( "'open_station_chromeless'", $output );
	}

	/**
	 * Cross-page admin-link routing depends on the chromeless bridge
	 * preventing the iframe's natural navigation; the parent shell
	 * decides between same-page in-iframe nav and a fresh window. If
	 * the bridge ever stops calling preventDefault on admin links,
	 * cross-page clicks would trash the source iframe before the
	 * parent could react.
	 *
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_prevents_default_on_admin_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		// Pin the admin-branch shape: the prevent-default must sit
		// inside the `kind === 'admin'` block, paired with the
		// admin-link postMessage. A regression that drops the
		// prevent-default would still emit the message, so we assert
		// both substrings are present.
		$this->assertStringContainsString( "kind === 'admin'", $output );
		$this->assertStringContainsString( 'os-iframe-admin-link', $output );
		$this->assertMatchesRegularExpression(
			"/kind === 'admin'.*?e\\.preventDefault\\(\\).*?os-iframe-admin-link/s",
			$output
		);
	}

	/**
	 * Clicks inside NESTED same-origin iframes (Gutenberg's
	 * editor-canvas, TinyMCE's visual mode) never reach the outer
	 * document's pointerdown listener — the bridge must attach its
	 * focus escalation inside them too, or clicking into the canvas
	 * of an unfocused editor window is swallowed and the window never
	 * activates.
	 *
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_escalates_focus_from_nested_frames() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'os-focus-request', $output );
		$this->assertStringContainsString( 'hookNestedFrames', $output );
		$this->assertStringContainsString(
			"doc.addEventListener( 'pointerdown', postFocusRequest, true )",
			$output
		);
	}

	/**
	 * The nested-frame sweep must walk each mutation record's
	 * `addedNodes`, never re-query the whole document. The observer
	 * is installed in EVERY chromeless iframe, so a document-wide
	 * `querySelectorAll( 'iframe' )` per mutation batch would put an
	 * O(DOM) tree walk on Gutenberg's typing path — exactly when the
	 * editor mutates hardest and the editor-preview pairing is live.
	 *
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_nested_frame_sweep_is_scoped_to_added_nodes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
		$output = ob_get_clean();

		// The observer callback iterates addedNodes and hands each
		// one to the scoped sweep.
		$this->assertStringContainsString( 'records[ r ].addedNodes', $output );
		$this->assertStringContainsString( 'hookNestedFrames( added[ n ] )', $output );

		// The sweep queries within its root, not the document.
		$this->assertStringContainsString( "root.querySelectorAll( 'iframe' )", $output );
		$this->assertStringNotContainsString(
			"document.querySelectorAll( 'iframe' )",
			$output,
			'Nested-frame sweep must stay scoped to added subtrees, not re-query the document.'
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
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_bridge_script_skips_wp_core_ajax_update_buttons() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		ob_start();
		open_station_chromeless_bridge_script();
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
	 * @covers ::open_station_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_nothing_without_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		open_station_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::open_station_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_script_when_flag_present() {
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';

		ob_start();
		open_station_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertStringContainsString( '<script>', $output );
		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		// The rewritten URL must carry the same flag the server checks for.
		$this->assertStringContainsString( '"' . OPEN_STATION_CLASSIC_FLAG . '"', $output );
	}

	/**
	 * The interceptor is what keeps the detached tab classic across
	 * navigations. It must be wired on admin_footer or the first click
	 * would escape back into the desktop shell.
	 *
	 * @covers ::open_station_classic_link_interceptor
	 */
	public function test_classic_interceptor_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'open_station_classic_link_interceptor' )
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
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_chromeless_bridge_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'open_station_chromeless_bridge_script' )
		);
	}

	/**
	 * @covers ::open_station_chromeless_offset_neutralizer_script
	 */
	public function test_chromeless_offset_neutralizer_is_wired_on_admin_head() {
		$this->assertNotFalse(
			has_action( 'admin_head', 'open_station_chromeless_offset_neutralizer_script' )
		);
	}

	/**
	 * The hidden refresh-probe iframe `wp.os.refreshMenu()` spawns
	 * lands on `admin.php?open_station_chromeless=1&open_station_menu_refresh=1`,
	 * which Core doesn't fire `admin_footer` for — so the
	 * admin-footer-hosted bridge never emits its payload. The
	 * `admin_init @ 99` handler short-circuits that request with the
	 * payload script directly. Catching the priority here so a refactor
	 * can't silently move it earlier than `wp-admin/menu.php` (which
	 * populates `$menu`).
	 *
	 * @covers ::open_station_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_is_wired_on_admin_init() {
		$this->assertSame(
			99,
			has_action( 'admin_init', 'open_station_emit_menu_refresh_probe' )
		);
	}

	/**
	 * Guard: when the refresh-probe flag isn't on the request, the
	 * handler must be a silent no-op so it doesn't slip into normal
	 * admin page loads.
	 *
	 * @covers ::open_station_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_when_flag_missing() {
		unset( $_GET['open_station_menu_refresh'] );

		ob_start();
		open_station_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Guard: chromeless gate. A request with the flag but no
	 * `open_station_chromeless=1` (and no Sec-Fetch fallback) must NOT
	 * emit the payload — the flag alone is forgeable from any tab.
	 *
	 * @covers ::open_station_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_without_chromeless() {
		unset( $_GET['open_station_chromeless'] );
		$_GET['open_station_menu_refresh'] = '1';

		ob_start();
		open_station_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );

		unset( $_GET['open_station_menu_refresh'] );
	}

	/**
	 * @covers ::open_station_chromeless_bridge_script
	 */
	public function test_chromeless_after_action_fires_in_iframes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		$fired = false;
		add_action(
			'open_station_chromeless_after',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		ob_start();
		open_station_chromeless_bridge_script();
		ob_end_clean();

		$this->assertTrue( $fired );
		remove_all_actions( 'open_station_chromeless_after' );
	}
}
