<?php
/**
 * Tests for Phase-6 sharing visibility + Heartbeat delta.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
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
		open_station_files_install_schema();
		// Some tests in this class flip the OS-Settings kill switch
		// user meta. WP_UnitTestCase rolls back the per-test
		// transaction in tear_down — but tests in this class also
		// TRUNCATE their own tables, which auto-commits and breaks
		// the wrapping transaction. Belt-and-braces clear the
		// kill-switch meta + object cache on entry to keep each test
		// independent of the order it runs in.
		foreach ( array( self::$owner_id, self::$editor_id, self::$subscriber_id ) as $uid ) {
			delete_user_meta( $uid, OPEN_STATION_OS_SETTINGS_META_KEY );
			wp_cache_delete( $uid, 'user_meta' );
		}
	}

	public function tear_down() {
		global $wpdb;
		$tables = open_station_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_files_compute_visible_folders
	 */
	public function test_private_folder_is_invisible_to_non_owner() {
		open_station_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		$visible = open_station_files_get_visible_folders( self::$editor_id );
		$this->assertSame( array(), $visible );
	}

	/**
	 * @covers ::open_station_files_compute_visible_folders
	 */
	public function test_all_share_mode_is_visible_to_anyone() {
		$id = open_station_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$visible = open_station_files_get_visible_folders( self::$editor_id );
		$ids     = wp_list_pluck( $visible, 'id' );
		$this->assertContains( $id, $ids );
	}

	/**
	 * @covers ::open_station_files_compute_visible_folders
	 */
	public function test_users_share_mode_filters_by_id() {
		// Canonical flow: invite + accept. The legacy
		// `share_meta`-only shape is no longer a visibility source
		// (was a real revocation-bypass bug; the JSON is now
		// diagnostic-only on the folders row).
		$id    = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Shared with editor' ) );
		$share = open_station_folder_share_invite(
			$id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		open_station_folder_share_accept( $share, self::$editor_id );
		$visible_to_editor = wp_list_pluck( open_station_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( open_station_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::open_station_files_compute_visible_folders
	 */
	public function test_roles_share_mode_filters_by_role() {
		// Canonical flow: invite the role + each member accepts
		// independently. Subscriber doesn't have `edit_posts`, so
		// the default eligibility filter wouldn't let us invite
		// `subscriber` as a role — use a second editor instead.
		$other_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$id           = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Editors only' ) );
		$share        = open_station_folder_share_invite(
			$id, self::$owner_id, 'role', 'editor', 'read'
		);
		open_station_folder_share_accept( $share, self::$editor_id );
		open_station_folder_share_accept( $share, $other_editor );
		$visible_to_editor = wp_list_pluck( open_station_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( open_station_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::open_station_files_compute_visible_folders
	 */
	public function test_owner_always_sees_their_own() {
		$id = open_station_files_create_folder( self::$owner_id, array(
			'name'       => 'My folder',
			'share_mode' => 'private',
		) );
		$visible = wp_list_pluck( open_station_files_get_visible_folders( self::$owner_id ), 'id' );
		$this->assertContains( $id, $visible );
	}

	/**
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_returns_new_folders_since_version() {
		$id = open_station_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$folder = open_station_files_get_folder( $id );
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$folder_ids = wp_list_pluck( $delta['folders'], 'id' );
		$this->assertContains( $id, $folder_ids );

		// Pretend the client has now seen this folder.
		$delta2 = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $id => (int) $folder['updated_at_ms'] ),
			$delta['serverTimeMs'],
			200
		);
		$this->assertSame( array(), $delta2['folders'] );
	}

	/**
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_includes_tombstones_after_remove() {
		$post_id = self::factory()->post->create();
		$pid = open_station_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		open_station_files_remove( $pid, self::$owner_id );

		$delta = open_station_files_compute_heartbeat_delta(
			self::$owner_id,
			array(),
			0,
			200
		);
		$this->assertContains( $pid, $delta['removed']['placements'] );
	}

	/**
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_truncated_flag() {
		// Create more folders than the cap of 5.
		for ( $i = 0; $i < 7; $i++ ) {
			open_station_files_create_folder( self::$owner_id, array(
				'name'       => 'F' . $i,
				'share_mode' => 'all',
			) );
		}
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			5
		);
		$this->assertTrue( $delta['truncated'] );
		$this->assertCount( 5, $delta['folders'] );
	}

	/**
	 * The placement shape must carry a `canTrash` flag that mirrors
	 * the server's `open_station_files_user_can_trash_placement`
	 * decision. The client uses this to hide the "Move to Trash"
	 * menu item and to make the trash drop target reject the drag
	 * — without it, a recipient of a shared folder would attempt to
	 * trash the owner's placement and only see a 403 logged to the
	 * console.
	 *
	 * @covers ::open_station_files_shape_placement
	 */
	public function test_shape_placement_carries_can_trash_for_share_recipient() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Owner drops a post into the shared folder.
		$post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$owner_id,
		) );
		$placement_id = open_station_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );
		$row = open_station_files_get_placement( (int) $placement_id );

		// Owner is the placement owner — must be allowed to trash.
		wp_set_current_user( self::$owner_id );
		$owner_shape = open_station_files_shape_placement( $row );
		$this->assertTrue(
			(bool) $owner_shape['canTrash'],
			'Owner should be allowed to trash their own placement.'
		);

		// Recipient with read-only share — must NOT be allowed.
		wp_set_current_user( self::$editor_id );
		$recipient_shape = open_station_files_shape_placement( $row );
		$this->assertFalse(
			(bool) $recipient_shape['canTrash'],
			"Read-only recipient must not be allowed to trash the owner's placement; the client uses canTrash to hide the Move to Trash menu item and reject the trash drop."
		);
	}

	/**
	 * The recipient's root placement of a READ-ONLY shared folder
	 * must report `canTrash: false`. The client uses this to hide
	 * the "Move to Trash" tile-menu item and to reject the trash
	 * drop target — the user is expected to use "Leave shared
	 * folder" instead (which fires the share-leave flow, not a
	 * destructive trash).
	 *
	 * Writers (recipients with `write` capability) keep the
	 * default ownership-based behavior, since they can already
	 * mutate the folder's contents.
	 *
	 * @covers ::open_station_files_share_gate_trash
	 * @covers ::open_station_files_shape_placement
	 */
	public function test_root_shared_folder_placement_can_trash_respects_capability() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// `accept` placed the folder at the recipient's desktop
		// root (parent_id=0). Find that row.
		$rows = open_station_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_placements = array_values( array_filter(
			$rows,
			static fn( $r ) => 'folder' === $r['file_type']
				&& (string) $folder_id === (string) $r['file_ref']
		) );
		$this->assertNotEmpty( $folder_placements, 'Accept should have placed the folder at recipient root.' );
		$root_row = $folder_placements[ 0 ];

		// READ-only recipient — must NOT be allowed to trash.
		wp_set_current_user( self::$editor_id );
		$shape = open_station_files_shape_placement( $root_row );
		$this->assertFalse(
			(bool) $shape['canTrash'],
			'Read-only recipient must not be allowed to trash the root shared-folder tile; they should use "Leave shared folder" instead.'
		);

		// Promoting the recipient to WRITE must not re-enable
		// trash on the root placement — the rule is "any non-owner
		// recipient uses Leave instead of Trash", regardless of
		// capability. Trashing your root placement is semantically
		// "leave", and forcing it through the leave flow keeps the
		// share-state cleanup paired with the placement removal.
		open_station_folder_share_update_capability( $share_id, self::$owner_id, 'write' );
		$shape_writer = open_station_files_shape_placement( $root_row );
		$this->assertFalse(
			(bool) $shape_writer['canTrash'],
			'Writer recipient still cannot trash their root placement — the correct action is "Leave shared folder".'
		);

		// Owner of the folder is unaffected — they trash their
		// OWN placement of their OWN folder via the default
		// ownership path.
		$owner_placement_id = open_station_files_place(
			self::$owner_id,
			0,
			'folder',
			(string) $folder_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $owner_placement_id );
		$owner_row = open_station_files_get_placement( (int) $owner_placement_id );
		wp_set_current_user( self::$owner_id );
		$owner_shape = open_station_files_shape_placement( $owner_row );
		$this->assertTrue(
			(bool) $owner_shape['canTrash'],
			'Folder owner should retain trash access on their own placement of their folder.'
		);
	}

	/**
	 * Running `install_schema` twice in a row must not produce
	 * "Table … already exists" errors. Reproduces a tester-reported
	 * fatal: dbDelta's `DESCRIBE`-based existence check can return
	 * empty for the shares table under certain MySQL configurations,
	 * causing it to fall back to a bare CREATE that blows up.
	 *
	 * @covers ::open_station_files_install_schema
	 */
	public function test_install_schema_is_idempotent_on_repeated_calls() {
		global $wpdb;
		$show_prev = $wpdb->show_errors( false );
		$wpdb->last_error = '';
		open_station_files_install_schema();
		$first_error = (string) $wpdb->last_error;
		$wpdb->last_error = '';
		// Second call mimics a plugin re-activation or an
		// admin_init re-trigger after the option was cleared.
		delete_option( OPEN_STATION_FILES_SCHEMA_OPTION );
		open_station_files_install_schema();
		$second_error = (string) $wpdb->last_error;
		$wpdb->show_errors( $show_prev );
		$this->assertSame( '', $first_error, 'First install should not error.' );
		$this->assertStringNotContainsString(
			'already exists',
			$second_error,
			'Second install must not error with "Table … already exists" — shares/decisions skip dbDelta and use idempotent CREATE TABLE IF NOT EXISTS.'
		);
	}

	/**
	 * Owner deletes a folder that has active shares: every share
	 * row + every per-user decision + every recipient's root
	 * placement of that folder must be cleaned up, with tombstones
	 * so heartbeat tells connected clients the tile is gone.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_delete_folder_cascade_revokes_shares_and_recipient_placements() {
		global $wpdb;
		$tables = open_station_files_table_names();

		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		// Second user-principal recipient via a second editor —
		// `subscriber` / `author` lack `edit_posts` so they aren't
		// eligible for invites by default. The cascade logic is
		// indifferent to principal type, so two user-principals
		// give the test the coverage it needs.
		$second_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$user_share = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$role_share = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) $second_editor, 'read'
		);
		open_station_folder_share_accept( $user_share, self::$editor_id );
		open_station_folder_share_accept( $role_share, $second_editor );

		// Recipients now have root placements of the folder. Owner
		// also has their own placement (for symmetry).
		$owner_placement = open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );

		// Sanity: pointing placements exist for every party.
		$pointing_before = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			)
		);
		$this->assertSame( 3, $pointing_before, 'Owner + 2 recipients should each have a placement.' );

		open_station_files_delete_folder( $folder_id, self::$owner_id );

		// Folder row gone.
		$this->assertNull(
			open_station_files_get_folder( $folder_id ),
			'Folder row should be deleted.'
		);

		// Every pointing placement gone.
		$pointing_after = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			)
		);
		$this->assertSame( 0, $pointing_after, 'No placement should still point at the deleted folder.' );

		// Every share row gone.
		$share_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['shares']} WHERE folder_id = %d",
				$folder_id
			)
		);
		$this->assertSame( 0, $share_rows, 'All shares for the deleted folder should be revoked.' );

		// Every decision row gone.
		$decision_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['decisions']} WHERE share_id IN (%d, %d)",
				$user_share,
				$role_share
			)
		);
		$this->assertSame( 0, $decision_rows, 'All per-user decisions for the deleted folder should be gone.' );

		// Heartbeat tells the recipient the placement is gone.
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertContains(
			(int) $folder_id,
			$delta['removed']['folders'],
			"Folder id should appear in recipient's removed.folders so the heartbeat scrubs the tile."
		);
	}

	/**
	 * Owner deletes a non-shared PARENT that contains a SHARED
	 * sub-folder. The cascade must reach the sub-folder and revoke
	 * its shares too — recipients of the sub-folder lose access in
	 * the same step.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_delete_parent_cascades_into_shared_subfolder() {
		global $wpdb;
		$tables = open_station_files_table_names();

		$parent_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$shared_sub_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Shared sub',
		) );
		// Place the sub-folder INSIDE the parent (owner's view).
		open_station_files_place(
			self::$owner_id,
			$parent_id,
			'folder',
			(string) $shared_sub_id
		);
		// Share the sub-folder with editor.
		$sub_share = open_station_folder_share_invite(
			$shared_sub_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'write'
		);
		open_station_folder_share_accept( $sub_share, self::$editor_id );

		open_station_files_delete_folder( $parent_id, self::$owner_id );

		// Parent gone.
		$this->assertNull( open_station_files_get_folder( $parent_id ) );
		// Cascade: shared sub-folder also gone.
		$this->assertNull(
			open_station_files_get_folder( $shared_sub_id ),
			'Cascade must delete the shared sub-folder when its owner-side parent is deleted.'
		);
		// Sub-folder's shares revoked.
		$share_rows = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['shares']} WHERE folder_id = %d",
				$shared_sub_id
			)
		);
		$this->assertSame( 0, $share_rows );
	}

	/**
	 * A sub-folder owned by SOMEONE ELSE (e.g. a write recipient
	 * who created their own folder inside a shared folder) must NOT
	 * be cascade-deleted when the parent goes away. Only the
	 * containment-placement is removed; the sub-folder survives so
	 * its own owner can still reach it via their other placements.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_delete_parent_leaves_other_owner_subfolder_intact() {
		$parent_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		// Editor (write recipient hypothetically) owns a folder.
		$other_id = open_station_files_create_folder( self::$editor_id, array(
			'name' => 'Editor folder',
		) );
		// Editor's folder ends up placed inside the owner's parent
		// (rare but legal — e.g. through a future move flow).
		open_station_files_place(
			self::$editor_id,
			$parent_id,
			'folder',
			(string) $other_id
		);

		open_station_files_delete_folder( $parent_id, self::$owner_id );

		// Parent gone.
		$this->assertNull( open_station_files_get_folder( $parent_id ) );
		// Editor's folder STILL EXISTS.
		$this->assertNotNull(
			open_station_files_get_folder( $other_id ),
			'Cascade must NOT delete sub-folders owned by another user.'
		);
	}

	/**
	 * Renaming a folder must propagate to every placement that
	 * points at it so connected clients see the new title on the
	 * next heartbeat tick — no F5 required.
	 *
	 * @covers ::open_station_files_update_folder
	 */
	public function test_rename_folder_bumps_pointing_placements() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Old name',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Baseline heartbeat for the recipient.
		$baseline = open_station_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$baseline_ts = (int) $baseline['serverTimeMs'];
		usleep( 5000 );

		// Owner renames.
		open_station_files_update_folder( $folder_id, self::$owner_id, array(
			'name' => 'New name',
		) );

		// Next heartbeat must re-deliver the recipient's placement
		// of the folder with the fresh title.
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => open_station_files_now_ms() ),
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

	/**
	 * The v10 `updated_by` column means the If-Match 409 conflict
	 * response names the SESSION that won the race, not the row's
	 * static owner. Reviewer-flagged misattribution: in a shared
	 * folder where User A owns the folder and User B (writer) moves
	 * a placement, User C must see "User B moved this" — not "User
	 * A moved this" (which is what the old `owner_id` fallback would
	 * have said).
	 *
	 * @covers ::open_station_files_move
	 * @covers ::open_station_files_check_if_match
	 */
	public function test_updated_by_attributes_conflict_to_mutator_not_row_owner() {
		// Owner = $owner_id, writer recipient = $editor_id.
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Owner places a post in the shared folder. Owner is the
		// row's `owner_id` (creator).
		$post_id  = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$pid      = (int) open_station_files_place( self::$owner_id, $folder_id, 'post', (string) $post_id );
		$original = open_station_files_get_placement( $pid );

		// `now_ms` has 1 ms precision and PHPUnit tests fire fast
		// enough that consecutive calls inside the same millisecond
		// can collide. Sleep 2 ms so the move's `updated_at_ms` is
		// strictly greater than the placement's original.
		usleep( 2000 );

		// Writer recipient moves the placement. `updated_by` flips
		// to the editor; `owner_id` stays as the row creator.
		open_station_files_move( $pid, self::$editor_id, array( 'x' => 50, 'y' => 100 ) );
		$after = open_station_files_get_placement( $pid );
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

		// A third viewer's stale `If-Match` (pointing at the
		// pre-move updated_at_ms) must surface a 409 whose actor is
		// the editor, not the owner. The viewer here is the FOLDER
		// OWNER (themselves a writer on the row, just attempting a
		// concurrent PATCH) — they're in scope to learn the actor's
		// identity, so the PII gate lets the name
		// through.
		wp_set_current_user( self::$owner_id );
		$req = new WP_REST_Request( 'PATCH' );
		$req->set_header( 'if_match', (string) $original['updated_at_ms'] );
		$err = open_station_files_check_if_match( (int) $after['updated_at_ms'], $req, $after );
		$this->assertInstanceOf( WP_Error::class, $err );
		$data = $err->get_error_data();
		$this->assertSame(
			self::$editor_id,
			(int) $data['data']['actor']['id'],
			'Conflict toast must name the editor (who moved the placement), not the owner.'
		);
	}

	// -----------------------------------------------------------------
	// Path independence — the sharer's location vs the recipient's
	// location are decoupled. Both can move the folder around their
	// own desktop without touching the other side; the share's
	// permission contract is on the FOLDER, not on where the folder
	// happens to be placed.
	// -----------------------------------------------------------------

	/**
	 * Owner shares a folder that lives INSIDE another (non-shared)
	 * folder. The recipient's placement of it must land at the
	 * recipient's desktop ROOT (parent_id=0), not buried inside the
	 * owner's parent folder — the recipient doesn't have access to
	 * that parent and couldn't reach the share otherwise.
	 *
	 * @covers ::open_station_folder_share_accept
	 */
	public function test_shared_subfolder_lands_at_recipient_root() {
		$parent_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$sub_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		// Owner places the sub-folder INSIDE the parent. Owner sees
		// Workspace → Marketing.
		open_station_files_place(
			self::$owner_id,
			$parent_id,
			'folder',
			(string) $sub_id
		);
		// Owner shares ONLY the sub-folder.
		$share_id = open_station_folder_share_invite(
			$sub_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Recipient's root must contain the sub-folder placement.
		$root_rows = open_station_files_get_for_user_folder( self::$editor_id, 0 );
		$folder_refs = array_map(
			static fn( $r ) => (string) $r['file_ref'],
			array_filter( $root_rows, static fn( $r ) => 'folder' === $r['file_type'] )
		);
		$this->assertContains(
			(string) $sub_id,
			$folder_refs,
			'Shared sub-folder must appear at recipient root regardless of where the owner has it placed.'
		);
		// Recipient must NOT have a placement of the OWNER's parent.
		$this->assertNotContains(
			(string) $parent_id,
			$folder_refs,
			"Recipient must not see the owner's non-shared parent folder."
		);
	}

	/**
	 * Owner moving the folder around their own desktop (e.g. from
	 * root into another folder, or from one parent to another) must
	 * NOT touch the recipient's placement — locations are per-user.
	 *
	 * @covers ::open_station_files_move
	 */
	public function test_owner_moving_shared_folder_does_not_touch_recipient_placement() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$owner_pid = open_station_files_place( self::$owner_id, 0, 'folder', (string) $folder_id );
		$share_id = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Snapshot recipient's placement BEFORE the owner moves.
		$before = open_station_files_get_for_user_folder( self::$editor_id, 0 );
		$recipient_row_before = null;
		foreach ( $before as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $folder_id === (string) $r['file_ref'] ) {
				$recipient_row_before = $r;
			}
		}
		$this->assertNotNull( $recipient_row_before );

		// Owner now moves the folder into a new container they own.
		$container_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Container',
		) );
		open_station_files_move( $owner_pid, self::$owner_id, array(
			'parent_id' => $container_id,
		) );

		// Recipient's placement is untouched.
		$after = open_station_files_get_for_user_folder( self::$editor_id, 0 );
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

	/**
	 * The recipient must be able to move their own placement around
	 * (e.g. into one of their own folders) without affecting the
	 * owner — and without losing access to the folder's contents,
	 * write capability if granted, or any of the live-sync plumbing.
	 *
	 * @covers ::open_station_files_move
	 * @covers ::open_station_folder_share_user_capability
	 */
	public function test_recipient_can_move_shared_folder_into_their_own_folder() {
		$shared_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = open_station_folder_share_invite(
			$shared_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Recipient creates their own container folder at THEIR root.
		$recipient_folder = open_station_files_create_folder( self::$editor_id, array(
			'name' => "Editor's stuff",
		) );

		// Find recipient's placement of the shared folder.
		$root_rows = open_station_files_get_for_user_folder( self::$editor_id, 0 );
		$placement_id = 0;
		foreach ( $root_rows as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $shared_id === (string) $r['file_ref'] ) {
				$placement_id = (int) $r['id'];
				break;
			}
		}
		$this->assertNotSame( 0, $placement_id );

		// Move the shared placement into recipient's own folder.
		// Write cap is required to move into a folder — and the
		// recipient owns the destination, so it's allowed.
		$moved = open_station_files_move( $placement_id, self::$editor_id, array(
			'parent_id' => $recipient_folder,
		) );
		$this->assertNotInstanceOf( WP_Error::class, $moved );

		// Recipient still has write cap on the shared folder — the
		// share is on the folder, not on where it's placed.
		$cap = open_station_folder_share_user_capability( $shared_id, self::$editor_id );
		$this->assertSame( 'write', $cap );

		// Recipient navigates INTO their own container and finds
		// the shared folder there.
		$container_rows = open_station_files_get_for_user_folder( self::$editor_id, $recipient_folder );
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

		// Recipient enters the shared folder — contents are visible
		// regardless of where the folder lives in their hierarchy.
		// Sanity-add a file as the owner; recipient must see it.
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		open_station_files_place(
			self::$owner_id, $shared_id, 'post', (string) $post_id
		);
		$shared_contents = open_station_files_get_for_user_folder( self::$editor_id, $shared_id );
		$post_refs = array_map( static fn( $r ) => (string) $r['file_ref'], $shared_contents );
		$this->assertContains( (string) $post_id, $post_refs );

		// Recipient adds their own file (writer cap) — works because
		// write cap is on the folder, not on the path.
		$own_post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$editor_id,
		) );
		$placement_for_add = open_station_files_place(
			self::$editor_id, $shared_id, 'post', (string) $own_post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_for_add );
	}

	/**
	 * Cascade through a SHARED sub-folder: owner has A → B → C, the
	 * cascade from C walks the OWNER's canonical chain so the
	 * recipient who has access to B inherits access to C through
	 * the share cascade, regardless of where B is placed in
	 * recipient's own hierarchy.
	 *
	 * @covers ::open_station_folder_share_user_capability
	 */
	public function test_cascade_grants_access_to_subfolders_of_shared_folder() {
		$shared_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Workspace',
		) );
		$nested_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Inside',
		) );
		// Owner places nested INSIDE shared.
		open_station_files_place( self::$owner_id, $shared_id, 'folder', (string) $nested_id );

		$share_id = open_station_folder_share_invite(
			$shared_id, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Cascade grants access to nested via the shared ancestor.
		$cap_shared = open_station_folder_share_user_capability( $shared_id, self::$editor_id );
		$cap_nested = open_station_folder_share_user_capability( $nested_id, self::$editor_id );
		$this->assertSame( 'write', $cap_shared );
		$this->assertSame( 'write', $cap_nested, 'Cascade should grant the recipient access to sub-folders of the shared folder.' );

		// Owner moves nested OUT of shared (to root). Recipient
		// loses access to nested because the cascade chain is
		// broken — but RETAINS access to shared itself.
		$nested_placements = open_station_files_get_for_user_folder( self::$owner_id, $shared_id );
		$nested_pid = 0;
		foreach ( $nested_placements as $r ) {
			if ( 'folder' === $r['file_type'] && (string) $nested_id === (string) $r['file_ref'] ) {
				$nested_pid = (int) $r['id'];
			}
		}
		$this->assertNotSame( 0, $nested_pid );
		open_station_files_move( $nested_pid, self::$owner_id, array( 'parent_id' => 0 ) );

		$this->assertSame(
			'write',
			open_station_folder_share_user_capability( $shared_id, self::$editor_id ),
			'Recipient must still have access to the directly-shared folder.'
		);
		$this->assertSame(
			'none',
			open_station_folder_share_user_capability( $nested_id, self::$editor_id ),
			'Recipient loses access to the nested folder once the owner moves it out of the shared scope.'
		);
	}

	/**
	 * Cascade capability lookup must collapse to a constant number
	 * of queries regardless of ancestor chain depth. The pre-batched
	 * implementation issued up to two queries per ancestor (32 at
	 * the 16-level cap). The batched version uses at most three.
	 *
	 * Owns its own assertion budget — counts queries fired between
	 * the snapshot and the lookup call, then guards with a hard cap.
	 *
	 * @covers ::open_station_folder_share_user_capability_cascade
	 */
	public function test_cascade_capability_is_batched_into_few_queries() {
		// Build a deep chain: root → A → B → C → D → leaf.
		$root  = open_station_files_create_folder( self::$owner_id, array( 'name' => 'root' ) );
		$a     = open_station_files_create_folder( self::$owner_id, array( 'name' => 'a' ) );
		$b     = open_station_files_create_folder( self::$owner_id, array( 'name' => 'b' ) );
		$c     = open_station_files_create_folder( self::$owner_id, array( 'name' => 'c' ) );
		$d     = open_station_files_create_folder( self::$owner_id, array( 'name' => 'd' ) );
		$leaf  = open_station_files_create_folder( self::$owner_id, array( 'name' => 'leaf' ) );
		open_station_files_place( self::$owner_id, $root, 'folder', (string) $a );
		open_station_files_place( self::$owner_id, $a,    'folder', (string) $b );
		open_station_files_place( self::$owner_id, $b,    'folder', (string) $c );
		open_station_files_place( self::$owner_id, $c,    'folder', (string) $d );
		open_station_files_place( self::$owner_id, $d,    'folder', (string) $leaf );

		// Share the root with editor. Cascade should grant access
		// to leaf via 5 ancestors.
		$share = open_station_folder_share_invite(
			$root, self::$owner_id, 'user', (string) self::$editor_id, 'write'
		);
		open_station_folder_share_accept( $share, self::$editor_id );

		global $wpdb;
		$before = $wpdb->num_queries;
		$cap    = open_station_folder_share_user_capability_cascade( $leaf, self::$editor_id );
		$fired  = $wpdb->num_queries - $before;

		$this->assertSame( 'write', $cap, 'Cascade through 5 ancestors must inherit write.' );
		// Ancestor walk itself fires up to 2 queries per level (one
		// folder fetch, one placement lookup). The cascade resolver
		// on top adds at most 3 batched queries — independent of
		// chain length. 5 levels × 2 + 3 = 13. Pad to 20 to absorb
		// per-test cache warmth without losing the regression
		// signal (the old code would have fired 30–40+ here).
		$this->assertLessThanOrEqual(
			20,
			$fired,
			"Cascade capability lookup should batch ancestor checks (fired $fired queries)."
		);
	}

	/**
	 * Per-user kill switch via OS Settings — flipping
	 * `foldersSharingEnabled` to `false` must stop the heartbeat
	 * from delivering `shares.pending` to that user, even when an
	 * invite is actually pending in the database.
	 *
	 * @covers ::open_station_files_sharing_enabled_for
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_folder_sharing_kill_switch_suppresses_heartbeat_payload() {
		$folder = open_station_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		open_station_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		// Default — sharing enabled. Heartbeat surfaces the pending
		// invite.
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertNotEmpty(
			$delta['shares']['pending'],
			'Default-on sharing must surface pending invites in the heartbeat delta.'
		);

		// User flips sharing off in OS Settings.
		update_user_meta(
			self::$editor_id,
			OPEN_STATION_OS_SETTINGS_META_KEY,
			array( 'foldersSharingEnabled' => false )
		);

		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id, array(), 0, 200
		);
		$this->assertSame(
			array(),
			$delta['shares']['pending'],
			'After the user opts out, the heartbeat must not surface pending invites to them.'
		);
	}

	/**
	 * Pending invites are seeded into the shell config on every
	 * admin page render so the accept/deny modal opens immediately
	 * on refresh instead of waiting for the first heartbeat tick to
	 * deliver them.
	 *
	 * @covers ::open_station_files_share_inject_shell_config
	 */
	public function test_shell_config_seeds_pending_invites_for_recipient() {
		$folder = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Brief' ) );
		open_station_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$editor_id );
		$config = apply_filters( 'open_station_shell_config', array() );

		$this->assertArrayHasKey( 'serverPendingShares', $config );
		$this->assertCount( 1, $config['serverPendingShares'] );
		$invite = $config['serverPendingShares'][0];
		$this->assertSame( $folder, (int) $invite['folderId'] );
		$this->assertSame( 'pending', $invite['state'] );
		$this->assertSame( 'Brief', $invite['folderName'] );
		$this->assertSame( (int) self::$owner_id, (int) $invite['ownerId'] );

		// Owner doesn't see their own invite seed (it's the recipient's pending list).
		wp_set_current_user( self::$owner_id );
		$config = apply_filters( 'open_station_shell_config', array() );
		$this->assertSame( array(), $config['serverPendingShares'] );
	}

	/**
	 * Recipients who flipped the kill switch off must not get pending
	 * invites in the shell config either — same guarantee as the
	 * heartbeat path.
	 *
	 * @covers ::open_station_files_share_inject_shell_config
	 */
	public function test_shell_config_kill_switch_suppresses_pending_invites() {
		$folder = open_station_files_create_folder( self::$owner_id, array( 'name' => 'Y' ) );
		open_station_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		update_user_meta(
			self::$editor_id,
			OPEN_STATION_OS_SETTINGS_META_KEY,
			array( 'foldersSharingEnabled' => false )
		);

		wp_set_current_user( self::$editor_id );
		$config = apply_filters( 'open_station_shell_config', array() );
		$this->assertSame( array(), $config['serverPendingShares'] );
	}

	/**
	 * Admin purge endpoint drops the shares + decisions tables
	 * (and any future variant a filter registers), clears the
	 * schema-version option so they get recreated on next admin
	 * load.
	 *
	 * @covers ::open_station_files_rest_purge_sharing_tables
	 */
	public function test_purge_sharing_tables_drops_and_clears_version() {
		$tables = open_station_files_table_names();

		// Seed the tables with some data so we can verify the
		// purge actually removed it — checking
		// INFORMATION_SCHEMA in WP-test-transactional contexts is
		// flaky (DDL auto-commits but the test wrapper's
		// SAVEPOINT shenanigans can leave the catalog view
		// behind). Asserting the dropped payload + cleared option
		// + the inability to query the table proves the contract
		// without depending on catalog timing.
		$folder = open_station_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		open_station_folder_share_invite(
			$folder, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$owner_id );
		$response = open_station_files_rest_purge_sharing_tables();
		$data     = is_object( $response ) && method_exists( $response, 'get_data' )
			? $response->get_data()
			: $response;

		// Both expected tables in the dropped list.
		$this->assertContains( $tables['shares'], $data['dropped'] );
		$this->assertContains( $tables['decisions'], $data['dropped'] );

		// Schema option cleared so the next admin-init re-runs
		// install_schema and recreates the empty tables.
		$this->assertSame( '', (string) get_option( OPEN_STATION_FILES_SCHEMA_OPTION, '' ) );
	}

	/**
	 * Share-mutation routes (`PATCH/DELETE/accept/deny`) must honor
	 * the `{folder_id}` segment of the URL. A share id that exists
	 * on a different folder than the URL claims must 404 — the
	 * routes are hierarchical and a request to
	 * `/folders/{A}/shares/{share_belonging_to_B}` is semantically
	 * a wrong URL.
	 *
	 * @covers ::open_station_files_rest_resolve_share_in_folder
	 * @covers ::open_station_files_rest_update_share
	 * @covers ::open_station_files_rest_delete_share
	 * @covers ::open_station_files_rest_accept_share
	 * @covers ::open_station_files_rest_deny_share
	 */
	public function test_share_routes_reject_folder_id_mismatch() {
		$folder_a = open_station_files_create_folder( self::$owner_id, array( 'name' => 'A' ) );
		$folder_b = open_station_files_create_folder( self::$owner_id, array( 'name' => 'B' ) );
		$share_a  = open_station_folder_share_invite(
			$folder_a, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);

		wp_set_current_user( self::$owner_id );

		// PATCH /folders/{B}/shares/{share_on_A} — mismatch.
		$req = new WP_REST_Request( 'PATCH', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$req->set_param( 'capability', 'write' );
		$res = open_station_files_rest_update_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'open_station_files_not_found', $res->get_error_code() );

		// DELETE /folders/{B}/shares/{share_on_A} — same.
		$req = new WP_REST_Request( 'DELETE', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$res = open_station_files_rest_delete_share( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'open_station_files_not_found', $res->get_error_code() );

		// Accept / deny under a mismatched folder also reject.
		wp_set_current_user( self::$editor_id );
		$req = new WP_REST_Request( 'POST', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}/accept" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$this->assertWPError( open_station_files_rest_accept_share( $req ) );

		$req = new WP_REST_Request( 'POST', "/desktop-mode/v1/files/folders/{$folder_b}/shares/{$share_a}/deny" );
		$req['id']      = $folder_b;
		$req['shareId'] = $share_a;
		$this->assertWPError( open_station_files_rest_deny_share( $req ) );

		// Sanity: the share is untouched on folder A — still pending.
		$row = open_station_files_get_share( $share_a );
		$this->assertSame( 'pending', $row['state'] );
		$this->assertSame( 'read', $row['capability'] );
	}

	/**
	 * The user-search response must not expose `user_login` (the
	 * auth credential). The disambiguation handle is `user_nicename`
	 * via the `slug` field — same shape WP's own `/wp/v2/users`
	 * surfaces publicly.
	 *
	 * @covers ::open_station_files_rest_search_users
	 */
	public function test_user_search_does_not_leak_user_login() {
		wp_set_current_user( self::$owner_id );
		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/users/search' );
		$req->set_param( 'q', '' );
		$res  = open_station_files_rest_search_users( $req );
		$data = is_object( $res ) && method_exists( $res, 'get_data' ) ? $res->get_data() : $res;
		$this->assertArrayHasKey( 'users', $data );
		$this->assertNotEmpty( $data['users'] );
		foreach ( $data['users'] as $u ) {
			$this->assertArrayNotHasKey( 'login', $u, 'login (user_login) must not appear in the search response.' );
			$this->assertArrayHasKey( 'slug', $u );
		}
	}

	/**
	 * A malicious or misconfigured filter on
	 * `open_station_files_sharing_tables_for_purge` must not be able
	 * to drop arbitrary tables. The purge endpoint validates every
	 * entry against an identifier regex AND the wpdb prefix —
	 * anything that fails the validation lands in `skipped` and is
	 * never interpolated into a `DROP TABLE` statement.
	 *
	 * @covers ::open_station_files_rest_purge_sharing_tables
	 */
	public function test_purge_filter_rejects_unsafe_table_names() {
		global $wpdb;
		$prefix = $wpdb->prefix;
		$filter = static function ( $tables ) use ( $prefix ) {
			$tables[] = $prefix . "fake; DROP TABLE {$prefix}users; --"; // sql injection
			$tables[] = 'evil';                                          // missing prefix
			$tables[] = $prefix . "users' OR '1";                        // special chars
			return $tables;
		};
		add_filter( 'open_station_files_sharing_tables_for_purge', $filter );

		wp_set_current_user( self::$owner_id );
		$response = open_station_files_rest_purge_sharing_tables();
		remove_filter( 'open_station_files_sharing_tables_for_purge', $filter );

		$data = is_object( $response ) && method_exists( $response, 'get_data' )
			? $response->get_data()
			: $response;

		// All three malicious entries land in `skipped`, never dropped.
		$this->assertSame( 3, count( $data['skipped'] ) );
		foreach ( $data['skipped'] as $skipped ) {
			$this->assertNotContains( $skipped, $data['dropped'] );
		}
		// Critical: the users table is still here.
		$users_table = $wpdb->users;
		$row = $wpdb->get_var( "SELECT COUNT(*) FROM {$users_table}" );
		$this->assertNotNull( $row, 'wp_users must survive a malicious filter.' );
	}

	/**
	 * Plugin authors must be able to veto a folder delete from
	 * `open_station_files_can_delete_folder`. The veto should keep
	 * the folder + every share row intact.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_can_delete_folder_filter_veto_blocks_cascade() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Important',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$veto = function () { return false; };
		add_filter( 'open_station_files_can_delete_folder', $veto );
		$result = open_station_files_delete_folder( $folder_id, self::$owner_id );
		remove_filter( 'open_station_files_can_delete_folder', $veto );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'open_station_files_delete_vetoed', $result->get_error_code() );
		$this->assertNotNull(
			open_station_files_get_folder( $folder_id ),
			'Folder must still exist when the delete filter vetoed.'
		);
		$this->assertNotNull(
			open_station_files_get_share( $share_id ),
			'Share row must still exist when the delete filter vetoed.'
		);
	}

	/**
	 * The cascade-delete must fire per-share
	 * `open_station_files_share_revoked` actions AND a single
	 * `open_station_files_after_delete_folder_cascade` summary.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_cascade_fires_share_revoked_and_summary_actions() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$second_editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		$share_a = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) self::$editor_id, 'read'
		);
		$share_b = open_station_folder_share_invite(
			$folder_id, self::$owner_id, 'user', (string) $second_editor, 'read'
		);

		$revoked_ids = array();
		$revoke_listener = function ( $share_id ) use ( &$revoked_ids ) {
			$revoked_ids[] = (int) $share_id;
		};
		add_action( 'open_station_files_share_revoked', $revoke_listener );

		$summary_captured = null;
		$summary_listener = function ( $fid, $uid, $summary ) use ( &$summary_captured ) {
			$summary_captured = $summary;
		};
		add_action(
			'open_station_files_after_delete_folder_cascade',
			$summary_listener,
			10,
			3
		);

		open_station_files_delete_folder( $folder_id, self::$owner_id );

		remove_action( 'open_station_files_share_revoked', $revoke_listener );
		remove_action( 'open_station_files_after_delete_folder_cascade', $summary_listener, 10 );

		sort( $revoked_ids );
		$expected = array( (int) $share_a, (int) $share_b );
		sort( $expected );
		$this->assertSame(
			$expected,
			$revoked_ids,
			'Cascade must fire open_station_files_share_revoked for every share it tore down.'
		);

		$this->assertIsArray( $summary_captured );
		$this->assertContains( $folder_id, $summary_captured['folders_deleted'] );
		$this->assertCount( 2, $summary_captured['shares_revoked'] );
	}

	/**
	 * Renaming a folder must fire `open_station_folder_renamed`
	 * with both the new and old names so plugins can audit /
	 * broadcast / refresh other surfaces.
	 *
	 * @covers ::open_station_files_update_folder
	 */
	public function test_rename_fires_folder_renamed_action() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Old name',
		) );
		$captured = null;
		$listener = function ( $fid, $new, $old, $uid ) use ( &$captured ) {
			$captured = array( 'fid' => $fid, 'new' => $new, 'old' => $old, 'uid' => $uid );
		};
		add_action( 'open_station_folder_renamed', $listener, 10, 4 );
		open_station_files_update_folder( $folder_id, self::$owner_id, array(
			'name' => 'New name',
		) );
		remove_action( 'open_station_folder_renamed', $listener, 10 );

		$this->assertIsArray( $captured );
		$this->assertSame( $folder_id, $captured['fid'] );
		$this->assertSame( 'New name', $captured['new'] );
		$this->assertSame( 'Old name', $captured['old'] );
		$this->assertSame( self::$owner_id, $captured['uid'] );
	}

	/**
	 * Reproduces the reported regression: owner adds a NEW file
	 * to an already-shared folder, recipient's next heartbeat
	 * delta must include the new placement.
	 *
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_surfaces_new_file_added_to_shared_folder() {
		// 1) Owner creates a folder, invites editor (user-principal),
		//    editor accepts.
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing assets',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		$accepted = open_station_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		// 2) Snapshot the heartbeat high-water at "now" — emulates
		//    the recipient having already synced everything up to
		//    this point.
		$first = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];

		// Small sleep so the new placement's updated_at_ms is
		// strictly greater than the baseline.
		usleep( 5000 );

		// 3) Owner adds a brand-new file (a post) to the shared
		//    folder. This is the exact action the user reported
		//    not propagating to recipients.
		$post_id = self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$owner_id,
		) );
		$placement_id = open_station_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		// 4) Recipient's next heartbeat — should pick up the new
		//    placement because its parent_id is a visible folder
		//    and its updated_at_ms is fresher than the high-water.
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => open_station_files_now_ms() ),
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

	/**
	 * Reproduces the user-reported "new file added to shared folder
	 * doesn't appear in the recipient's open folder until F5" bug.
	 *
	 * Combined scenario the user actually hit:
	 *   - Owner invites the recipient via BOTH user-principal AND
	 *     role-principal (same recipient, same folder).
	 *   - Recipient accepts (user-principal flips to accepted).
	 *   - Owner drops a new link into the shared folder.
	 *
	 * Expectations:
	 *   1. REST listing of the folder contents (what F5 reloads)
	 *      must include the new link — this is what makes the file
	 *      appear after F5 today.
	 *   2. The recipient's next heartbeat delta — without
	 *      F5 — must ALSO include the new placement so the open
	 *      folder window repaints live. This is the half the user
	 *      reports as broken.
	 *
	 * @covers ::open_station_files_get_for_user_folder
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_new_file_in_shared_folder_visible_via_rest_and_heartbeat_with_both_principals() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );

		// Both invites for the same recipient.
		$user_share = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);
		// Recipient accepts via user-principal.
		open_station_folder_share_accept( $user_share, self::$editor_id );

		// Capture baseline heartbeat — emulates the recipient having
		// already synced everything before the owner adds the file.
		$first = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];
		usleep( 5000 );

		// Owner adds a new link to the shared folder.
		$link_id = open_station_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://youtube.com',
			array( 'meta' => array( 'name' => 'YouTube' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		// 1) REST contents listing must include the new link.
		$rows = open_station_files_get_for_user_folder( self::$editor_id, $folder_id );
		$ids  = array_map( static fn( $r ) => (int) $r['id'], $rows );
		$this->assertContains(
			(int) $link_id,
			$ids,
			'Recipient REST listing of the shared folder must include the newly-placed link.'
		);

		// 2) Heartbeat delta must surface the same placement live.
		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => open_station_files_now_ms() ),
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

	/**
	 * Reproduces the user-reported "shared folder disappears after
	 * refresh" bug end-to-end. The trigger is the leave → re-accept
	 * cycle: each leave used to write a tombstone for the
	 * recipient's still-existing placement row, and the
	 * re-acceptance reuses the same row id. The next heartbeat tick
	 * then sends the placement as both an upsert AND in
	 * `removed.placements`; the client applies upserts first, then
	 * removals, so the folder vanishes on every tick.
	 *
	 * @covers ::open_station_files_compute_heartbeat_delta
	 * @covers ::open_station_files_trash_folder_for_user
	 */
	public function test_leave_then_reaccept_does_not_send_active_placement_as_removed() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Recipient leaves the share — soft-trashes their placement.
		open_station_folder_share_leave( $folder_id, self::$editor_id );

		// Owner re-invites and recipient re-accepts. The accept path
		// reuses the soft-trashed placement row (same id) via the
		// duplicate-key handler in `open_station_files_place`.
		$share_id2 = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_accept( $share_id2, self::$editor_id );

		// Fresh heartbeat with placementsVersion=0 (recipient just
		// refreshed). The placement must NOT appear in
		// `removed.placements` since it was just restored.
		$delta = open_station_files_compute_heartbeat_delta(
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

	/**
	 * Reproduces a user-reported bug: after the owner drops a URL
	 * (`link` file type) into the shared folder, the FOLDER itself
	 * vanishes from the recipient's desktop on refresh.
	 *
	 * Verifies:
	 *   - the recipient's root listing still returns the folder
	 *     placement after the new link is added; and
	 *   - the folder remains in `open_station_files_get_visible_folders`
	 *     for the recipient.
	 *
	 * @covers ::open_station_files_get_for_user_folder
	 * @covers ::open_station_files_get_visible_folders
	 */
	public function test_adding_link_to_shared_folder_keeps_folder_visible_to_recipient() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Shared with links',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		open_station_folder_share_accept( $share_id, self::$editor_id );

		// Sanity: recipient sees the folder at their root before the link.
		$before_root = open_station_files_get_for_user_folder( self::$editor_id, 0 );
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

		// Owner drops a URL into the shared folder.
		$link_id = open_station_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://example.com/',
			array( 'meta' => array( 'name' => 'Example' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		// Recipient refreshes — folder must still be at root.
		$after_root = open_station_files_get_for_user_folder( self::$editor_id, 0 );
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

		// And it must still be in the visible-folders set the heartbeat
		// uses to gate placement deltas.
		$visible_ids = wp_list_pluck(
			open_station_files_get_visible_folders( self::$editor_id ),
			'id'
		);
		$this->assertContains(
			(int) $folder_id,
			array_map( 'intval', $visible_ids ),
			'Shared folder should remain in visible-folders set after link is added.'
		);
	}

	/**
	 * Same scenario but for a role-principal share. Editor was
	 * granted access via the `editor` role, not by user id.
	 *
	 * @covers ::open_station_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_surfaces_new_file_for_role_principal_recipient() {
		$folder_id = open_station_files_create_folder( self::$owner_id, array(
			'name' => 'Editors workspace',
		) );
		$share_id = open_station_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);
		$accepted = open_station_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		$first = open_station_files_compute_heartbeat_delta(
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
		$placement_id = open_station_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		$delta = open_station_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => open_station_files_now_ms() ),
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
