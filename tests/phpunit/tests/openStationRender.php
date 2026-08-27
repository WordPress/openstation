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
		delete_user_meta( self::$admin_id, OPENSTATION_OS_SETTINGS_META_KEY );
		remove_all_filters( 'openstation_admin_bar_mode' );
		remove_all_filters( 'openstation_dock_behavior' );
		unset( $_GET['openstation_chromeless'], $_GET[ OPENSTATION_CLASSIC_FLAG ] );
		parent::tear_down();
	}

	/**
	 * Everything the bridge contributes to a chromeless page.
	 *
	 * The bridge code ships as a built bundle now, so the footer hook
	 * enqueues a handle and attaches its per-request data rather than
	 * printing ~125 KB of inline JavaScript into every window. Tests
	 * that assert on bridge BEHAVIOUR therefore read the source that
	 * builds into that bundle, alongside whatever PHP still prints.
	 *
	 * Returns only the printed output when the bridge didn't run, so
	 * "emits nothing off a chromeless request" assertions keep meaning
	 * what they say.
	 *
	 * @return string
	 */
	private function bridge_output() {
		ob_start();
		openstation_chromeless_bridge_script();
		$printed = (string) ob_get_clean();

		if ( ! openstation_is_chromeless_request() ) {
			return $printed;
		}

		$data = wp_scripts()->get_data( 'os-chromeless-bridge', 'before' );
		if ( is_array( $data ) ) {
			$data = implode( "\n", $data );
		}

		return $printed . (string) $data . (string) file_get_contents(
			OPENSTATION_DIR . 'src/chromeless-bridge.js'
		);
	}

	/**
	 * The admin-bar mode has to ride along on the body class rather
	 * than wait for the shell's JS apply pass — the bar has already
	 * painted by then, so a user who picked `hidden` would see it
	 * flash on every navigation.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_carries_default_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertStringContainsString(
			'os-admin-bar-hidden',
			openstation_admin_body_classes( '' )
		);
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 * @covers ::openstation_get_admin_bar_mode
	 */
	public function test_body_class_reflects_saved_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );

		$classes = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-admin-bar-dynamic', $classes );
		$this->assertStringNotContainsString( 'os-admin-bar-static', $classes );
	}

	/**
	 * The dock is stamped for the first paint so a dynamic rail never
	 * flashes on screen before the JS folds it.
	 *
	 * @covers ::openstation_render_shell
	 * @covers ::openstation_get_dock_behavior
	 */
	public function test_shell_stamps_default_dock_behavior_on_the_dock() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'data-os-dock-behavior="static"', $output );
	}

	/**
	 * @covers ::openstation_render_shell
	 * @covers ::openstation_get_dock_behavior
	 */
	public function test_shell_stamps_saved_dock_behavior_on_the_dock() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_save_os_settings( self::$admin_id, array( 'dockBehavior' => 'dynamic' ) );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'data-os-dock-behavior="dynamic"', $output );
		$this->assertStringNotContainsString( 'data-os-dock-behavior="static"', $output );
	}

	/**
	 * @covers ::openstation_get_dock_behavior
	 */
	public function test_dock_behavior_filter_overrides_the_user_pick() {
		openstation_save_os_settings( self::$admin_id, array( 'dockBehavior' => 'dynamic' ) );
		add_filter( 'openstation_dock_behavior', static fn () => 'static' );

		$this->assertSame( 'static', openstation_get_dock_behavior() );
	}

	/**
	 * @covers ::openstation_get_dock_behavior
	 */
	public function test_dock_behavior_filter_returning_junk_fails_closed() {
		add_filter( 'openstation_dock_behavior', static fn () => array( 'nope' ) );

		$this->assertSame( 'static', openstation_get_dock_behavior() );
	}

	/**
	 * Classic mode is vanilla admin — no shell, and therefore no
	 * business restyling the admin bar.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_omits_admin_bar_mode_when_openstation_off() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );

		$this->assertStringNotContainsString(
			'os-admin-bar-',
			openstation_admin_body_classes( '' )
		);
	}

	/**
	 * @covers ::openstation_get_admin_bar_mode
	 */
	public function test_admin_bar_mode_filter_overrides_the_user_pick() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );
		add_filter( 'openstation_admin_bar_mode', static fn () => 'static' );

		$this->assertSame( 'static', openstation_get_admin_bar_mode() );
	}

	/**
	 * A filter returning something outside the enum fails closed to
	 * the always-visible mode, never to a class no CSS rule matches.
	 *
	 * @covers ::openstation_get_admin_bar_mode
	 */
	public function test_admin_bar_mode_filter_result_is_validated() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );
		add_filter( 'openstation_admin_bar_mode', static fn () => 'peekaboo' );

		$this->assertSame( 'static', openstation_get_admin_bar_mode() );
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_unchanged_when_mode_off() {
		$this->assertSame( 'foo', openstation_admin_body_classes( 'foo' ) );
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_adds_active_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertStringContainsString( 'os-active', openstation_admin_body_classes( '' ) );
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_adds_chromeless_when_iframed() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$this->assertStringContainsString( 'os-chromeless', openstation_admin_body_classes( '' ) );
	}

	/**
	 * Per-request classic override must suppress the `os-active`
	 * body class so the classic admin chrome isn't hidden in the detached
	 * tab — even when the user's account still has OpenStation enabled.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_omits_active_when_classic_flag_present() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$classes = openstation_admin_body_classes( 'foo' );

		$this->assertSame( 'foo', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * Classic override must not short-circuit chromeless tagging —
	 * defense in depth in case both flags land on the same request.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_classic_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless']              = '1';
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$classes = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * Chromeless wins over active — inside an iframe we want the
	 * chromeless class, never the shell class.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_chromeless_class_wins_over_active() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$classes            = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_render_shell_emits_nothing_when_mode_off() {
		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_render_shell_emits_nothing_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Per-request classic override must skip shell injection even with
	 * OpenStation enabled on the account — otherwise the detached tab
	 * would render both the classic chrome and the floating shell.
	 *
	 * @covers ::openstation_render_shell
	 */
	public function test_render_shell_emits_nothing_on_classic_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_render_shell_emits_markup_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'os-shell', $output );
		$this->assertStringContainsString( 'os-dock', $output );
		$this->assertStringContainsString( 'os-area', $output );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_shell_before_and_after_actions_fire() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$order = array();
		add_action(
			'openstation_shell_before',
			function () use ( &$order ) {
				$order[] = 'before';
			}
		);
		add_action(
			'openstation_shell_after',
			function () use ( &$order ) {
				$order[] = 'after';
			}
		);

		ob_start();
		openstation_render_shell();
		ob_end_clean();

		$this->assertSame( array( 'before', 'after' ), $order );

		remove_all_actions( 'openstation_shell_before' );
		remove_all_actions( 'openstation_shell_after' );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_render_shell_is_wired_to_in_admin_header() {
		$this->assertSame(
			5,
			has_action( 'in_admin_header', 'openstation_render_shell' )
		);
	}

	/**
	 * The classic `wp_admin_bar_render` action must be detached inside
	 * chromeless iframes — the filter alone can't stop it because
	 * `is_admin_bar_showing()` returns true unconditionally in admin.
	 *
	 * @covers ::openstation_chromeless_suppress_admin_bar
	 */
	public function test_chromeless_detaches_admin_bar_render_action() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		openstation_chromeless_suppress_admin_bar();

		$this->assertFalse( has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
	}

	/**
	 * @covers ::openstation_chromeless_suppress_admin_bar
	 */
	public function test_non_chromeless_leaves_admin_bar_render_wired() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		openstation_chromeless_suppress_admin_bar();

		$this->assertSame( 0, has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
	}

	/**
	 * Chromeless iframes must not load core's session-expired login
	 * modal — the parent shell owns the single prompt (DESKMOD-49).
	 *
	 * @covers ::openstation_chromeless_suppress_auth_check
	 */
	public function test_chromeless_suppresses_wp_auth_check_load() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$this->assertFalse(
			openstation_chromeless_suppress_auth_check( true ),
			'Chromeless iframes must not load the wp-auth-check modal.'
		);
	}

	/**
	 * @covers ::openstation_chromeless_suppress_auth_check
	 */
	public function test_shell_keeps_wp_auth_check_load() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertTrue(
			openstation_chromeless_suppress_auth_check( true ),
			'The parent shell keeps core\'s modal — it is the single login prompt.'
		);
		$this->assertFalse(
			openstation_chromeless_suppress_auth_check( false ),
			'A false verdict from earlier filters must pass through unchanged.'
		);
	}

	/**
	 * @covers ::openstation_chromeless_suppress_auth_check
	 */
	public function test_auth_check_suppression_is_registered() {
		$this->assertNotFalse(
			has_filter(
				'wp_auth_check_load',
				'openstation_chromeless_suppress_auth_check'
			),
			'openstation_chromeless_suppress_auth_check should hook wp_auth_check_load.'
		);
	}

	/**
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_nothing_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$output = $this->bridge_output();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_postmessage_glue_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'os-screen-meta', $output );
		$this->assertStringContainsString( 'postMessage', $output );
	}

	/**
	 * The soft-reload topic matcher and the save-watcher's broadcast
	 * emitter live in the same script but were once renamed out of
	 * sync — the matcher expected a prefix nothing emits, silently
	 * killing every list-page soft reload. Pin both sides to the
	 * `os.` prefix so they can only move together.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_soft_reload_matcher_matches_emitted_topic_prefix() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		// The matcher.
		$this->assertStringContainsString( '/^os\.(.+)\.changed$/', $output );
		// The emitter it must keep matching.
		$this->assertStringContainsString( "'os.' +", $output );
	}

	/**
	 * A soft reload swaps the CONTENTS of `#wpbody-content` and then
	 * re-runs Core's list-table init entry points. Both halves are
	 * load-bearing and both are invisible until a user clicks:
	 * Core's inline editors delegate on `#the-list` /
	 * `#the-comment-list`, inside the swapped subtree, so a
	 * `replaceWith` of the container (or a missing re-init) leaves
	 * Quick Edit and Bulk Edit rendering, focusable, and dead.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_reinits_list_tables_after_soft_reload() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		// The container node survives; only its children are swapped.
		$this->assertStringContainsString( 'live.replaceChildren.apply', $output );
		$this->assertStringNotContainsString( 'live.replaceWith', $output );

		// …and the re-init runs before `os-soft-reloaded` listeners.
		$this->assertStringContainsString( '_openstationReinitListTables();', $output );
		$this->assertStringContainsString( 'window.inlineEditPost.init()', $output );
		$this->assertStringContainsString( 'window.inlineEditTax.init()', $output );
		$this->assertStringContainsString( 'window.commentReply.init()', $output );

		/*
		 * `setCommentsList()` must stay out. It re-runs `wpList`,
		 * which binds on `document` — a node the swap does not
		 * replace — so every call stacks another set of comment
		 * row-action handlers and one Approve click fires N
		 * moderation requests. Those handlers survive the swap on
		 * their own and never needed re-running.
		 *
		 * Matched on the call form, not the bare name: the comment
		 * above the re-init names it too, and should keep saying why.
		 */
		$this->assertStringNotContainsString( 'window.setCommentsList(', $output );
		$this->assertLessThan(
			strpos( $output, "new CustomEvent( 'os-soft-reloaded' )" ),
			strpos( $output, '_openstationReinitListTables();' ),
			'Core re-init must run before the os-soft-reloaded listeners it exists to unblock.'
		);
	}

	/**
	 * Link interceptor must be inside the bridge script so stray clicks on
	 * `<a href="/wp-admin/...">` don't kick the iframe out of chromeless mode.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_emits_link_interceptor_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		$this->assertStringContainsString( "'openstation_chromeless'", $output );
	}

	/**
	 * Cross-page admin-link routing depends on the chromeless bridge
	 * preventing the iframe's natural navigation; the parent shell
	 * decides between same-page in-iframe nav and a fresh window. If
	 * the bridge ever stops calling preventDefault on admin links,
	 * cross-page clicks would trash the source iframe before the
	 * parent could react.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_prevents_default_on_admin_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

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
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_escalates_focus_from_nested_frames() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

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
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_nested_frame_sweep_is_scoped_to_added_nodes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

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
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_skips_wp_core_ajax_update_buttons() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

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
	 * `aria-button-if-js` is core's marker for an anchor that JS turns
	 * into an in-page button, with the href kept only as a no-JS
	 * fallback. The capture-phase handler runs before the script that
	 * owns the button, so intercepting these swaps the in-page action
	 * for the fallback URL: on the Media Library grid the shell opened a
	 * window for `media-new.php` while media-grid.js expanded the inline
	 * uploader behind it. Pin the skip so it doesn't get refactored away.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_skips_core_js_button_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString(
			"link.classList.contains( 'aria-button-if-js' )",
			$output,
			'Bridge must skip clicks on core .aria-button-if-js anchors so their owning script can run.'
		);

		// Must bail before the branch that preventDefaults and hands
		// the URL to the shell.
		$skip_pos  = strpos( $output, "link.classList.contains( 'aria-button-if-js' )" );
		$admin_pos = strpos( $output, "kind === 'admin'" );
		$this->assertNotFalse( $skip_pos );
		$this->assertNotFalse( $admin_pos );
		$this->assertLessThan(
			$admin_pos,
			$skip_pos,
			'JS-button skip must run before the admin-link prevent-default block.'
		);
	}

	/**
	 * `upload.php` copies unknown `$_GET` keys into
	 * `_wpMediaGridSettings.queryVars`, and `wp.media.model.Query` only
	 * watches `wp.Uploader.queue` when every query arg is one it knows
	 * how to filter on. Our chromeless flag riding along was enough to
	 * stop the grid from ever showing a finished upload.
	 *
	 * @covers ::openstation_strip_chromeless_flag_from_media_grid
	 */
	public function test_media_grid_query_vars_drop_the_chromeless_flag() {
		set_current_screen( 'upload' );

		if ( ! wp_script_is( 'media-grid', 'registered' ) ) {
			wp_register_script( 'media-grid', '/media-grid.js', array(), '1.0', true );
		}
		// `$wp_scripts` is global and `localize()` appends, so clear
		// any payload a sibling test left behind.
		wp_scripts()->add_data( 'media-grid', 'data', '' );

		wp_localize_script(
			'media-grid',
			'_wpMediaGridSettings',
			array(
				'adminUrl'  => '/wp-admin/',
				'queryVars' => (object) array(
					'openstation_chromeless' => '1',
					'orderby'                => 'date',
				),
			)
		);

		openstation_strip_chromeless_flag_from_media_grid();

		$data = wp_scripts()->get_data( 'media-grid', 'data' );
		$this->assertIsString( $data );

		preg_match_all( '/^var _wpMediaGridSettings = (.+);$/m', $data, $matches );
		$settings = json_decode( end( $matches[1] ), true );

		$this->assertArrayNotHasKey(
			'openstation_chromeless',
			$settings['queryVars'],
			"The grid's query args must not carry the chromeless flag, or uploads stop refreshing the grid."
		);
		$this->assertSame( 'date', $settings['queryVars']['orderby'], 'Core query vars must survive untouched.' );
		$this->assertSame( '/wp-admin/', $settings['adminUrl'] );

		// An object, not `[]`, since the grid iterates the value's keys.
		$this->assertStringContainsString( '"queryVars":{', end( $matches[1] ) );
	}

	/**
	 * Leave every other admin screen alone: the hook is global, and
	 * re-localizing on a screen that never localized in the first place
	 * would invent a `_wpMediaGridSettings` that core didn't ask for.
	 *
	 * @covers ::openstation_strip_chromeless_flag_from_media_grid
	 */
	public function test_media_grid_cleanup_skips_other_screens() {
		set_current_screen( 'edit-post' );

		// Same payload the upload-screen test uses, so the only thing
		// standing between the flag and removal is the screen guard.
		// Seeded through the registered handle rather than a bare
		// `add_data()` so this can't pass by accident on a handle that
		// was never registered.
		if ( ! wp_script_is( 'media-grid', 'registered' ) ) {
			wp_register_script( 'media-grid', '/media-grid.js', array(), '1.0', true );
		}
		wp_scripts()->add_data( 'media-grid', 'data', '' );
		wp_localize_script(
			'media-grid',
			'_wpMediaGridSettings',
			array(
				'adminUrl'  => '/wp-admin/',
				'queryVars' => (object) array( 'openstation_chromeless' => '1' ),
			)
		);

		$before = wp_scripts()->get_data( 'media-grid', 'data' );

		openstation_strip_chromeless_flag_from_media_grid();

		// Byte-identical, not just "still mentions the flag":
		// `wp_localize_script()` APPENDS, so a cleanup that ran here
		// would leave the original assignment in place and only the
		// last one would differ.
		$this->assertSame(
			$before,
			wp_scripts()->get_data( 'media-grid', 'data' ),
			'The cleanup must only run on the Media Library screen.'
		);
	}

	/**
	 * @covers ::openstation_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_nothing_without_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * @covers ::openstation_classic_link_interceptor
	 */
	public function test_classic_interceptor_emits_script_when_flag_present() {
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		ob_start();
		openstation_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertStringContainsString( '<script>', $output );
		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		// The rewritten URL must carry the same flag the server checks for.
		$this->assertStringContainsString( '"' . OPENSTATION_CLASSIC_FLAG . '"', $output );
	}

	/**
	 * The interceptor is what keeps the detached tab classic across
	 * navigations. It must be wired on admin_footer or the first click
	 * would escape back into the desktop shell.
	 *
	 * @covers ::openstation_classic_link_interceptor
	 */
	public function test_classic_interceptor_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'openstation_classic_link_interceptor' )
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
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_chromeless_bridge_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'openstation_chromeless_bridge_script' )
		);
	}

	/**
	 * @covers ::openstation_chromeless_offset_neutralizer_script
	 */
	public function test_chromeless_offset_neutralizer_is_wired_on_admin_head() {
		$this->assertNotFalse(
			has_action( 'admin_head', 'openstation_chromeless_offset_neutralizer_script' )
		);
	}

	/**
	 * The hidden refresh-probe iframe `wp.os.refreshMenu()` spawns
	 * lands on `admin.php?openstation_chromeless=1&openstation_menu_refresh=1`,
	 * which Core doesn't fire `admin_footer` for — so the
	 * admin-footer-hosted bridge never emits its payload. The
	 * `admin_init @ 99` handler short-circuits that request with the
	 * payload script directly. Catching the priority here so a refactor
	 * can't silently move it earlier than `wp-admin/menu.php` (which
	 * populates `$menu`).
	 *
	 * @covers ::openstation_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_is_wired_on_admin_init() {
		$this->assertSame(
			99,
			has_action( 'admin_init', 'openstation_emit_menu_refresh_probe' )
		);
	}

	/**
	 * Guard: when the refresh-probe flag isn't on the request, the
	 * handler must be a silent no-op so it doesn't slip into normal
	 * admin page loads.
	 *
	 * @covers ::openstation_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_when_flag_missing() {
		unset( $_GET['openstation_menu_refresh'] );

		ob_start();
		openstation_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	/**
	 * Guard: chromeless gate. A request with the flag but no
	 * `openstation_chromeless=1` (and no Sec-Fetch fallback) must NOT
	 * emit the payload — the flag alone is forgeable from any tab.
	 *
	 * @covers ::openstation_emit_menu_refresh_probe
	 */
	public function test_menu_refresh_probe_skips_without_chromeless() {
		unset( $_GET['openstation_chromeless'] );
		$_GET['openstation_menu_refresh'] = '1';

		ob_start();
		openstation_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );

		unset( $_GET['openstation_menu_refresh'] );
	}

	/**
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_chromeless_after_action_fires_in_iframes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$fired = false;
		add_action(
			'openstation_chromeless_after',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		ob_start();
		openstation_chromeless_bridge_script();
		ob_end_clean();

		$this->assertTrue( $fired );
		remove_all_actions( 'openstation_chromeless_after' );
	}
}
