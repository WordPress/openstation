<?php

class Tests_OpenStation_StoredFiles extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $other_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$other_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		wp_set_current_user( self::$owner_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		$this->rrmdir( openstation_stored_files_dir() );
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

	private function make_stored_file( $owner_id, $name = 'report.pdf', $contents = 'PDFBYTES', $mime = 'application/pdf' ) {
		$dir = openstation_stored_files_ensure_dir( $owner_id );
		$this->assertIsString( $dir );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		$id = openstation_stored_files_create( $owner_id, array(
			'display_name' => $name,
			'disk_name'    => $disk_name,
			'size_bytes'   => strlen( $contents ),
			'mime'         => $mime,
		) );
		$this->assertIsInt( $id );
		return $id;
	}

	public function test_ensure_dir_writes_protection_files() {
		openstation_stored_files_ensure_dir( self::$owner_id );
		$base = openstation_stored_files_dir();
		$this->assertFileExists( $base . '/.htaccess' );
		$this->assertFileExists( $base . '/index.php' );
		$this->assertFileExists( openstation_stored_files_dir( self::$owner_id ) . '/index.php' );
		$rules = file_get_contents( $base . '/.htaccess' );
		$this->assertStringContainsString( 'Require all denied', $rules );
		$this->assertStringContainsString( 'Deny from all', $rules );
	}

	public function test_create_get_delete_roundtrip() {
		$id  = $this->make_stored_file( self::$owner_id );
		$row = openstation_stored_files_get( $id );
		$this->assertSame( 'report.pdf', $row['display_name'] );
		$this->assertSame( 8, $row['size_bytes'] );
		$path = openstation_stored_file_path( $row );
		$this->assertFileExists( $path );

		$this->assertTrue( openstation_stored_files_delete( $id ) );
		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_create_rejects_bad_disk_name() {
		$result = openstation_stored_files_create( self::$owner_id, array(
			'display_name' => 'x.txt',
			'disk_name'    => '../../evil',
			'size_bytes'   => 1,
			'mime'         => 'text/plain',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_files_bad_disk_name', $result->get_error_code() );
	}

	public function test_path_rejects_traversal_disk_name() {
		$row = array(
			'owner_id'  => self::$owner_id,
			'disk_name' => '../outside',
		);
		$this->assertNull( openstation_stored_file_path( $row ) );
	}

	public function test_total_bytes_sums_per_owner() {
		$this->make_stored_file( self::$owner_id, 'a.txt', 'aaaa', 'text/plain' );
		$this->make_stored_file( self::$owner_id, 'b.txt', 'bbbbbb', 'text/plain' );
		$this->make_stored_file( self::$other_id, 'c.txt', 'cc', 'text/plain' );
		$this->assertSame( 10, openstation_stored_files_total_bytes( self::$owner_id ) );
		$this->assertSame( 2, openstation_stored_files_total_bytes( self::$other_id ) );
	}

	public function test_rename_updates_display_name_and_bumps_placements() {
		$id = $this->make_stored_file( self::$owner_id );
		$placement_id = openstation_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$this->assertIsInt( $placement_id );
		$before = openstation_files_get_placement( $placement_id )['updated_at_ms'];

		usleep( 2000 );
		$this->assertTrue( openstation_stored_files_rename( $id, 'renamed.pdf' ) );
		$this->assertSame( 'renamed.pdf', openstation_stored_files_get( $id )['display_name'] );
		$after = openstation_files_get_placement( $placement_id )['updated_at_ms'];
		$this->assertGreaterThan( $before, $after );
	}

	public function test_owner_can_read_stranger_cannot() {
		$id = $this->make_stored_file( self::$owner_id );
		$this->assertTrue( openstation_stored_file_user_can_read( $id, self::$owner_id ) );
		$this->assertFalse( openstation_stored_file_user_can_read( $id, self::$other_id ) );
	}

	public function test_folder_share_reader_can_read_contained_upload() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		openstation_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = openstation_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'read' );
		$this->assertIsInt( $share_id );
		openstation_folder_share_accept( $share_id, self::$other_id );

		$this->assertTrue( openstation_stored_file_user_can_read( $id, self::$other_id ) );
	}

	public function test_upload_file_type_serializes_size_mime_kind() {
		$id   = $this->make_stored_file( self::$owner_id, 'photo.jpg', 'JPEG', 'image/jpeg' );
		$file = openstation_resolve_file( 'upload', (string) $id );
		$this->assertInstanceOf( 'OpenStation_Upload_File', $file );
		$shape = $file->serialize();
		$this->assertSame( 'upload', $shape['type'] );
		$this->assertSame( 'photo.jpg', $shape['title'] );
		$this->assertSame( 4, $shape['sizeBytes'] );
		$this->assertSame( 'image/jpeg', $shape['mime'] );
		$this->assertSame( 'image', $shape['kind'] );
		$this->assertTrue( $shape['isMedia'] );
		$this->assertSame( 'dashicons-format-image', $shape['icon'] );
	}

	public function test_upload_file_type_missing_row() {
		$file = openstation_resolve_file( 'upload', '999999' );
		$this->assertFalse( $file->exists() );
		$this->assertFalse( $file->can_read( self::$owner_id ) );
	}

	public function test_owner_lock_blocks_non_owner_move_even_with_write_share() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$placement_id = openstation_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = openstation_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'write' );
		openstation_folder_share_accept( $share_id, self::$other_id );

		$result = openstation_files_move( $placement_id, self::$other_id, array( 'x' => 5 ) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_upload_owner_locked', $result->get_error_code() );

		$this->assertTrue( openstation_files_move( $placement_id, self::$owner_id, array( 'x' => 5 ) ) );
	}

	public function test_owner_lock_blocks_non_owner_remove_and_trash_gate() {
		$id        = $this->make_stored_file( self::$owner_id );
		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Team' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$placement_id = openstation_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$share_id = openstation_folder_share_invite( (int) $folder_id, self::$owner_id, 'user', (string) self::$other_id, 'write' );
		openstation_folder_share_accept( $share_id, self::$other_id );

		$result = openstation_files_remove( $placement_id, self::$other_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_upload_owner_locked', $result->get_error_code() );

		$row = openstation_files_get_placement( $placement_id );
		$this->assertFalse( openstation_files_user_can_trash_placement( self::$other_id, $row ) );
		$this->assertTrue( openstation_files_user_can_trash_placement( self::$owner_id, $row ) );
	}

	public function test_purge_of_owners_last_placement_deletes_bytes_and_cascades() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = openstation_stored_files_get( $id );
		$path = openstation_stored_file_path( $row );

		$owner_placement = openstation_files_place( self::$owner_id, 0, 'upload', (string) $id );

		global $wpdb;
		$tables = openstation_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => openstation_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		$this->assertTrue( openstation_files_remove( $owner_placement, self::$owner_id ) );

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
		$this->assertNull( openstation_files_get_placement( $recipient_placement ) );

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
		$row  = openstation_stored_files_get( $id );
		$path = openstation_stored_file_path( $row );

		$owner_placement = openstation_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$tables          = openstation_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => openstation_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		$this->assertTrue( openstation_files_trash_placement( self::$owner_id, $owner_placement ) );
		$this->assertFileExists( $path, 'soft-trash must keep the bytes' );

		$this->assertTrue( openstation_files_purge_placement( self::$owner_id, $owner_placement ) );

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
		$this->assertNull( openstation_files_get_placement( $recipient_placement ) );
	}

	public function test_purge_folder_containing_upload_deletes_bytes() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = openstation_stored_files_get( $id );
		$path = openstation_stored_file_path( $row );

		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Doomed' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		openstation_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$this->assertTrue( openstation_files_trash_folder( self::$owner_id, (int) $folder_id ) );
		$this->assertFileExists( $path, 'soft-trash must keep the bytes' );
		$this->assertTrue( openstation_files_purge_folder( self::$owner_id, (int) $folder_id ) );

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_hard_delete_folder_cascade_cleans_uploads() {
		$id   = $this->make_stored_file( self::$owner_id );
		$row  = openstation_stored_files_get( $id );
		$path = openstation_stored_file_path( $row );

		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Gone' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		openstation_files_place( self::$owner_id, (int) $folder_id, 'upload', (string) $id );

		$this->assertTrue( openstation_files_delete_folder( (int) $folder_id, self::$owner_id ) );

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_recipient_placement_removal_keeps_bytes() {
		$id  = $this->make_stored_file( self::$owner_id );
		$row = openstation_stored_files_get( $id );
		openstation_files_place( self::$owner_id, 0, 'upload', (string) $id );

		global $wpdb;
		$tables = openstation_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$other_id,
				'parent_id'     => 0,
				'file_type'     => 'upload',
				'file_ref'      => (string) $id,
				'updated_at_ms' => openstation_files_now_ms(),
			)
		);
		$recipient_placement = (int) $wpdb->insert_id;

		$wpdb->delete( $tables['placements'], array( 'id' => $recipient_placement ) );
		do_action(
			'openstation_file_unplaced',
			$recipient_placement,
			array(
				'owner_id'  => self::$other_id,
				'file_type' => 'upload',
				'file_ref'  => (string) $id,
			)
		);

		$this->assertNotNull( openstation_stored_files_get( $id ) );
		$this->assertFileExists( openstation_stored_file_path( $row ) );
	}

	public function test_reconcile_removes_placementless_rows_past_grace() {
		global $wpdb;
		$id  = $this->make_stored_file( self::$owner_id );
		$row = openstation_stored_files_get( $id );

		$tables = openstation_files_table_names();
		$wpdb->update(
			$tables['stored_files'],
			array( 'created_at_ms' => openstation_files_now_ms() - ( 2 * DAY_IN_SECONDS * 1000 ) ),
			array( 'id' => $id )
		);

		openstation_stored_files_reconcile();

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( openstation_stored_file_path( $row ) );
	}

	public function test_reconcile_removes_rowless_bytes_past_grace() {
		$dir  = openstation_stored_files_ensure_dir( self::$owner_id );
		$name = wp_generate_uuid4();
		$path = $dir . '/' . $name;
		file_put_contents( $path, 'orphan' );
		touch( $path, time() - 2 * DAY_IN_SECONDS );

		openstation_stored_files_reconcile();

		$this->assertFileDoesNotExist( $path );

		$this->assertFileExists( $dir . '/index.php' );
	}

	public function test_reconcile_keeps_fresh_rows_and_bytes() {
		$id = $this->make_stored_file( self::$owner_id );
		openstation_stored_files_reconcile();
		$this->assertNotNull( openstation_stored_files_get( $id ) );
	}

	public function test_reconcile_database_failure_never_deletes_valid_bytes( $pattern, $placed ) {
		global $wpdb;
		$id = $this->make_stored_file( self::$owner_id );
		$row = openstation_stored_files_get( $id );
		$path = openstation_stored_file_path( $row );
		touch( $path, time() - 2 * DAY_IN_SECONDS );
		$tables = openstation_files_table_names();
		$wpdb->update( $tables['stored_files'], array( 'created_at_ms' => openstation_files_now_ms() - 2 * DAY_IN_SECONDS * 1000 ), array( 'id' => $id ) );
		if ( $placed ) {
			$this->assertIsInt( openstation_files_place( self::$owner_id, 0, 'upload', (string) $id ) );
		}
		$orphan = dirname( $path ) . '/' . wp_generate_uuid4();
		file_put_contents( $orphan, 'unregistered bytes' );
		touch( $orphan, time() - 2 * DAY_IN_SECONDS );
		$failed = false;
		$reported = array();
		$filter = static function ( $sql ) use ( $pattern, &$failed ) {
			if ( ! $failed && false !== strpos( $sql, $pattern ) ) {
				$failed = true;
				return 'SELECT * FROM openstation_deliberately_missing_reconcile_table';
			}
			return $sql;
		};
		add_filter( 'query', $filter );
		add_action( 'openstation_stored_files_reconcile_failed', static function ( $error ) use ( &$reported ) { $reported[] = $error; } );
		$suppress = $wpdb->suppress_errors( true );
		try {
			openstation_stored_files_reconcile();
		} finally {
			remove_filter( 'query', $filter );
			$wpdb->suppress_errors( $suppress );
		}
		$this->assertTrue( $failed, 'The intended SQL lookup must actually fail.' );
		$this->assertCount( 1, $reported );
		$this->assertWPError( $reported[0] );
		$this->assertNotNull( openstation_stored_files_get( $id ) );
		$this->assertFileExists( $path );
		$this->assertFileExists( $orphan );
	}

	public static function reconcile_failure_stages() {
		return array(
			'candidate query' => array( 'SELECT sf.id', false ),
			'cleanup lock' => array( 'SELECT GET_LOCK', false ),
			'row revalidation' => array( 'SELECT sf.*', false ),
			'conditional delete' => array( 'DELETE sf', false ),
			'known files' => array( 'SELECT disk_name', true ),
			'byte revalidation' => array( 'AND disk_name =', true ),
		);
	}

	public function test_reconcile_rechecks_placement_created_after_candidate_scan() {
		global $wpdb;
		$id = $this->make_stored_file( self::$owner_id );
		$tables = openstation_files_table_names();
		$wpdb->update( $tables['stored_files'], array( 'created_at_ms' => openstation_files_now_ms() - 2 * DAY_IN_SECONDS * 1000 ), array( 'id' => $id ) );
		$filter = null;
		$filter = function ( $sql ) use ( $id, &$filter ) {
			if ( false !== strpos( $sql, 'SELECT GET_LOCK' ) ) {
				remove_filter( 'query', $filter );
				$this->assertIsInt( openstation_files_place( self::$owner_id, 0, 'upload', (string) $id ) );
			}
			return $sql;
		};
		add_filter( 'query', $filter );
		try { openstation_stored_files_reconcile(); } finally { remove_filter( 'query', $filter ); }
		$this->assertNotNull( openstation_stored_files_get( $id ) );
	}

	public function test_reconcile_rechecks_registration_after_known_file_scan() {
		$dir = openstation_stored_files_ensure_dir( self::$owner_id );
		$name = wp_generate_uuid4();
		$path = $dir . '/' . $name;
		file_put_contents( $path, 'late registration' );
		touch( $path, time() - 2 * DAY_IN_SECONDS );
		$filter = null;
		$filter = function ( $sql ) use ( $name, &$filter ) {
			if ( false !== strpos( $sql, 'SELECT GET_LOCK' ) ) {
				remove_filter( 'query', $filter );
				$this->assertIsInt( openstation_stored_files_create( self::$owner_id, array( 'disk_name' => $name ) ) );
			}
			return $sql;
		};
		add_filter( 'query', $filter );
		try { openstation_stored_files_reconcile(); } finally { remove_filter( 'query', $filter ); }
		$this->assertFileExists( $path );
	}

	public function test_reconcile_preserves_files_with_trashed_placements() {
		global $wpdb;
		$id = $this->make_stored_file( self::$owner_id );
		$pid = openstation_files_place( self::$owner_id, 0, 'upload', (string) $id );
		$tables = openstation_files_table_names();
		$wpdb->update( $tables['stored_files'], array( 'created_at_ms' => openstation_files_now_ms() - 2 * DAY_IN_SECONDS * 1000 ), array( 'id' => $id ) );
		$wpdb->update( $tables['placements'], array( 'trashed_at_ms' => openstation_files_now_ms() ), array( 'id' => $pid ) );
		openstation_stored_files_reconcile();
		$this->assertNotNull( openstation_stored_files_get( $id ) );
	}

	public function test_deleted_user_purges_storage() {
		$victim = self::factory()->user->create( array( 'role' => 'editor' ) );
		$id     = $this->make_stored_file( $victim );
		$row    = openstation_stored_files_get( $id );
		$path   = openstation_stored_file_path( $row );
		$this->assertFileExists( $path );

		wp_delete_user( $victim );

		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileDoesNotExist( $path );
	}

	public function test_unlink_failure_does_not_starve_later_bytes() {
		$dir = openstation_stored_files_ensure_dir( self::$owner_id );
		$blocked = $dir . '/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
		$other = $dir . '/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
		foreach ( array( $blocked, $other ) as $path ) { file_put_contents( $path, 'orphan' ); touch( $path, time() - 2 * DAY_IN_SECONDS ); }
		$filter = static function ( $path ) use ( $blocked ) { return $path === $blocked ? '' : $path; };
		$stages = array();
		add_action( 'openstation_stored_files_reconcile_failed', static function ( $error ) use ( &$stages ) { $stages[] = $error->get_error_data()['stage']; } );
		add_filter( 'wp_delete_file', $filter );
		try { openstation_stored_files_reconcile(); } finally { remove_filter( 'wp_delete_file', $filter ); }
		$this->assertFileExists( $blocked );
		$this->assertFileDoesNotExist( $other );
		$this->assertSame( array( 'unlink_bytes' ), $stages );
	}

	public function test_deleted_row_announces_deletion_even_when_bytes_cannot_be_unlinked() {
		global $wpdb;
		$id = $this->make_stored_file( self::$owner_id );
		$path = openstation_stored_file_path( openstation_stored_files_get( $id ) );
		$tables = openstation_files_table_names();
		$wpdb->update( $tables['stored_files'], array( 'created_at_ms' => 1 ), array( 'id' => $id ) );
		$deleted = array();
		add_action( 'openstation_stored_file_deleted', static function ( $id ) use ( &$deleted ) { $deleted[] = $id; } );
		add_filter( 'wp_delete_file', '__return_empty_string' );
		try { openstation_stored_files_reconcile(); } finally { remove_filter( 'wp_delete_file', '__return_empty_string' ); }
		$this->assertSame( array( $id ), $deleted );
		$this->assertNull( openstation_stored_files_get( $id ) );
		$this->assertFileExists( $path );
	}

	public function test_sqlite_noop_lock_allows_intake_but_never_destructive_cleanup() {
		global $wpdb;
		$filter = static function ( $sql ) { return false !== strpos( $sql, 'SELECT GET_LOCK' ) ? "SELECT '1=1'" : $sql; };
		add_filter( 'query', $filter );
		try {
			$id = $this->make_stored_file( self::$owner_id );
			$tables = openstation_files_table_names();
			$wpdb->update( $tables['stored_files'], array( 'created_at_ms' => 1 ), array( 'id' => $id ) );
			openstation_stored_files_reconcile();
			$this->assertNotNull( openstation_stored_files_get( $id ) );
			$this->assertIsInt( openstation_files_place( self::$owner_id, 0, 'upload', (string) $id ) );
		} finally { remove_filter( 'query', $filter ); }
	}

	public function test_upload_extension_callbacks_run_outside_the_storage_lock() {
		global $wpdb;
		$name = 'os-files-' . md5( $wpdb->dbname . ':' . $wpdb->prefix );
		$check = function () use ( $name ) {
			global $wpdb;
			$this->assertSame( '1', (string) $wpdb->get_var( $wpdb->prepare( 'SELECT IS_FREE_LOCK(%s)', $name ) ) );
		};
		add_action( 'openstation_stored_file_created', $check );
		add_action( 'openstation_file_placed', $check );
		add_filter( 'openstation_files_can_place', static function ( $can ) use ( $check ) { $check(); return $can; } );
		$id = $this->make_stored_file( self::$owner_id );
		$this->assertIsInt( openstation_files_place( self::$owner_id, 0, 'upload', (string) $id ) );
	}

}
