<?php
/**
 * Tests for the folder-sharing feature:
 *
 *   - v8 schema migration + shares table existence
 *   - Invite / accept / deny / revoke lifecycle
 *   - Capability gating (eligibility, manage, write enforcement)
 *   - REST routes
 *   - If-Match conflict 409
 *   - Heartbeat pending payload
 *   - Trash scoped to recipient
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_FilesShares extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	// ---------------------------------------------------------------
	// Schema
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_install_schema
	 */
	public function test_shares_table_exists_after_install() {
		global $wpdb;
		$tables = openstation_files_table_names();
		$this->assertArrayHasKey( 'shares', $tables );
		$exists = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
				WHERE TABLE_SCHEMA = DATABASE()
					AND TABLE_NAME   = %s",
				$tables['shares']
			)
		);
		$this->assertSame( 1, $exists );
	}

	/**
	 * @covers ::openstation_files_install_schema
	 */
	public function test_shares_table_has_target_type_column() {
		global $wpdb;
		$tables = openstation_files_table_names();
		$cols   = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
				WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
				$tables['shares']
			)
		);
		$this->assertContains( 'target_type', $cols );
	}

	// ---------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_folder_share_invite
	 */
	public function test_invite_creates_a_pending_share_row() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$this->assertIsInt( $id );
		$row = openstation_files_get_share( $id );
		$this->assertSame( 'pending', $row['state'] );
		$this->assertSame( 'read', $row['capability'] );
	}

	/**
	 * @covers ::openstation_folder_share_invite
	 */
	public function test_invite_rejects_low_tier_user() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$subscriber_id, 'read' );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_ineligible_principal', $err->get_error_code() );
	}

	/**
	 * @covers ::openstation_folder_share_invite
	 */
	public function test_invite_rejects_non_owner_actor() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_invite( $folder, self::$editor_id, 'user', (string) self::$author_id, 'read' );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_forbidden', $err->get_error_code() );
	}

	/**
	 * @covers ::openstation_folder_share_accept
	 */
	public function test_accept_creates_recipient_folder_placement() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$row    = openstation_folder_share_accept( $id, self::$editor_id );
		$this->assertIsArray( $row );
		$this->assertSame( 'accepted', $row['state'] );

		// Editor now has a placement of the folder at desktop root.
		$placements = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$placements,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 1, $matched );
	}

	/**
	 * @covers ::openstation_folder_share_deny
	 */
	public function test_deny_marks_state_and_does_not_create_placement() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$row    = openstation_folder_share_deny( $id, self::$editor_id );
		$this->assertSame( 'denied', $row['state'] );
		$placements = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$placements,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched );
	}

	/**
	 * @covers ::openstation_folder_share_revoke
	 */
	public function test_revoke_after_accept_removes_recipient_placement() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );
		$ok = openstation_folder_share_revoke( $id, self::$owner_id );
		$this->assertTrue( $ok );
		$placements = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$placements,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched, 'recipient placement was soft-trashed' );
	}

	// ---------------------------------------------------------------
	// Capability resolver
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_owner_always_has_write() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$cap    = openstation_folder_share_user_capability( $folder, self::$owner_id );
		$this->assertSame( 'write', $cap );
	}

	/**
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_read_recipient_gets_read() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'read', $cap );
	}

	/**
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_write_beats_read_when_multiple_grants_match() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		// Grant editor 'read' as user-principal AND 'write' as role-principal.
		$u_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$r_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'write' );
		openstation_folder_share_accept( $u_id, self::$editor_id );
		openstation_folder_share_accept( $r_id, self::$editor_id );
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'write', $cap );
	}

	/**
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_pending_share_does_not_grant_visibility() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		// Not accepted yet.
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'none', $cap );
	}

	// ---------------------------------------------------------------
	// Visibility integration
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_compute_visible_folders
	 */
	public function test_accepted_user_share_appears_in_visible_folders() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );

		$visible = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$this->assertContains( $folder, $visible );
	}

	/**
	 * @covers ::openstation_files_compute_visible_folders
	 */
	public function test_pending_share_does_not_appear_in_visible_folders() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );

		$visible = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$this->assertNotContains( $folder, $visible );
	}

	// ---------------------------------------------------------------
	// Write-gate
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_read_only_recipient_cannot_move_placement_into_shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );

		// Editor has a personal post-placement at root. Try to move it into the shared folder.
		$post_id   = $this->factory->post->create( array( 'post_author' => self::$editor_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$editor_id, 0, 'post', (string) $post_id );
		$this->assertIsInt( $placement );

		$err = openstation_files_move( $placement, self::$editor_id, array( 'parent_id' => $folder ) );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_no_write_in_shared_folder', $err->get_error_code() );
	}

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_write_recipient_can_move_into_shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'write' );
		openstation_folder_share_accept( $id, self::$editor_id );

		$post_id   = $this->factory->post->create( array( 'post_author' => self::$editor_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$editor_id, 0, 'post', (string) $post_id );
		$this->assertIsInt( $placement );

		$ok = openstation_files_move( $placement, self::$editor_id, array( 'parent_id' => $folder ) );
		$this->assertTrue( $ok );
	}

	// ---------------------------------------------------------------
	// Conflict (If-Match)
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_check_if_match
	 */
	public function test_if_match_mismatch_returns_409() {
		wp_set_current_user( self::$owner_id );
		$post_id   = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		$row       = openstation_files_get_placement( $placement );

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $placement );
		$req->set_url_params( array( 'id' => $placement ) );
		$req->set_header( 'if_match', (string) ( $row['updated_at_ms'] - 1 ) );
		$req->set_body( wp_json_encode( array( 'x' => 100 ) ) );

		$res = openstation_files_rest_update_placement( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_conflict', $res->get_error_code() );
		$this->assertSame( 409, $res->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_files_check_if_match
	 */
	public function test_if_match_header_match_lets_request_through() {
		wp_set_current_user( self::$owner_id );
		$post_id   = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		$row       = openstation_files_get_placement( $placement );

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $placement );
		$req->set_url_params( array( 'id' => $placement ) );
		$req->set_header( 'if_match', (string) $row['updated_at_ms'] );
		$req->set_body_params( array( 'x' => 100 ) );

		$res = openstation_files_rest_update_placement( $req );
		$this->assertNotWPError( $res );
	}

	/**
	 * @covers ::openstation_files_check_if_match
	 */
	public function test_no_if_match_header_is_back_compat_last_write_wins() {
		wp_set_current_user( self::$owner_id );
		$post_id   = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$owner_id, 0, 'post', (string) $post_id );

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $placement );
		$req->set_url_params( array( 'id' => $placement ) );
		$req->set_body_params( array( 'x' => 100 ) );
		// No If-Match header at all → should pass.

		$res = openstation_files_rest_update_placement( $req );
		$this->assertNotWPError( $res );
	}

	// ---------------------------------------------------------------
	// Heartbeat pending payload
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_get_pending_shares_for_user
	 */
	public function test_pending_invites_surface_in_heartbeat_query() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$pending = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$this->assertCount( 1, $pending );
		$this->assertSame( $folder, $pending[0]['folder_id'] );
	}

	/**
	 * @covers ::openstation_files_get_pending_shares_for_user
	 */
	public function test_pending_invites_filter_by_since_ms() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$pending = openstation_files_get_pending_shares_for_user( self::$editor_id, openstation_files_now_ms() + 1000 );
		$this->assertCount( 0, $pending );
	}

	/**
	 * @covers ::openstation_files_get_pending_shares_for_user
	 */
	public function test_role_principal_targets_user_with_matching_role() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );
		$pending_e = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$pending_s = openstation_files_get_pending_shares_for_user( self::$subscriber_id, 0 );
		$this->assertCount( 1, $pending_e );
		$this->assertCount( 0, $pending_s );
	}

	// ---------------------------------------------------------------
	// Recipient-scoped trash
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_trash_folder_for_user
	 */
	public function test_trash_for_user_only_touches_recipient_rows() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'write' );
		openstation_folder_share_accept( $id, self::$editor_id );

		// Owner's own placement of the folder at root.
		$owner_folder_placement = openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder );

		// Recipient also gets a placement (created by accept).
		// Trash for editor only.
		openstation_files_trash_folder_for_user( $folder, self::$editor_id );

		// Owner's placement still active.
		$owner_row = openstation_files_get_placement( $owner_folder_placement );
		$this->assertNotNull( $owner_row );

		// Editor's placement gone.
		$editor_root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$editor_root,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched );
	}

	// ---------------------------------------------------------------
	// REST coverage
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_rest_list_shares
	 */
	public function test_rest_list_shares_requires_owner() {
		wp_set_current_user( self::$editor_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );

		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/folders/' . $folder . '/shares' );
		$req->set_url_params( array( 'id' => $folder ) );
		$res = openstation_files_rest_list_shares( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_forbidden', $res->get_error_code() );
	}

	/**
	 * @covers ::openstation_files_rest_create_share
	 */
	public function test_rest_create_share_invites_principal() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );

		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/folders/' . $folder . '/shares' );
		$req->set_url_params( array( 'id' => $folder ) );
		$req->set_body_params(
			array(
				'principalType' => 'user',
				'principalRef'  => (string) self::$editor_id,
				'capability'    => 'read',
			)
		);
		$res = openstation_files_rest_create_share( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertSame( 'pending', $data['state'] );
		$this->assertSame( 'read', $data['capability'] );
	}

	// ---------------------------------------------------------------
	// Extensibility hooks
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_files_shareable_types
	 */
	public function test_shareable_types_defaults_to_folder() {
		$types = openstation_files_shareable_types();
		$this->assertContains( 'folder', $types );
	}

	/**
	 * @covers ::openstation_files_shareable_types
	 */
	public function test_shareable_types_is_filterable() {
		add_filter(
			'openstation_files_shareable_types',
			static fn( $t ) => array_merge( $t, array( 'post' ) )
		);
		$types = openstation_files_shareable_types();
		$this->assertContains( 'post', $types );
		$this->assertContains( 'folder', $types );
		remove_all_filters( 'openstation_files_shareable_types' );
	}

	// ---------------------------------------------------------------
	// Role-principal per-user opt-in (decisions table)
	// ---------------------------------------------------------------

	/**
	 * One editor accepting a role-share does NOT auto-accept it
	 * for other editors — each one keeps their own pending state.
	 *
	 * @covers ::openstation_folder_share_accept
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_role_share_accept_is_per_user() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		// Create a second editor.
		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );

		// Editor 1 accepts; editor 2 should remain undecided.
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$cap1 = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$cap2 = openstation_folder_share_user_capability( $folder, $editor2 );
		$this->assertSame( 'read', $cap1, 'editor 1 accepted, has access' );
		$this->assertSame( 'none', $cap2, 'editor 2 has not accepted yet' );

		// Editor 2 still sees a pending invite on heartbeat.
		$pending2 = openstation_files_get_pending_shares_for_user( $editor2, 0 );
		$this->assertCount( 1, $pending2 );
		$this->assertSame( $share_id, $pending2[0]['id'] );

		// Editor 1 no longer sees it as pending.
		$pending1 = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$this->assertCount( 0, $pending1 );
	}

	/**
	 * @covers ::openstation_folder_share_deny
	 */
	public function test_role_share_deny_is_per_user() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );

		// Editor 1 denies; editor 2 still has a pending invite.
		openstation_folder_share_deny( $share_id, self::$editor_id );

		$pending1 = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$pending2 = openstation_files_get_pending_shares_for_user( $editor2, 0 );
		$this->assertCount( 0, $pending1 );
		$this->assertCount( 1, $pending2 );

		// Editor 2 can still accept later.
		openstation_folder_share_accept( $share_id, $editor2 );
		$cap2 = openstation_folder_share_user_capability( $folder, $editor2 );
		$this->assertSame( 'read', $cap2 );
	}

	// ---------------------------------------------------------------
	// Leave shared folder
	// ---------------------------------------------------------------

	/**
	 * @covers ::openstation_folder_share_leave
	 */
	public function test_leave_user_principal_share_revokes_self() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$ok = openstation_folder_share_leave( $folder, self::$editor_id );
		$this->assertTrue( $ok );

		// Visibility gone.
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'none', $cap );

		// The recipient's folder placement was trashed.
		$root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$root,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched );
	}

	/**
	 * @covers ::openstation_folder_share_leave
	 */
	public function test_leave_role_share_does_not_affect_other_role_members() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );
		openstation_folder_share_accept( $share_id, self::$editor_id );
		openstation_folder_share_accept( $share_id, $editor2 );

		openstation_folder_share_leave( $folder, self::$editor_id );

		$this->assertSame( 'none', openstation_folder_share_user_capability( $folder, self::$editor_id ) );
		$this->assertSame( 'read', openstation_folder_share_user_capability( $folder, $editor2 ) );
	}

	/**
	 * @covers ::openstation_folder_share_leave
	 */
	public function test_owner_cannot_leave_their_own_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_leave( $folder, self::$owner_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_owner_cannot_leave', $err->get_error_code() );
	}

	/**
	 * @covers ::openstation_folder_share_leave
	 */
	public function test_leave_without_membership_returns_404() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_leave( $folder, self::$editor_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_not_member', $err->get_error_code() );
	}

	// ---------------------------------------------------------------
	// Cascade (sub-folders inside a shared folder)
	// ---------------------------------------------------------------

	/**
	 * Recipient with read on a folder also gets read on every
	 * sub-folder nested inside it.
	 *
	 * @covers ::openstation_folder_share_user_capability
	 * @covers ::openstation_folder_ancestors
	 */
	public function test_cascade_grants_read_to_nested_subfolder() {
		$parent = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Parent' ) );
		$child  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Child' ) );
		// Owner places the child folder inside the parent.
		openstation_files_place( self::$owner_id, $parent, 'folder', (string) $child );

		$share_id = openstation_folder_share_invite( $parent, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$cap = openstation_folder_share_user_capability( $child, self::$editor_id );
		$this->assertSame( 'read', $cap );
	}

	/**
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_cascade_propagates_write_through_multiple_levels() {
		$a = openstation_files_create_folder( self::$owner_id, array( 'name' => 'A' ) );
		$b = openstation_files_create_folder( self::$owner_id, array( 'name' => 'B' ) );
		$c = openstation_files_create_folder( self::$owner_id, array( 'name' => 'C' ) );
		openstation_files_place( self::$owner_id, $a, 'folder', (string) $b );
		openstation_files_place( self::$owner_id, $b, 'folder', (string) $c );

		$share_id = openstation_folder_share_invite( $a, self::$owner_id, 'user', (string) self::$editor_id, 'write' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$this->assertSame( 'write', openstation_folder_share_user_capability( $b, self::$editor_id ) );
		$this->assertSame( 'write', openstation_folder_share_user_capability( $c, self::$editor_id ) );
	}

	/**
	 * Recipient sees EVERY placement inside a shared folder, even
	 * those whose underlying entity their role can't normally read
	 * (e.g. private posts, users they can't list). Per-entity
	 * access enforcement is the opener's job, not the lister's.
	 *
	 * @covers ::openstation_files_get_for_user_folder
	 */
	public function test_shared_folder_listing_ignores_per_entity_can_read() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );

		// Owner places three entities. The author user is the
		// canonical "can't read for an editor without list_users"
		// case; the private post is the post-side equivalent.
		$post_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$page_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish', 'post_type' => 'page' ) );
		openstation_files_place( self::$owner_id, $folder, 'post', (string) $post_id );
		openstation_files_place( self::$owner_id, $folder, 'post', (string) $page_id );
		openstation_files_place( self::$owner_id, $folder, 'user', (string) self::$author_id );

		// Share with author (low cap on purpose — author can't
		// list_users, can't edit_others_posts).
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$author_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$author_id );

		$rows = openstation_files_get_for_user_folder( self::$author_id, $folder );
		$types = array_count_values( array_map( static fn( $r ) => $r['file_type'], $rows ) );
		$this->assertSame( 2, $types['post'] ?? 0, 'both posts surface' );
		$this->assertSame( 1, $types['user'] ?? 0, 'user surface even when recipient lacks list_users' );
	}

	/**
	 * Files placed inside a sub-folder of a shared folder are
	 * visible to the recipient (the placements list returns the
	 * full set, not just the viewer's).
	 *
	 * @covers ::openstation_files_get_for_user_folder
	 */
	public function test_recipient_sees_files_inside_nested_subfolder() {
		$parent = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Parent' ) );
		$child  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Child' ) );
		openstation_files_place( self::$owner_id, $parent, 'folder', (string) $child );

		// Owner places a post inside the child folder.
		$post_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		openstation_files_place( self::$owner_id, $child, 'post', (string) $post_id );

		// Share parent with editor; editor accepts.
		$share_id = openstation_folder_share_invite( $parent, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$child_contents = openstation_files_get_for_user_folder( self::$editor_id, $child );
		$post_placements = array_filter(
			$child_contents,
			static fn( $p ) => 'post' === $p['file_type'] && (string) $post_id === (string) $p['file_ref']
		);
		$this->assertCount( 1, $post_placements );
	}

	/**
	 * Cascade does NOT cross folders the owner doesn't own.
	 *
	 * @covers ::openstation_folder_share_user_capability
	 */
	public function test_cascade_terminates_at_ancestors_owned_by_others() {
		$root_other = openstation_files_create_folder( self::$subscriber_id, array( 'name' => 'Other root' ) );
		// `editor` has no access to `root_other`. Now we create a
		// folder owned by `editor` and place it inside `root_other`.
		// (In reality this couldn't happen via REST — write-gates
		// block it — but the DB allows it, and we test the cap
		// walker doesn't leap across the boundary.)
		$mid = openstation_files_create_folder( self::$editor_id, array( 'name' => 'Editor mid' ) );
		// Force placement via the store directly with editor as the owner.
		global $wpdb;
		$tables = openstation_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => self::$editor_id,
				'parent_id'     => $root_other,
				'file_type'     => 'folder',
				'file_ref'      => (string) $mid,
				'updated_at_ms' => openstation_files_now_ms(),
			),
			array( '%d', '%d', '%s', '%s', '%d' )
		);
		// Owner doesn't share `root_other` with `editor`. Editor's
		// access to `mid` should remain ownership-only (write) and
		// NOT inherit anything from `root_other`.
		$cap = openstation_folder_share_user_capability( $mid, self::$editor_id );
		$this->assertSame( 'write', $cap, 'editor owns mid' );
		// And another viewer with no relationship to either gets none.
		$cap_other = openstation_folder_share_user_capability( $mid, self::$author_id );
		$this->assertSame( 'none', $cap_other );
	}

	/**
	 * @covers ::openstation_folder_share_revoke
	 */
	public function test_revoke_role_share_trashes_every_decided_member_view() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );
		openstation_folder_share_accept( $share_id, self::$editor_id );
		openstation_folder_share_accept( $share_id, $editor2 );

		openstation_folder_share_revoke( $share_id, self::$owner_id );

		foreach ( array( self::$editor_id, $editor2 ) as $uid ) {
			$placements = openstation_files_get_for_user_folder( $uid, 0 );
			$matched    = array_filter(
				$placements,
				static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
			);
			$this->assertCount( 0, $matched, "user $uid lost their local view" );
		}
	}
}
