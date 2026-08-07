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
		openstation_files_install_schema();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		remove_all_filters( 'openstation_icons' );
		remove_all_filters( 'openstation_files_can_place' );
		// Static icon registry is process-scoped — clear any
		// test-local registrations so they don't leak into other
		// tests' auto-place expectations.
		if ( function_exists( 'openstation_unregister_icon' ) ) {
			openstation_unregister_icon( 'unified-test' );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_files_install_schema
	 */
	public function test_schema_creates_three_tables() {
		global $wpdb;
		$tables = openstation_files_table_names();
		foreach ( $tables as $name ) {
			$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $name ) );
			$this->assertSame( $name, $found );
		}
	}

	/**
	 * @covers ::openstation_files_place
	 */
	public function test_place_inserts_row_and_fires_action() {
		$fired = 0;
		add_action( 'openstation_file_placed', function () use ( &$fired ) { $fired++; } );

		$id = openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id, array(
			'x' => 100,
			'y' => 200,
		) );
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		$this->assertSame( 1, $fired );

		$row = openstation_files_get_placement( $id );
		$this->assertSame( 'post', $row['file_type'] );
		$this->assertSame( (string) self::$post_id, $row['file_ref'] );
		$this->assertSame( 100, $row['x'] );
	}

	/**
	 * @covers ::openstation_files_place
	 */
	public function test_place_with_unknown_type_returns_error() {
		$result = openstation_files_place( self::$admin_id, 0, 'never-registered', '1' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_unknown_type', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_files_place
	 */
	public function test_place_can_be_blocked_by_filter() {
		add_filter( 'openstation_files_can_place', '__return_false' );
		$result = openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_forbidden', $result->get_error_code() );
		remove_filter( 'openstation_files_can_place', '__return_false' );
	}

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_move_updates_row_and_fires_action() {
		$id    = openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$fired = array();
		add_action( 'openstation_file_moved', function ( $pid, $next, $prev ) use ( &$fired ) {
			$fired[] = array( 'pid' => $pid, 'next_x' => $next['x'], 'prev_x' => $prev['x'] );
		}, 10, 3 );

		$ok = openstation_files_move( $id, self::$admin_id, array( 'x' => 999 ) );
		$this->assertTrue( $ok );
		$this->assertSame( 999, openstation_files_get_placement( $id )['x'] );
		$this->assertCount( 1, $fired );
		$this->assertSame( 999, $fired[0]['next_x'] );
		$this->assertSame( 0, $fired[0]['prev_x'] );
	}

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_move_rejects_non_owner() {
		$id = openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		$result = openstation_files_move( $id, self::$other_id, array( 'x' => 1 ) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_forbidden', $result->get_error_code() );
	}

	/**
	 * Placements are REFERENCES — removing a placement must never
	 * delete the underlying entity. This is the core safety
	 * contract of the desktop-files system.
	 *
	 * @covers ::openstation_files_remove
	 */
	public function test_remove_does_not_delete_underlying_entity() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$pid     = openstation_files_place( self::$admin_id, 0, 'post', (string) $post_id );

		$ok = openstation_files_remove( $pid, self::$admin_id );
		$this->assertTrue( $ok );

		// Placement row is gone…
		$this->assertNull( openstation_files_get_placement( $pid ) );
		// …but the underlying post is untouched.
		$post = get_post( $post_id );
		$this->assertInstanceOf( 'WP_Post', $post );
		$this->assertSame( 'publish', $post->post_status );
	}

	/**
	 * Folder deletion cascades placements (tombstones each) but
	 * still must not touch the referenced entities.
	 *
	 * @covers ::openstation_files_delete_folder
	 */
	public function test_folder_delete_does_not_delete_referenced_entities() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$folder  = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		openstation_files_place( self::$admin_id, $folder, 'post', (string) $post_id );

		$ok = openstation_files_delete_folder( $folder, self::$admin_id );
		$this->assertTrue( $ok );

		$post = get_post( $post_id );
		$this->assertInstanceOf( 'WP_Post', $post );
		$this->assertSame( 'publish', $post->post_status );
	}

	/**
	 * @covers ::openstation_files_remove
	 */
	public function test_remove_deletes_row_and_writes_tombstone() {
		global $wpdb;
		$id = openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );

		$ok = openstation_files_remove( $id, self::$admin_id );
		$this->assertTrue( $ok );
		$this->assertNull( openstation_files_get_placement( $id ) );

		$tables = openstation_files_table_names();
		$count  = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['tombstones']} WHERE kind = 'placement' AND ref_id = %d",
			$id
		) );
		$this->assertSame( 1, $count );
	}

	/**
	 * @covers ::openstation_files_get_for_user_folder
	 */
	public function test_list_returns_only_users_placements_in_folder() {
		openstation_files_place( self::$admin_id, 0, 'post', (string) self::$post_id );
		openstation_files_place( self::$other_id, 0, 'post', (string) self::$post_id );

		$rows = openstation_files_get_for_user_folder( self::$admin_id, 0 );
		$this->assertCount( 1, $rows );
		$this->assertSame( (int) self::$admin_id, $rows[0]['owner_id'] );
	}

	/**
	 * @covers ::openstation_files_create_folder
	 */
	public function test_folder_create_round_trips() {
		$id = openstation_files_create_folder( self::$admin_id, array(
			'name' => 'Projects',
		) );
		$this->assertIsInt( $id );
		$folder = openstation_files_get_folder( $id );
		$this->assertSame( 'Projects', $folder['name'] );
		$this->assertSame( 'private', $folder['share_mode'] );
	}

	/**
	 * @covers ::openstation_files_create_folder
	 */
	public function test_folder_rejects_invalid_share_mode() {
		$result = openstation_files_create_folder( self::$admin_id, array(
			'name'       => 'X',
			'share_mode' => 'planet',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_invalid_share_mode', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_files_update_folder
	 */
	public function test_folder_update_fires_shared_action_when_share_changes() {
		$id    = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$fired = 0;
		add_action( 'openstation_folder_shared', function () use ( &$fired ) { $fired++; } );

		$ok = openstation_files_update_folder( $id, self::$admin_id, array(
			'share_mode' => 'all',
		) );
		$this->assertTrue( $ok );
		$this->assertSame( 1, $fired );
	}

	/**
	 * @covers ::openstation_files_delete_folder
	 */
	public function test_folder_delete_cascades_placements_and_tombstones() {
		global $wpdb;
		$folder = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$pid    = openstation_files_place( self::$admin_id, $folder, 'post', (string) self::$post_id );

		$ok = openstation_files_delete_folder( $folder, self::$admin_id );
		$this->assertTrue( $ok );
		$this->assertNull( openstation_files_get_placement( $pid ) );
		$this->assertNull( openstation_files_get_folder( $folder ) );

		$tables = openstation_files_table_names();
		$count  = (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM {$tables['tombstones']}"
		);
		// One for the placement, one for the folder.
		$this->assertSame( 2, $count );
	}

	/**
	 * @covers ::openstation_files_auto_place_orphans
	 */
	public function test_registered_shortcut_gets_auto_placed_on_first_hydrate() {
		// Register through the canonical PHP API. The shortcut
		// file class's `can_read()` reads from the static
		// registry (`openstation_desktop_icon_registry`), so a
		// filter-only injection wouldn't pass the place() gate.
		openstation_register_icon( 'unified-test', array(
			'title'  => 'Unified',
			'icon'   => 'dashicons-star-filled',
			// `openstation_register_icon()` requires either a
			// `window` or a `url` target — this is a synthetic
			// test-only window id that doesn't need to exist.
			'window' => 'unified-test-window',
		) );

		$placed = openstation_files_auto_place_orphans( self::$admin_id );
		$this->assertGreaterThan( 0, $placed );

		$rows = openstation_files_get_for_user_folder( self::$admin_id, 0 );
		$ids  = array();
		foreach ( $rows as $row ) {
			if ( 'shortcut' === $row['file_type'] ) {
				$ids[] = $row['file_ref'];
			}
		}
		$this->assertContains( 'unified-test', $ids );
	}

	/**
	 * @covers ::openstation_files_auto_place_orphans
	 */
	public function test_orphan_folder_gets_auto_placed_at_root() {
		$folder_id = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Orphan' ) );
		// Pre-condition: no placements anywhere.
		$this->assertSame( array(), openstation_files_get_for_user_folder( self::$admin_id, 0 ) );

		$placed = openstation_files_auto_place_orphan_folders( self::$admin_id );
		$this->assertSame( 1, $placed );

		$rows = openstation_files_get_for_user_folder( self::$admin_id, 0 );
		$this->assertCount( 1, $rows );
		$this->assertSame( 'folder', $rows[0]['file_type'] );
		$this->assertSame( (string) $folder_id, $rows[0]['file_ref'] );
	}

	/**
	 * @covers ::openstation_files_auto_place_orphan_folders
	 */
	public function test_auto_place_is_idempotent() {
		openstation_files_create_folder( self::$admin_id, array( 'name' => 'Once' ) );
		$first  = openstation_files_auto_place_orphan_folders( self::$admin_id );
		$second = openstation_files_auto_place_orphan_folders( self::$admin_id );
		$this->assertSame( 1, $first );
		$this->assertSame( 0, $second );
	}

	/**
	 * @covers ::openstation_files_auto_place_orphan_folders
	 */
	public function test_auto_place_skips_folder_with_existing_placement() {
		$folder_id = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Already placed' ) );
		// Place it inside another folder explicitly.
		$parent = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Parent' ) );
		openstation_files_place( self::$admin_id, $parent, 'folder', (string) $folder_id );

		$placed = openstation_files_auto_place_orphan_folders( self::$admin_id );
		// Only the parent itself qualifies as orphan; the nested folder is already placed.
		$this->assertSame( 1, $placed );
	}

	/**
	 * @covers ::openstation_files_get_visible_folders
	 */
	public function test_get_visible_folders_returns_owned() {
		openstation_files_create_folder( self::$admin_id, array( 'name' => 'A' ) );
		openstation_files_create_folder( self::$other_id, array( 'name' => 'B' ) );
		$rows = openstation_files_get_visible_folders( self::$admin_id );
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
	 * @covers ::openstation_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_flags_self_target() {
		$folder = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$this->assertTrue(
			openstation_files_would_create_folder_cycle(
				self::$admin_id,
				$folder,
				$folder
			)
		);
	}

	/**
	 * @covers ::openstation_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_flags_descendant_target() {
		// X (root) → Y → Z
		$x = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );
		// Y's placement under X.
		openstation_files_place( self::$admin_id, $x, 'folder', (string) $y );
		$z = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Z' ) );
		openstation_files_place( self::$admin_id, $y, 'folder', (string) $z );

		// Moving X into Z (a descendant of X) would form X → Z → Y → X.
		$this->assertTrue(
			openstation_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				$z
			),
			'Target inside the moving folder\'s subtree must flag a cycle.'
		);
	}

	/**
	 * @covers ::openstation_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_allows_unrelated_target() {
		// Two parallel trees — moving one folder under the other is fine.
		$x = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );

		$this->assertFalse(
			openstation_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				$y
			)
		);
	}

	/**
	 * @covers ::openstation_files_would_create_folder_cycle
	 */
	public function test_cycle_detector_allows_move_to_root() {
		$x = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		// Target parent 0 = desktop root, can never form a cycle.
		$this->assertFalse(
			openstation_files_would_create_folder_cycle(
				self::$admin_id,
				$x,
				0
			)
		);
	}

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_move_rejects_folder_cycle_into_descendant() {
		// X → Y. Now try to move X into Y.
		$x = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$y = openstation_files_create_folder( self::$admin_id, array( 'name' => 'Y' ) );
		// X has an auto-placed row at root; Y has a placement under X.
		$x_placement = openstation_files_place(
			self::$admin_id,
			0,
			'folder',
			(string) $x
		);
		openstation_files_place( self::$admin_id, $x, 'folder', (string) $y );

		$result = openstation_files_move(
			$x_placement,
			self::$admin_id,
			array( 'parent_id' => $y )
		);
		$this->assertWPError( $result );
		$this->assertSame(
			'openstation_files_folder_cycle',
			$result->get_error_code()
		);

		// And the row was not actually moved.
		$row = openstation_files_get_placement( $x_placement );
		$this->assertSame( 0, (int) $row['parent_id'] );
	}

	/**
	 * @covers ::openstation_files_move
	 */
	public function test_move_rejects_folder_into_itself() {
		$x = openstation_files_create_folder( self::$admin_id, array( 'name' => 'X' ) );
		$x_placement = openstation_files_place(
			self::$admin_id,
			0,
			'folder',
			(string) $x
		);

		$result = openstation_files_move(
			$x_placement,
			self::$admin_id,
			array( 'parent_id' => $x )
		);
		$this->assertWPError( $result );
		$this->assertSame(
			'openstation_files_folder_cycle',
			$result->get_error_code()
		);
	}
}
