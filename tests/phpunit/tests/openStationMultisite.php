<?php

class Tests_OpenStation_Multisite extends WP_UnitTestCase {

	public function test_nothing_multisite_leaks_into_a_single_site_install() {
		$this->assertSame( OPENSTATION_SESSION_META_KEY, openstation_session_meta_key() );
		$this->assertNull( openstation_multisite_payload() );
		$this->assertFalse( openstation_is_core_menu_slug( 'settings.php' ) );
		$this->assertFalse( openstation_is_core_menu_slug( 'sites.php' ) );

		$this->assertTrue( openstation_is_core_menu_slug( 'options-general.php' ) );
	}

	public function test_network_session_has_its_own_meta_key() {
		$this->assertSame( OPENSTATION_SESSION_META_KEY . '_network', openstation_session_meta_key( true ) );
		$this->assertSame( OPENSTATION_SESSION_META_KEY, openstation_session_meta_key( false ) );
	}

	public function test_probe_screen_id_keeps_the_admin_context() {
		set_current_screen( 'sites-network' );
		$this->assertTrue( is_network_admin() );
		$this->assertSame( 'admin-network', openstation_menu_refresh_probe_screen_id() );

		$this->assertTrue( WP_Screen::get( 'admin-network' )->in_admin( 'network' ) );
		$this->assertFalse( WP_Screen::get( 'admin' )->in_admin( 'network' ) );

		set_current_screen( openstation_menu_refresh_probe_screen_id() );
		$this->assertTrue( is_network_admin() );
		$this->assertSame(
			esc_url_raw( network_admin_url( 'plugins.php' ) ),
			openstation_menu_item_url( 'plugins.php' )
		);

		set_current_screen( 'profile-user' );
		$this->assertSame( 'admin-user', openstation_menu_refresh_probe_screen_id() );

		set_current_screen( 'dashboard' );
		$this->assertSame( 'admin', openstation_menu_refresh_probe_screen_id() );
	}

	public function test_session_url_scope_separates_the_two_admins() {
		$site    = admin_url( 'index.php' );
		$network = admin_url( 'network/index.php' );

		$this->assertTrue( openstation_session_url_in_scope( $site, false ) );
		$this->assertFalse( openstation_session_url_in_scope( $site, true ) );
		$this->assertTrue( openstation_session_url_in_scope( $network, true ) );
		$this->assertFalse( openstation_session_url_in_scope( $network, false ) );
	}

	public function test_sanitize_session_drops_windows_from_the_other_admin() {
		$session = array(
			'updated' => 1000,
			'windows' => array(
				array(
					'id'  => 'index-php',
					'url' => admin_url( 'index.php' ),
				),
				array(
					'id'  => 'network-index',
					'url' => admin_url( 'network/index.php' ),
				),
			),
		);

		$site_clean = openstation_sanitize_session( $session, false );
		$this->assertCount( 1, $site_clean['windows'] );
		$this->assertSame( admin_url( 'index.php' ), $site_clean['windows'][0]['url'] );

		$network_clean = openstation_sanitize_session( $session, true );
		$this->assertCount( 1, $network_clean['windows'] );
		$this->assertSame( admin_url( 'network/index.php' ), $network_clean['windows'][0]['url'] );
	}

	public function test_drop_tables_filter_appends_every_plugin_table() {
		global $wpdb;
		$core   = array( $wpdb->get_blog_prefix( 2 ) . 'posts' );
		$tables = openstation_filter_wpmu_drop_tables( $core, 2 );

		$this->assertSame( $core[0], $tables[0], 'Core tables stay in the list.' );
		$prefix = $wpdb->get_blog_prefix( 2 );
		foreach ( openstation_site_table_names() as $name ) {
			$this->assertContains( $prefix . $name, $tables );
		}
	}

	public function test_drop_tables_list_covers_every_schema_helper_table() {
		global $wpdb;
		$helper_tables = array_merge( array_values( openstation_files_table_names() ), array( openstation_presence_table() ) );
		if ( function_exists( 'openstation_games_table_names' ) ) {
			$helper_tables = array_merge( $helper_tables, array_values( openstation_games_table_names() ) );
		}

		$unprefixed = array();
		foreach ( $helper_tables as $table ) {
			$this->assertStringStartsWith( $wpdb->prefix, $table );
			$unprefixed[] = substr( $table, strlen( $wpdb->prefix ) );
		}

		foreach ( $unprefixed as $name ) {
			$this->assertContains( $name, openstation_site_table_names() );
		}
	}

