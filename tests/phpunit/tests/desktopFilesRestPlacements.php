<?php
/**
 * Tests for the placement REST creation handler — specifically
 * the favicon-resolver wiring that runs for `link` placements.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_Files_RestPlacements extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$post_id  = $factory->post->create( array( 'post_status' => 'publish' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		wp_set_current_user( self::$admin_id );
		remove_all_filters( 'openstation_resolve_favicon' );
		remove_all_filters( 'pre_http_request' );
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		remove_all_filters( 'openstation_resolve_favicon' );
		remove_all_filters( 'pre_http_request' );
		parent::tear_down();
	}

	private function build_request( array $params ) {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/placements' );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		return $req;
	}

	/**
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_create_link_placement_stores_iconUrl_when_resolver_returns_data_uri() {
		$synthetic = 'data:image/png;base64,SYNTH';
		add_filter(
			'openstation_resolve_favicon',
			static function () use ( $synthetic ) {
				return $synthetic;
			}
		);

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
			'x'        => 10,
			'y'        => 20,
			'meta'     => array( 'name' => 'Example' ),
		) );

		$resp = openstation_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );

		$data = $resp->get_data();
		$this->assertIsArray( $data );
		$this->assertSame( 'link', $data['file']['type'] );
		$this->assertIsArray( $data['meta'] );
		$this->assertSame( 'Example', $data['meta']['name'] );
		$this->assertSame( $synthetic, $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_create_link_placement_omits_iconUrl_when_resolver_returns_null() {
		add_filter( 'openstation_resolve_favicon', '__return_null' );

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
			'meta'     => array( 'name' => 'Example' ),
		) );

		$resp = openstation_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );
		$data = $resp->get_data();
		$this->assertSame( 'Example', $data['meta']['name'] );
		$this->assertArrayNotHasKey( 'iconUrl', (array) $data['meta'] );
	}

	/**
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_create_link_placement_works_without_user_meta() {
		// No client-supplied `meta` at all — resolver still attaches
		// `iconUrl`.
		add_filter(
			'openstation_resolve_favicon',
			static function () {
				return 'data:image/png;base64,XX';
			}
		);

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
		) );

		$resp = openstation_files_rest_create_placement( $req );
		$data = $resp->get_data();
		$this->assertIsArray( $data['meta'] );
		$this->assertSame( 'data:image/png;base64,XX', $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_create_non_link_placement_does_not_call_resolver() {
		$called = 0;
		add_filter(
			'openstation_resolve_favicon',
			static function ( $result ) use ( &$called ) {
				$called++;
				return $result;
			}
		);

		$req = $this->build_request( array(
			'type'     => 'post',
			'ref'      => (string) self::$post_id,
			'parentId' => 0,
		) );

		$resp = openstation_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );
		$this->assertSame( 0, $called );
	}

	/**
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_create_link_with_empty_ref_skips_resolver() {
		$called = 0;
		add_filter(
			'openstation_resolve_favicon',
			static function ( $result ) use ( &$called ) {
				$called++;
				return $result;
			}
		);

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => '',
			'parentId' => 0,
		) );

		// `link` file's `can_read` returns true, but `openstation_files_place`
		// still inserts even with an empty ref because the type permits it.
		// The point of this test is that the resolver is never invoked.
		openstation_files_rest_create_placement( $req );
		$this->assertSame( 0, $called );
	}
}
