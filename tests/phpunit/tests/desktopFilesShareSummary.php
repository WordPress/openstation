<?php

class Tests_OpenStation_FilesShareSummary extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		foreach ( openstation_files_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	private function file_shape( $folder_id ) {
		$file = openstation_resolve_file( 'folder', (string) $folder_id );
		$this->assertNotNull( $file, 'The folder file type must resolve.' );
		return $file->serialize();
	}

	private function shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$share  = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share, self::$editor_id );
		return $folder;
	}

	public function test_folder_file_shape_carries_the_share_summary() {
		wp_set_current_user( self::$owner_id );
		$folder = $this->shared_folder();

		$shape = $this->file_shape( $folder );
		$this->assertArrayHasKey( 'shareSummary', $shape );
		$this->assertTrue( $shape['shareSummary']['shared'] );
	}

	public function test_recipient_also_sees_the_shared_flag() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$editor_id );
		$shape = $this->file_shape( $folder );
		$this->assertTrue( $shape['shareSummary']['shared'] );
	}

	public function test_recipient_count_is_owner_only() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$owner_id );
		$this->assertSame( 1, $this->file_shape( $folder )['shareSummary']['recipientCount'] );

		wp_set_current_user( self::$editor_id );
		$this->assertSame( 0, $this->file_shape( $folder )['shareSummary']['recipientCount'] );
	}

	public function test_pending_invitation_is_not_shared_yet() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Pending' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );

		$this->assertFalse( $this->file_shape( $folder )['shareSummary']['shared'] );
	}

	public function test_private_folder_is_not_shared() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$summary = $this->file_shape( $folder )['shareSummary'];
		$this->assertFalse( $summary['shared'] );
		$this->assertSame( 0, $summary['recipientCount'] );
	}

	public function test_share_mode_all_counts_as_shared() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder(
			self::$owner_id,
			array(
				'name'       => 'Everyone',
				'share_mode' => 'all',
			)
		);

		$this->assertTrue( $this->file_shape( $folder )['shareSummary']['shared'] );
	}

	public function test_folder_response_and_placement_shape_agree() {
		wp_set_current_user( self::$owner_id );
		$folder = $this->shared_folder();

		$from_folder_route = openstation_files_shape_folder(
			openstation_files_get_folder( $folder )
		);
		$from_placement = $this->file_shape( $folder );

		$this->assertSame(
			$from_folder_route['shareSummary'],
			$from_placement['shareSummary']
		);
	}

	public function test_boot_config_carries_the_viewers_folders() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$config = openstation_files_inject_boot_folders( array() );
		$this->assertArrayHasKey( 'filesBootFolders', $config );

		$ids = wp_list_pluck( $config['filesBootFolders'], 'id' );
		$this->assertContains( $folder, $ids );
	}

	public function test_boot_folders_carry_owner_id() {
		wp_set_current_user( self::$owner_id );
		openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$folders = openstation_files_inject_boot_folders( array() )['filesBootFolders'];
		$this->assertNotEmpty( $folders );
		foreach ( $folders as $f ) {
			$this->assertSame( self::$owner_id, $f['ownerId'] );
		}
	}

	public function test_boot_folders_include_accepted_shares_for_the_recipient() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$editor_id );
		$folders = openstation_files_inject_boot_folders( array() )['filesBootFolders'];

		$ids = wp_list_pluck( $folders, 'id' );
		$this->assertContains( $folder, $ids );

		$matched = array_values(
			array_filter( $folders, static fn( $f ) => (int) $f['id'] === (int) $folder )
		);
		$this->assertSame(
			self::$owner_id,
			$matched[0]['ownerId'],
			'The recipient must see the real owner, not themselves.'
		);
	}

	public function test_boot_folders_absent_for_anonymous_requests() {
		wp_set_current_user( 0 );
		$this->assertArrayNotHasKey(
			'filesBootFolders',
			openstation_files_inject_boot_folders( array() )
		);
	}
}
