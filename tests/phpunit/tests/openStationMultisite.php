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
 * @covers ::openstation_session_url_in_scope
 * @covers ::openstation_sanitize_session
 * @covers ::openstation_get_session
 * @covers ::openstation_multisite_payload
 * @covers ::openstation_is_core_menu_slug
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
	 * A blob written before the per-admin keys split — or by an older
	 * client posting to the wrong scope — heals on READ, not just on the
	 * next write. Native windows carry no admin URL and always survive.
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