	public function test_another_sites_window_never_persists() {
		$foreign = set_url_scheme( 'http://' . wp_parse_url( admin_url(), PHP_URL_HOST ) . '/site2/wp-admin/index.php' );
		$session = array(
			'updated'  => 1000,
			'desktops' => array(
				array( 'id' => 'desktop-1', 'label' => 'Desktop 1' ),
				array( 'id' => 'desktop-2', 'label' => 'site2' ),
			),
			'windows'  => array(
				array(
					'id'        => 'own',
					'url'       => admin_url( 'index.php' ),
					'desktopId' => 'desktop-1',
				),
				array(
					'id'        => 'foreign',
					'url'       => $foreign,
					'desktopId' => 'desktop-2',
				),
			),
		);

		$clean = openstation_sanitize_session( $session, false );

		$this->assertSame( array( 'own' ), wp_list_pluck( $clean['windows'], 'id' ) );
		$this->assertArrayNotHasKey( 'scope', $clean['desktops'][1] );
	}

	public function test_get_session_drops_site_space_desktops() {
		$user_id = self::factory()->user->create();
		update_user_meta(
			$user_id,
			openstation_session_meta_key( false ),
			array(
				'updated'       => 1000,
				'desktops'      => array(
					array( 'id' => 'desktop-1', 'label' => 'Desktop 1' ),
					array(
						'id'    => 'desktop-2',
						'label' => 'site2',
						'scope' => '/site2/wp-admin/',
					),
				),
				'activeDesktop' => 'desktop-2',
				'windows'       => array(),
			)
		);

		$session = openstation_get_session( $user_id, false );

		$this->assertSame( array( 'desktop-1' ), wp_list_pluck( $session['desktops'], 'id' ) );
		$this->assertSame( 'desktop-1', $session['activeDesktop'] );
	}

