<?php

class Tests_OpenStation_MenuItemUrl extends WP_UnitTestCase {

	public function test_passes_through_absolute_http_url() {
		$url = 'http://example.com/foo';
		$this->assertSame( esc_url_raw( $url ), openstation_menu_item_url( $url ) );
	}

	public function test_passes_through_absolute_https_url() {
		$url = 'https://example.com/foo?bar=baz';
		$this->assertSame( esc_url_raw( $url ), openstation_menu_item_url( $url ) );
	}

	public function test_routes_php_slug_to_admin_url() {
		$this->assertSame( esc_url_raw( admin_url( 'edit.php' ) ), openstation_menu_item_url( 'edit.php' ) );
	}

	public function test_preserves_query_string_on_php_slugs() {
		$this->assertSame(
			esc_url_raw( admin_url( 'edit.php?post_type=page' ) ),
			openstation_menu_item_url( 'edit.php?post_type=page' )
		);
	}

	public function test_routes_plugin_page_slug_through_admin_php() {
		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=my-plugin' ) ),
			openstation_menu_item_url( 'my-plugin' )
		);
	}

	public function test_url_encodes_plugin_page_slug() {
		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=' . rawurlencode( 'plugin with spaces' ) ) ),
			openstation_menu_item_url( 'plugin with spaces' )
		);
	}

	public function test_strips_path_traversal_sequences() {
		$result = openstation_menu_item_url( '../../etc/passwd' );
		$this->assertStringNotContainsString( '..', $result );
	}

	public function test_strips_path_traversal_in_php_slug() {
		$result = openstation_menu_item_url( '../edit.php' );
		$this->assertStringNotContainsString( '..', $result );
		$this->assertStringContainsString( 'edit.php', $result );
	}

	public function test_routes_slug_with_embedded_query_params() {
		$result = openstation_menu_item_url( 'wc-admin&path=/customers' );
		$this->assertStringContainsString( 'page=wc-admin', $result );
		$this->assertStringNotContainsString( 'page=wc-admin%26', $result );
		$this->assertStringNotContainsString( '%3D', $result );

		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
		$this->assertSame( '/customers', $args['path'] );
	}

	public function test_routes_slug_with_multiple_embedded_query_params() {
		$result = openstation_menu_item_url( 'wc-admin&path=/analytics/orders&period=year' );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
		$this->assertSame( '/analytics/orders', $args['path'] );
		$this->assertSame( 'year', $args['period'] );
	}

	public function test_routes_submenu_slug_through_php_parent() {
		global $_parent_pages;
		$_parent_pages['scheduler'] = 'tools.php';

		$this->assertSame(
			esc_url_raw( admin_url( 'tools.php?page=scheduler' ) ),
			openstation_menu_item_url( 'scheduler' )
		);

		unset( $_parent_pages['scheduler'] );
	}

	public function test_routes_submenu_slug_through_php_parent_with_embedded_query() {
		global $_parent_pages;
		$_parent_pages['scheduler'] = 'tools.php';

		$result = openstation_menu_item_url( 'scheduler&status=past-due' );

		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'scheduler', $args['page'] );
		$this->assertSame( 'past-due', $args['status'] );
		$this->assertStringContainsString( 'tools.php', $result );

		unset( $_parent_pages['scheduler'] );
	}

	public function test_routes_submenu_slug_under_slug_parent_through_admin_php() {
		global $_parent_pages;
		$_parent_pages['woocommerce'] = 'woocommerce';
		$_parent_pages['wc-admin']    = 'woocommerce';

		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=wc-admin' ) ),
			openstation_menu_item_url( 'wc-admin' )
		);

		unset( $_parent_pages['woocommerce'], $_parent_pages['wc-admin'] );
	}

	public function test_routes_top_level_slug_through_admin_php() {
		global $_parent_pages;
		$_parent_pages['my-top-level'] = 'my-top-level';

		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=my-top-level' ) ),
			openstation_menu_item_url( 'my-top-level' )
		);

		unset( $_parent_pages['my-top-level'] );
	}

	public function test_falls_back_to_admin_php_for_unregistered_slug() {

		$this->assertSame(
			esc_url_raw( admin_url( 'admin.php?page=unhooked' ) ),
			openstation_menu_item_url( 'unhooked' )
		);
	}

	public function test_embedded_query_param_with_only_key() {

		$result = openstation_menu_item_url( 'wc-admin&' );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wc-admin', $args['page'] );
	}

	public function test_routes_registered_file_path_slug_through_php_parent() {
		global $_parent_pages;
		$_parent_pages['wp-sweep/admin.php'] = 'tools.php';

		$result = openstation_menu_item_url( 'wp-sweep/admin.php' );

		$this->assertStringContainsString( 'tools.php', $result );
		$this->assertStringNotContainsString( admin_url( 'wp-sweep/admin.php' ), $result );
		parse_str( wp_parse_url( html_entity_decode( $result ), PHP_URL_QUERY ), $args );
		$this->assertSame( 'wp-sweep/admin.php', $args['page'] );

		unset( $_parent_pages['wp-sweep/admin.php'] );
	}

	public function test_unregistered_file_path_slug_still_routes_as_direct_file() {
		$this->assertSame(
			esc_url_raw( admin_url( 'network/sites.php' ) ),
			openstation_menu_item_url( 'network/sites.php' )
		);
	}

	public function test_registered_url_style_slug_stays_direct_admin_file_link() {
		global $_parent_pages;
		$_parent_pages['edit.php?post_type=acf-field-group'] = false;

		$this->assertSame(
			esc_url_raw( admin_url( 'edit.php?post_type=acf-field-group' ) ),
			openstation_menu_item_url( 'edit.php?post_type=acf-field-group' )
		);

		unset( $_parent_pages['edit.php?post_type=acf-field-group'] );
	}

	public function test_registered_url_style_submenu_slug_stays_direct_admin_file_link() {
		global $_parent_pages;
		$_parent_pages['edit.php?post_type=acf-field-group'] = false;
		$_parent_pages['edit.php?post_type=acf-post-type']   = 'edit.php?post_type=acf-field-group';

		$this->assertSame(
			esc_url_raw( admin_url( 'edit.php?post_type=acf-post-type' ) ),
			openstation_menu_item_url( 'edit.php?post_type=acf-post-type' )
		);

		unset(
			$_parent_pages['edit.php?post_type=acf-field-group'],
			$_parent_pages['edit.php?post_type=acf-post-type']
		);
	}

	public function test_admin_file_check_ignores_registered_plugin_file_slug_with_query() {
		global $_parent_pages;
		$_parent_pages['wp-sweep/admin.php?tab=cleanup'] = 'tools.php';

		$result = openstation_menu_item_url( 'wp-sweep/admin.php?tab=cleanup' );

		$this->assertStringContainsString( 'tools.php', $result );

		unset( $_parent_pages['wp-sweep/admin.php?tab=cleanup'] );
	}
}
