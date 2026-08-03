<?php
/**
 * Tests for the desktop-files store: schema, placement CRUD,
 * folder CRUD, and tombstones.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_FilesStore extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $other_id;
	protected static $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$other_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$post_id  = $factory->post->create( array( 'post_status' => 'publish' ) );
	}

	public function set_up() {
		parent::set_up();
		// Ensure schema exists in the test environment.
		open_station_files_install_schema();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = open_station_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		remove_all_filters( 'open_station_icons' );
		remove_all_filters( 'open_station_files_can_place' );
		// Static icon registry is process-scoped — clear any
		// test-local registrations so they don't leak into other
		// tests' auto-place expectations.
		if ( function_exists( 'open_station_unregister_icon' ) ) {
			open_station_unregister_icon( 'unified-test' );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_files_install_schema
	 */
	public function test_schema_creates_three_tables() {
		global $wpdb;
		$tables = open_station_files_table_names();
		foreach ( $tables as $name ) {
			$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $name ) );
			$this->assertSame( $name, $found );
		}
	}

	/**
	 * @covers ::open_station_files_place
	 */
	public function test_place_inserts_row_and_fires_action() {
		$fired = 0;
		add_action( 'open_station_file_placed', function () use ( &$fired ) { $fired++; } );

		$id = open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id, array(
			'x' => 100,
			'y' => 200,
		) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		$this->assertSame( 1, $fired );

		$row = open_station_files_get_placement( $id );
		$this->assertSame( 'post', $row['file_type'] );
		$this->assertSame( (string) self::$post_id, $row['file_ref'] );
		$this->assertSame( 100, $row['x'] );
	}

	/**
	 * @covers ::open_station_files_place
	 */
	public function test_place_with_unknown_type_returns_error() {
		$result = open_station_files_place( self::$admin_id, 0, 'never-registered', '1' );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_unknown_type', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_files_place
	 */
	public function test_place_can_be_blocked_by_filter() {
		add_filter( 'open_station_files_can_place', '__return_false' );
		$result = open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_forbidden', $result->get_error_code() );
		remove_filter( 'open_station_files_can_place', '__return_false' );
	}

	/**
	 * @covers ::open_station_files_move
	 */
	public function test_move_updates_row_and_fires_action() {
		$id    = open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$fired = array();
		add_action( 'open_station_file_moved', function ( $pid, $next, $prev ) use ( &$fired ) {
			$fired[] = array( 'pid' => $pid, 'next_x' => $next['x'], 'prev_x' => $prev['x'] );
		}, 10, 3 );

		$ok = open_station_files_move( $id, self::$admin_id, array( 'x' => 999 ) );
		$this->assertTrue( $ok );
		$this->assertSame( 999, open_station_files_get_placement( $id )['x'] );
		$this->assertCount( 1, $fired );
		$this->assertSame( 999, $fired[0]['next_x'] );
		$this->assertSame( 0, $fired[0]['prev_x'] );
	}

	/**
	 * @covers ::open_station_files_move
	 */
	public function test_move_rejects_non_owner() {
		$id = open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$result = open_station_files_move( $id, self::$other_id, array( 'x' => 1 ) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_forbidden', $result->get_error_code() );
	}

	/**
	 * Placements are REFERENCES — removing a placement must never
	 * delete the underlying entity. This is the core safety
	 * contract of the desktop-files system.
	 *
	 * @covers ::open_station_files_remove
	 */
	public function test_remove_does_not_delete_underlying_entity() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$pid     = open_station_files_place( self::$admin_id, 0, 'post', (string) $post_id );

		$ok = open_station_files_remove( $pid, self::$admin_id );
		$this->assertTrue( $ok );

		// Placement row is gone…
		$this->assertNull( open_station_files_get_placement( $pid ) );
		// …but the underlying post is untouched.
		$post = get_post( $post_id );
		$this->assertInstanceOf( 'WP_Post', $post );
		$this->assertSame( 'publish', $post->post_status );
	}

	/**
	 * Folder deletion cascades placements (tombstones each) but
	 * still must not touch the referenced entities.
	 *
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_folder_delete_does_not_delete_referenced_entities() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$folder  = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		open_station_files_place( self::$admin_id, $folder, 'post', (string) $post_id );

		$ok = open_station_files_delete_folder( $folder, self::$admin_id );
		$this->assertTrue( $ok );

		$post = get_post( $post_id );
		$this->assertInstanceOf( 'WP_Post', $post );
		$this->assertSame( 'publish', $post->post_status );
	}

	/**
	 * @covers ::open_station_files_remove
	 */
	public function test_remove_deletes_row_and_writes_tombstone() {
		global $wpdb;
		$id = open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );

		$ok = open_station_files_remove( $id, self::$admin_id );
		$this->assertTrue( $ok );
		$this->assertNull( open_station_files_get_placement( $id ) );

		$tables = open_station_files_table_names();
		$count  = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['tombstones']} WHERE kind = 'placement' AND ref_id = %d",
			$id
		) );
		$this->assertSame( 1, $count );
	}

	/**
	 * @covers ::open_station_files_get_for_user_folder
	 */
	public function test_list_returns_only_users_placements_in_folder() {
		open_station_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		open_station_files_place( self::$other_id, 0, 'post', (string) self::$post_id );

		$rows = open_station_files_get_for_user_folder( self::$admin_id, 0 );
		$this->assertCount( 1, $rows );
		$this->assertSame( (int) self::$admin_id, $rows[0]['owner_id'] );
	}

	/**
	 * @covers ::open_station_files_create_folder
	 */
	public function test_folder_create_round_trips() {
		$id = open_station_files_create_folder( self::$admin_id, array(
			'name' => 'Projects',
		) );
		$this->assertIsInt( $id );
		$folder = open_station_files_get_folder( $id );
		$this->assertSame( 'Projects', $folder['name'] );
		$this->assertSame( 'private', $folder['share_mode'] );
	}

	/**
	 * @covers ::open_station_files_create_folder
	 */
	public function test_folder_rejects_invalid_share_mode() {
		$result = open_station_files_create_folder( self::$admin_id, array(
			'name'       => 'X',
			'share_mode' => 'planet',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_files_invalid_share_mode', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_files_update_folder
	 */
	public function test_folder_update_fires_shared_action_when_share_changes() {
		$id    = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$fired = 0;
		add_action( 'open_station_folder_shared', function () use ( &$fired ) { $fired++; } );

		$ok = open_station_files_update_folder( $id, self::$admin_id, array(
			'share_mode' => 'all',
		) );
		$this->assertTrue( $ok );
		$this->assertSame( 1, $fired );
	}

	/**
	 * @covers ::open_station_files_delete_folder
	 */
	public function test_folder_delete_cascades_placements_and_tombstones() {
		global $wpdb;
		$folder = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$pid    = open_station_files_place( self::$admin_id, $folder, 'post', (string) self::$post_id );

		$ok = open_station_files_delete_folder( $folder, self::$admin_id );
		$this->assertTrue( $ok );
		$this->assertNull( open_station_files_get_placement( $pid ) );
		$this->assertNull( open_station_files_get_folder( $folder ) );

		$tables = open_station_files_table_names();
		$count  = (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM {$tables['tombstones']}"
		);
		// One for the placement, one for the folder.
		$this->assertSame( 2, $count );
	}

	/**
	 * @covers ::open_station_files_auto_place_orphans
	 */
	public function test_registered_shortcut_gets_auto_placed_on_first_hydrate() {
		// Register through the canonical PHP API. The shortcut
		// file class's `can_read()` reads from the static
		// registry (`open_station_desktop_icon_registry`), so a
		// filter-only injection wouldn't pass the place() gate.
		open_station_register_icon( 'unified-test', array(
			'title'  => 'Unified',
			'icon'   => 'dashicons-star-filled',
			// `open_station_register_icon()` requires either a
			// `window` or a `url` target — this is a synthetic
			// test-only window id that doesn't need to exist.
			'window' => 'unified-test-window',
		) );

		$placed = open_station_files_auto_place_orphans( self::$admin_id );
		$this->assertGreaterThan( 0, $placed );

		$rows = open_station_files_get_for_user_folder( self::$admin_id, 0 );
		$ids  = array();
		foreach ( $rows as $row ) {
			if ( 'shortcut' === $row['file_type'] ) {
				$ids[] = $row['file_ref'];
			}
		}
		$this->assertContains( 'unified-test', $ids );
	}

	/**
	 * @covers ::open_station_files_auto_place_orphans
	 */
	public function test_orphan_folder_gets_auto_placed_at_root() {
		$folder_id = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Orphan' ) );
		// Pre-condition: no placements anywhere.
		$this->assertSame( array(), open_station_files_get_for_user_folder( self::$admin_id, 0 ) );

		$placed = open_station_files_auto_place_orphan_folders( self::$admin_id );
		$this->assertSame( 1, $placed );

		$rows = open_station_files_get_for_user_folder( self::$admin_id, 0 );
		$this->assertCount( 1, $rows );
		$this->assertSame( 'folder', $rows[0]['file_type'] );
		$this->assertSame( (string) $folder_id, $rows[0]['file_ref'] );
	}

	/**
	 * @covers ::open_station_files_auto_place_orphan_folders
	 */
	public function test_auto_place_is_idempotent() {
		open_station_files_create_folder( self::$admin_id, array( 'name' => 'Once' ) );
		$first  = open_station_files_auto_place_orphan_folders( self::$admin_id );
		$second = open_station_files_auto_place_orphan_folders( self::$admin_id );
		$this->assertSame( 1, $first );
		$this->assertSame( 0, $second );
	}

	/**
	 * @covers ::open_station_files_auto_place_orphan_folders
	 */
	public function test_auto_place_skips_folder_with_existing_placement() {
		$folder_id = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Already placed' ) );
		// Place it inside another folder explicitly.
		$parent = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Parent' ) );
		open_station_files_place( self::$admin_id, $parent, 'folder', (string) $folder_id );

		$placed = open_station_files_auto_place_orphan_folders( self::$admin_id );
		// Only the parent itself qualifies as orphan; the nested folder is already placed.
		$this->assertSame( 1, $placed );
	}

	/**
	 * @covers ::open_station_files_get_visible_folders
	 */
	public function test_get_visible_folders_returns_owned() {
		open_station_files_create_folder( self::$admin_id, array( 'name' => 'A' ) );
		open_station_files_create_folder( self::$other_id, array( 'name' => 'B' ) );
		$rows = open_station_files_get_visible_folders( self::$admin_id );
		$this->assertCount( 1, $rows );
		$this->assertSame( 'A', $rows[0]['name'] );
	}

	// ───────────────────────────────────────────────────────────────
	// Folder-cycle prevention. A folder must not be movable into
	// itself or into any of its descendants — committing such a
	// move would leave the chain looping back, stranding every
	// descendant outside the desktop root.
	// ───────────────────────────────────────────────────────────────

	/**
	 * @covers ::open_station_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_flags_self_target() {
		$folder = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$this->assertTrue(
			open_station_files_would_create_folder_cycle(
				self::$admin_id,
				$folder,
				$folder
			)
		);
	}

	/**
	 * @covers ::open_station_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_flags_descendant_target() {
		// X (root) → Y → Z
		$x = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );
		// Y's placement under X.
		open_station_files_place( self::$admin_id, $x, 'folder', (string) $y );
		$z = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Z' ) );
		open_station_files_place( self::$admin_id, $y, 'folder', (string) $z );

		// Moving X into Z (a descendant of X) would form X → Z → Y → X.
		$this->assertTrue(
			open_station_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				$z
			),
			'Target inside the moving folder\'s subtree must flag a cycle.'
		);
	}

	/**
	 * @covers ::open_station_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_allows_unrelated_target() {
		// Two parallel trees — moving one folder under the other is fine.
		$x = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );

		$this->assertFalse(
			open_station_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				$y
			)
		);
	}

	/**
	 * @covers ::open_station_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_allows_move_to_root() {
		$x = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		// Target parent 0 = desktop root, can never form a cycle.
		$this->assertFalse(
			open_station_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				0
			)
		);
	}

	/**
	 * @covers ::open_station_files_move
	 */
	public function test_move_rejects_folder_cycle_into_descendant() {
		// X → Y. Now try to move X into Y.
		$x = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = open_station_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );
		// X has an auto-placed row at root; Y has a placement under X.
		$x_placement = open_station_files_place(
			self::$admin_id,
			0,
			'folder',
			(string) $x
		);
		open_station_files_place( self::$admin_id, $x, 'folder', (string) $y );

		$result = open_station_files_move(
			$x_placement,
			self::$admin_id,
			array( 'parent_id' => $y )
		);
		$this->assertWPError( $result );
		$this->assertSame(
			'open_station_files_folder_cycle',
			$result->get_error_code()
		);

		// And the row was not actually moved.
		$row = open_station_files_get_placement( $x_placement );
		$this->assertSame( 0, (int) $row['parent_id'] );
	}

	/**
	 * @covers ::open_station_files_move
	 */
	public function test_move_rejects_folder_into_itself() {
		$x = open_station_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$x_placement = open_station_files_place(
			self::$admin_id,
			0,
			'folder',
			(string) $x
		);

		$result = open_station_files_move(
			$x_placement,
			self::$admin_id,
			array( 'parent_id' => $x )
		);
		$this->assertWPError( $result );
		$this->assertSame(
			'open_station_files_folder_cycle',
			$result->get_error_code()
		);
	}
}
