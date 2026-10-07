<?php

class Tests_OpenStation_RestUploads extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		wp_set_current_user( self::$admin_id );

		add_filter( 'openstation_stored_files_upload_overrides', array( $this, 'use_sideload_action' ) );
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		remove_filter( 'openstation_stored_files_upload_overrides', array( $this, 'use_sideload_action' ) );
		remove_all_filters( 'openstation_stored_files_user_quota_bytes' );
		remove_all_filters( 'openstation_stored_files_max_upload_bytes' );
		$base = openstation_stored_files_dir();
		if ( is_dir( $base ) ) {
			$this->rrmdir( $base );
		}
		parent::tear_down();
	}

	public function use_sideload_action( $overrides ) {
		$overrides['action'] = 'wp_handle_sideload';
		return $overrides;
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

	private function upload_request( $filename, $contents, $params = array() ) {
		$tmp = wp_tempnam( $filename );
		file_put_contents( $tmp, $contents );
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads' );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		$req->set_param( 'parentId', isset( $params['parentId'] ) ? $params['parentId'] : 0 );
		$req->set_param( 'relativePath', isset( $params['relativePath'] ) ? $params['relativePath'] : '' );
		$req->set_file_params(
			array(
				'file' => array(
					'name'     => $filename,
					'type'     => '',
					'tmp_name' => $tmp,
					'size'     => strlen( $contents ),
					'error'    => UPLOAD_ERR_OK,
				),
			)
		);
		return $req;
	}

	public function test_happy_path_stores_bytes_and_creates_placement() {
		$req = $this->upload_request( 'notes.txt', 'hello world' );
		$res = openstation_files_rest_upload( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();

		$this->assertArrayHasKey( 'placement', $data );
		$this->assertArrayHasKey( 'storedFileId', $data );
		$file_id = (int) $data['storedFileId'];

		$row = openstation_stored_files_get( $file_id );
		$this->assertSame( 'notes.txt', $row['display_name'] );
		$this->assertSame( 11, $row['size_bytes'] );
		$this->assertSame( 'text/plain', $row['mime'] );

		$path = openstation_stored_file_path( $row );
		$this->assertFileExists( $path );
		$this->assertSame( 'hello world', file_get_contents( $path ) );
		$this->assertMatchesRegularExpression( '/^[a-f0-9-]+$/', basename( $path ) );
		$this->assertStringNotContainsString( '.', basename( $path ) );

		$this->assertSame( 'upload', $data['placement']['file']['type'] );
		$this->assertSame( (string) $file_id, $data['placement']['file']['ref'] );
	}

	public function test_php_and_double_extension_and_dotfiles_rejected() {
		foreach ( array( 'shell.php', 'shell.php.gif', 'shell.phtml', '.htaccess', '.user.ini', 'web.config' ) as $bad ) {
			$req = $this->upload_request( $bad, 'x' );
			$res = openstation_files_rest_upload( $req );
			$this->assertWPError( $res, "expected rejection for $bad" );
			$this->assertSame( 'openstation_stored_files_forbidden_type', $res->get_error_code(), "wrong code for $bad" );
		}
	}

	public function test_disallowed_mime_rejected_by_wp_policy() {

		$req = $this->upload_request( 'setup.exe', 'MZbinary' );
		$res = openstation_files_rest_upload( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_stored_files_upload_failed', $res->get_error_code() );
	}

	public function test_oversize_rejected_with_413() {
		add_filter( 'openstation_stored_files_max_upload_bytes', function () {
			return 4;
		} );
		$req = $this->upload_request( 'big.txt', 'way more than four bytes' );
		$res = openstation_files_rest_upload( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_stored_files_too_large', $res->get_error_code() );
		$this->assertSame( 413, $res->get_error_data()['status'] );
	}

	public function test_empty_files_with_content_length_maps_to_413() {
		$_SERVER['CONTENT_LENGTH'] = '999999999';
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads' );
		$res = openstation_files_rest_upload( $req );
		unset( $_SERVER['CONTENT_LENGTH'] );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_stored_files_too_large', $res->get_error_code() );
	}

	public function test_quota_exceeded_rejected() {
		add_filter( 'openstation_stored_files_user_quota_bytes', function () {
			return 10;
		} );
		$req = $this->upload_request( 'a.txt', 'well over ten bytes of content' );
		$res = openstation_files_rest_upload( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_stored_files_quota_exceeded', $res->get_error_code() );
	}

	public function test_subscriber_fails_permission_gate() {

		update_user_meta( self::$subscriber_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$subscriber_id );
		$result = openstation_files_rest_uploads_permission();
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_files_cannot_upload', $result->get_error_code() );
	}

	public function test_upload_capability_is_filterable() {
		update_user_meta( self::$subscriber_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$subscriber_id );
		add_filter( 'openstation_stored_files_upload_capability', function () {
			return 'read';
		} );
		$this->assertTrue( openstation_files_rest_uploads_permission() );
		remove_all_filters( 'openstation_stored_files_upload_capability' );
	}

	public function test_read_only_recipient_cannot_upload_into_shared_folder() {
		$folder_id = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Team' ) );
		openstation_files_place( self::$admin_id, 0, 'folder', (string) $folder_id );
		$share_id = openstation_folder_share_invite( (int) $folder_id, self::$admin_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		wp_set_current_user( self::$editor_id );
		$req = $this->upload_request( 'sneak.txt', 'nope', array( 'parentId' => (int) $folder_id ) );
		$res = openstation_files_rest_upload( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_no_write_in_shared_folder', $res->get_error_code() );
	}

	public function test_placement_failure_rollback_balances_created_deleted_actions() {
		global $wpdb;
		$created = 0;
		$deleted = 0;
		add_action( 'openstation_stored_file_created', function () use ( &$created ) {
			$created++;
		} );
		add_action( 'openstation_stored_file_deleted', function () use ( &$deleted ) {
			$deleted++;
		} );

		$folder_id = openstation_files_create_folder( self::$admin_id, array( 'name' => 'RO' ) );
		openstation_files_place( self::$admin_id, 0, 'folder', (string) $folder_id );
		$share_id = openstation_folder_share_invite( (int) $folder_id, self::$admin_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		wp_set_current_user( self::$editor_id );
		$res = openstation_files_rest_upload(
			$this->upload_request( 'sneak.txt', 'rollback me please', array( 'parentId' => (int) $folder_id ) )
		);
		$this->assertWPError( $res );
		$this->assertSame( 1, $created, 'row creation fires the created action' );
		$this->assertSame( 1, $deleted, 'rollback must fire the paired deleted action' );

		$tables = openstation_files_table_names();
		$this->assertSame(
			'0',
			(string) $wpdb->get_var( "SELECT COUNT(*) FROM {$tables['stored_files']}" ),
			'rollback leaves no orphan row'
		);
	}

	public function test_relative_path_creates_and_dedupes_folders() {
		$req1 = $this->upload_request( 'q1.pdf', '%PDF-1.4 fake', array( 'relativePath' => 'docs/reports/q1.pdf' ) );
		$res1 = openstation_files_rest_upload( $req1 );
		$this->assertNotWPError( $res1 );

		$req2 = $this->upload_request( 'q2.pdf', '%PDF-1.4 fake', array( 'relativePath' => 'docs/reports/q2.pdf' ) );
		$res2 = openstation_files_rest_upload( $req2 );
		$this->assertNotWPError( $res2 );

		global $wpdb;
		$tables = openstation_files_table_names();
		$this->assertSame(
			'2',
			(string) $wpdb->get_var( "SELECT COUNT(*) FROM {$tables['folders']}" ),
			'docs + reports, each exactly once'
		);

		$p1 = $res1->get_data()['placement']['parentId'];
		$p2 = $res2->get_data()['placement']['parentId'];
		$this->assertSame( $p1, $p2 );
		$this->assertGreaterThan( 0, $p1 );

		$created = $res1->get_data()['createdFolders'];
		$this->assertCount( 2, $created );
		$this->assertSame( 'docs', $created[0]['folder']['name'] );
		$this->assertSame( 0, $created[0]['placement']['parentId'] );
		$this->assertSame( 'folder', $created[0]['placement']['file']['type'] );
		$this->assertSame( (string) $created[0]['folder']['id'], $created[0]['placement']['file']['ref'] );
		$this->assertSame( 'reports', $created[1]['folder']['name'] );
		$this->assertSame( $created[0]['folder']['id'], $created[1]['placement']['parentId'] );
		$this->assertSame( $created[1]['folder']['id'], $p1 );

		$this->assertSame( array(), $res2->get_data()['createdFolders'] );
	}

	public function test_flat_upload_reports_no_created_folders() {
		$res = openstation_files_rest_upload( $this->upload_request( 'flat.pdf', '%PDF-1.4 fake' ) );
		$this->assertNotWPError( $res );
		$this->assertSame( array(), $res->get_data()['createdFolders'] );
	}

	public function test_created_folders_take_distinct_grid_slots() {

		$res_a = openstation_files_rest_upload( $this->upload_request( 'a.pdf', '%PDF-1.4 fake', array( 'relativePath' => 'alpha/a.pdf' ) ) );
		$res_b = openstation_files_rest_upload( $this->upload_request( 'b.pdf', '%PDF-1.4 fake', array( 'relativePath' => 'beta/b.pdf' ) ) );
		$this->assertNotWPError( $res_a );
		$this->assertNotWPError( $res_b );
		$slot_a = $res_a->get_data()['createdFolders'][0]['placement'];
		$slot_b = $res_b->get_data()['createdFolders'][0]['placement'];
		$this->assertNotSame(
			array( $slot_a['x'], $slot_a['y'] ),
			array( $slot_b['x'], $slot_b['y'] ),
			'sibling folders must not stack on the same cell'
		);
	}

	public function test_ensure_upload_path_reports_created_folders() {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads/paths' );
		$req->set_param( 'parentId', 0 );
		$req->set_param( 'relativePath', 'empty/nested' );
		$res = openstation_files_rest_ensure_upload_path( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertCount( 2, $data['createdFolders'] );
		$this->assertSame( 'empty', $data['createdFolders'][0]['folder']['name'] );
		$this->assertSame( 'nested', $data['createdFolders'][1]['folder']['name'] );
		$this->assertSame( $data['createdFolders'][1]['folder']['id'], $data['folderId'] );

		$again = openstation_files_rest_ensure_upload_path( $req );
		$this->assertNotWPError( $again );
		$this->assertSame( $data['folderId'], $again->get_data()['folderId'] );
		$this->assertSame( array(), $again->get_data()['createdFolders'] );
	}

	public function test_relative_path_rejects_dot_segments() {
		$result = openstation_files_resolve_relative_path( self::$admin_id, 0, '../../etc/passwd' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_files_bad_path', $result->get_error_code() );
	}

	public function test_directory_only_relative_path_creates_empty_folder() {
		$folder_id = openstation_files_resolve_relative_path( self::$admin_id, 0, 'empty-dir/' );
		$this->assertIsInt( $folder_id );
		$this->assertGreaterThan( 0, $folder_id );
		$folder = openstation_files_get_folder( $folder_id );
		$this->assertSame( 'empty-dir', $folder['name'] );
	}

	public function test_duplicate_display_names_are_distinct_rows() {
		$res1 = openstation_files_rest_upload( $this->upload_request( 'same.txt', 'one' ) );
		$res2 = openstation_files_rest_upload( $this->upload_request( 'same.txt', 'two' ) );
		$this->assertNotWPError( $res1 );
		$this->assertNotWPError( $res2 );
		$this->assertNotSame( $res1->get_data()['storedFileId'], $res2->get_data()['storedFileId'] );
	}

	public function test_rename_route_owner_only() {

		$res = openstation_files_rest_upload( $this->upload_request( 'old.txt', 'rename me please' ) );
		$this->assertNotWPError( $res );
		$file_id = (int) $res->get_data()['storedFileId'];

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/uploads/' . $file_id );
		$req['id'] = $file_id;
		$req->set_param( 'name', 'new.txt' );
		$out = openstation_files_rest_rename_upload( $req );
		$this->assertNotWPError( $out );
		$this->assertSame( 'new.txt', $out->get_data()['name'] );

		wp_set_current_user( self::$editor_id );
		$req2 = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/uploads/' . $file_id );
		$req2['id'] = $file_id;
		$req2->set_param( 'name', 'evil.txt' );
		$out2 = openstation_files_rest_rename_upload( $req2 );
		$this->assertWPError( $out2 );
		$this->assertSame( 404, $out2->get_error_data()['status'] );
	}

	public function test_upload_routes_are_registered() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/uploads', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/uploads/(?P<id>\d+)/download', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/folders/(?P<id>\d+)/download', $routes );
	}
}
