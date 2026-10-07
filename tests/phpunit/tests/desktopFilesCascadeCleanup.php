<?php

class Tests_OpenStation_FilesCascadeCleanup extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $other_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$other_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	private function read_trash_columns( $placement_id ) {
		global $wpdb;
		$tables = openstation_files_table_names();
		$row    = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT trashed_at_ms, trashed_meta FROM {$tables['placements']} WHERE id = %d",
				(int) $placement_id
			),
			ARRAY_A
		);
		return array(
			'trashed_at_ms' => isset( $row['trashed_at_ms'] ) && null !== $row['trashed_at_ms'] ? (int) $row['trashed_at_ms'] : null,
			'trashed_meta' => isset( $row['trashed_meta'] ) ? $row['trashed_meta'] : null,
		);
	}

	public function test_cascade_soft_trashes_matching_placements() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$p1 = openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );
		$p2 = openstation_files_place( self::$other_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 1 ) );

		$count = openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );

		$this->assertSame( 2, $count );
		$this->assertNotNull( $this->read_trash_columns( $p1 )['trashed_at_ms'] );
		$this->assertNotNull( $this->read_trash_columns( $p2 )['trashed_at_ms'] );
	}

	public function test_cascade_is_idempotent() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );

		$first  = openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );
		$second = openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );

		$this->assertSame( 1, $first );
		$this->assertSame( 0, $second, 'Second pass must not re-stamp already-trashed rows.' );
	}

	public function test_cascade_ignores_unrelated_file_types() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$other_user = self::factory()->user->create();

		$post_placement = openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );
		$user_placement = openstation_files_place( self::$admin_id, 0, 'user', (string) $other_user, array( 'x' => 1, 'y' => 0 ) );

		openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );

		$this->assertNotNull( $this->read_trash_columns( $post_placement )['trashed_at_ms'] );
		$this->assertNull( $this->read_trash_columns( $user_placement )['trashed_at_ms'] );
	}

	public function test_wp_trash_post_triggers_cascade() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$p_id    = openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );

		wp_trash_post( $post_id );

		$this->assertNotNull(
			$this->read_trash_columns( $p_id )['trashed_at_ms'],
			'wp_trash_post() must cascade-soft-trash the matching placement.'
		);
	}

	public function test_pages_cascade_via_post_trash_hook() {

		$page_id = self::factory()->post->create( array(
			'post_type'   => 'page',
			'post_status' => 'publish',
		) );
		$p_id    = openstation_files_place( self::$admin_id, 0, 'post', (string) $page_id, array( 'x' => 0, 'y' => 0 ) );

		wp_trash_post( $page_id );

		$this->assertNotNull( $this->read_trash_columns( $p_id )['trashed_at_ms'] );
	}

	public function test_attachment_wp_trash_routes_to_attachment_filetype() {

		$att_id = self::factory()->attachment->create_object( 'image.jpg', 0, array(
			'post_mime_type' => 'image/jpeg',
			'post_status'    => 'inherit',
		) );
		$p_id   = openstation_files_place( self::$admin_id, 0, 'attachment', (string) $att_id, array( 'x' => 0, 'y' => 0 ) );

		wp_trash_post( $att_id );

		$this->assertNotNull( $this->read_trash_columns( $p_id )['trashed_at_ms'] );
	}

	public function test_delete_attachment_triggers_cascade() {
		$att_id = self::factory()->attachment->create_object( 'image2.jpg', 0, array(
			'post_mime_type' => 'image/jpeg',
			'post_status'    => 'inherit',
		) );
		$p_id   = openstation_files_place( self::$admin_id, 0, 'attachment', (string) $att_id, array( 'x' => 0, 'y' => 0 ) );

		wp_delete_attachment( $att_id, true );

		$this->assertNotNull( $this->read_trash_columns( $p_id )['trashed_at_ms'] );
	}

	public function test_deleted_user_triggers_cascade() {
		require_once ABSPATH . 'wp-admin/includes/user.php';
		$victim_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$p_id      = openstation_files_place( self::$admin_id, 0, 'user', (string) $victim_id, array( 'x' => 0, 'y' => 0 ) );

		wp_delete_user( $victim_id, self::$admin_id );

		$this->assertNotNull( $this->read_trash_columns( $p_id )['trashed_at_ms'] );
	}

	public function test_cascade_fires_after_action_per_placement() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );
		openstation_files_place( self::$other_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 1 ) );

		$fired = 0;
		add_action( 'openstation_files_after_cascade_trash_placement', function () use ( &$fired ) {
			++$fired;
		} );

		openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );

		$this->assertSame( 2, $fired );
	}

	public function test_cascade_writes_cascade_marker_to_trashed_meta() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$p_id    = openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id, array( 'x' => 0, 'y' => 0 ) );

		openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );

		$row  = $this->read_trash_columns( $p_id );
		$meta = json_decode( $row['trashed_meta'], true );
		$this->assertIsArray( $meta );
		$this->assertSame( 'post_trashed', $meta['cascade']['reason'] );
		$this->assertSame( 'post', $meta['cascade']['file_type'] );
		$this->assertSame( (string) $post_id, $meta['cascade']['file_ref'] );
	}
}
