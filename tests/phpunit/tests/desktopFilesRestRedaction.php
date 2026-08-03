<?php
/**
 * Tests for the viewer-scoped redaction in the files REST shapers:
 *
 *   - Access-gated placements ship a redacted `file` shape (no
 *     entity title/permalink/status across the read boundary).
 *   - The If-Match 409 body hides the parent folder's identity
 *     from out-of-scope viewers.
 *   - `shareSummary.recipientCount` is owner-internal; other
 *     viewers see `0` while keeping the `shared` badge flag.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_Files_RestRedaction extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id = $factory->user->create( array( 'role' => 'author' ) );
		self::$post_id   = $factory->post->create(
			array(
				'post_status' => 'publish',
				'post_title'  => 'Quarterly Numbers',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		open_station_files_install_schema();
		wp_set_current_user( self::$owner_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = open_station_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	private function placement_row( array $overrides = array() ) {
		return array_merge(
			array(
				'id'            => 1,
				'owner_id'      => self::$owner_id,
				'parent_id'     => 0,
				'x'             => 0,
				'y'             => 0,
				'sort_order'    => 0,
				'updated_at_ms' => 123,
				'meta'          => null,
				'file_type'     => 'post',
				'file_ref'      => (string) self::$post_id,
			),
			$overrides
		);
	}

	// ---------------------------------------------------------------
	// Access-gated placement redaction
	// ---------------------------------------------------------------

	/**
	 * @covers ::open_station_files_shape_placement
	 */
	public function test_shape_placement_redacts_access_gated_rows() {
		$shape = open_station_files_shape_placement(
			$this->placement_row( array( 'access_gated' => true ) )
		);

		$this->assertTrue( $shape['accessGated'] );
		$this->assertSame( 'post', $shape['file']['type'] );
		$this->assertSame( (string) self::$post_id, $shape['file']['ref'] );
		$this->assertSame( 'Restricted item', $shape['file']['title'] );
		$this->assertSame( 'dashicons-lock', $shape['file']['icon'] );
		$this->assertSame( '', $shape['file']['previewUrl'] );
		$this->assertTrue( $shape['file']['exists'] );

		// Entity metadata must not cross the read boundary.
		$this->assertArrayNotHasKey( 'link', $shape['file'] );
		$this->assertArrayNotHasKey( 'status', $shape['file'] );
		$this->assertArrayNotHasKey( 'postType', $shape['file'] );
		$this->assertStringNotContainsString(
			'Quarterly Numbers',
			wp_json_encode( $shape )
		);
	}

	/**
	 * @covers ::open_station_files_shape_placement
	 */
	public function test_shape_placement_serializes_normally_without_access_gate() {
		$shape = open_station_files_shape_placement( $this->placement_row() );

		$this->assertFalse( $shape['accessGated'] );
		$this->assertSame( 'Quarterly Numbers', $shape['file']['title'] );
		$this->assertArrayHasKey( 'postType', $shape['file'] );
		$this->assertArrayHasKey( 'status', $shape['file'] );
		$this->assertArrayHasKey( 'link', $shape['file'] );
	}

	// ---------------------------------------------------------------
	// If-Match 409 parent-identity redaction
	// ---------------------------------------------------------------

	private function stale_if_match_request() {
		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/1' );
		$req->set_header( 'If-Match', '1' );
		return $req;
	}

	/**
	 * @covers ::open_station_files_check_if_match
	 */
	public function test_if_match_409_hides_parent_identity_from_out_of_scope_viewer() {
		$folder_id    = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Secret' ) );
		$placement_id = open_station_files_place( self::$owner_id, $folder_id, 'post', (string) self::$post_id );
		$row          = open_station_files_get_placement( $placement_id );

		// Unrelated viewer — no ownership, no share on the folder.
		wp_set_current_user( self::$author_id );
		$err = open_station_files_check_if_match( (int) $row['updated_at_ms'], $this->stale_if_match_request(), $row );

		$this->assertWPError( $err );
		$data = $err->get_error_data();
		$this->assertSame( 409, $data['status'] );
		$this->assertSame( 0, $data['data']['current']['parentId'] );
		$this->assertSame( '', $data['data']['current']['parentName'] );
		$this->assertSame( 0, $data['data']['actor']['id'] );
		$this->assertStringNotContainsString(
			'Secret',
			wp_json_encode( $data )
		);
	}

	/**
	 * @covers ::open_station_files_check_if_match
	 */
	public function test_if_match_409_keeps_parent_identity_for_in_scope_viewer() {
		$folder_id    = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Secret' ) );
		$placement_id = open_station_files_place( self::$owner_id, $folder_id, 'post', (string) self::$post_id );
		$row          = open_station_files_get_placement( $placement_id );

		wp_set_current_user( self::$owner_id );
		$err = open_station_files_check_if_match( (int) $row['updated_at_ms'], $this->stale_if_match_request(), $row );

		$this->assertWPError( $err );
		$data = $err->get_error_data();
		$this->assertSame( $folder_id, $data['data']['current']['parentId'] );
		$this->assertSame( 'Secret', $data['data']['current']['parentName'] );
	}

	// ---------------------------------------------------------------
	// shareSummary recipient count
	// ---------------------------------------------------------------

	/**
	 * @covers ::open_station_files_shape_folder
	 */
	public function test_share_summary_recipient_count_is_owner_only() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		$share_id  = open_station_folder_share_invite( $folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		open_station_folder_share_accept( $share_id, self::$editor_id );
		$row = open_station_files_get_folder( $folder_id );

		// Owner (can manage) sees the real count.
		wp_set_current_user( self::$owner_id );
		$shape = open_station_files_shape_folder( $row );
		$this->assertTrue( $shape['shareSummary']['shared'] );
		$this->assertSame( 1, $shape['shareSummary']['recipientCount'] );

		// Recipient keeps the badge flag but not the roster size.
		wp_set_current_user( self::$editor_id );
		$shape = open_station_files_shape_folder( $row );
		$this->assertTrue( $shape['shareSummary']['shared'] );
		$this->assertSame( 0, $shape['shareSummary']['recipientCount'] );
	}
}