	public function test_my_sites_row_links_follow_the_shell() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}
		$current = get_current_blog_id();
		$other   = self::factory()->blog->create( array( 'path' => '/my-sites-other/' ) );

		$row = static function ( $blog_id, $active ) use ( $current ) {
			switch_to_blog( $blog_id );
			$core    = "<a href='" . esc_url( home_url() ) . "'>Visit</a> | <a href='" . esc_url( admin_url() ) . "'>Dashboard</a>";
			$actions = openstation_multisite_my_sites_actions( $core, $blog_id, $current, $active );
			$urls    = array( esc_url( home_url() ), esc_url( admin_url() ), esc_url( admin_url( 'index.php' ) ) );
			restore_current_blog();
			return array( $actions, $urls );
		};

		list( $actions, $urls ) = $row( $current, true );
		$this->assertStringContainsString( "<a href='{$urls[0]}' target='_blank' rel='noopener'>Visit</a>", $actions );
		$this->assertStringContainsString( "<a href='{$urls[2]}'>Dashboard</a>", $actions );

		list( $actions, $urls ) = $row( $other, true );
		$this->assertStringContainsString( "<a href='{$urls[0]}' target='_blank' rel='noopener'>Visit</a>", $actions );
		$this->assertStringContainsString( "<a href='{$urls[1]}' target='_top'>Dashboard</a>", $actions );

		list( $actions, $urls ) = $row( $other, false );
		$this->assertStringContainsString( "<a href='{$urls[1]}' target='_blank' rel='noopener'>Dashboard</a>", $actions );

		$this->assertSame( '<a href="https://example.org/">Visit</a>', openstation_multisite_my_sites_actions( '<a href="https://example.org/">Visit</a>', $other, $current, true ) );
	}

	public function test_network_sites_row_links_follow_the_shell() {
		$actions = array(
			'edit'    => '<a href="http://example.org/wp-admin/network/site-info.php?id=2">Edit</a>',
			'backend' => '<a href="http://site2.example.org/wp-admin/" class="edit">Dashboard</a>',
			'visit'   => '<a href="http://site2.example.org/" rel="bookmark">Visit</a>',
		);

		$active = openstation_multisite_sites_row_actions( $actions, true );
		$this->assertSame( $actions['edit'], $active['edit'], 'A link inside the network admin stays a window link.' );
		$this->assertSame( '<a target="_top" href="http://site2.example.org/wp-admin/" class="edit">Dashboard</a>', $active['backend'] );
		$this->assertSame( '<a target="_blank" href="http://site2.example.org/" rel="bookmark">Visit</a>', $active['visit'] );

		$inactive = openstation_multisite_sites_row_actions( $actions, false );
		$this->assertSame( '<a target="_blank" href="http://site2.example.org/wp-admin/" class="edit">Dashboard</a>', $inactive['backend'] );

		$named = array( 'visit' => '<a href="http://site2.example.org/" target="_self">Visit</a>' );
		$this->assertSame( $named, openstation_multisite_sites_row_actions( $named, true ) );
	}

	public function test_multisite_payload_names_every_instance() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}
		$blog_id    = get_current_blog_id();
		$other      = self::factory()->blog->create( array( 'path' => '/switcher-other/' ) );
		$site_admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $site_admin );

		$payload = openstation_multisite_payload();
		$this->assertNull( $payload['networkAdmin'], 'A site admin cannot reach the network admin.' );
		$this->assertSame( (string) $blog_id, $payload['current'] );
		$ids = wp_list_pluck( $payload['sites'], 'id' );
		$this->assertContains( (string) $blog_id, $ids );
		$this->assertNotContains( (string) $other, $ids, 'A site admin sees only the sites they belong to.' );
		$this->assertSame(
			get_admin_url( $blog_id, 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ),
			$payload['sites'][ array_search( (string) $blog_id, $ids, true ) ]['shellUrl']
		);

		$super = self::factory()->user->create( array( 'role' => 'administrator' ) );
		grant_super_admin( $super );
		wp_set_current_user( $super );
		$payload = openstation_multisite_payload();
		$this->assertSame(
			network_admin_url( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ),
			$payload['networkAdmin']['shellUrl']
		);

		$this->assertContains( (string) $other, wp_list_pluck( $payload['sites'], 'id' ) );

		$plugin      = plugin_basename( OPENSTATION_FILE );
		$active_here = get_option( 'active_plugins', array() );
		update_option( 'active_plugins', array( $plugin ) );
		$by_id = array_column( openstation_multisite_payload()['sites'], null, 'id' );
		$this->assertTrue( $by_id[ (string) $blog_id ]['active'] );
		$this->assertFalse( $by_id[ (string) $other ]['active'] );
		$this->assertSame( get_admin_url( $other ), $by_id[ (string) $other ]['adminUrl'] );
		update_blog_option( $other, 'active_plugins', array( $plugin ) );
		$this->assertTrue( array_column( openstation_multisite_payload()['sites'], null, 'id' )[ (string) $other ]['active'] );
		update_option( 'active_plugins', $active_here );

		add_filter( 'openstation_multisite_sites', '__return_empty_array' );
		$this->assertSame( array(), openstation_multisite_payload()['sites'] );
		remove_filter( 'openstation_multisite_sites', '__return_empty_array' );
		wp_set_current_user( 0 );
	}

	public function test_shell_lands_in_overview_reads_the_flag() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertFalse( openstation_shell_lands_in_overview() );

		$_GET['openstation_overview'] = '1';
		$this->assertTrue( openstation_shell_lands_in_overview() );

		set_current_screen( 'dashboard' );
		$this->assertFalse( openstation_shell_lands_in_overview() );
		unset( $_GET['openstation_overview'] );
	}

	public function test_shell_root_is_stamped_arriving_for_an_overview_boot() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		update_user_meta( $admin, 'desktop_mode_mode', '1' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		ob_start();
		openstation_render_shell();
		$plain = ob_get_clean();
		$this->assertStringContainsString( 'id="os-shell"', $plain );
		$this->assertStringNotContainsString( 'os-shell--arriving', $plain );

		$_GET['openstation_overview'] = '1';
		ob_start();
		openstation_render_shell();
		$arriving = ob_get_clean();
		unset( $_GET['openstation_overview'] );
		$this->assertStringContainsString( 'class="os-shell os-shell--arriving"', $arriving );

		delete_user_meta( $admin, 'desktop_mode_mode' );
		wp_set_current_user( 0 );
	}

	public function test_get_session_filters_stored_windows_to_the_scope() {
		$user_id = self::factory()->user->create();
		update_user_meta(
			$user_id,
			openstation_session_meta_key( false ),
			array(
				'updated' => 1000,
				'windows' => array(
					array(
						'id'  => 'index-php',
						'url' => admin_url( 'index.php' ),
					),
					array(
						'id'  => 'index-php',
						'url' => admin_url( 'network/index.php' ),
					),
					array(
						'id'     => 'desktop-mode-settings',
						'url'    => '#desktop-mode-settings',
						'native' => true,
					),
				),
			)
		);

		$session = openstation_get_session( $user_id, false );
		$urls    = wp_list_pluck( $session['windows'], 'url' );
		$this->assertSame( array( admin_url( 'index.php' ), '#desktop-mode-settings' ), $urls );
	}
}
