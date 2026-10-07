<?php

class Tests_OpenStation_Render extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
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

	public function test_body_class_carries_default_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$this->assertStringContainsString(
			'os-admin-bar-hidden',
			openstation_admin_body_classes( '' )
		);
	}

	public function test_body_class_reflects_saved_admin_bar_mode() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );

		$classes = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-admin-bar-dynamic', $classes );
		$this->assertStringNotContainsString( 'os-admin-bar-static', $classes );
	}

	public function test_shell_stamps_default_dock_behavior_on_the_dock() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'data-os-dock-behavior="static"', $output );
	}

	public function test_shell_stamps_saved_dock_behavior_on_the_dock() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_save_os_settings( self::$admin_id, array( 'dockBehavior' => 'dynamic' ) );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'data-os-dock-behavior="dynamic"', $output );
		$this->assertStringNotContainsString( 'data-os-dock-behavior="static"', $output );
	}

	public function test_dock_behavior_filter_overrides_the_user_pick() {
		openstation_save_os_settings( self::$admin_id, array( 'dockBehavior' => 'dynamic' ) );
		add_filter( 'openstation_dock_behavior', static fn () => 'static' );

		$this->assertSame( 'static', openstation_get_dock_behavior() );
	}

	public function test_dock_behavior_filter_returning_junk_fails_closed() {
		add_filter( 'openstation_dock_behavior', static fn () => array( 'nope' ) );

		$this->assertSame( 'static', openstation_get_dock_behavior() );
	}

	public function test_body_class_omits_admin_bar_mode_when_openstation_off() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );

		$this->assertStringNotContainsString(
			'os-admin-bar-',
			openstation_admin_body_classes( '' )
		);
	}

	public function test_admin_bar_mode_filter_overrides_the_user_pick() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'hidden' ) );
		add_filter( 'openstation_admin_bar_mode', static fn () => 'static' );

		$this->assertSame( 'static', openstation_get_admin_bar_mode() );
	}

	public function test_admin_bar_mode_filter_result_is_validated() {
		openstation_save_os_settings( self::$admin_id, array( 'adminBarMode' => 'dynamic' ) );
		add_filter( 'openstation_admin_bar_mode', static fn () => 'peekaboo' );

		$this->assertSame( 'static', openstation_get_admin_bar_mode() );
	}

	public function test_body_class_unchanged_when_mode_off() {
		$this->assertSame( 'foo', openstation_admin_body_classes( 'foo' ) );
	}

	public function test_body_class_adds_active_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$this->assertStringContainsString( 'os-active', openstation_admin_body_classes( '' ) );
	}

	public function test_body_class_adds_chromeless_when_iframed() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$this->assertStringContainsString( 'os-chromeless', openstation_admin_body_classes( '' ) );
	}

	public function test_body_class_omits_active_when_classic_flag_present() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$classes = openstation_admin_body_classes( 'foo' );

		$this->assertSame( 'foo', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	public function test_chromeless_class_wins_over_classic_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless']              = '1';
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$classes = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	public function test_chromeless_class_wins_over_active() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
		$classes            = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-chromeless', $classes );
		$this->assertStringNotContainsString( 'os-active', $classes );
	}

	public function test_render_shell_emits_nothing_when_mode_off() {
		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	public function test_render_shell_emits_nothing_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	public function test_render_shell_emits_nothing_on_classic_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	public function test_render_shell_emits_markup_when_mode_on() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_render_shell();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'os-shell', $output );
		$this->assertStringContainsString( 'os-dock', $output );
		$this->assertStringContainsString( 'os-area', $output );
	}

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

	public function test_render_shell_is_wired_to_in_admin_header() {
		$this->assertSame(
			5,
			has_action( 'in_admin_header', 'openstation_render_shell' )
		);
	}

	public function test_chromeless_detaches_admin_bar_render_action() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		openstation_chromeless_suppress_admin_bar();

		$this->assertFalse( has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
	}

	public function test_non_chromeless_leaves_admin_bar_render_wired() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		add_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		openstation_chromeless_suppress_admin_bar();

		$this->assertSame( 0, has_action( 'in_admin_header', 'wp_admin_bar_render' ) );
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
	}

	public function test_chromeless_suppresses_wp_auth_check_load() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$this->assertFalse(
			openstation_chromeless_suppress_auth_check( true ),
			'Chromeless iframes must not load the wp-auth-check modal.'
		);
	}

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

	public function test_auth_check_suppression_is_registered() {
		$this->assertNotFalse(
			has_filter(
				'wp_auth_check_load',
				'openstation_chromeless_suppress_auth_check'
			),
			'openstation_chromeless_suppress_auth_check should hook wp_auth_check_load.'
		);
	}

	public function test_bridge_script_emits_nothing_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$output = $this->bridge_output();

		$this->assertSame( '', $output );
	}

	public function test_bridge_script_emits_postmessage_glue_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'os-screen-meta', $output );
		$this->assertStringContainsString( 'postMessage', $output );
	}

	public function test_bridge_script_soft_reload_matcher_matches_emitted_topic_prefix() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( '/^os\.(.+)\.changed$/', $output );

		$this->assertStringContainsString( "'os.' +", $output );
	}

	public function test_bridge_script_reinits_list_tables_after_soft_reload() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'live.replaceChildren.apply', $output );
		$this->assertStringNotContainsString( 'live.replaceWith', $output );

		$this->assertStringContainsString( '_openstationReinitListTables();', $output );
		$this->assertStringContainsString( 'window.inlineEditPost.init()', $output );
		$this->assertStringContainsString( 'window.inlineEditTax.init()', $output );
		$this->assertStringContainsString( 'window.commentReply.init()', $output );

		$this->assertStringNotContainsString( 'window.setCommentsList(', $output );
		$this->assertLessThan(
			strpos( $output, "new CustomEvent( 'os-soft-reloaded' )" ),
			strpos( $output, '_openstationReinitListTables();' ),
			'Core re-init must run before the os-soft-reloaded listeners it exists to unblock.'
		);
	}

	public function test_bridge_script_emits_link_interceptor_in_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );
		$this->assertStringContainsString( "'openstation_chromeless'", $output );
	}

	public function test_bridge_script_prevents_default_on_admin_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( "kind === 'admin'", $output );
		$this->assertStringContainsString( 'os-iframe-admin-link', $output );
		$this->assertMatchesRegularExpression(
			"/kind === 'admin'.*?e\\.preventDefault\\(\\).*?os-iframe-admin-link/s",
			$output
		);
	}

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

	public function test_bridge_script_nested_frame_sweep_is_scoped_to_added_nodes() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString( 'records[ r ].addedNodes', $output );
		$this->assertStringContainsString( 'hookNestedFrames( added[ n ] )', $output );

		$this->assertStringContainsString( "root.querySelectorAll( 'iframe' )", $output );
		$this->assertStringNotContainsString(
			"document.querySelectorAll( 'iframe' )",
			$output,
			'Nested-frame sweep must stay scoped to added subtrees, not re-query the document.'
		);
	}

	public function test_bridge_script_skips_wp_core_ajax_update_buttons() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

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

	public function test_bridge_script_skips_core_js_button_links() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$output = $this->bridge_output();

		$this->assertStringContainsString(
			"link.classList.contains( 'aria-button-if-js' )",
			$output,
			'Bridge must skip clicks on core .aria-button-if-js anchors so their owning script can run.'
		);

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

	public function test_media_grid_query_vars_drop_the_chromeless_flag() {
		set_current_screen( 'upload' );

		if ( ! wp_script_is( 'media-grid', 'registered' ) ) {
			wp_register_script( 'media-grid', '/media-grid.js', array(), '1.0', true );
		}

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

		$this->assertStringContainsString( '"queryVars":{', end( $matches[1] ) );
	}

	public function test_media_grid_cleanup_skips_other_screens() {
		set_current_screen( 'edit-post' );

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

		$this->assertSame(
			$before,
			wp_scripts()->get_data( 'media-grid', 'data' ),
			'The cleanup must only run on the Media Library screen.'
		);
	}

	public function test_classic_interceptor_emits_nothing_without_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		ob_start();
		openstation_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	public function test_classic_interceptor_emits_script_when_flag_present() {
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		ob_start();
		openstation_classic_link_interceptor();
		$output = ob_get_clean();

		$this->assertStringContainsString( '<script>', $output );
		$this->assertStringContainsString( 'rewriteAdminUrl', $output );
		$this->assertStringContainsString( "addEventListener( 'click'", $output );
		$this->assertStringContainsString( "addEventListener( 'submit'", $output );

		$this->assertStringContainsString( '"' . OPENSTATION_CLASSIC_FLAG . '"', $output );
	}

	public function test_classic_interceptor_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'openstation_classic_link_interceptor' )
		);
	}

	public function test_chromeless_bridge_is_wired_on_admin_footer() {
		$this->assertNotFalse(
			has_action( 'admin_footer', 'openstation_chromeless_bridge_script' )
		);
	}

	public function test_chromeless_offset_neutralizer_is_wired_on_admin_head() {
		$this->assertNotFalse(
			has_action( 'admin_head', 'openstation_chromeless_offset_neutralizer_script' )
		);
	}

	public function test_menu_refresh_probe_is_wired_on_admin_init() {
		$this->assertSame(
			99,
			has_action( 'admin_init', 'openstation_emit_menu_refresh_probe' )
		);
	}

	public function test_menu_refresh_probe_skips_when_flag_missing() {
		unset( $_GET['openstation_menu_refresh'] );

		ob_start();
		openstation_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );
	}

	public function test_menu_refresh_probe_skips_without_chromeless() {
		unset( $_GET['openstation_chromeless'] );
		$_GET['openstation_menu_refresh'] = '1';

		ob_start();
		openstation_emit_menu_refresh_probe();
		$output = ob_get_clean();

		$this->assertSame( '', $output );

		unset( $_GET['openstation_menu_refresh'] );
	}

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
