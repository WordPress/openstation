<?php
/**
 * Tests for the download endpoints: access matrix with 404
 * masking, stream markers, zip manifest collection (nesting,
 * reference skipping, empty dirs, caps, name dedupe), and the
 * ZipArchive round-trip.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_Downloads extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $reader_id;
	protected static $stranger_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id    = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$reader_id   = $factory->user->create( array( 'role' => 'editor' ) );
		self::$stranger_id = $factory->user->create( array( 'role' => 'editor' ) );
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
		remove_all_filters( 'open_station_stored_files_zip_caps' );
		$base = open_station_stored_files_dir();
		if ( is_dir( $base ) ) {
			$this->rrmdir( $base );
		}
		parent::tear_down();
	}

	private function rrmdir( $dir ) {
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			is_dir( $entry ) ? $this->rrmdir( $entry ) : unlink( $entry );
		}
		foreach ( (array) glob( $dir . '/.htaccess' ) as $entry ) {
			unlink( $entry );
		}
		rmdir( $dir );
	}

	private function make_stored_file( $owner_id, $name, $contents = 'bytes', $mime = 'text/plain' ) {
		$dir       = open_station_stored_files_ensure_dir( $owner_id );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		return open_station_stored_files_create( $owner_id, array(
			'display_name' => $name,
			'disk_name'    => $disk_name,
			'size_bytes'   => strlen( $contents ),
			'mime'         => $mime,
		) );
	}

	private function download_request( $file_id ) {
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/uploads/' . $file_id . '/download' );
		$req['id'] = $file_id;
		return open_station_files_rest_download_file( $req );
	}

	private function zip_request( $folder_id ) {
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/folders/' . $folder_id . '/download' );
		$req['id'] = $folder_id;
		return open_station_files_rest_download_folder_zip( $req );
	}

	public function test_owner_gets_stream_marker_with_correct_path() {
		$id  = $this->make_stored_file( self::$owner_id, 'a.txt', 'file contents' );
		$res = $this->download_request( $id );
		$this->assertNotWPError( $res );
		$stream = $res->get_data()['__open_station_stream'];
		$this->assertSame( 'a.txt', $stream['name'] );
		$this->assertSame( 'text/plain', $stream['mime'] );
		$this->assertFalse( $stream['delete_after'] );
		$this->assertSame( 'file contents', file_get_contents( $stream['path'] ) );
	}

	public function test_stranger_gets_masked_404() {
		$id = $this->make_stored_file( self::$owner_id, 'a.txt' );
		wp_set_current_user( self::$stranger_id );
		$res = $this->download_request( $id );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );

		// Missing id: exactly the same shape.
		$res2 = $this->download_request( 999999 );
		$this->assertWPError( $res2 );
		$this->assertSame( $res->get_error_code(), $res2->get_error_code() );
		$this->assertSame( 404, $res2->get_error_data()['status'] );
	}

	public function test_file_share_recipient_can_download_until_revoked() {
		$id       = $this->make_stored_file( self::$owner_id, 'shared.txt' );
		open_station_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$share_id = open_station_stored_file_share_invite( $id, self::$owner_id, self::$reader_id );
		$this->assertIsInt( $share_id );
		open_station_stored_file_share_accept( $share_id, self::$reader_id );

		wp_set_current_user( self::$reader_id );
		$res = $this->download_request( $id );
		$this->assertNotWPError( $res );

		wp_set_current_user( self::$owner_id );
		open_station_stored_file_share_revoke( $share_id, self::$owner_id );

		wp_set_current_user( self::$reader_id );
		$res2 = $this->download_request( $id );
		$this->assertWPError( $res2 );
		$this->assertSame( 404, $res2->get_error_data()['status'] );
	}

	public function test_zip_contains_nested_paths_skips_references_and_keeps_empty_dirs() {
		// Tree: Root/ { a.txt, Sub/ { b.txt }, Empty/, <post reference> }
		$root_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Root' ) );
		$sub_id  = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Sub' ) );
		$empty_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Empty' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $root_id );
		open_station_files_place( self::$owner_id, (int) $root_id, 'folder', (string) $sub_id );
		open_station_files_place( self::$owner_id, (int) $root_id, 'folder', (string) $empty_id );

		$a = $this->make_stored_file( self::$owner_id, 'a.txt', 'AAA' );
		$b = $this->make_stored_file( self::$owner_id, 'b.txt', 'BBB' );
		open_station_files_place( self::$owner_id, (int) $root_id, 'upload', (string) $a );
		open_station_files_place( self::$owner_id, (int) $sub_id, 'upload', (string) $b );

		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		open_station_files_place( self::$owner_id, (int) $root_id, 'post', (string) $post_id );

		$res = $this->zip_request( (int) $root_id );
		$this->assertNotWPError( $res );
		$stream = $res->get_data()['__open_station_stream'];
		$this->assertSame( 'Root.zip', $stream['name'] );
		$this->assertSame( 'application/zip', $stream['mime'] );
		$this->assertTrue( $stream['delete_after'] );

		$zip = new ZipArchive();
		$this->assertTrue( $zip->open( $stream['path'] ) );
		$names = array();
		for ( $i = 0; $i < $zip->numFiles; $i++ ) {
			$names[] = $zip->getNameIndex( $i );
		}
		$zip->close();
		wp_delete_file( $stream['path'] );

		$this->assertContains( 'a.txt', $names );
		$this->assertContains( 'Sub/b.txt', $names );
		$this->assertContains( 'Empty/', $names );
		// The post reference contributed nothing.
		$this->assertCount( 3, $names );
	}

	public function test_zip_dedupes_case_colliding_names() {
		$root_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Dupes' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $root_id );
		$a = $this->make_stored_file( self::$owner_id, 'report.pdf', '1' );
		$b = $this->make_stored_file( self::$owner_id, 'Report.pdf', '2' );
		open_station_files_place( self::$owner_id, (int) $root_id, 'upload', (string) $a );
		open_station_files_place( self::$owner_id, (int) $root_id, 'upload', (string) $b );

		$res    = $this->zip_request( (int) $root_id );
		$this->assertNotWPError( $res );
		$stream = $res->get_data()['__open_station_stream'];
		$zip    = new ZipArchive();
		$zip->open( $stream['path'] );
		$names = array();
		for ( $i = 0; $i < $zip->numFiles; $i++ ) {
			$names[] = $zip->getNameIndex( $i );
		}
		$zip->close();
		wp_delete_file( $stream['path'] );

		sort( $names );
		$this->assertCount( 2, $names );
		$this->assertNotSame( strtolower( $names[0] ), strtolower( $names[1] ) );
	}

	public function test_zip_cap_exceeded_yields_friendly_error() {
		add_filter( 'open_station_stored_files_zip_caps', function () {
			return array( 'max_entries' => 1, 'max_bytes' => MB_IN_BYTES );
		} );
		$root_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Big' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $root_id );
		foreach ( array( 'a.txt', 'b.txt' ) as $n ) {
			$fid = $this->make_stored_file( self::$owner_id, $n );
			open_station_files_place( self::$owner_id, (int) $root_id, 'upload', (string) $fid );
		}
		$res = $this->zip_request( (int) $root_id );
		$this->assertWPError( $res );
		$this->assertSame( 'open_station_stored_files_zip_too_big', $res->get_error_code() );
	}

	public function test_zip_of_unshared_folder_is_masked_404_for_stranger() {
		$root_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		wp_set_current_user( self::$stranger_id );
		$res = $this->zip_request( (int) $root_id );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );
	}

	public function test_folder_share_reader_can_zip() {
		$root_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $root_id );
		$fid = $this->make_stored_file( self::$owner_id, 'doc.txt' );
		open_station_files_place( self::$owner_id, (int) $root_id, 'upload', (string) $fid );

		$share_id = open_station_folder_share_invite( (int) $root_id, self::$owner_id, 'user', (string) self::$reader_id, 'read' );
		open_station_folder_share_accept( $share_id, self::$reader_id );

		wp_set_current_user( self::$reader_id );
		$res = $this->zip_request( (int) $root_id );
		$this->assertNotWPError( $res );
		wp_delete_file( $res->get_data()['__open_station_stream']['path'] );
	}

	public function test_serve_filter_ignores_foreign_routes_and_errors() {
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/placements' );
		$this->assertFalse(
			open_station_files_serve_download( false, new WP_REST_Response( array( 'x' => 1 ) ), $req )
		);
		$dl_req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/uploads/5/download' );
		// A 404 error result must fall through to JSON serving.
		$this->assertFalse(
			open_station_files_serve_download( false, new WP_REST_Response( array( 'code' => 'x' ), 404 ), $dl_req )
		);
	}

	public function test_zip_unique_name_helper() {
		$used = array();
		$this->assertSame( 'a.txt', open_station_files_zip_unique_name( 'a.txt', $used ) );
		$this->assertSame( 'a (2).txt', open_station_files_zip_unique_name( 'a.txt', $used ) );
		$this->assertSame( 'A (3).txt', open_station_files_zip_unique_name( 'A.txt', $used ) );
		$this->assertSame( 'noext', open_station_files_zip_unique_name( 'noext', $used ) );
		$this->assertSame( 'noext (2)', open_station_files_zip_unique_name( 'noext', $used ) );
	}
}
