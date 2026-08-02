<?php
/**
 * Tests for the placement REST creation handler — specifically
 * the favicon-resolver wiring that runs for external URL placements.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-files
 */
class Tests_DesktopMode_Files_RestPlacements extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$post_id  = $factory->post->create( array( 'post_status' => 'publish' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_files_install_schema();
		wp_set_current_user( self::$admin_id );
		remove_all_filters( 'desktop_mode_resolve_favicon' );
		remove_all_filters( 'pre_http_request' );
	}

	public function tear_down() {
		global $wpdb;
		$tables = desktop_mode_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		remove_all_filters( 'desktop_mode_resolve_favicon' );
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

	private function build_metadata_request( $id ) {
		$req       = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/placements/' . (int) $id . '/web-metadata' );
		$req['id'] = (int) $id;
		return $req;
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_link_placement_stores_iconUrl_when_resolver_returns_data_uri() {
		$synthetic = 'data:image/png;base64,SYNTH';
		add_filter(
			'desktop_mode_resolve_favicon',
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

		$resp = desktop_mode_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );

		$data = $resp->get_data();
		$this->assertIsArray( $data );
		$this->assertSame( 'link', $data['file']['type'] );
		$this->assertIsArray( $data['meta'] );
		$this->assertSame( 'Example', $data['meta']['name'] );
		$this->assertSame( $synthetic, $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_bookmark_placement_stores_iconUrl_when_resolver_returns_data_uri() {
		add_filter(
			'desktop_mode_resolve_favicon',
			static function () {
				return 'data:image/png;base64,BOOKMARK';
			}
		);

		$resp = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type'     => 'bookmark',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
		) ) );
		$data = $resp->get_data();
		$this->assertSame( 'bookmark', $data['file']['type'] );
		$this->assertSame( 'data:image/png;base64,BOOKMARK', $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_link_placement_omits_iconUrl_when_resolver_returns_null() {
		add_filter( 'desktop_mode_resolve_favicon', '__return_null' );

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
			'meta'     => array( 'name' => 'Example' ),
		) );

		$resp = desktop_mode_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );
		$data = $resp->get_data();
		$this->assertSame( 'Example', $data['meta']['name'] );
		$this->assertArrayNotHasKey( 'iconUrl', (array) $data['meta'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_link_placement_works_without_user_meta() {
		// No client-supplied `meta` at all — resolver still attaches
		// `iconUrl`.
		add_filter(
			'desktop_mode_resolve_favicon',
			static function () {
				return 'data:image/png;base64,XX';
			}
		);

		$req = $this->build_request( array(
			'type'     => 'link',
			'ref'      => 'https://example.com/',
			'parentId' => 0,
		) );

		$resp = desktop_mode_files_rest_create_placement( $req );
		$data = $resp->get_data();
		$this->assertIsArray( $data['meta'] );
		$this->assertSame( 'data:image/png;base64,XX', $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_non_link_placement_does_not_call_resolver() {
		$called = 0;
		add_filter(
			'desktop_mode_resolve_favicon',
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

		$resp = desktop_mode_files_rest_create_placement( $req );
		$this->assertInstanceOf( 'WP_REST_Response', $resp );
		$this->assertSame( 0, $called );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_link_with_empty_ref_skips_resolver() {
		$called = 0;
		add_filter(
			'desktop_mode_resolve_favicon',
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

		// `link` file's `can_read` returns true, but `desktop_mode_files_place`
		// still inserts even with an empty ref because the type permits it.
		// The point of this test is that the resolver is never invoked.
		desktop_mode_files_rest_create_placement( $req );
		$this->assertSame( 0, $called );
	}

	/**
	 * @covers ::desktop_mode_files_rest_create_placement
	 */
	public function test_create_embed_rejects_unsafe_or_credentialed_urls() {
		foreach ( array( 'javascript:alert(1)', 'https://user:pass@example.com/' ) as $url ) {
			$result = desktop_mode_files_rest_create_placement(
				$this->build_request( array( 'type' => 'embed', 'ref' => $url ) )
			);
			$this->assertWPError( $result );
			$this->assertSame( 'desktop_mode_files_invalid_web_url', $result->get_error_code() );
		}
	}

	/**
	 * @covers ::desktop_mode_files_place
	 */
	public function test_duplicate_embed_preserves_later_metadata_while_repositioning() {
		$meta = array(
			'name'    => 'My later rename',
			'iconUrl' => 'data:image/png;base64,AA',
			'window'  => array( 'x' => 4, 'y' => 5, 'width' => 640, 'height' => 480 ),
		);
		$first = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
			'x'    => 16,
			'y'    => 16,
			'meta' => $meta,
		) ) );
		$id = $first->get_data()['id'];

		$second = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
			'x'    => 208,
			'y'    => 112,
			'meta' => array( 'name' => 'example.com' ),
		) ) );
		$data = $second->get_data();
		$this->assertSame( $id, $data['id'] );
		$this->assertSame( 208, $data['x'] );
		$this->assertSame( 112, $data['y'] );
		$this->assertSame( $meta, $data['meta'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_enrich_web_metadata
	 */
	public function test_metadata_enrichment_merges_without_overwriting_name_or_window() {
		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'offline', 'Network unavailable' );
			}
		);
		add_filter(
			'desktop_mode_resolve_favicon',
			static function () {
				return 'data:image/png;base64,SYNTH';
			}
		);
		$window = array( 'x' => 4, 'y' => 5, 'width' => 640, 'height' => 480 );
		$created = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
			'meta' => array( 'name' => 'Custom name', 'window' => $window ),
		) ) );

		$response = desktop_mode_files_rest_enrich_web_metadata(
			$this->build_metadata_request( $created->get_data()['id'] )
		);
		$data = $response->get_data();
		$this->assertSame( 'Custom name', $data['meta']['name'] );
		$this->assertSame( $window, $data['meta']['window'] );
		$this->assertSame( 'data:image/png;base64,SYNTH', $data['meta']['iconUrl'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_enrich_web_metadata
	 */
	public function test_metadata_enrichment_adds_sanitized_title_and_survives_network_failure() {
		$page = array(
			'response' => array( 'code' => 200, 'message' => 'OK' ),
			'body'     => '<html><head><title>  Example &amp; Friends  </title></head></html>',
			'headers'  => array( 'content-type' => 'text/html' ),
			'cookies'  => array(),
			'filename' => null,
		);
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( $page ) {
				return false !== strpos( $url, '/favicon.ico' )
					? new WP_Error( 'offline', 'No icon' )
					: $page;
			},
			10,
			3
		);
		$created = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
		) ) );
		$response = desktop_mode_files_rest_enrich_web_metadata(
			$this->build_metadata_request( $created->get_data()['id'] )
		);
		$this->assertSame( 'Example & Friends', $response->get_data()['meta']['name'] );

		remove_all_filters( 'pre_http_request' );
		add_filter( 'pre_http_request', static function () {
			return new WP_Error( 'offline', 'Network unavailable' );
		} );
		$again = desktop_mode_files_rest_enrich_web_metadata(
			$this->build_metadata_request( $created->get_data()['id'] )
		);
		$this->assertInstanceOf( 'WP_REST_Response', $again );
		$this->assertSame( 'Example & Friends', $again->get_data()['meta']['name'] );
	}

	/**
	 * @covers ::desktop_mode_files_rest_enrich_web_metadata
	 */
	public function test_metadata_enrichment_honors_authorization_and_deleted_rows() {
		$created = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
		) ) );
		$id = $created->get_data()['id'];
		$other = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $other );
		$forbidden = desktop_mode_files_rest_enrich_web_metadata( $this->build_metadata_request( $id ) );
		$this->assertWPError( $forbidden );
		$this->assertSame( 403, $forbidden->get_error_data()['status'] );

		wp_set_current_user( self::$admin_id );
		desktop_mode_files_trash_placement( self::$admin_id, $id );
		$missing = desktop_mode_files_rest_enrich_web_metadata( $this->build_metadata_request( $id ) );
		$this->assertWPError( $missing );
		$this->assertSame( 404, $missing->get_error_data()['status'] );
	}

	/**
	 * @covers ::desktop_mode_files_replace_meta_if_unchanged
	 */
	public function test_atomic_metadata_replace_refuses_to_overwrite_a_later_rename() {
		$created = desktop_mode_files_rest_create_placement( $this->build_request( array(
			'type' => 'embed',
			'ref'  => 'https://example.com/',
			'meta' => array( 'name' => 'Initial name' ),
		) ) );
		$id       = $created->get_data()['id'];
		$expected = desktop_mode_files_get_placement( $id )['updated_at_ms'];
		$later    = array(
			'name'   => 'Renamed while loading',
			'window' => array( 'x' => 20, 'y' => 30, 'width' => 700, 'height' => 500 ),
		);
		desktop_mode_files_move( $id, self::$admin_id, array( 'meta' => $later ) );

		$result = desktop_mode_files_replace_meta_if_unchanged(
			$id,
			self::$admin_id,
			$expected,
			array( 'name' => 'Initial name', 'iconUrl' => 'data:image/png;base64,STALE' )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_files_metadata_race', $result->get_error_code() );
		$this->assertSame( $later, desktop_mode_files_get_placement( $id )['meta'] );
	}
}
