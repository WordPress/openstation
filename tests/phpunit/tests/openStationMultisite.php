<?php
/**
 * Nothing multisite leaking into an install with no network, and the
 * session's per-admin scoping. The first guards a silent failure — a
 * session key that gained a suffix would empty every desktop on
 * upgrade, and `settings.php` counting as Core would file a plugin's
 * own menu in the dock's Core zone. The rest pin the network admin's
 * own session: its meta key, and the scope gate that keeps one admin's
 * windows out of the other's desktop (the site and network desktops
 * derive the same window ids — `index-php` is the site dashboard on
 * one, the network dashboard on the other — so a shared or leaking
 * blob restored the wrong admin's dashboard under the dock's tile).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @covers ::openstation_session_meta_key
 * @covers ::openstation_filter_wpmu_drop_tables
 * @covers ::openstation_site_table_names
 * @covers ::openstation_multisite_sites
 * @covers ::openstation_shell_lands_in_overview
 * @covers ::openstation_session_window_url_ok
 * @covers ::openstation_session_url_in_scope
 * @covers ::openstation_sanitize_session
 * @covers ::openstation_get_session
 * @covers ::openstation_multisite_payload
 * @covers ::openstation_is_core_menu_slug
 * @covers ::openstation_menu_refresh_probe_screen_id
 */
class Tests_OpenStation_Multisite extends WP_UnitTestCase {

	public function test_nothing_multisite_leaks_into_a_single_site_install() {
		$this->assertSame( OPENSTATION_SESSION_META_KEY, openstation_session_meta_key() );
		$this->assertNull( openstation_multisite_payload() );
		$this->assertFalse( openstation_is_core_menu_slug( 'settings.php' ) );
		$this->assertFalse( openstation_is_core_menu_slug( 'sites.php' ) );
		// The site admin's own Settings is unaffected either way.
		$this->assertTrue( openstation_is_core_menu_slug( 'options-general.php' ) );
	}

	public function test_network_session_has_its_own_meta_key() {
		$this->assertSame( OPENSTATION_SESSION_META_KEY . '_network', openstation_session_meta_key( true ) );
		$this->assertSame( OPENSTATION_SESSION_META_KEY, openstation_session_meta_key( false ) );
	}

	/**
	 * The refresh probe's placeholder screen keeps the request's admin
	 * context. `WP_Screen::get()` reads a bare id's context off its
	 * suffix, so a plain `admin` screen turned a network probe into a
	 * site request from that point on: `self_admin_url()` resolved every
	 * network menu slug against the site admin, and the dock harvested
	 * for a Network Admin Space sent its Plugins tile to the site's
	 * `plugins.php` (whose payload then repainted the dock with the site
	 * menu).
	 */
	public function test_probe_screen_id_keeps_the_admin_context() {
		set_current_screen( 'sites-network' );
		$this->assertTrue( is_network_admin() );
		$this->assertSame( 'admin-network', openstation_menu_refresh_probe_screen_id() );
		// The Core behaviour the id relies on: the suffix carries the
		// context, a bare `admin` drops it.
		$this->assertTrue( WP_Screen::get( 'admin-network' )->in_admin( 'network' ) );
		$this->assertFalse( WP_Screen::get( 'admin' )->in_admin( 'network' ) );
		// What the probe's payload builder then resolves slugs against.
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

	/**
	 * A window persisted for one admin never sanitizes into the other's
	 * session, whichever scope the save addresses.
	 */
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

	/**
	 * Deleting a site must drop every table the plugin created there.
	 *
	 * @covers ::openstation_filter_wpmu_drop_tables
	 * @covers ::openstation_site_table_names
	 */
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

	/**
	 * The drop list is static on purpose (the games module, owner of
	 * two tables, only loads while its toggle is on) — so this pins it
	 * against the loaded schema helpers: a table added to a schema
	 * without being added to the drop list fails here.
	 *
	 * @covers ::openstation_site_table_names
	 */
	public function test_drop_tables_list_covers_every_schema_helper_table() {
		global $wpdb;
		$helper_tables = array_values( openstation_files_table_names() );
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

	/**
	 * Another site's window never persists in this session, whichever
	 * desktop it sits on: on a network every site is its own
	 * OpenStation, and a site's windows live in that site's shell.
	 *
	 * @covers ::openstation_sanitize_session
	 * @covers ::openstation_session_window_url_ok
	 */
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

	/**
	 * A desktop persisted by the site-Spaces model carried a `scope`, a
	 * desk hosting another admin. Every site is its own OpenStation now,
	 * so the desk has nothing left to host: dropped on read, the active
	 * desktop moved off it, and the next save writes it out.
	 *
	 * @covers ::openstation_get_session
	 */
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

	/**
	 * On a network every site is its own OpenStation: the block names
	 * this instance, every site the user may switch to, and the network
	 * admin only for those who can reach it.
	 *
	 * @covers ::openstation_multisite_payload
	 * @covers ::openstation_multisite_sites
	 */
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
		// A super admin can reach every site, member or not.
		$this->assertContains( (string) $other, wp_list_pluck( $payload['sites'], 'id' ) );

		// The filter is where a large network trims the row.
		add_filter( 'openstation_multisite_sites', '__return_empty_array' );
		$this->assertSame( array(), openstation_multisite_payload()['sites'] );
		remove_filter( 'openstation_multisite_sites', '__return_empty_array' );
		wp_set_current_user( 0 );
	}

	/**
	 * The overview flag is a boot arg of the shell screen and nothing
	 * else: how a switch from another site's overview lands in this one's.
	 *
	 * @covers ::openstation_shell_lands_in_overview
	 */
	public function test_shell_lands_in_overview_reads_the_flag() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertFalse( openstation_shell_lands_in_overview() );

		$_GET['openstation_overview'] = '1';
		$this->assertTrue( openstation_shell_lands_in_overview() );

		// Only the shell screen consumes it.
		set_current_screen( 'dashboard' );
		$this->assertFalse( openstation_shell_lands_in_overview() );
		unset( $_GET['openstation_overview'] );
	}

	/**
	 * A blob written before the per-admin keys split — or by an older
	 * client posting to the wrong scope — heals on READ, not just on the
	 * next write. Native windows carry no admin URL and always survive.
	 *
	 * @covers ::openstation_get_session
	 */
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
