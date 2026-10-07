<?php

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

	public function test_invite_creates_a_pending_share_row() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$this->assertIsInt( $id );
		$row = openstation_files_get_share( $id );
		$this->assertSame( 'pending', $row['state'] );
		$this->assertSame( 'read', $row['capability'] );
	}

	public function test_invite_rejects_low_tier_user() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$subscriber_id, 'read' );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_ineligible_principal', $err->get_error_code() );
	}

	public function test_invite_rejects_agent_user() {
		$agent_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		update_user_meta( $agent_id, OPENSTATION_AGENT_USER_MARKER_META, '1' );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) $agent_id, 'read' );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_ineligible_principal', $err->get_error_code() );
	}

	public function test_invite_rejects_non_owner_actor() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_invite( $folder, self::$editor_id, 'user', (string) self::$author_id, 'read' );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_forbidden', $err->get_error_code() );
	}

	public function test_accept_creates_recipient_folder_placement() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$row    = openstation_folder_share_accept( $id, self::$editor_id );
		$this->assertIsArray( $row );
		$this->assertSame( 'accepted', $row['state'] );

		$placements = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$placements,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 1, $matched );
	}

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

	public function test_owner_always_has_write() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$cap    = openstation_folder_share_user_capability( $folder, self::$owner_id );
		$this->assertSame( 'write', $cap );
	}

	public function test_read_recipient_gets_read() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'read', $cap );
	}

	public function test_write_beats_read_when_multiple_grants_match() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );

		$u_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$r_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'write' );
		openstation_folder_share_accept( $u_id, self::$editor_id );
		openstation_folder_share_accept( $r_id, self::$editor_id );
		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'write', $cap );
	}

	public function test_pending_share_does_not_grant_visibility() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );

		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'none', $cap );
	}

	public function test_accepted_user_share_appears_in_visible_folders() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );

		$visible = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$this->assertContains( $folder, $visible );
	}

	public function test_pending_share_does_not_appear_in_visible_folders() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );

		$visible = wp_list_pluck( openstation_files_get_visible_folders( self::$editor_id ), 'id' );
		$this->assertNotContains( $folder, $visible );
	}

	public function test_read_only_recipient_cannot_move_placement_into_shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $id, self::$editor_id );

		$post_id   = $this->factory->post->create( array( 'post_author' => self::$editor_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$editor_id, 0, 'post', (string) $post_id );
		$this->assertIsInt( $placement );

		$err = openstation_files_move( $placement, self::$editor_id, array( 'parent_id' => $folder ) );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_no_write_in_shared_folder', $err->get_error_code() );
	}

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

	public function test_no_if_match_header_is_back_compat_last_write_wins() {
		wp_set_current_user( self::$owner_id );
		$post_id   = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$placement = openstation_files_place( self::$owner_id, 0, 'post', (string) $post_id );

		$req = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/files/placements/' . $placement );
		$req->set_url_params( array( 'id' => $placement ) );
		$req->set_body_params( array( 'x' => 100 ) );

		$res = openstation_files_rest_update_placement( $req );
		$this->assertNotWPError( $res );
	}

	public function test_pending_invites_surface_in_heartbeat_query() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$pending = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$this->assertCount( 1, $pending );
		$this->assertSame( $folder, $pending[0]['folder_id'] );
	}

	public function test_pending_invites_filter_by_since_ms() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		$pending = openstation_files_get_pending_shares_for_user( self::$editor_id, openstation_files_now_ms() + 1000 );
		$this->assertCount( 0, $pending );
	}

	public function test_role_principal_targets_user_with_matching_role() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );
		$pending_e = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$pending_s = openstation_files_get_pending_shares_for_user( self::$subscriber_id, 0 );
		$this->assertCount( 1, $pending_e );
		$this->assertCount( 0, $pending_s );
	}

	public function test_trash_for_user_only_touches_recipient_rows() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$id     = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'write' );
		openstation_folder_share_accept( $id, self::$editor_id );

		$owner_folder_placement = openstation_files_place( self::$owner_id, 0, 'folder', (string) $folder );

		openstation_files_trash_folder_for_user( $folder, self::$editor_id );

		$owner_row = openstation_files_get_placement( $owner_folder_placement );
		$this->assertNotNull( $owner_row );

		$editor_root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$editor_root,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched );
	}

	public function test_rest_list_shares_requires_owner() {
		wp_set_current_user( self::$editor_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );

		$req = new WP_REST_Request( 'GET', '/desktop-mode/v1/files/folders/' . $folder . '/shares' );
		$req->set_url_params( array( 'id' => $folder ) );
		$res = openstation_files_rest_list_shares( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_files_forbidden', $res->get_error_code() );
	}

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

	public function test_shareable_types_defaults_to_folder() {
		$types = openstation_files_shareable_types();
		$this->assertContains( 'folder', $types );
	}

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

	public function test_role_share_accept_is_per_user() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );

		openstation_folder_share_accept( $share_id, self::$editor_id );

		$cap1 = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$cap2 = openstation_folder_share_user_capability( $folder, $editor2 );
		$this->assertSame( 'read', $cap1, 'editor 1 accepted, has access' );
		$this->assertSame( 'none', $cap2, 'editor 2 has not accepted yet' );

		$pending2 = openstation_files_get_pending_shares_for_user( $editor2, 0 );
		$this->assertCount( 1, $pending2 );
		$this->assertSame( $share_id, $pending2[0]['id'] );

		$pending1 = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$this->assertCount( 0, $pending1 );
	}

	public function test_role_share_deny_is_per_user() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'role', 'editor', 'read' );

		$editor2 = $this->factory->user->create( array( 'role' => 'editor' ) );

		openstation_folder_share_deny( $share_id, self::$editor_id );

		$pending1 = openstation_files_get_pending_shares_for_user( self::$editor_id, 0 );
		$pending2 = openstation_files_get_pending_shares_for_user( $editor2, 0 );
		$this->assertCount( 0, $pending1 );
		$this->assertCount( 1, $pending2 );

		openstation_folder_share_accept( $share_id, $editor2 );
		$cap2 = openstation_folder_share_user_capability( $folder, $editor2 );
		$this->assertSame( 'read', $cap2 );
	}

	public function test_leave_user_principal_share_revokes_self() {
		$folder   = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$ok = openstation_folder_share_leave( $folder, self::$editor_id );
		$this->assertTrue( $ok );

		$cap = openstation_folder_share_user_capability( $folder, self::$editor_id );
		$this->assertSame( 'none', $cap );

		$root = openstation_files_get_for_user_folder( self::$editor_id, 0 );
		$matched = array_filter(
			$root,
			static fn( $p ) => 'folder' === $p['file_type'] && (string) $folder === (string) $p['file_ref']
		);
		$this->assertCount( 0, $matched );
	}

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

	public function test_owner_cannot_leave_their_own_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_leave( $folder, self::$owner_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_owner_cannot_leave', $err->get_error_code() );
	}

	public function test_leave_without_membership_returns_404() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'X' ) );
		$err    = openstation_folder_share_leave( $folder, self::$editor_id );
		$this->assertWPError( $err );
		$this->assertSame( 'openstation_files_not_member', $err->get_error_code() );
	}

	public function test_cascade_grants_read_to_nested_subfolder() {
		$parent = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Parent' ) );
		$child  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Child' ) );

		openstation_files_place( self::$owner_id, $parent, 'folder', (string) $child );

		$share_id = openstation_folder_share_invite( $parent, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$cap = openstation_folder_share_user_capability( $child, self::$editor_id );
		$this->assertSame( 'read', $cap );
	}

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

	public function test_shared_folder_listing_ignores_per_entity_can_read() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );

		$post_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		$page_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish', 'post_type' => 'page' ) );
		openstation_files_place( self::$owner_id, $folder, 'post', (string) $post_id );
		openstation_files_place( self::$owner_id, $folder, 'post', (string) $page_id );
		openstation_files_place( self::$owner_id, $folder, 'user', (string) self::$author_id );

		$share_id = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$author_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$author_id );

		$rows = openstation_files_get_for_user_folder( self::$author_id, $folder );
		$types = array_count_values( array_map( static fn( $r ) => $r['file_type'], $rows ) );
		$this->assertSame( 2, $types['post'] ?? 0, 'both posts surface' );
		$this->assertSame( 1, $types['user'] ?? 0, 'user surface even when recipient lacks list_users' );
	}

	public function test_recipient_sees_files_inside_nested_subfolder() {
		$parent = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Parent' ) );
		$child  = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Child' ) );
		openstation_files_place( self::$owner_id, $parent, 'folder', (string) $child );

		$post_id = $this->factory->post->create( array( 'post_author' => self::$owner_id, 'post_status' => 'publish' ) );
		openstation_files_place( self::$owner_id, $child, 'post', (string) $post_id );

		$share_id = openstation_folder_share_invite( $parent, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share_id, self::$editor_id );

		$child_contents = openstation_files_get_for_user_folder( self::$editor_id, $child );
		$post_placements = array_filter(
			$child_contents,
			static fn( $p ) => 'post' === $p['file_type'] && (string) $post_id === (string) $p['file_ref']
		);
		$this->assertCount( 1, $post_placements );
	}

	public function test_cascade_terminates_at_ancestors_owned_by_others() {
		$root_other = openstation_files_create_folder( self::$subscriber_id, array( 'name' => 'Other root' ) );

		$mid = openstation_files_create_folder( self::$editor_id, array( 'name' => 'Editor mid' ) );

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

		$cap = openstation_folder_share_user_capability( $mid, self::$editor_id );
		$this->assertSame( 'write', $cap, 'editor owns mid' );

		$cap_other = openstation_folder_share_user_capability( $mid, self::$author_id );
		$this->assertSame( 'none', $cap_other );
	}

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
