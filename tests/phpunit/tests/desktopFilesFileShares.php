<?php

class Tests_OpenStation_FileShares extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $recipient_id;
	protected static $stranger_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id     = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$recipient_id = $factory->user->create( array( 'role' => 'editor' ) );
		self::$stranger_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
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
		$base = openstation_stored_files_dir();
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

	private function make_stored_file( $owner_id, $name = 'doc.txt', $contents = 'bytes' ) {
		$dir       = openstation_stored_files_ensure_dir( $owner_id );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		$id = openstation_stored_files_create( $owner_id, array(
			'display_name' => $name,
			'disk_name'    => $disk_name,
			'size_bytes'   => strlen( $contents ),
			'mime'         => 'text/plain',
		) );
		openstation_files_place( $owner_id, 0, 'upload', (string) $id );
		return $id;
	}

	public function test_invite_accept_creates_recipient_placement_and_read_access() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		$this->assertIsInt( $share_id );

		$row = openstation_files_get_share( $share_id );
		$this->assertSame( 'file', $row['target_type'] );
		$this->assertSame( 'read', $row['capability'] );
		$this->assertSame( 'pending', $row['state'] );

		$pending = openstation_files_get_pending_file_shares_for_user( self::$recipient_id );
		$this->assertCount( 1, $pending );
		$shape = openstation_files_shape_file_share( $pending[0] );
		$this->assertSame( 'file', $shape['targetType'] );
		$this->assertSame( 'doc.txt', $shape['fileName'] );

		$next = openstation_stored_file_share_accept( $share_id, self::$recipient_id );
		$this->assertSame( 'accepted', $next['state'] );

		$rows = openstation_files_get_for_user_folder( self::$recipient_id, 0 );
		$uploads = array_filter( $rows, function ( $r ) {
			return 'upload' === $r['file_type'];
		} );
		$this->assertCount( 1, $uploads );

		$this->assertTrue( openstation_stored_file_user_can_read( $file_id, self::$recipient_id ) );

		$this->assertCount( 0, openstation_files_get_pending_file_shares_for_user( self::$recipient_id ) );
	}

	public function test_invite_validations() {
		$file_id = $this->make_stored_file( self::$owner_id );

		$err = openstation_stored_file_share_invite( $file_id, self::$recipient_id, self::$stranger_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_forbidden', $err->get_error_code() );

		$err = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$owner_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_share_owner', $err->get_error_code() );

		$err = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$stranger_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_ineligible_principal', $err->get_error_code() );
	}

	public function test_rest_create_rejects_write_capability() {
		$file_id = $this->make_stored_file( self::$owner_id );
		$req     = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads/' . $file_id . '/shares' );
		$req['id'] = $file_id;
		$req->set_param( 'userId', self::$recipient_id );
		$req->set_param( 'capability', 'write' );
		$res = openstation_files_rest_create_file_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_invalid_capability', $res->get_error_code() );
		$this->assertSame( 400, $res->get_error_data()['status'] );
	}

	public function test_deny_after_accept_scrubs_placement() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );
		$this->assertCount( 1, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );

		$next = openstation_stored_file_share_deny( $share_id, self::$recipient_id );
		$this->assertSame( 'denied', $next['state'] );
		$this->assertCount( 0, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );
		$this->assertFalse( openstation_stored_file_user_can_read( $file_id, self::$recipient_id ) );
	}

	public function test_leave_flow() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );

		$this->assertTrue( openstation_stored_file_share_leave( $file_id, self::$recipient_id ) );
		$this->assertSame( 'denied', openstation_stored_file_share_state( $file_id, self::$recipient_id ) );
		$this->assertCount( 0, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );

		$err = openstation_stored_file_share_leave( $file_id, self::$owner_id );
		$this->assertSame( 'openstation_files_owner_cannot_leave', $err->get_error_code() );
		$err = openstation_stored_file_share_leave( $file_id, self::$stranger_id );
		$this->assertSame( 'openstation_files_not_member', $err->get_error_code() );
	}

	public function test_revoke_scrubs_recipient() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );

		$this->assertTrue( openstation_stored_file_share_revoke( $share_id, self::$owner_id ) );
		$this->assertSame( 'none', openstation_stored_file_share_state( $file_id, self::$recipient_id ) );
		$this->assertCount( 0, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );
		$this->assertFalse( openstation_stored_file_user_can_read( $file_id, self::$recipient_id ) );
	}

	public function test_owner_purge_deletes_bytes_shares_and_recipient_placements() {
		global $wpdb;
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );

		$path = openstation_stored_file_path( openstation_stored_files_get( $file_id ) );

		$rows = openstation_files_get_for_user_folder( self::$owner_id, 0 );
		$this->assertTrue( openstation_files_remove( (int) $rows[0]['id'], self::$owner_id ) );

		$this->assertNull( openstation_stored_files_get( $file_id ) );
		$this->assertFileDoesNotExist( $path );
		$this->assertCount( 0, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );
		$tables = openstation_files_table_names();
		$this->assertSame(
			'0',
			(string) $wpdb->get_var(
				$wpdb->prepare( "SELECT COUNT(*) FROM {$tables['shares']} WHERE target_type = 'file' AND folder_id = %d", $file_id )
			)
		);
	}

	public function test_file_share_does_not_bleed_into_folder_queries_with_same_id() {
		global $wpdb;
		$tables = openstation_files_table_names();

		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Collide' ) );
		$file_id   = $this->make_stored_file( self::$owner_id );
		$wpdb->update( $tables['stored_files'], array( 'id' => (int) $folder_id ), array( 'id' => $file_id ) );
		$wpdb->update(
			$tables['placements'],
			array( 'file_ref' => (string) $folder_id ),
			array( 'file_type' => 'upload', 'file_ref' => (string) $file_id )
		);
		$file_id = (int) $folder_id;

		openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );

		$this->assertCount( 0, openstation_files_get_folder_shares( $folder_id ) );
		$this->assertCount( 1, openstation_stored_files_get_file_shares( $file_id ) );

		$this->assertSame( 'none', openstation_folder_share_user_capability( $folder_id, self::$recipient_id ) );

		$pending_folders = openstation_files_get_pending_shares_for_user( self::$recipient_id );
		$this->assertCount( 0, $pending_folders );
	}

	public function test_folder_purge_does_not_wipe_colliding_file_share() {
		global $wpdb;
		$tables = openstation_files_table_names();

		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Collide' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$file_id = $this->make_stored_file( self::$owner_id );
		$wpdb->update( $tables['stored_files'], array( 'id' => (int) $folder_id ), array( 'id' => $file_id ) );
		$wpdb->update(
			$tables['placements'],
			array( 'file_ref' => (string) $folder_id ),
			array( 'file_type' => 'upload', 'file_ref' => (string) $file_id )
		);
		$file_id = (int) $folder_id;

		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );

		$this->assertTrue( openstation_files_trash_folder( self::$owner_id, $folder_id ) );
		$this->assertTrue( openstation_files_purge_folder( self::$owner_id, $folder_id ) );

		$this->assertSame( 'accepted', openstation_stored_file_share_state( $file_id, self::$recipient_id ) );
		$this->assertTrue( openstation_stored_file_user_can_read( $file_id, self::$recipient_id ) );
		$this->assertNotNull( openstation_stored_files_get( $file_id ) );
	}

	public function test_folder_hard_delete_does_not_wipe_colliding_file_share() {
		global $wpdb;
		$tables = openstation_files_table_names();

		$folder_id = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Collide2' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$file_id = $this->make_stored_file( self::$owner_id );
		$wpdb->update( $tables['stored_files'], array( 'id' => (int) $folder_id ), array( 'id' => $file_id ) );
		$wpdb->update(
			$tables['placements'],
			array( 'file_ref' => (string) $folder_id ),
			array( 'file_type' => 'upload', 'file_ref' => (string) $file_id )
		);
		$file_id = (int) $folder_id;

		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );

		$revoked = array();
		add_action( 'openstation_files_share_revoked', function ( $sid ) use ( &$revoked ) {
			$revoked[] = (int) $sid;
		} );

		$this->assertTrue( openstation_files_delete_folder( $folder_id, self::$owner_id ) );

		$this->assertSame( 'accepted', openstation_stored_file_share_state( $file_id, self::$recipient_id ) );
		$this->assertNotContains( (int) $share_id, $revoked, 'file share must not be revoked by a folder cascade' );
	}

	public function test_folder_accept_rejects_file_share_row() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		$err      = openstation_folder_share_accept( $share_id, self::$recipient_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_share_not_found', $err->get_error_code() );
	}

	public function test_heartbeat_delta_carries_pending_file_share() {
		$file_id = $this->make_stored_file( self::$owner_id );
		openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );

		wp_set_current_user( self::$recipient_id );
		$delta = openstation_files_compute_heartbeat_delta( self::$recipient_id, array(), 0, 200, 0 );
		$pending = $delta['shares']['pending'];
		$file_shapes = array_filter( $pending, function ( $s ) {
			return isset( $s['targetType'] ) && 'file' === $s['targetType'];
		} );
		$this->assertCount( 1, $file_shapes );
		$shape = array_values( $file_shapes )[0];
		$this->assertSame( 'doc.txt', $shape['fileName'] );
		$this->assertSame( 'read', $shape['capability'] );
	}

	public function test_reinvite_after_deny_goes_back_to_pending() {
		$file_id  = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		openstation_stored_file_share_deny( $share_id, self::$recipient_id );
		$again = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		$this->assertSame( $share_id, $again );
		$this->assertSame( 'pending', openstation_files_get_share( $share_id )['state'] );
	}

	public function test_accept_can_retry_when_placement_lock_was_busy() {
		$file_id = $this->make_stored_file( self::$owner_id );
		$share_id = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$recipient_id );
		$filter = static function ( $sql ) { return false !== strpos( $sql, 'SELECT GET_LOCK' ) ? 'SELECT 0' : $sql; };
		add_filter( 'query', $filter );
		try { $failed = openstation_stored_file_share_accept( $share_id, self::$recipient_id ); } finally { remove_filter( 'query', $filter ); }
		$this->assertWPError( $failed );
		$this->assertSame( 'openstation_storage_busy', $failed->get_error_code() );
		$next = openstation_stored_file_share_accept( $share_id, self::$recipient_id );
		$this->assertSame( 'accepted', $next['state'] );
		$this->assertCount( 1, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );
		openstation_stored_file_share_accept( $share_id, self::$recipient_id );
		$this->assertCount( 1, openstation_files_get_for_user_folder( self::$recipient_id, 0 ) );
	}

}
