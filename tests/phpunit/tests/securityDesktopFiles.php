<?php
/**
 * Security regressions for the desktop-files module (placements,
 * folders, folder/file shares, stored files, trash) and the read
 * gates on the built-in file types.
 *
 * Each test is a lower-privileged user attacking an object that
 * belongs to someone else, in the shape the threat model in
 * SECURITY.md describes: OpenStation can be switched on by any
 * account, so "logged in" is effectively "any account".
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-security
 * @group os-files
 */
class Tests_OpenStation_SecurityDesktopFiles extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $owner_id;
	protected static $writer_id;
	protected static $subscriber_id;
	protected static $searcher_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$owner_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$writer_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$searcher_id   = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		// The TRUNCATEs below commit the test transaction, so sideloaded
		// attachments would outlive the test along with their files.
		$attachments = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		foreach ( $attachments as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		$this->rrmdir( openstation_stored_files_dir() );
		_unregister_post_type( 'os_sec_internal' );
		_unregister_taxonomy( 'os_sec_private' );
		parent::tear_down();
	}

	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			is_dir( $entry ) ? $this->rrmdir( $entry ) : unlink( $entry );
		}
		foreach ( (array) glob( $dir . '/.htaccess' ) as $entry ) {
			unlink( $entry );
		}
		rmdir( $dir );
	}

	private function make_stored_file( $owner_id, $name = 'doc.txt', $contents = 'bytes', $mime = 'text/plain' ) {
		$dir       = openstation_stored_files_ensure_dir( $owner_id );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		$id = openstation_stored_files_create(
			$owner_id,
			array(
				'display_name' => $name,
				'disk_name'    => $disk_name,
				'size_bytes'   => strlen( $contents ),
				'mime'         => $mime,
			)
		);
		$this->assertIsInt( $id );
		openstation_files_place( $owner_id, 0, 'upload', (string) $id );
		return $id;
	}

	/**
	 * Raw placement row, trash columns included (the normalized row
	 * drops them).
	 */
	private function raw_placement( $placement_id ) {
		global $wpdb;
		$tables = openstation_files_table_names();
		return $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$tables['placements']} WHERE id = %d", (int) $placement_id ),
			ARRAY_A
		);
	}

	/**
	 * Owner creates a folder on their desktop and shares it with the
	 * writer at `write`; the writer accepts. Returns the folder id and
	 * the share id.
	 */
	private function make_write_shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder );
		$share = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$writer_id, 'write' );
		$this->assertIsInt( $share );
		openstation_folder_share_accept( $share, self::$writer_id );
		$this->assertSame( 'write', openstation_folder_share_user_capability( $folder, self::$writer_id ) );
		return array( $folder, $share );
	}

	private function placement_ids_in( $user_id, $folder_id ) {
		return array_map(
			static function ( $row ) {
				return (int) $row['id'];
			},
			openstation_files_get_for_user_folder( $user_id, $folder_id )
		);
	}

	// ---------------------------------------------------------------
	// Placements: trashed / unknown folders
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_place
	 * @covers ::openstation_files_rest_create_placement
	 */
	public function test_subscriber_cannot_place_into_another_users_trashed_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		openstation_files_trash_folder( self::$owner_id, $folder );

		wp_set_current_user( self::$subscriber_id );
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/placements' );
		$req->set_param( 'type', 'bookmark' );
		$req->set_param( 'ref', 'https://evil.example/login' );
		$req->set_param( 'parentId', $folder );
		$res = openstation_files_rest_create_placement( $req );

		$this->assertWPError( $res );
		$this->assertSame( 403, $res->get_error_data()['status'] );

		// Nothing waits inside the folder for the owner's restore.
		openstation_files_restore_folder( self::$owner_id, $folder );
		$this->assertSame( array(), $this->placement_ids_in( self::$owner_id, $folder ) );
	}

	/**
	 * @covers ::openstation_files_place
	 */
	public function test_subscriber_cannot_preplace_into_a_folder_id_that_does_not_exist_yet() {
		wp_set_current_user( self::$subscriber_id );
		$future = 1 + (int) openstation_files_create_folder( self::$subscriber_id, array( 'name' => 'Mine' ) );

		$res = openstation_files_place( self::$subscriber_id, $future, 'bookmark', 'https://evil.example/' );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );

		// The victim's next folder gets that id and must come up empty.
		$victim = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Payroll' ) );
		$this->assertSame( $future, $victim );
		$this->assertSame( array(), $this->placement_ids_in( self::$owner_id, $victim ) );
	}

	/**
	 * @covers ::openstation_files_move
	 * @covers ::openstation_files_rest_update_placement
	 */
	public function test_subscriber_cannot_rewrite_a_placement_inside_another_users_trashed_folder() {
		$folder    = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		$placement = openstation_files_place( self::$owner_id, $folder, 'bookmark', 'https://example.com/' );
		$this->assertIsInt( $placement );
		openstation_files_trash_folder( self::$owner_id, $folder );

		wp_set_current_user( self::$subscriber_id );
		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $placement );
		$req->set_url_params( array( 'id' => $placement ) );
		$req->set_body_params(
			array(
				'parentId' => 0,
				'meta'     => array( 'name' => 'pwned' ),
			)
		);
		$res = openstation_files_rest_update_placement( $req );

		$this->assertWPError( $res );
		$this->assertSame( 403, $res->get_error_data()['status'] );
		$row = $this->raw_placement( $placement );
		$this->assertSame( $folder, (int) $row['parent_id'] );
		$this->assertNull( $row['meta'] );
	}

	// ---------------------------------------------------------------
	// Shared folders: a writer cannot take the owner's sub-folder
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_move
	 * @covers ::openstation_folder_ancestors
	 */
	public function test_writer_cannot_move_the_owners_subfolder_into_a_private_folder_of_their_own() {
		list( $shared ) = $this->make_write_shared_folder();

		$sub     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Contracts' ) );
		$sub_pid = openstation_files_place( self::$owner_id, $shared, 'folder', (string) $sub );
		$mine    = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Mine' ) );
		openstation_files_place( self::$writer_id, 0, 'folder', (string) $mine );

		$res = openstation_files_move( $sub_pid, self::$writer_id, array( 'parent_id' => $mine ) );

		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_forbidden', $res->get_error_code() );
		$this->assertSame( array( $shared ), openstation_folder_ancestors( $sub ) );

		// Revoking the share must leave the writer with nothing on it.
		$share_rows = openstation_files_get_folder_shares( $shared );
		openstation_folder_share_revoke( (int) $share_rows[0]['id'], self::$owner_id );
		$this->assertSame( 'none', openstation_folder_share_user_capability( $sub, self::$writer_id ) );
	}

	/**
	 * Guard for the rule above: moving someone else's tile between
	 * folders inside the shared tree still works.
	 *
	 * @covers ::openstation_files_move
	 */
	public function test_writer_can_still_move_the_owners_tile_into_a_folder_inside_the_shared_tree() {
		list( $shared ) = $this->make_write_shared_folder();

		$inner = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Inner' ) );
		$this->assertIsInt( openstation_files_place( self::$writer_id, $shared, 'folder', (string) $inner ) );
		$tile = openstation_files_place( self::$owner_id, $shared, 'bookmark', 'https://example.com/' );

		$res = openstation_files_move( $tile, self::$writer_id, array( 'parent_id' => $inner ) );

		$this->assertTrue( $res );
		$this->assertSame( $inner, (int) $this->raw_placement( $tile )['parent_id'] );
	}

	// ---------------------------------------------------------------
	// Restore: no write-back after a revoke, no resurrection into the
	// owner's account
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_restore_placement
	 */
	public function test_revoked_writer_cannot_restore_tiles_back_into_the_owners_folder() {
		list( $shared, $share ) = $this->make_write_shared_folder();
		$tile = openstation_files_place( self::$writer_id, $shared, 'bookmark', 'https://evil.example/' );
		$this->assertIsInt( $tile );

		openstation_folder_share_revoke( $share, self::$owner_id );
		$this->assertNotNull( $this->raw_placement( $tile )['trashed_at_ms'] );

		$this->assertTrue( openstation_files_restore_placement( self::$writer_id, $tile ) );

		$row = $this->raw_placement( $tile );
		$this->assertNull( $row['trashed_at_ms'] );
		$this->assertSame( 0, (int) $row['parent_id'], 'The tile lands on the writer\'s own desktop.' );
		$this->assertNotContains( $tile, $this->placement_ids_in( self::$owner_id, $shared ) );
	}

	/**
	 * @covers ::openstation_files_restore_placement
	 * @covers ::openstation_files_resurrect_ancestry
	 */
	public function test_restoring_a_tile_does_not_resurrect_a_purged_folder_into_the_owners_account() {
		global $wpdb;
		list( $shared ) = $this->make_write_shared_folder();
		$tile = openstation_files_place( self::$writer_id, $shared, 'bookmark', 'https://example.com/' );
		$this->assertTrue( openstation_files_trash_placement( self::$writer_id, $tile ) );
		$this->assertTrue( openstation_files_purge_folder( self::$owner_id, $shared ) );

		$this->assertTrue( openstation_files_restore_placement( self::$writer_id, $tile ) );

		$tables      = openstation_files_table_names();
		$owner_count = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM {$tables['folders']} WHERE owner_id = %d", self::$owner_id )
		);
		$this->assertSame( 0, $owner_count, 'The owner deleted that folder for good.' );

		$parent = openstation_files_get_folder( (int) $this->raw_placement( $tile )['parent_id'] );
		$this->assertNotNull( $parent );
		$this->assertSame( self::$writer_id, $parent['owner_id'] );
	}

	// ---------------------------------------------------------------
	// Folder-share routes must not reach file shares
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_rest_resolve_share_in_folder
	 * @covers ::openstation_folder_share_revoke
	 * @covers ::openstation_folder_share_update_capability
	 */
	public function test_subscriber_cannot_revoke_a_file_share_through_a_folder_with_the_same_id() {
		// Line up a subscriber-owned folder id with a stored-file id —
		// the shares table keys both on `folder_id`.
		$file_id   = $this->make_stored_file( self::$owner_id );
		$folder_id = openstation_files_create_folder( self::$subscriber_id, array( 'name' => 'f' ) );
		for ( $i = 0; $i < 100 && $folder_id !== $file_id; $i++ ) {
			if ( $folder_id < $file_id ) {
				$folder_id = openstation_files_create_folder( self::$subscriber_id, array( 'name' => 'f' . $i ) );
			} else {
				$file_id = $this->make_stored_file( self::$owner_id, 'doc' . $i . '.txt' );
			}
		}
		$this->assertSame( $file_id, $folder_id );

		$share = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$writer_id );
		$this->assertIsInt( $share );
		openstation_stored_file_share_accept( $share, self::$writer_id );

		wp_set_current_user( self::$subscriber_id );
		$params = array(
			'id'      => $folder_id,
			'shareId' => $share,
		);

		$req = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/files/folders/' . $folder_id . '/shares/' . $share );
		$req->set_url_params( $params );
		$res = openstation_files_rest_delete_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/folders/' . $folder_id . '/shares/' . $share );
		$req->set_url_params( $params );
		$req->set_param( 'capability', 'write' );
		$res = openstation_files_rest_update_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );

		// The store primitives refuse on their own too.
		$this->assertWPError( openstation_folder_share_revoke( $share, self::$subscriber_id ) );
		$this->assertWPError( openstation_folder_share_update_capability( $share, self::$subscriber_id, 'write' ) );

		$row = openstation_files_get_share( $share );
		$this->assertNotNull( $row );
		$this->assertSame( 'accepted', $row['state'] );
		$this->assertSame( 'read', $row['capability'] );
		$this->assertTrue( openstation_stored_file_user_can_read( $file_id, self::$writer_id ) );
	}

	// ---------------------------------------------------------------
	// Stored files: no laundering read access through own folders
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_stored_file_user_can_read
	 * @covers ::openstation_files_rest_download_file
	 */
	public function test_reader_cannot_launder_upload_access_through_a_folder_of_their_own() {
		list( $shared, $share ) = $this->make_write_shared_folder();
		$file_id                = $this->make_stored_file( self::$owner_id );
		$this->assertIsInt( openstation_files_place( self::$owner_id, $shared, 'upload', (string) $file_id ) );
		$this->assertTrue( openstation_stored_file_user_can_read( $file_id, self::$writer_id ) );

		// The collaborator files a reference to the owner's upload in a
		// folder of their own and shares THAT with a third user.
		$mine = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Mine' ) );
		openstation_files_place( self::$writer_id, 0, 'folder', (string) $mine );
		$this->assertIsInt( openstation_files_place( self::$writer_id, $mine, 'upload', (string) $file_id ) );
		$invite = openstation_folder_share_invite( $mine, self::$writer_id, 'user', (string) self::$searcher_id, 'read' );
		$this->assertIsInt( $invite );
		openstation_folder_share_accept( $invite, self::$searcher_id );

		$this->assertFalse( openstation_stored_file_user_can_read( $file_id, self::$searcher_id ) );
		wp_set_current_user( self::$searcher_id );
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/uploads/' . $file_id . '/download' );
		$req->set_url_params( array( 'id' => $file_id ) );
		$res = openstation_files_rest_download_file( $req );
		$this->assertWPError( $res );
		$this->assertSame( 404, $res->get_error_data()['status'] );

		// And the owner's revoke actually ends the collaborator's access.
		openstation_folder_share_revoke( $share, self::$owner_id );
		$this->assertFalse( openstation_stored_file_user_can_read( $file_id, self::$writer_id ) );
	}

	// ---------------------------------------------------------------
	// File-type read gates
	// ---------------------------------------------------------------

	/**
	 * @covers OpenStation_Comment_File::can_read
	 * @covers ::openstation_files_place
	 */
	public function test_subscriber_cannot_place_approved_comments_on_posts_they_cannot_read() {
		$private   = self::factory()->post->create( array( 'post_status' => 'private', 'post_author' => self::$owner_id ) );
		$draft     = self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => self::$owner_id ) );
		$protected = self::factory()->post->create( array( 'post_status' => 'publish', 'post_password' => 'secret', 'post_author' => self::$owner_id ) );
		$public    = self::factory()->post->create( array( 'post_status' => 'publish', 'post_author' => self::$owner_id ) );

		foreach ( array( $private, $draft, $protected ) as $post_id ) {
			$comment = self::factory()->comment->create(
				array(
					'comment_post_ID'  => $post_id,
					'comment_approved' => '1',
					'comment_content'  => 'Board approved the layoffs list',
				)
			);
			$file    = openstation_resolve_file( 'comment', (string) $comment );
			$this->assertFalse( $file->can_read( self::$subscriber_id ), "Comment on post {$post_id} must not be readable." );
			$this->assertTrue( $file->can_read( self::$owner_id ), 'The post\'s editor still reads it.' );

			$res = openstation_files_place( self::$subscriber_id, 0, 'comment', (string) $comment );
			$this->assertWPError( $res );
			$this->assertSame( 403, $res->get_error_data()['status'] );
		}

		$comment = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $public,
				'comment_approved' => '1',
			)
		);
		$this->assertTrue( openstation_resolve_file( 'comment', (string) $comment )->can_read( self::$subscriber_id ) );
	}

	/**
	 * @covers OpenStation_Post_File::can_read
	 * @covers OpenStation_Post_File::user_can_read_post
	 * @covers OpenStation_Comment_File::can_read
	 */
	public function test_subscriber_cannot_read_published_rows_of_a_non_viewable_post_type() {
		register_post_type(
			'os_sec_internal',
			array(
				'public'       => false,
				'show_ui'      => true,
				'map_meta_cap' => true,
			)
		);
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => 'os_sec_internal',
				'post_status' => 'publish',
				'post_title'  => 'Refund request #1234',
				'post_author' => self::$admin_id,
			)
		);

		$file = openstation_resolve_file( 'post', (string) $post_id );
		$this->assertFalse( $file->can_read( self::$subscriber_id ) );
		$this->assertTrue( $file->can_read( self::$admin_id ) );
		$this->assertWPError( openstation_files_place( self::$subscriber_id, 0, 'post', (string) $post_id ) );

		$comment = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
			)
		);
		$this->assertFalse( openstation_resolve_file( 'comment', (string) $comment )->can_read( self::$subscriber_id ) );

		// Viewable types are unchanged.
		$public = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$this->assertTrue( openstation_resolve_file( 'post', (string) $public )->can_read( self::$subscriber_id ) );
	}

	/**
	 * @covers OpenStation_Term_File::can_read
	 */
	public function test_subscriber_cannot_read_terms_of_a_non_viewable_taxonomy() {
		register_taxonomy( 'os_sec_private', 'post', array( 'public' => false ) );
		$private  = self::factory()->term->create( array( 'taxonomy' => 'os_sec_private', 'name' => 'Acquisition target' ) );
		$category = self::factory()->term->create( array( 'taxonomy' => 'category', 'name' => 'News' ) );

		$file = openstation_resolve_file( 'term', "os_sec_private:{$private}" );
		$this->assertFalse( $file->can_read( self::$subscriber_id ) );
		$this->assertTrue( $file->can_read( self::$owner_id ), 'Editors manage the taxonomy.' );
		$this->assertWPError( openstation_files_place( self::$subscriber_id, 0, 'term', "os_sec_private:{$private}" ) );

		$this->assertTrue( openstation_resolve_file( 'term', "category:{$category}" )->can_read( self::$subscriber_id ) );
	}

	// ---------------------------------------------------------------
	// Share picker: no email oracle below list_users
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_rest_search_users
	 */
	public function test_share_picker_does_not_match_on_email_without_list_users() {
		$target = self::factory()->user->create(
			array(
				'role'         => 'editor',
				'user_login'   => 'ossec_plainlogin',
				'display_name' => 'Plain Person',
				'user_email'   => 'zq7mailbox@private.example',
			)
		);

		$search = static function () {
			$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/users/search' );
			$req->set_param( 'q', 'zq7mailbox' );
			$req->set_param( 'exclude', '' );
			return wp_list_pluck( openstation_files_rest_search_users( $req )->get_data()['users'], 'id' );
		};

		wp_set_current_user( self::$searcher_id );
		$this->assertFalse( current_user_can( 'list_users' ) );
		$this->assertNotContains( $target, $search() );

		wp_set_current_user( self::$admin_id );
		$this->assertContains( $target, $search() );
	}

	// ---------------------------------------------------------------
	// Media Library bridge: no re-parenting another user's attachment
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_stored_files_attach_to_post
	 */
	public function test_recipient_cannot_reparent_the_owners_attachment_onto_their_draft() {
		$file_id = $this->make_stored_file(
			self::$owner_id,
			'photo.jpg',
			file_get_contents( DIR_TESTDATA . '/images/test-image.jpg' ),
			'image/jpeg'
		);
		wp_set_current_user( self::$owner_id );
		$copied = openstation_stored_file_to_attachment( $file_id, self::$owner_id );
		$this->assertIsArray( $copied );
		$attachment_id = (int) $copied['attachment_id'];
		$this->assertSame( 0, (int) get_post_field( 'post_parent', $attachment_id ) );

		$share = openstation_stored_file_share_invite( $file_id, self::$owner_id, self::$writer_id );
		openstation_stored_file_share_accept( $share, self::$writer_id );

		wp_set_current_user( self::$writer_id );
		$draft  = self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => self::$writer_id ) );
		$result = openstation_stored_files_attach_to_post( $draft, array( $file_id ), self::$writer_id );

		$this->assertIsArray( $result );
		$this->assertSame( array( $attachment_id ), $result['attachment_ids'] );
		$this->assertSame( 0, (int) get_post_field( 'post_parent', $attachment_id ), 'The owner\'s attachment keeps its parent.' );
	}

	// ---------------------------------------------------------------
	// Shared folders: the writer's own folder is not a way out
	// ---------------------------------------------------------------

	/**
	 * The writer holds `write` on their own folder inside the shared
	 * tree, and so does the owner through the share. Parking the
	 * owner's sub-folder in it and then moving that folder out used to
	 * carry the sub-folder into the writer's private tree: the owner
	 * lost it, and the writer kept `write` on it after the revoke.
	 *
	 * @covers ::openstation_files_move
	 */
	public function test_writer_cannot_park_the_owners_subfolder_in_their_own_folder() {
		list( $shared, $share ) = $this->make_write_shared_folder();

		$sub     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Contracts' ) );
		$sub_pid = openstation_files_place( self::$owner_id, $shared, 'folder', (string) $sub );
		$inner   = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Inner' ) );
		$this->assertIsInt( openstation_files_place( self::$writer_id, $shared, 'folder', (string) $inner ) );

		$res = openstation_files_move( $sub_pid, self::$writer_id, array( 'parent_id' => $inner ) );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_forbidden', $res->get_error_code() );

		// Nor out to the root, which is the owner's desktop.
		$res = openstation_files_move( $sub_pid, self::$writer_id, array( 'parent_id' => 0 ) );
		$this->assertWPError( $res );
		$this->assertSame( $shared, (int) $this->raw_placement( $sub_pid )['parent_id'] );

		openstation_folder_share_revoke( $share, self::$owner_id );
		$this->assertSame( 'none', openstation_folder_share_user_capability( $sub, self::$writer_id ) );
	}

	/**
	 * The owner may put their own folder under the writer's, and the
	 * writer may still move their folder wherever they like; what the
	 * writer's folder lends is cut the moment the owner can no longer
	 * reach it, so moving it out of the shared tree grants nothing.
	 *
	 * @covers ::openstation_folder_trusted_ancestors
	 * @covers ::openstation_folder_share_user_capability_cascade
	 */
	public function test_an_ancestor_the_owner_cannot_reach_lends_no_capability() {
		list( $shared, $share ) = $this->make_write_shared_folder();

		$inner     = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Inner' ) );
		$inner_pid = openstation_files_place( self::$writer_id, $shared, 'folder', (string) $inner );
		$sub       = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Contracts' ) );
		$this->assertIsInt( openstation_files_place( self::$owner_id, $inner, 'folder', (string) $sub ), 'The owner chose to put it there.' );
		$this->assertSame( 'write', openstation_folder_share_user_capability( $sub, self::$writer_id ), 'Inside the shared tree the share applies.' );

		$mine = openstation_files_create_folder( self::$writer_id, array( 'name' => 'Mine' ) );
		openstation_files_place( self::$writer_id, 0, 'folder', (string) $mine );
		$this->assertTrue( openstation_files_move( $inner_pid, self::$writer_id, array( 'parent_id' => $mine ) ) );

		$this->assertSame( 'none', openstation_folder_share_user_capability( $sub, self::$writer_id ) );

		openstation_folder_share_revoke( $share, self::$owner_id );
		$this->assertSame( 'none', openstation_folder_share_user_capability( $sub, self::$writer_id ) );
	}

	// ---------------------------------------------------------------
	// Redaction follows the row into every response that shapes it
	// ---------------------------------------------------------------

	/**
	 * The folder listing withholds the title, link and status of a
	 * tile whose entity the viewer cannot read. The single-row PATCH
	 * response shaped the same row without that check, so a writer on
	 * a shared folder could PATCH the owner's tile with a no-op change
	 * and read the private post behind it.
	 *
	 * @covers ::openstation_files_rest_update_placement
	 * @covers ::openstation_files_gate_placement_for_viewer
	 */
	public function test_placement_patch_response_redacts_an_entity_the_writer_cannot_read() {
		list( $shared ) = $this->make_write_shared_folder();
		$private = self::factory()->post->create(
			array(
				'post_status' => 'private',
				'post_author' => self::$owner_id,
				'post_title'  => 'Board minutes',
			)
		);
		$tile    = openstation_files_place( self::$owner_id, $shared, 'post', (string) $private );
		$this->assertIsInt( $tile );

		$patch = static function ( $tile ) {
			$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $tile );
			$req->set_url_params( array( 'id' => $tile ) );
			$req->set_body_params( array( 'x' => 5 ) );
			return openstation_files_rest_update_placement( $req );
		};

		wp_set_current_user( self::$writer_id );
		$res = $patch( $tile );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertTrue( $data['accessGated'] );
		$this->assertSame( 'Restricted item', $data['file']['title'] );
		$this->assertStringNotContainsString( 'Board minutes', wp_json_encode( $data ) );

		wp_set_current_user( self::$owner_id );
		$data = $patch( $tile )->get_data();
		$this->assertFalse( $data['accessGated'] );
		$this->assertStringContainsString( 'Board minutes', $data['file']['title'] );
	}

	/**
	 * A trashed placement is the viewer's own, but the post behind it
	 * may have gone private since; the bin re-asks `can_read()` like
	 * the active listing does.
	 *
	 * @covers ::openstation_files_list_trashed_for_recycle_bin
	 */
	public function test_recycle_bin_listing_redacts_an_entity_the_viewer_can_no_longer_read() {
		$post = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => self::$owner_id,
				'post_title'  => 'Quarterly numbers',
			)
		);
		$tile = openstation_files_place( self::$writer_id, 0, 'post', (string) $post );
		$this->assertTrue( openstation_files_trash_placement( self::$writer_id, $tile ) );
		wp_update_post(
			array(
				'ID'          => $post,
				'post_status' => 'private',
			)
		);

		wp_set_current_user( self::$writer_id );
		$rows = openstation_files_list_trashed_for_recycle_bin( self::$writer_id );
		$this->assertCount( 1, $rows );
		$this->assertStringNotContainsString( 'Quarterly numbers', wp_json_encode( $rows ) );
	}
}
