<?php
/**
 * Tests for Phase-6 sharing visibility + Heartbeat delta.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-files
 */
class Tests_DesktopMode_FilesSharing extends WP_UnitTestCase {

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
		desktop_mode_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		$tables = desktop_mode_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_private_folder_is_invisible_to_non_owner() {
		desktop_mode_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		$visible = desktop_mode_files_get_visible_folders( self::$editor_id );
		$this->assertSame( array(), $visible );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_all_share_mode_is_visible_to_anyone() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$visible = desktop_mode_files_get_visible_folders( self::$editor_id );
		$ids     = wp_list_pluck( $visible, 'id' );
		$this->assertContains( $id, $ids );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_users_share_mode_filters_by_id() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Shared with editor',
			'share_mode' => 'users',
			'share_meta' => array( 'users' => array( self::$editor_id ) ),
		) );
		$visible_to_editor = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_roles_share_mode_filters_by_role() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Editors only',
			'share_mode' => 'roles',
			'share_meta' => array( 'roles' => array( 'editor' ) ),
		) );
		$visible_to_editor = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_owner_always_sees_their_own() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'My folder',
			'share_mode' => 'private',
		) );
		$visible = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$owner_id ), 'id' );
		$this->assertContains( $id, $visible );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_returns_new_folders_since_version() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$folder = desktop_mode_files_get_folder( $id );
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$folder_ids = wp_list_pluck( $delta['folders'], 'id' );
		$this->assertContains( $id, $folder_ids );

		// Pretend the client has now seen this folder.
		$delta2 = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $id => (int) $folder['updated_at_ms'] ),
			$delta['serverTimeMs'],
			200
		);
		$this->assertSame( array(), $delta2['folders'] );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_includes_tombstones_after_remove() {
		$post_id = self::factory()->post->create();
		$pid = desktop_mode_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		desktop_mode_files_remove( $pid, self::$owner_id );

		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$owner_id,
			array(),
			0,
			200
		);
		$this->assertContains( $pid, $delta['removed']['placements'] );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_truncated_flag() {
		// Create more folders than the cap of 5.
		for ( $i = 0; $i < 7; $i++ ) {
			desktop_mode_files_create_folder( self::$owner_id, array(
				'name'       => 'F' . $i,
				'share_mode' => 'all',
			) );
		}
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			5
		);
		$this->assertTrue( $delta['truncated'] );
		$this->assertCount( 5, $delta['folders'] );
	}

	/**
	 * Reproduces the reported regression: owner adds a NEW file
	 * to an already-shared folder, recipient's next heartbeat
	 * delta must include the new placement.
	 *
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_surfaces_new_file_added_to_shared_folder() {
		// 1) Owner creates a folder, invites editor (user-principal),
		//    editor accepts.
		$folder_id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing assets',
		) );
		$share_id = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		$accepted = desktop_mode_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		// 2) Snapshot the heartbeat high-water at "now" — emulates
		//    the recipient having already synced everything up to
		//    this point.
		$first = desktop_mode_files_compute_heartbeat_delta(
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
		$placement_id = desktop_mode_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		// 4) Recipient's next heartbeat — should pick up the new
		//    placement because its parent_id is a visible folder
		//    and its updated_at_ms is fresher than the high-water.
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => desktop_mode_files_now_ms() ),
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
	 * @covers ::desktop_mode_files_get_for_user_folder
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_new_file_in_shared_folder_visible_via_rest_and_heartbeat_with_both_principals() {
		$folder_id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );

		// Both invites for the same recipient.
		$user_share = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);
		// Recipient accepts via user-principal.
		desktop_mode_folder_share_accept( $user_share, self::$editor_id );

		// Capture baseline heartbeat — emulates the recipient having
		// already synced everything before the owner adds the file.
		$first = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$baseline_high_water = (int) $first['serverTimeMs'];
		usleep( 5000 );

		// Owner adds a new link to the shared folder.
		$link_id = desktop_mode_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://youtube.com',
			array( 'meta' => array( 'name' => 'YouTube' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		// 1) REST contents listing must include the new link.
		$rows = desktop_mode_files_get_for_user_folder( self::$editor_id, $folder_id );
		$ids  = array_map( static fn( $r ) => (int) $r['id'], $rows );
		$this->assertContains(
			(int) $link_id,
			$ids,
			'Recipient REST listing of the shared folder must include the newly-placed link.'
		);

		// 2) Heartbeat delta must surface the same placement live.
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => desktop_mode_files_now_ms() ),
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
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 * @covers ::desktop_mode_files_trash_folder_for_user
	 */
	public function test_leave_then_reaccept_does_not_send_active_placement_as_removed() {
		$folder_id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name' => 'Marketing',
		) );
		$share_id = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		desktop_mode_folder_share_accept( $share_id, self::$editor_id );

		// Recipient leaves the share — soft-trashes their placement.
		desktop_mode_folder_share_leave( $folder_id, self::$editor_id );

		// Owner re-invites and recipient re-accepts. The accept path
		// reuses the soft-trashed placement row (same id) via the
		// duplicate-key handler in `desktop_mode_files_place`.
		$share_id2 = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		desktop_mode_folder_share_accept( $share_id2, self::$editor_id );

		// Fresh heartbeat with placementsVersion=0 (recipient just
		// refreshed). The placement must NOT appear in
		// `removed.placements` since it was just restored.
		$delta = desktop_mode_files_compute_heartbeat_delta(
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
	 *   - the folder remains in `desktop_mode_files_get_visible_folders`
	 *     for the recipient.
	 *
	 * @covers ::desktop_mode_files_get_for_user_folder
	 * @covers ::desktop_mode_files_get_visible_folders
	 */
	public function test_adding_link_to_shared_folder_keeps_folder_visible_to_recipient() {
		$folder_id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name' => 'Shared with links',
		) );
		$share_id = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'user',
			(string) self::$editor_id,
			'read'
		);
		desktop_mode_folder_share_accept( $share_id, self::$editor_id );

		// Sanity: recipient sees the folder at their root before the link.
		$before_root = desktop_mode_files_get_for_user_folder( self::$editor_id, 0 );
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
		$link_id = desktop_mode_files_place(
			self::$owner_id,
			$folder_id,
			'link',
			'https://example.com/',
			array( 'meta' => array( 'name' => 'Example' ) )
		);
		$this->assertNotInstanceOf( WP_Error::class, $link_id );

		// Recipient refreshes — folder must still be at root.
		$after_root = desktop_mode_files_get_for_user_folder( self::$editor_id, 0 );
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
			desktop_mode_files_get_visible_folders( self::$editor_id ),
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
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_surfaces_new_file_for_role_principal_recipient() {
		$folder_id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name' => 'Editors workspace',
		) );
		$share_id = desktop_mode_folder_share_invite(
			$folder_id,
			self::$owner_id,
			'role',
			'editor',
			'read'
		);
		$accepted = desktop_mode_folder_share_accept( $share_id, self::$editor_id );
		$this->assertNotInstanceOf( WP_Error::class, $accepted );

		$first = desktop_mode_files_compute_heartbeat_delta(
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
		$placement_id = desktop_mode_files_place(
			self::$owner_id,
			$folder_id,
			'post',
			(string) $post_id
		);
		$this->assertNotInstanceOf( WP_Error::class, $placement_id );

		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $folder_id => desktop_mode_files_now_ms() ),
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
