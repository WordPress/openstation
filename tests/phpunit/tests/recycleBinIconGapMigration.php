<?php

class Tests_OpenStation_RecycleBinIconGapMigration extends WP_UnitTestCase {

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

		$wpdb->query( "DELETE FROM {$tables['placements']}" );
	}

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

	private function coords() {
		global $wpdb;
		$tables = openstation_files_table_names();
		$rows   = $wpdb->get_results(
			$wpdb->prepare(

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

		ksort( $out );
		return $out;
	}

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

	public function test_other_columns_are_left_alone() {
		$this->place( 'desktop-mode-recycle-bin', 1 );
		$this->place( 'second-column', 2, 1 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$this->assertSame( array( 112, 236 ), $this->coords()['second-column'] );
	}

	public function test_tiles_above_the_bin_do_not_move() {
		$this->place( 'above', 0 );
		$this->place( 'desktop-mode-recycle-bin', 2 );

		openstation_migrate_close_recycle_bin_icon_gap();

		$this->assertSame( array( 16, 16 ), $this->coords()['above'] );
	}

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

	public function test_owners_are_independent() {
		$other = self::factory()->user->create();
		$this->place( 'desktop-mode-content-graph', 2, 0, $other );

		$this->place( 'desktop-mode-recycle-bin', 1 );
		openstation_migrate_close_recycle_bin_icon_gap();

		global $wpdb;
		$tables = openstation_files_table_names();
		$y      = (int) $wpdb->get_var(
			$wpdb->prepare(

				"SELECT y FROM {$tables['placements']}
				WHERE owner_id = %d AND parent_id = 0",
				$other
			)
		);
		$this->assertSame( 236, $y );
	}
}
