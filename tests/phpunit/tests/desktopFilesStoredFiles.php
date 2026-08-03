<?php
/**
 * Tests for the stored-files store (real per-user file storage):
 * disk layout + protection files, CRUD, access resolver, deletion
 * contract (purge cascade), reconciliation sweep, the `upload`
 * file type, and the owner-lock gates.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_StoredFiles extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $other_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$other_id = $factory->user->create( array( 'role' => 'editor' ) );
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
		$this->rrmdir( open_station_stored_files_dir() );
		parent::tear_down();
	}

	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			if ( is_dir( $entry ) ) {
				$this->rrmdir( $entry );
			} else {
				unlink( $entry );
			}
		}
		foreach ( (array) glob( $dir . '/.htaccess' ) as $entry ) {
			unlink( $entry );
		}
		rmdir( $dir );
	}

	/**
	 * Creates a stored file with real bytes on disk. Returns the row id.
	 */
	private function make_stored_file( $owner_id, $name = 'report.pdf', $contents = 'PDFBYTES', $mime = 'application/pdf' ) {
		$dir = open_station_stored_files_ensure_dir( $owner_id );
		$this->assertIsString( $dir );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		$id = open_station_stored_files_create( $owner_id, array(
			'display_name' => $name,
			'disk_name'    => $disk_name,
			'size_bytes'   => strlen( $contents ),
			'mime'         => $mime,
		) );
		$this->assertIsInt( $id );
		return $id;
	}

	public function test_ensure_dir_writes_protection_files() {
		open_station_stored_files_ensure_dir( self::$owner_id );
		$base = open_station_stored_files_dir();
		$this->assertFileExists( $base . '/.htaccess' );
		$this->assertFileExists( $base . '/index.php' );
		$this->assertFileExists( open_station_stored_files_dir( self::$owner_id ) . '/index.php' );
		$rules = file_get_contents( $base . '/.htaccess' );
		$this->assertStringContainsString( 'Require all denied', $rules );
		$this->assertStringContainsString( 'Deny from all', $rules );
	}

	public function test_create_get_delete_roundtrip() {
		$id  = $this->make_stored_file( self::$owner_id );
		$row = open_station_stored_files_get( $id );
		$this->assertSame( 'report.pdf', $row['display_name'] );
		$this->assertSame( 8, $row['size_bytes'] );
		$path = open_station_stored_file_path( $row );
		$this->assertFileExists( $path );

		$this->assertTrue( open_station_stored_files_delete( $id ) );
		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_create_rejects_bad_disk_name() {
		$result = open_station_stored_files_create( self::$owner_id, array(
			'display_name' => 'x.txt',
			'disk_name'    => '../../evil',
			'size_bytes'   => 1,
			'mime'         => 'text/plain',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_stored_files_bad_disk_name', $result->get_error_code() );
	}

	public function test_path_rejects_traversal_disk_name() {
		$row = array(
			'owner_id'  => self::$owner_id,
			'disk_name' => '../outside',
		);
		$this->assertNull( open_station_stored_file_path( $row ) );
	}

	public function test_total_bytes_sums_per_owner() {
		$this->make_stored_file( self::$owner_id, 'a.txt', 'aaaa', 'text/plain' );
		$this->make_stored_file( self::$owner_id, 'b.txt', 'bbbbbb', 'text/plain' );
		$this->make_stored_file( self::$other_id, 'c.txt', 'cc', 'text/plain' );
		$this->assertSame( 10, open_station_stored_files_total_bytes( self::$owner_id ) );
		$this->assertSame( 2, open_station_stored_files_total_bytes( self::$other_id ) );
	}

	public function test_rename_updates_display_name_and_bumps_placements() {
		$id = $this->make_stored_file( self::$owner_id );
		$placement_id = open_station_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$this->assertIsInt( $placement_id );
		$before = open_station_files_get_placement( $placement_id )['updated_at_ms'];

		// Force a measurable clock delta.
		usleep( 2000 );
		$this->assertTrue( open_station_stored_files_rename( $id, 'renamed.pdf' ) );
		$this->assertSame( 'renamed.pdf', open_station_stored_files_get( $id )['display_name'] );
		$after = open_station_files_get_placement( $placement_id )['updated_at_ms'];
		$this->assertGreaterThan( $before, $after );
	}

	public function test_owner_can_read_stranger_cannot() {
		$id = $this->make_stored_file( self::$owner_id );
		$this->assertTrue( open_station_stored_file_user_can_read( $id, self::$owner_id ) );
		$this->assertFalse( open_station_stored_file_user_can_read( $id, self::$other_id ) );
	}

	public function test_folder_share_reader_can_read_contained_upload() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		open_station_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = open_station_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'read' );
		$this->assertIsInt( $share_id );
		open_station_folder_share_accept( $share_id, self::$other_id );

		$this->assertTrue( open_station_stored_file_user_can_read( $id, self::$other_id ) );
	}

	public function test_upload_file_type_serializes_size_mime_kind() {
		$id   = $this->make_stored_file( self::$owner_id, 'photo.jpg', 'JPEG', 'image/jpeg' );
		$file = open_station_resolve_file( 'upload', (string) $id );
		$this->assertInstanceOf( 'Open_Station_Upload_File', $file );
		$shape = $file->serialize();
		$this->assertSame( 'upload', $shape['type'] );
		$this->assertSame( 'photo.jpg', $shape['title'] );
		$this->assertSame( 4, $shape['sizeBytes'] );
		$this->assertSame( 'image/jpeg', $shape['mime'] );
		$this->assertSame( 'image', $shape['kind'] );
		$this->assertSame( 'dashicons-format-image', $shape['icon'] );
	}

	public function test_upload_file_type_missing_row() {
		$file = open_station_resolve_file( 'upload', '999999' );
		$this->assertFalse( $file->exists() );
		$this->assertFalse( $file->can_read( self::$owner_id ) );
	}

	public function test_owner_lock_blocks_non_owner_move_even_with_write_share() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$placement_id = open_station_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = open_station_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'write' );
		open_station_folder_share_accept( $share_id, self::$other_id );

		// Writer CAN move a normal placement in the folder, but not
		// the upload.
		$result = open_station_files_move( $placement_id, self::$other_id, array( 'x' => 5 ) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_upload_owner_locked', $result->get_error_code() );

		// The owner still can.
		$this->assertTrue( open_station_files_move( $placement_id, self::$owner_id, array( 'x' => 5 ) ) );
	}

	public function test_owner_lock_blocks_non_owner_remove_and_trash_gate() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$placement_id = open_station_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = open_station_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'write' );
		open_station_folder_share_accept( $share_id, self::$other_id );

		$result = open_station_files_remove( $placement_id, self::$other_id );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_upload_owner_locked', $result->get_error_code() );

		$row = open_station_files_get_placement( $placement_id );
		$this->assertFalse( open_station_files_user_can_trash_placement( self::$other_id, $row ) );
		$this->assertTrue( open_station_files_user_can_trash_placement( self::$owner_id, $row ) );
	}

	public function test_purge_of_owners_last_placement_deletes_bytes_and_cascades() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = open_station_stored_files_get( $id );
		$path = open_station_stored_file_path( $row );

		$owner_placement = open_station_files_place( self::$owner_id, 0, 'upload', (string) $id );
		// Simulate a recipient placement (file share accepted).
		global $wpdb;
		$tables = open_station_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => open_station_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		// Hard-remove the owner's placement → full purge fires.
		$this->assertTrue( open_station_files_remove( $owner_placement, self::$owner_id ) );

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
		$this->assertNull( open_station_files_get_placement( $recipient_placement ) );

		// The recipient's tile got a tombstone so heartbeat scrubs it.
		$tomb = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['tombstones']} WHERE kind = 'placement' AND ref_id = %d",
				$recipient_placement
			)
		);
		$this->assertSame( '1', (string) $tomb );
	}

	public function test_trash_then_purge_placement_deletes_bytes_and_cascades() {
		global $wpdb;
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = open_station_stored_files_get( $id );
		$path = open_station_stored_file_path( $row );

		$owner_placement = open_station_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$tables          = open_station_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => open_station_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		// The REAL user path: recycle bin (soft-trash), then
		// "Delete forever" (purge) — NOT open_station_files_remove().
		$this->assertTrue( open_station_files_trash_placement( self::$owner_id, $owner_placement ) );
		$this->assertFileExists( $path, 'soft-trash must keep the bytes' );

		$this->assertTrue( open_station_files_purge_placement( self::$owner_id, $owner_placement ) );

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
		$this->assertNull( open_station_files_get_placement( $recipient_placement ) );
	}

	public function test_purge_folder_containing_upload_deletes_bytes() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = open_station_stored_files_get( $id );
		$path = open_station_stored_file_path( $row );

		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Doomed' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		open_station_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		// Recycle-bin path: trash the folder (cascades children),
		// then empty the bin (purge).
		$this->assertTrue( open_station_files_trash_folder( self::$owner_id, (int) $folder_id ) );
		$this->assertFileExists( $path, 'soft-trash must keep the bytes' );
		$this->assertTrue( open_station_files_purge_folder( self::$owner_id, (int) $folder_id ) );

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_hard_delete_folder_cascade_cleans_uploads() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = open_station_stored_files_get( $id );
		$path = open_station_stored_file_path( $row );

		$folder_id = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Gone' ) );
		open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		open_station_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$this->assertTrue( open_station_files_delete_folder( (int) $folder_id, self::$owner_id ) );

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_recipient_placement_removal_keeps_bytes() {
		$id  = $this->make_stored_file( self::$owner_id );
		$row = open_station_stored_files_get( $id );
		open_station_files_place( self::$owner_id, 0, 'upload', (string) $id );

		global $wpdb;
		$tables = open_station_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => open_station_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		// Recipient's own row goes away — the file survives. (Direct
		// row removal here; the REST path would owner-lock, but a
		// leave/revoke scrub ends in the same unplaced signal.)
		$wpdb->delete( $tables['placements'], array( 'id' => $recipient_placement ) );
		do_action(
			'open_station_file_unplaced',
			$recipient_placement,
			array(
				'owner_id'  => self::$other_id,
				'file_type' => 'upload',
				'file_ref'  => (string) $id,
			)
		);

		$this->assertNotNull( open_station_stored_files_get( $id ) );
		$this->assertFileExists( open_station_stored_file_path( $row ) );
	}

	public function test_reconcile_removes_placementless_rows_past_grace() {
		global $wpdb;
		$id  = $this->make_stored_file( self::$owner_id );
		$row = open_station_stored_files_get( $id );
		// Backdate creation beyond the grace period; no placement exists.
		$tables = open_station_files_table_names();
		$wpdb->update(
			$tables['stored_files'],
			array( 'created_at_ms' => open_station_files_now_ms() - ( 2 * DAY_IN_SECONDS * 1000 ) ),
			array( 'id' => $id )
		);

		open_station_stored_files_reconcile();

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( open_station_stored_file_path( $row ) );
	}

	public function test_reconcile_removes_rowless_bytes_past_grace() {
		$dir  = open_station_stored_files_ensure_dir( self::$owner_id );
		$name = wp_generate_uuid4();
		$path = $dir . '/' . $name;
		file_put_contents( $path, 'orphan' );
		touch( $path, time() - 2 * DAY_IN_SECONDS );

		open_station_stored_files_reconcile();

		$this->assertFileDoesNotExist( $path );
		// index.php and non-UUID files are never touched.
		$this->assertFileExists( $dir . '/index.php' );
	}

	public function test_reconcile_keeps_fresh_rows_and_bytes() {
		$id = $this->make_stored_file( self::$owner_id );
		open_station_stored_files_reconcile();
		$this->assertNotNull( open_station_stored_files_get( $id ) );
	}

	public function test_deleted_user_purges_storage() {
		$victim = self::factory()->user->create( array( 'role' => 'editor' ) );
		$id     = $this->make_stored_file( $victim );
		$row    = open_station_stored_files_get( $id );
		$path   = open_station_stored_file_path( $row );
		$this->assertFileExists( $path );

		wp_delete_user( $victim );

		$this->assertNull( open_station_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}
}
