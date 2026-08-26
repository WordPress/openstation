<?php
/**
 * Tests for migration 6 — the Trash's desktop icon is taken back, and
 * the hole it leaves in the icon column is closed.
 *
 * The bin used to register a desktop icon that every viewer's first
 * hydrate auto-placed. Deleting the row is only half the job: the icons
 * below it stay where they were and the column is left with a gap.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-migrations
 */
class Tests_OpenStation_RecycleBinIconGapMigration extends WP_UnitTestCase {

	/** Row pitch the desktop auto-placer uses. */
	const ROW_H = 110;

	protected static $owner_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		$this->wipe_placements();
	}

	private function wipe_placements() {
		global $wpdb;
		$tables = openstation_files_table_names();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$wpdb->query( "DELETE FROM {$tables['placements']}" );
	}

	/**
	 * Insert a shortcut placement at a grid cell.
	 *
	 * Direct insert rather than `openstation_files_place()`, which
	 * gates on the file being readable — and a shortcut is only
	 * readable while its icon is registered. The bin's is not, which
	 * is the whole point: these rows outlive the registration, and
	 * that is the state the migration exists to clean up.
	 */
	private function place( $ref, $row, $col = 0, $owner = null ) {
		global $wpdb;
		$tables = openstation_files_table_names();
		$wpdb->insert(
			$tables['placements'],
			array(
				'owner_id'      => null === $owner ? self::$owner_id : $owner,
				'parent_id'     => 0,
				'file_type'     => 'shortcut',
				'file_ref'      => $ref,
				'x'             => 16 + $col * 96,
				'y'             => 16 + $row * self::ROW_H,
				'sort_order'    => 0,
				'updated_at_ms' => 1,
			),
			array( '%d', '%d', '%s', '%s', '%d', '%d', '%d', '%d' )
		);
	}

	/** Map of `file_ref => y` for the owner's root placements. */
	private function coords() {
		global $wpdb;
		$tables = openstation_files_table_names();
		$rows   = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT file_ref, x, y FROM {$tables['placements']}
				WHERE owner_id = %d AND parent_id = 0",
				self::$owner_id
			),
			ARRAY_A
		);
		$out = array();
		foreach ( $rows as $row ) {
			$out[ $row['file_ref'] ] = array( (int) $row['x'], (int) $row['y'] );
		}
		// Row order is whatever the engine returns; the assertions are
		// about coordinates.
		ksort( $out );
		return $out;
	}

	/**
	 * @covers ::openstation_migrate_close_recycle_bin_icon_gap
	 */
	public function test_bin_placement_is_removed_and_the_column_closes_up() {
		$this->place( 'desktop-mode-my-wordpress', 0 );
		$this->place( 'desktop-mode-recycle-bin', 1 );
		$this->place( 'desktop-mode-content-graph', 2 );
		$this->place( 'some-plugin-icon', 3 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$coords = $this->coords();
		$this->assertArrayNotHasKey( 'desktop-mode-recycle-bin', $coords );
		$this->assertSame( array( 16, 16 ), $coords['desktop-mode-my-wordpress'] );
		$this->assertSame( array( 16, 126 ), $coords['desktop-mode-content-graph'] );
		$this->assertSame( array( 16, 236 ), $coords['some-plugin-icon'] );
	}

	/**
	 * Only the bin's own column moves. The auto-placer fills
	 * column-major, so a column is the run the bin was part of, and a
	 * neighbouring column has no gap to close.
	 *
	 * @covers ::openstation_migrate_close_recycle_bin_icon_gap
	 */
	public function test_other_columns_are_left_alone() {
		$this->place( 'desktop-mode-recycle-bin', 1 );
		$this->place( 'second-column', 2, 1 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$this->assertSame( array( 112, 236 ), $this->coords()['second-column'] );
	}

	/**
	 * A tile ABOVE the bin was not displaced by it, so it must not be
	 * displaced by its removal either.
	 *
	 * @covers ::openstation_migrate_close_recycle_bin_icon_gap
	 */
	public function test_tiles_above_the_bin_do_not_move() {
		$this->place( 'above', 0 );
		$this->place( 'desktop-mode-recycle-bin', 2 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$this->assertSame( array( 16, 16 ), $this->coords()['above'] );
	}

	/**
	 * A desk that never had the bin on it (someone who had already
	 * hidden it) is untouched.
	 *
	 * @covers ::openstation_migrate_close_recycle_bin_icon_gap
	 */
	public function test_no_bin_placement_means_no_change() {
		$this->place( 'desktop-mode-my-wordpress', 0 );
		$this->place( 'desktop-mode-content-graph', 1 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$this->assertSame(
			array(
				'desktop-mode-content-graph' => array( 16, 126 ),
				'desktop-mode-my-wordpress'  => array( 16, 16 ),
			),
			$this->coords()
		);
	}

	/**
	 * One owner's desk is not rearranged by another owner's bin.
	 *
	 * @covers ::openstation_migrate_close_recycle_bin_icon_gap
	 */
	public function test_owners_are_independent() {
		$other = self::factory()->user->create();
		$this->place( 'desktop-mode-content-graph', 2, 0, $other );

		$this->place( 'desktop-mode-recycle-bin', 1 );
		openstation_migrate_close_recycle_bin_icon_gap();

		global $wpdb;
		$tables = openstation_files_table_names();
		$y      = (int) $wpdb->get_var(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT y FROM {$tables['placements']}
				WHERE owner_id = %d AND parent_id = 0",
				$other
			)
		);
		$this->assertSame( 236, $y );
	}
}
