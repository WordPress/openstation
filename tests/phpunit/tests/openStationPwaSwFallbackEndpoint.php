<?php
/**
 * Tests for the extensionless service-worker fallback endpoint.
 *
 * Some hosts' web servers (WordPress.com) 404 virtual `.js` paths
 * before WordPress runs, so `/openstation/sw.js` is unservable there
 * while the extensionless manifest route works. The fallback serves the
 * same bytes at `/?openstation_sw=1`; `src/pwa/sw-register.ts` retries
 * registration with it when the pretty URL fails.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_PwaSwFallbackEndpoint extends WP_UnitTestCase {

	/**
	 * @var array Saved superglobal slices restored in tear_down.
	 */
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

	/**
	 * @covers ::openstation_pwa_sw_fallback_url
	 */
	public function test_fallback_url_is_extensionless_and_root_pathed() {
		$url  = openstation_pwa_sw_fallback_url();
		$path = wp_parse_url( $url, PHP_URL_PATH );

		$this->assertStringContainsString( 'openstation_sw=1', $url );
		// The script URL's path decides the SW's default max scope —
		// it must be the site root, with no file extension in sight.
		$this->assertSame( '/', $path );
	}

	/**
	 * @covers ::openstation_pwa_endpoint_kind
	 */
	public function test_query_var_resolves_to_sw_endpoint() {
		$_SERVER['REQUEST_URI'] = '/?openstation_sw=1';
		$_GET['openstation_sw'] = '1';

		$this->assertSame( 'sw', openstation_pwa_endpoint_kind() );
	}

	/**
	 * The fallback is the site root and nothing else. Matching the
	 * query on any path would make every URL a service-worker
	 * endpoint — harmless in effect, but wider than the contract, and
	 * a worker's scope comes from the path it is served from.
	 *
	 * @covers ::openstation_pwa_endpoint_kind
	 */
	public function test_query_var_off_the_root_does_not_match() {
		$_SERVER['REQUEST_URI'] = '/some/other/page/?openstation_sw=1';
		$_GET['openstation_sw'] = '1';

		$this->assertSame( '', openstation_pwa_endpoint_kind() );
	}

	/**
	 * @covers ::openstation_pwa_endpoint_kind
	 */
	public function test_other_query_values_do_not_match() {
		$_SERVER['REQUEST_URI'] = '/?openstation_sw=0';
		$_GET['openstation_sw'] = '0';

		$this->assertSame( '', openstation_pwa_endpoint_kind() );
	}

	/**
	 * The pretty path keeps working — the fallback is additive.
	 *
	 * @covers ::openstation_pwa_endpoint_kind
	 */
	public function test_pretty_sw_path_still_resolves() {
		$_SERVER['REQUEST_URI'] = '/openstation/sw.js';
		$_GET                   = array();

		$this->assertSame( 'sw', openstation_pwa_endpoint_kind() );
	}
}
