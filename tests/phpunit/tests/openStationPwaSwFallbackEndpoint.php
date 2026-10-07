<?php

class Tests_OpenStation_PwaSwFallbackEndpoint extends WP_UnitTestCase {

	private $saved_server;
	private $saved_get;

	public function set_up() {
		parent::set_up();
		$this->saved_server = $_SERVER;
		$this->saved_get    = $_GET;
	}

	public function tear_down() {
		$_SERVER = $this->saved_server;
		$_GET    = $this->saved_get;
		parent::tear_down();
	}

	public function test_fallback_url_is_extensionless_and_root_pathed() {
		$url  = openstation_pwa_sw_fallback_url();
		$path = wp_parse_url( $url, PHP_URL_PATH );

		$this->assertStringContainsString( 'openstation_sw=1', $url );

		$this->assertSame( '/', $path );
	}

	public function test_query_var_resolves_to_sw_endpoint() {
		$_SERVER['REQUEST_URI'] = '/?openstation_sw=1';
		$_GET['openstation_sw'] = '1';

		$this->assertSame( 'sw', openstation_pwa_endpoint_kind() );
	}

	public function test_query_var_off_the_root_does_not_match() {
		$_SERVER['REQUEST_URI'] = '/some/other/page/?openstation_sw=1';
		$_GET['openstation_sw'] = '1';

		$this->assertSame( '', openstation_pwa_endpoint_kind() );
	}

	public function test_other_query_values_do_not_match() {
		$_SERVER['REQUEST_URI'] = '/?openstation_sw=0';
		$_GET['openstation_sw'] = '0';

		$this->assertSame( '', openstation_pwa_endpoint_kind() );
	}

	public function test_pretty_sw_path_still_resolves() {
		$_SERVER['REQUEST_URI'] = '/openstation/sw.js';
		$_GET                   = array();

		$this->assertSame( 'sw', openstation_pwa_endpoint_kind() );
	}
}
