<?php

class Tests_OpenStation_FilesSharing extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();

		foreach ( array( self::$owner_id, self::$editor_id, self::$subscriber_id ) as $uid ) {
			delete_user_meta( $uid, OPENSTATION_OS_SETTINGS_META_KEY );
			wp_cache_delete( $uid, 'user_meta' );
		}
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	public function test_private_folder_is_invisible_to_non_owner() {
		openstation_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		$visible = openstation_files_get_visible_folders( self::$editor_id );
		$this->assertSame( array(), $visible );
	}

	public function test_all_share_mode_is_visible_to_anyone() {
		$id = openstation_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$visible = openstation_files_get_visible_folders( self::$editor_id );
		$ids     = wp_list_pluck( $visible, 'id' );
		$this->assertContains( $id, $ids );
	}

	public function test_users_share_mode_filters_by_id() {

		$id    = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared with editor' ) );
		$share = openstation_folder_share_invite(
			$id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		openstation_folder_share_accept( $share, self::$editor_id );
		$visible_to_editor = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( openstation_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	public function test_roles_share_mode_filters_by_role() {

		$other_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$id           = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Editors only' ) );
		$share        = openstation_folder_share_invite(
			$id, self::$owner_id, 'role', 'editor', 'read'
		);
		openstation_folder_share_accept( $share, self::$editor_id );
		openstation_folder_share_accept( $share, $other_editor );
		$visible_to_editor = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( openstation_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	public function test_owner_always_sees_their_own() {
		$id = openstation_files_create_folder( self::$owner_id, array(
			'name'       => 'My folder',
			'share_mode' => 'private',
		) );
		$visible = wp_list_pluck( openstation_files_get_visible_folders( self::$owner_id ), 'id' );
		$this->assertContains( $id, $visible );
	}

	public function test_heartbeat_delta_returns_new_folders_since_version() {
		$id = openstation_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$folder = openstation_files_get_folder( $id );
		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$folder_ids = wp_list_pluck( $delta['folders'], 'id' );
		$this->assertContains( $id, $folder_ids );

		$delta2 = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $id => (int) $folder['updated_at_ms'] ),
			$delta['serverTimeMs'],
			200
		);
		$this->assertSame( array(), $delta2['folders'] );
	}

	public function test_heartbeat_delta_includes_tombstones_after_remove() {
		$post_id = self::factory()->post->create();
		$pid = openstation_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		openstation_files_remove( $pid, self::$owner_id );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$owner_id,
			array(),
			0,
			200
		);
		$this->assertContains( $pid, $delta['removed']['placements'] );
	}

	public function test_heartbeat_delta_truncated_flag() {

		for ( $i = 0; $i < 7; $i++ ) {
			openstation_files_create_folder( self::$owner_id, array(
				'name'       => 'F' . $i,
				'share_mode' => 'all',
			) );
		}
		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			5
		);
		$this->assertTrue( $delta['truncated'] );
		$this->assertCount( 5, $delta['folders'] );
	}

	public function test_shape_placement_carries_can_trash_for_share_recipient() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$owner_id,
		) );
		$placement_id = openstation_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );
		$row = openstation_files_get_placement( (int) $placement_id );

		wp_set_current_user( self::$owner_id );
		$owner_shape = openstation_files_shape_placement( $row );
		$this->assertTrue(
			(bool) $owner_shape['canTrash'],
			'Owner should be allowed to trash their own placement.'
		);

		wp_set_current_user( self::$editor_id );
		$recipient_shape = openstation_files_shape_placement( $row );
		$this->assertFalse(
			(bool) $recipient_shape['canTrash'],
			"Read-only recipient must not be allowed to trash the owner's placement; the client uses canTrash to hide the Move to Trash menu item and reject the trash drop."
		);
	}

	public function test_root_shared_folder_placement_can_trash_respects_capability() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$rows = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_placements = array_values( array_filter(
			$rows,
			static fn( $r ) => 'folder' === $r['file_type']
				&& (string) $folder_id === (string) $r['file_ref']
		) );
		$this->assertNotEmpty( $folder_placements, 'Accept should have placed the folder at recipient root.' );
		$root_row = $folder_placements[ 0 ];

		wp_set_current_user( self::$editor_id );
		$shape = openstation_files_shape_placement( $root_row );
		$this->assertFalse(
			(bool) $shape['canTrash'],
			'Read-only recipient must not be allowed to trash the root shared-folder tile; they should use "Leave shared folder" instead.'
		);

		openstation_folder_share_update_capability( $share_id, self::$owner_id, 'write' );
		$shape_writer = openstation_files_shape_placement( $root_row );
		$this->assertFalse(
			(bool) $shape_writer['canTrash'],
			'Writer recipient still cannot trash their root placement — the correct action is "Leave shared folder".'
		);

		$owner_placement_id = openstation_files_place(
			self::$owner_id,
			0,
			'folder',
			(string) $folder_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $owner_placement_id );
		$owner_row = openstation_files_get_placement( (int) $owner_placement_id );
		wp_set_current_user( self::$owner_id );
		$owner_shape = openstation_files_shape_placement( $owner_row );
		$this->assertTrue(
			(bool) $owner_shape['canTrash'],
			'Folder owner should retain trash access on their own placement of their folder.'
		);
	}

	public function test_install_schema_is_idempotent_on_repeated_calls() {
		global $wpdb;
		$show_prev = $wpdb->show_errors( false );
		$wpdb->last_error = '';
		openstation_files_install_schema();
		$first_error = (string) $wpdb->last_error;
		$wpdb->last_error = '';

		delete_option( OPENSTATION_FILES_SCHEMA_OPTION );
		openstation_files_install_schema();
		$second_error = (string) $wpdb->last_error;
		$wpdb->show_errors( $show_prev );
		$this->assertSame( '', $first_error, 'First install should not error.' );
		$this->assertStringNotContainsString(
			'already exists',
			$second_error,
			'Second install must not error with "Table … already exists" — shares/decisions skip dbDelta and use idempotent CREATE TABLE IF NOT EXISTS.'
		);
	}

	public function test_delete_folder_cascade_revokes_shares_and_recipient_placements() {
		global $wpdb;
		$tables = openstation_files_table_names();

		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );

		$second_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$user_share = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$role_share = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) $second_editor, 'read'
		);
		openstation_folder_share_accept( $user_share, self::$editor_id );
		openstation_folder_share_accept( $role_share, $second_editor );

		$owner_placement = openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );

		$pointing_before = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			)
		);
		$this->assertSame( 3, $pointing_before, 'Owner + 2 recipients should each have a placement.' );

		openstation_files_delete_folder( $folder_id, self::$owner_id );

		$this->assertNull(
			openstation_files_get_folder( $folder_id ),
			'Folder row should be deleted.'
		);

		$pointing_after = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			)
		);
		$this->assertSame( 0, $pointing_after, 'No placement should still point at the deleted folder.' );

		$share_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['shares']} WHERE folder_id = %d",
				$folder_id
			)
		);
		$this->assertSame( 0, $share_rows, 'All shares for the deleted folder should be revoked.' );

		$decision_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['decisions']} WHERE share_id IN (%d, %d)",
				$user_share,
				$role_share
			)
		);
		$this->assertSame( 0, $decision_rows, 'All per-user decisions for the deleted folder should be gone.' );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertContains(
			(int) $folder_id,
			$delta['removed']['folders'],
			"Folder id should appear in recipient's removed.folders so the heartbeat scrubs the tile."
		);
	}

	public function test_delete_parent_cascades_into_shared_subfolder() {
		global $wpdb;
		$tables = openstation_files_table_names();

		$parent_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$shared_sub_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Shared sub',
		) );

		openstation_files_place(
			self::$owner_id,
			$parent_id,
			'folder',
			(string) $shared_sub_id
		);

		$sub_share = openstation_folder_share_invite(
			$shared_sub_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'write'
		);
		openstation_folder_share_accept( $sub_share, self::$editor_id );

		openstation_files_delete_folder( $parent_id, self::$owner_id );

		$this->assertNull( openstation_files_get_folder( $parent_id ) );

		$this->assertNull(
			openstation_files_get_folder( $shared_sub_id ),
			'Cascade must delete the shared sub-folder when its owner-side parent is deleted.'
		);

		$share_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['shares']} WHERE folder_id = %d",
				$shared_sub_id
			)
		);
		$this->assertSame( 0, $share_rows );
	}

	public function test_delete_parent_leaves_other_owner_subfolder_intact() {
		$parent_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );

		$other_id = openstation_files_create_folder( self::$editor_id, array(
			'name' => 'Editor folder',
		) );

		openstation_files_place(
			self::$editor_id,
			$parent_id,
			'folder',
			(string) $other_id
		);

		openstation_files_delete_folder( $parent_id, self::$owner_id );

		$this->assertNull( openstation_files_get_folder( $parent_id ) );

		$this->assertNotNull(
			openstation_files_get_folder( $other_id ),
			'Cascade must NOT delete sub-folders owned by another user.'
		);
	}

	public function test_rename_folder_bumps_pointing_placements() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Old name',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$baseline = openstation_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$baseline_ts = (int) $baseline['serverTimeMs'];
		usleep( 5000 );

		openstation_files_update_folder( $folder_id, self::$owner_id, array(
			'name' => 'New name',
		) );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => openstation_files_now_ms() ),
			$baseline_ts,
			200
		);
		$folder_placement = null;
		foreach ( $delta['placements'] as $p ) {
			if ( 'folder' === $p['file']['type'] && (string) $folder_id === (string) $p['file']['ref'] ) {
				$folder_placement = $p;
				break;
			}
		}
		$this->assertNotNull(
			$folder_placement,
			"Recipient's placement of the renamed folder must be re-delivered as an upsert so the tile title updates live."
		);
		$this->assertSame( 'New name', $folder_placement['file']['title'] );
	}

	public function test_updated_by_attributes_conflict_to_mutator_not_row_owner() {

		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$post_id  = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$pid      = (int) openstation_files_place( self::$owner_id, $folder_id, 'post', (string) $post_id );
		$original = openstation_files_get_placement( $pid );

		usleep( 2000 );

		openstation_files_move( $pid, self::$editor_id, array( 'x' => 50, 'y' => 100 ) );
		$after = openstation_files_get_placement( $pid );
		$this->assertSame(
			self::$editor_id,
			(int) $after['updated_by'],
			'updated_by must record the mutating session, not the row creator.'
		);
		$this->assertSame(
			self::$owner_id,
			(int) $after['owner_id'],
			'owner_id (row creator) is unchanged by a move.'
		);

		wp_set_current_user( self::$owner_id );
		$req = new WP_REST_Request( 'PATCH' );
		$req->set_header( 'if_match', (string) $original['updated_at_ms'] );
		$err = openstation_files_check_if_match( (int) $after['updated_at_ms'], $req, $after );
		$this->assertInstanceOf( WP_Error::class, $err );
		$data = $err->get_error_data();
		$this->assertSame(
			self::$editor_id,
			(int) $data['data']['actor']['id'],
			'Conflict toast must name the editor (who moved the placement), not the owner.'
		);
	}

	public function test_shared_subfolder_lands_at_recipient_root() {
		$parent_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$sub_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );

		openstation_files_place(
			self::$owner_id,
			$parent_id,
			'folder',
			(string) $sub_id
		);

		$share_id = openstation_folder_share_invite(
			$sub_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$root_rows = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_refs = array_map(
			static fn( $r ) => (string) $r['file_ref'],
			array_filter( $root_rows, static fn( $r ) => 'folder' === $r['file_type'] )
		);
		$this->assertContains(
			(string) $sub_id,
			$folder_refs,
			'Shared sub-folder must appear at recipient root regardless of where the owner has it placed.'
		);

		$this->assertNotContains(
			(string) $parent_id,
			$folder_refs,
			"Recipient must not see the owner's non-shared parent folder."
		);
	}

	public function test_owner_moving_shared_folder_does_not_touch_recipient_placement() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$owner_pid = openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$share_id = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$before = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$recipient_row_before = null;
		foreach ( $before as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $folder_id === (string) $r['file_ref'] ) {
				$recipient_row_before = $r;
			}
		}
		$this->assertNotNull( $recipient_row_before );

		$container_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Container',
		) );
		openstation_files_move( $owner_pid, self::$owner_id, array(
			'parent_id' => $container_id,
		) );

		$after = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$recipient_row_after = null;
		foreach ( $after as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $folder_id === (string) $r['file_ref'] ) {
				$recipient_row_after = $r;
			}
		}
		$this->assertNotNull(
			$recipient_row_after,
			"Recipient's placement of the shared folder must still exist at their root after the owner moves."
		);
		$this->assertSame(
			(int) $recipient_row_before['id'],
			(int) $recipient_row_after['id'],
			"Recipient's placement row id must not change when the owner moves their copy."
		);
		$this->assertSame( 0, (int) $recipient_row_after['parent_id'] );
	}

	public function test_recipient_can_move_shared_folder_into_their_own_folder() {
		$shared_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = openstation_folder_share_invite(
			$shared_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$recipient_folder = openstation_files_create_folder( self::$editor_id, array(
			'name' => "Editor's stuff",
		) );

		$root_rows = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$placement_id = 0;
		foreach ( $root_rows as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $shared_id === (string) $r['file_ref'] ) {
				$placement_id = (int) $r['id'];
				break;
			}
		}
		$this->assertNotSame( 0, $placement_id );

		$moved = openstation_files_move( $placement_id, self::$editor_id, array(
			'parent_id' => $recipient_folder,
		) );
		$this->assertNotInstanceOf( WP_Error::class, $moved );

		$cap = openstation_folder_share_user_capability( $shared_id, self::$editor_id );
		$this->assertSame( 'write', $cap );

		$container_rows = openstation_files_get_for_user_folder( self::$editor_id, $recipient_folder );
		$found = false;
		foreach ( $container_rows as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $shared_id === (string) $r['file_ref'] ) {
				$found = true;
			}
		}
		$this->assertTrue(
			$found,
			"Recipient should see the shared folder inside their own container after the move."
		);

		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		openstation_files_place(
			self::$owner_id, $shared_id, 'post', (string) $post_id
		);
		$shared_contents = openstation_files_get_for_user_folder( self::$editor_id, $shared_id );
		$post_refs = array_map( static fn( $r ) => (string) $r['file_ref'], $shared_contents );
		$this->assertContains( (string) $post_id, $post_refs );

		$own_post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$editor_id,
		) );
		$placement_for_add = openstation_files_place(
			self::$editor_id, $shared_id, 'post', (string) $own_post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_for_add );
	}

	public function test_cascade_grants_access_to_subfolders_of_shared_folder() {
		$shared_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$nested_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Inside',
		) );

		openstation_files_place( self::$owner_id, $shared_id, 'folder', (string) $nested_id );

		$share_id = openstation_folder_share_invite(
			$shared_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$cap_shared = openstation_folder_share_user_capability( $shared_id, self::$editor_id );
		$cap_nested = openstation_folder_share_user_capability( $nested_id, self::$editor_id );
		$this->assertSame( 'write', $cap_shared );
		$this->assertSame( 'write', $cap_nested, 'Cascade should grant the recipient access to sub-folders of the shared folder.' );

		$nested_placements = openstation_files_get_for_user_folder( self::$owner_id, $shared_id );
		$nested_pid = 0;
		foreach ( $nested_placements as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $nested_id === (string) $r['file_ref'] ) {
				$nested_pid = (int) $r['id'];
			}
		}
		$this->assertNotSame( 0, $nested_pid );
		openstation_files_move( $nested_pid, self::$owner_id, array( 'parent_id' => 0 ) );

		$this->assertSame(
			'write',
			openstation_folder_share_user_capability( $shared_id, self::$editor_id ),
			'Recipient must still have access to the directly-shared folder.'
		);
		$this->assertSame(
			'none',
			openstation_folder_share_user_capability( $nested_id, self::$editor_id ),
			'Recipient loses access to the nested folder once the owner moves it out of the shared scope.'
		);
	}

	public function test_cascade_capability_is_batched_into_few_queries() {

		$root  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'root' ) );
		$a     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'a' ) );
		$b     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'b' ) );
		$c     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'c' ) );
		$d     = openstation_files_create_folder( self::$owner_id, array( 'name' => 'd' ) );
		$leaf  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'leaf' ) );
		openstation_files_place( self::$owner_id, $root, 'folder', (string) $a );
		openstation_files_place( self::$owner_id, $a,    'folder', (string) $b );
		openstation_files_place( self::$owner_id, $b,    'folder', (string) $c );
		openstation_files_place( self::$owner_id, $c,    'folder', (string) $d );
		openstation_files_place( self::$owner_id, $d,    'folder', (string) $leaf );

		$share = openstation_folder_share_invite(
			$root, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		openstation_folder_share_accept( $share, self::$editor_id );

		global $wpdb;
		$before = $wpdb->num_queries;
		$cap    = openstation_folder_share_user_capability_cascade( $leaf, self::$editor_id );
		$fired  = $wpdb->num_queries - $before;

		$this->assertSame( 'write', $cap, 'Cascade through 5 ancestors must inherit write.' );

		$this->assertLessThanOrEqual(
			20,
			$fired,
			"Cascade capability lookup should batch ancestor checks (fired $fired queries)."
		);
	}

	public function test_folder_sharing_kill_switch_suppresses_heartbeat_payload() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertNotEmpty(
			$delta['shares']['pending'],
			'Default-on sharing must surface pending invites in the heartbeat delta.'
		);

		update_user_meta(
			self::$editor_id,
			OPENSTATION_OS_SETTINGS_META_KEY,
			array( 'foldersSharingEnabled' => false )
		);

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertSame(
			array(),
			$delta['shares']['pending'],
			'After the user opts out, the heartbeat must not surface pending invites to them.'
		);
	}

	public function test_shell_config_seeds_pending_invites_for_recipient() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Brief' ) );
		openstation_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$editor_id );
		$config = apply_filters( 'openstation_shell_config', array() );

		$this->assertArrayHasKey( 'serverPendingShares', $config );
		$this->assertCount( 1, $config['serverPendingShares'] );
		$invite = $config['serverPendingShares'][0];
		$this->assertSame( $folder, (int) $invite['folderId'] );
		$this->assertSame( 'pending', $invite['state'] );
		$this->assertSame( 'Brief', $invite['folderName'] );
		$this->assertSame( (int) self::$owner_id, (int) $invite['ownerId'] );

		wp_set_current_user( self::$owner_id );
		$config = apply_filters( 'openstation_shell_config', array() );
		$this->assertSame( array(), $config['serverPendingShares'] );
	}

	public function test_shell_config_kill_switch_suppresses_pending_invites() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Y' ) );
		openstation_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		update_user_meta(
			self::$editor_id,
			OPENSTATION_OS_SETTINGS_META_KEY,
			array( 'foldersSharingEnabled' => false )
		);

		wp_set_current_user( self::$editor_id );
		$config = apply_filters( 'openstation_shell_config', array() );
		$this->assertSame( array(), $config['serverPendingShares'] );
	}

	public function test_purge_sharing_tables_drops_and_clears_version() {
		$tables = openstation_files_table_names();

		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$owner_id );
		$response = openstation_files_rest_purge_sharing_tables();
		$data     = is_object( $response ) && method_exists( $response, 'get_data' )
			? $response->get_data()
			: $response;

		$this->assertContains( $tables['shares'], $data['dropped'] );
		$this->assertContains( $tables['decisions'], $data['dropped'] );

		$this->assertSame( '', (string) get_option( OPENSTATION_FILES_SCHEMA_OPTION, '' ) );
	}

	public function test_share_routes_reject_folder_id_mismatch() {
		$folder_a = openstation_files_create_folder( self::$owner_id, array( 'name' => 'A' ) );
		$folder_b = openstation_files_create_folder( self::$owner_id, array( 'name' => 'B' ) );
		$share_a  = openstation_folder_share_invite(
			$folder_a, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$owner_id );

		$req = new WP_REST_Request( 'PATCH', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$req->set_param( 'capability', 'write' );
		$res = openstation_files_rest_update_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_not_found', $res->get_error_code() );

		$req = new WP_REST_Request( 'DELETE', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$res = openstation_files_rest_delete_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_not_found', $res->get_error_code() );

		wp_set_current_user( self::$editor_id );
		$req = new WP_REST_Request( 'POST', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}/accept" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$this->assertWPError( openstation_files_rest_accept_share( $req ) );

		$req = new WP_REST_Request( 'POST', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}/deny" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$this->assertWPError( openstation_files_rest_deny_share( $req ) );

		$row = openstation_files_get_share( $share_a );
		$this->assertSame( 'pending', $row['state'] );
		$this->assertSame( 'read', $row['capability'] );
	}

	public function test_user_search_does_not_leak_user_login() {
		wp_set_current_user( self::$owner_id );
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/users/search' );
		$req->set_param( 'q', '' );
		$res  = openstation_files_rest_search_users( $req );
		$data = is_object( $res ) && method_exists( $res, 'get_data' ) ? $res->get_data() : $res;
		$this->assertArrayHasKey( 'users', $data );
		$this->assertNotEmpty( $data['users'] );
		foreach ( $data['users'] as $u ) {
			$this->assertArrayNotHasKey( 'login', $u, 'login (user_login) must not appear in the search response.' );
			$this->assertArrayHasKey( 'slug', $u );
		}
	}

	public function test_user_search_skips_agents_and_fills_page_past_ineligible_users() {
		for ( $i = 0; $i < 22; $i++ ) {
			self::factory()->user->create(
				array(
					'role'         => 'subscriber',
					'display_name' => sprintf( 'Aaron Customer %02d', $i ),
				)
			);
		}
		$agent_id = self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Aaa Agent',
			)
		);
		update_user_meta( $agent_id, OPENSTATION_AGENT_USER_MARKER_META, '1' );

		wp_set_current_user( self::$owner_id );
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/users/search' );
		$req->set_param( 'q', '' );
		$data = openstation_files_rest_search_users( $req )->get_data();
		$ids  = wp_list_pluck( $data['users'], 'id' );

		$this->assertContains( self::$editor_id, $ids );
		$this->assertNotContains( $agent_id, $ids );
	}

	public function test_purge_filter_rejects_unsafe_table_names() {
		global $wpdb;
		$prefix = $wpdb->prefix;
		$filter = static function ( $tables ) use ( $prefix ) {
			$tables[] = $prefix . "fake; DROP TABLE {$prefix}users; --";
			$tables[] = 'evil';
			$tables[] = $prefix . "users' OR '1";
			return $tables;
		};
		add_filter( 'openstation_files_sharing_tables_for_purge', $filter );

		wp_set_current_user( self::$owner_id );
		$response = openstation_files_rest_purge_sharing_tables();
		remove_filter( 'openstation_files_sharing_tables_for_purge', $filter );

		$data = is_object( $response ) && method_exists( $response, 'get_data' )
			? $response->get_data()
			: $response;

		$this->assertSame( 3, count( $data['skipped'] ) );
		foreach ( $data['skipped'] as $skipped ) {
			$this->assertNotContains( $skipped, $data['dropped'] );
		}

		$users_table = $wpdb->users;
		$row = $wpdb->get_var( "SELECT COUNT(*) FROM {$users_table}" );
		$this->assertNotNull( $row, 'wp_users must survive a malicious filter.' );
	}

	public function test_can_delete_folder_filter_veto_blocks_cascade() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Important',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$veto = function () { return false; };
		add_filter( 'openstation_files_can_delete_folder', $veto );
		$result = openstation_files_delete_folder( $folder_id, self::$owner_id );
		remove_filter( 'openstation_files_can_delete_folder', $veto );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'openstation_files_delete_vetoed', $result->get_error_code() );
		$this->assertNotNull(
			openstation_files_get_folder( $folder_id ),
			'Folder must still exist when the delete filter vetoed.'
		);
		$this->assertNotNull(
			openstation_files_get_share( $share_id ),
			'Share row must still exist when the delete filter vetoed.'
		);
	}

	public function test_cascade_fires_share_revoked_and_summary_actions() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$second_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$share_a = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$share_b = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) $second_editor, 'read'
		);

		$revoked_ids = array();
		$revoke_listener = function ( $share_id ) use ( &$revoked_ids ) {
			$revoked_ids[] = (int) $share_id;
		};
		add_action( 'openstation_files_share_revoked', $revoke_listener );

		$summary_captured = null;
		$summary_listener = function ( $fid, $uid, $summary ) use ( &$summary_captured ) {
			$summary_captured = $summary;
		};
		add_action(
			'openstation_files_after_delete_folder_cascade',
			$summary_listener,
			10,
			3
		);

		openstation_files_delete_folder( $folder_id, self::$owner_id );

		remove_action( 'openstation_files_share_revoked', $revoke_listener );
		remove_action( 'openstation_files_after_delete_folder_cascade', $summary_listener, 10 );

		sort( $revoked_ids );
		$expected = array( (int) $share_a, (int) $share_b );
		sort( $expected );
		$this->assertSame(
			$expected,
			$revoked_ids,
			'Cascade must fire openstation_files_share_revoked for every share it tore down.'
		);

		$this->assertIsArray( $summary_captured );
		$this->assertContains( $folder_id, $summary_captured['folders_deleted'] );
		$this->assertCount( 2, $summary_captured['shares_revoked'] );
	}

	public function test_rename_fires_folder_renamed_action() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Old name',
		) );
		$captured = null;
		$listener = function ( $fid, $new, $old, $uid ) use ( &$captured ) {
			$captured = array( 'fid' => $fid, 'new' => $new, 'old' => $old, 'uid' => $uid );
		};
		add_action( 'openstation_folder_renamed', $listener, 10, 4 );
		openstation_files_update_folder( $folder_id, self::$owner_id, array(
			'name' => 'New name',
		) );
		remove_action( 'openstation_folder_renamed', $listener, 10 );

		$this->assertIsArray( $captured );
		$this->assertSame( $folder_id, $captured['fid'] );
		$this->assertSame( 'New name', $captured['new'] );
		$this->assertSame( 'Old name', $captured['old'] );
		$this->assertSame( self::$owner_id, $captured['uid'] );
	}

	public function test_heartbeat_surfaces_new_file_added_to_shared_folder() {

		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing assets',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		$accepted = openstation_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		$first = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];

		usleep( 5000 );

		$post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$owner_id,
		) );
		$placement_id = openstation_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => openstation_files_now_ms() ),
			$baseline_high_water,
			200
		);
		$placement_ids = wp_list_pluck( $delta['placements'], 'id' );
		$this->assertContains(
			(int) $placement_id,
			$placement_ids,
			'Recipient heartbeat should surface placements the owner added to the shared folder.'
		);
	}

	public function test_new_file_in_shared_folder_visible_via_rest_and_heartbeat_with_both_principals() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );

		$user_share = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);

		openstation_folder_share_accept( $user_share, self::$editor_id );

		$first = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];
		usleep( 5000 );

		$link_id = openstation_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://youtube.com',
			array( 'meta' => array( 'name' => 'YouTube' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		$rows = openstation_files_get_for_user_folder( self::$editor_id, $folder_id );
		$ids  = array_map( static fn( $r ) => (int) $r['id'], $rows );
		$this->assertContains(
			(int) $link_id,
			$ids,
			'Recipient REST listing of the shared folder must include the newly-placed link.'
		);

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => openstation_files_now_ms() ),
			$baseline_high_water,
			200
		);
		$delta_ids = wp_list_pluck( $delta['placements'], 'id' );
		$this->assertContains(
			(int) $link_id,
			$delta_ids,
			'Heartbeat delta must surface the newly-placed link so the open folder window repaints WITHOUT F5.'
		);
	}

	public function test_owner_lists_what_a_writer_added_to_their_shared_folder() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id  = openstation_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$link_id = openstation_files_place(
			self::$editor_id,
			$folder_id,
			'link',
			'https://example.org/',
			array( 'meta' => array( 'name' => 'Example' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		$rows = openstation_files_get_for_user_folder( self::$owner_id, $folder_id );
		$this->assertContains(
			(int) $link_id,
			array_map( static fn( $r ) => (int) $r['id'], $rows ),
			'The owner must see what a writer added to their shared folder.'
		);
	}

	public function test_leave_then_reaccept_does_not_send_active_placement_as_removed() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		openstation_folder_share_leave( $folder_id, self::$editor_id );

		$share_id2 = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_accept( $share_id2, self::$editor_id );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$upsert_ids = wp_list_pluck( $delta['placements'], 'id' );
		$this->assertNotEmpty( $upsert_ids, 'Recipient should still see at least their folder placement.' );

		foreach ( $upsert_ids as $alive_id ) {
			$this->assertNotContains(
				(int) $alive_id,
				$delta['removed']['placements'],
				"Placement {$alive_id} is alive in upserts; it must NOT also appear in removed.placements."
			);
		}
	}

	public function test_adding_link_to_shared_folder_keeps_folder_visible_to_recipient() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Shared with links',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$before_root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_refs_before = array_map(
			static fn( $p ) => (string) $p['file_ref'],
			array_filter(
				$before_root,
				static fn( $p ) => 'folder' === $p['file_type']
			)
		);
		$this->assertContains(
			(string) $folder_id,
			$folder_refs_before,
			'Recipient should see shared folder at root before link is added.'
		);

		$link_id = openstation_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://example.com/',
			array( 'meta' => array( 'name' => 'Example' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		$after_root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_refs_after = array_map(
			static fn( $p ) => (string) $p['file_ref'],
			array_filter(
				$after_root,
				static fn( $p ) => 'folder' === $p['file_type']
			)
		);
		$this->assertContains(
			(string) $folder_id,
			$folder_refs_after,
			'Recipient should still see shared folder at root after owner drops a link inside.'
		);

		$visible_ids = wp_list_pluck(
			openstation_files_get_visible_folders( self::$editor_id ),
			'id'
		);
		$this->assertContains(
			(int) $folder_id,
			array_map( 'intval', $visible_ids ),
			'Shared folder should remain in visible-folders set after link is added.'
		);
	}

	public function test_heartbeat_surfaces_new_file_for_role_principal_recipient() {
		$folder_id = openstation_files_create_folder( self::$owner_id, array(
			'name' => 'Editors workspace',
		) );
		$share_id = openstation_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);
		$accepted = openstation_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		$first = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];

		usleep( 5000 );

		$post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$owner_id,
		) );
		$placement_id = openstation_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		$delta = openstation_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => openstation_files_now_ms() ),
			$baseline_high_water,
			200
		);
		$placement_ids = wp_list_pluck( $delta['placements'], 'id' );
		$this->assertContains(
			(int) $placement_id,
			$placement_ids,
			'Role-principal recipient should see new files added by the owner.'
		);
	}
}
