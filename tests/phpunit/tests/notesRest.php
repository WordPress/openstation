<?php
/**
 * Tests for the pinned-notes REST handlers: ownership (owner-only
 * mutation, admins included), public/private visibility, optimistic
 * concurrency, trash/restore, and the Heartbeat delta.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-notes
 */
class Tests_DesktopMode_NotesRest extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $other_id;
	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Note Owner' ) );
		self::$other_id = $factory->user->create( array( 'role' => 'editor', 'display_name' => 'Someone Else' ) );
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		foreach ( array( self::$owner_id, self::$other_id, self::$admin_id ) as $user_id ) {
			update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		}
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$owner_id );
	}

	public function tear_down() {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	private function create_request( array $params = array() ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/notes' );
		foreach (
			array_merge(
				array(
					'text'   => 'Buy milk',
					'color'  => 'mint',
					'x'      => 0.25,
					'y'      => 0.5,
					'public' => false,
				),
				$params
			) as $key => $value
		) {
			$request->set_param( $key, $value );
		}
		return $request;
	}

	private function create_note( array $params = array() ) {
		$response = desktop_mode_notes_rest_create( $this->create_request( $params ) );
		return $response->get_data();
	}

	private function update_request( $id, array $params ) {
		$request = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/notes/' . $id );
		$request->set_param( 'id', $id );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return $request;
	}

	/**
	 * @covers ::desktop_mode_notes_rest_permission
	 */
	public function test_permission_requires_login() {
		wp_set_current_user( 0 );
		$result = desktop_mode_notes_rest_permission();
		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_permission
	 */
	public function test_permission_requires_desktop_mode() {
		$muggle = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $muggle );
		$result = desktop_mode_notes_rest_permission();
		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_create
	 * @covers ::desktop_mode_notes_prepare
	 */
	public function test_create_defaults_to_private_and_forces_author() {
		$note = $this->create_note();
		$this->assertFalse( $note['public'] );
		$this->assertSame( self::$owner_id, $note['ownerId'] );
		$this->assertTrue( $note['canEdit'] );
		$this->assertSame( 'Buy milk', $note['text'] );
		$this->assertSame( 'mint', $note['color'] );
		$this->assertSame( 0.25, $note['x'] );
		$this->assertSame( 0.5, $note['y'] );
		$this->assertGreaterThan( 0, $note['z'] );
		$this->assertGreaterThan( 0, $note['updatedAtMs'] );
		$this->assertSame( 'private', get_post_status( $note['id'] ) );
		// Title derived from the first line, for admin-side lists.
		$this->assertSame( 'Buy milk', get_post( $note['id'] )->post_title );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_create
	 * @covers ::desktop_mode_notes_rest_update
	 */
	public function test_seed_is_stamped_at_creation_and_never_updated() {
		// Client-provided seed is persisted verbatim.
		$note = $this->create_note( array( 'seed' => 777 ) );
		$this->assertSame( 777, $note['seed'] );

		// Absent seed → server derives one from the text.
		$derived = $this->create_note( array( 'text' => 'derive me' ) );
		$this->assertGreaterThan( 0, $derived['seed'] );

		// PATCH — even one that rewrites the text — leaves the seed alone.
		$resp = desktop_mode_notes_rest_update(
			$this->update_request(
				$note['id'],
				array(
					'text'        => 'completely different text',
					'updatedAtMs' => $note['updatedAtMs'],
				)
			)
		);
		$this->assertNotWPError( $resp );
		$this->assertSame( 777, $resp->get_data()['seed'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_create
	 */
	public function test_create_gates_on_the_user_can_create_filter() {
		add_filter( 'desktop_mode_notes_user_can_create', '__return_false' );
		$resp = desktop_mode_notes_rest_create( $this->create_request() );
		remove_filter( 'desktop_mode_notes_user_can_create', '__return_false' );
		$this->assertWPError( $resp );
		$this->assertSame( 403, $resp->get_error_data()['status'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_create
	 */
	public function test_create_public_note_is_publish_status() {
		$note = $this->create_note( array( 'public' => true ) );
		$this->assertTrue( $note['public'] );
		$this->assertSame( 'publish', get_post_status( $note['id'] ) );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_create
	 */
	public function test_create_whitelists_color_and_clamps_position() {
		$note = $this->create_note(
			array(
				'color' => 'hotpink',
				'x'     => 7,
				'y'     => -2,
			)
		);
		$this->assertSame( 'butter', $note['color'] );
		$this->assertSame( 1.0, $note['x'] );
		$this->assertSame( 0.0, $note['y'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_list
	 */
	public function test_list_returns_own_notes_and_only_public_notes_of_others() {
		$own_private = $this->create_note( array( 'text' => 'mine private' ) );
		$own_public  = $this->create_note( array( 'text' => 'mine public', 'public' => true ) );

		wp_set_current_user( self::$other_id );
		$their_private = $this->create_note( array( 'text' => 'theirs private' ) );
		$their_public  = $this->create_note( array( 'text' => 'theirs public', 'public' => true ) );

		wp_set_current_user( self::$owner_id );
		$data = desktop_mode_notes_rest_list()->get_data();
		$ids  = wp_list_pluck( $data['notes'], 'id' );

		$this->assertContains( $own_private['id'], $ids );
		$this->assertContains( $own_public['id'], $ids );
		$this->assertContains( $their_public['id'], $ids );
		$this->assertNotContains( $their_private['id'], $ids, 'Another user\'s private note must never be serialized.' );

		foreach ( $data['notes'] as $note ) {
			if ( $note['id'] === $their_public['id'] ) {
				$this->assertFalse( $note['canEdit'] );
				$this->assertSame( 'Someone Else', $note['ownerName'] );
			}
			if ( $note['id'] === $own_private['id'] ) {
				$this->assertTrue( $note['canEdit'] );
			}
		}
	}

	/**
	 * @covers ::desktop_mode_notes_rest_update
	 */
	public function test_update_persists_partial_fields() {
		$note = $this->create_note();
		$resp = desktop_mode_notes_rest_update(
			$this->update_request(
				$note['id'],
				array(
					'text'        => "New first line\nsecond",
					'color'       => 'lilac',
					'x'           => 0.7,
					'public'      => true,
					'updatedAtMs' => $note['updatedAtMs'],
				)
			)
		);
		$this->assertNotWPError( $resp );
		$updated = $resp->get_data();
		$this->assertSame( "New first line\nsecond", $updated['text'] );
		$this->assertSame( 'lilac', $updated['color'] );
		$this->assertSame( 0.7, $updated['x'] );
		$this->assertSame( 0.5, $updated['y'], 'Untouched fields keep their value.' );
		$this->assertTrue( $updated['public'] );
		$this->assertSame( 'New first line', get_post( $note['id'] )->post_title );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_update
	 * @covers ::desktop_mode_notes_require_owner
	 */
	public function test_non_owner_cannot_update_even_as_admin() {
		$note = $this->create_note( array( 'public' => true ) );

		wp_set_current_user( self::$other_id );
		$resp = desktop_mode_notes_rest_update(
			$this->update_request( $note['id'], array( 'text' => 'hijacked' ) )
		);
		$this->assertWPError( $resp );
		$this->assertSame( 403, $resp->get_error_data()['status'] );

		wp_set_current_user( self::$admin_id );
		$resp = desktop_mode_notes_rest_update(
			$this->update_request( $note['id'], array( 'text' => 'admin override' ) )
		);
		$this->assertWPError( $resp, 'Ownership is personal: admins do not bypass it.' );
		$this->assertSame( 403, $resp->get_error_data()['status'] );

		wp_set_current_user( self::$owner_id );
		$this->assertSame( 'Buy milk', get_post( $note['id'] )->post_content );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_update
	 */
	public function test_stale_token_conflicts_with_server_copy_attached() {
		$note = $this->create_note();
		$resp = desktop_mode_notes_rest_update(
			$this->update_request(
				$note['id'],
				array(
					'text'        => 'from a stale tab',
					'updatedAtMs' => 12345,
				)
			)
		);
		$this->assertWPError( $resp );
		$this->assertSame( 'desktop_mode_notes_conflict', $resp->get_error_code() );
		$data = $resp->get_error_data();
		$this->assertSame( 409, $data['status'] );
		$this->assertSame( $note['id'], $data['current']['id'] );
		$this->assertSame( 'Buy milk', $data['current']['text'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_delete
	 * @covers ::desktop_mode_notes_rest_restore
	 */
	public function test_delete_trashes_and_restore_untrashes_to_prior_status() {
		$note = $this->create_note( array( 'public' => true ) );

		$request = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/notes/' . $note['id'] );
		$request->set_param( 'id', $note['id'] );
		$resp = desktop_mode_notes_rest_delete( $request );
		$this->assertNotWPError( $resp );
		$this->assertSame( 'trash', get_post_status( $note['id'] ) );

		// Trashed notes vanish from the list.
		$ids = wp_list_pluck( desktop_mode_notes_rest_list()->get_data()['notes'], 'id' );
		$this->assertNotContains( $note['id'], $ids );

		$restore = new WP_REST_Request( 'POST', '/desktop-mode/v1/notes/' . $note['id'] . '/restore' );
		$restore->set_param( 'id', $note['id'] );
		$resp = desktop_mode_notes_rest_restore( $restore );
		$this->assertNotWPError( $resp );
		$this->assertSame( 'publish', get_post_status( $note['id'] ) );
		$this->assertTrue( $resp->get_data()['public'] );
	}

	/**
	 * @covers ::desktop_mode_notes_rest_delete
	 */
	public function test_non_owner_cannot_delete() {
		$note = $this->create_note( array( 'public' => true ) );
		wp_set_current_user( self::$admin_id );
		$request = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/notes/' . $note['id'] );
		$request->set_param( 'id', $note['id'] );
		$resp = desktop_mode_notes_rest_delete( $request );
		$this->assertWPError( $resp );
		$this->assertSame( 403, $resp->get_error_data()['status'] );
		$this->assertSame( 'publish', get_post_status( $note['id'] ) );
	}

	/**
	 * @covers ::desktop_mode_notes_get_note
	 */
	public function test_unknown_or_foreign_post_types_are_404() {
		$request = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/notes/999999' );
		$request->set_param( 'id', 999999 );
		$resp = desktop_mode_notes_rest_update( $request );
		$this->assertWPError( $resp );
		$this->assertSame( 404, $resp->get_error_data()['status'] );

		$post_id = self::factory()->post->create();
		$request = new WP_REST_Request( 'PATCH', '/desktop-mode/v1/notes/' . $post_id );
		$request->set_param( 'id', $post_id );
		$resp = desktop_mode_notes_rest_update( $request );
		$this->assertWPError( $resp );
		$this->assertSame( 404, $resp->get_error_data()['status'] );
	}

	/**
	 * @covers ::desktop_mode_notes_compute_heartbeat_delta
	 * @covers ::desktop_mode_notes_query_visible_ids
	 */
	public function test_heartbeat_delta_visibility_matches_the_list() {
		$own_private = $this->create_note( array( 'text' => 'mine' ) );

		wp_set_current_user( self::$other_id );
		$their_private = $this->create_note( array( 'text' => 'theirs private' ) );
		$their_public  = $this->create_note( array( 'text' => 'theirs public', 'public' => true ) );

		wp_set_current_user( self::$owner_id );
		$delta = desktop_mode_notes_compute_heartbeat_delta( array(), 0, 100 );
		$ids   = wp_list_pluck( $delta['notes'], 'id' );

		$this->assertContains( $own_private['id'], $ids );
		$this->assertContains( $their_public['id'], $ids );
		$this->assertNotContains( $their_private['id'], $ids );
		$this->assertSame( array(), $delta['removed'] );
		$this->assertGreaterThan( 0, $delta['serverTimeMs'] );
	}

	/**
	 * @covers ::desktop_mode_notes_compute_heartbeat_delta
	 * @covers ::desktop_mode_notes_alive_known_ids
	 */
	public function test_heartbeat_reports_trashed_and_privatized_notes_as_removed() {
		$mine = $this->create_note( array( 'text' => 'to be trashed' ) );

		wp_set_current_user( self::$other_id );
		$flipped = $this->create_note( array( 'text' => 'was public', 'public' => true ) );

		wp_set_current_user( self::$owner_id );
		wp_trash_post( $mine['id'] );

		// The other user flips their public note private → it must
		// disappear from this viewer's wall.
		wp_set_current_user( self::$other_id );
		desktop_mode_notes_rest_update(
			$this->update_request( $flipped['id'], array( 'public' => false ) )
		);

		wp_set_current_user( self::$owner_id );
		$delta = desktop_mode_notes_compute_heartbeat_delta(
			array( $mine['id'], $flipped['id'] ),
			0,
			100
		);
		$this->assertContains( $mine['id'], $delta['removed'] );
		$this->assertContains( $flipped['id'], $delta['removed'] );
	}
}
