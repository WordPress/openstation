<?php

class Tests_OpenStation_DesktopFilesGrid extends WP_UnitTestCase {

	protected static $grid_ts;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		$path = dirname( dirname( dirname( __DIR__ ) ) ) . '/src/desktop-files/grid.ts';
		self::assertFileExists(
			$path,
			'src/desktop-files/grid.ts is the source this mirror tracks. If it moved, ' .
			'point this test at the new path — do not delete the check.'
		);
		self::$grid_ts = (string) file_get_contents( $path );
	}

	protected function ts_const( $name ) {
		$matched = preg_match(
			'/export const ' . preg_quote( $name, '/' ) . '\s*=\s*(-?\d+)\s*;/',
			self::$grid_ts,
			$m
		);
		$this->assertSame(
			1,
			$matched,
			"src/desktop-files/grid.ts declares no $name. The TS grid is the source " .
			'of truth for includes/desktop-files/grid.php; if you removed a constant, ' .
			'remove its PHP mirror too.'
		);
		return (int) $m[1];
	}

	public function test_pitch_mirrors_the_typescript() {
		$tile_w = $this->ts_const( 'TILE_W' );
		$tile_h = $this->ts_const( 'TILE_H' );
		$gap_x  = $this->ts_const( 'GRID_GAP_X' );
		$gap_y  = $this->ts_const( 'GRID_GAP_Y' );

		$this->assertSame( $this->ts_const( 'GRID_PADDING' ), OPENSTATION_GRID_PADDING );

		$this->assertSame( $tile_w + $gap_x, OPENSTATION_GRID_CELL_W );
		$this->assertSame( $tile_h + $gap_y, OPENSTATION_GRID_CELL_H );
	}

	public function test_fallback_bounds_mirror_the_typescript() {
		$this->assertSame(
			$this->ts_const( 'GRID_FALLBACK_ROWS' ),
			OPENSTATION_GRID_FALLBACK_ROWS
		);
		$this->assertSame(
			$this->ts_const( 'GRID_FALLBACK_COLS' ),
			OPENSTATION_GRID_FALLBACK_COLS
		);

		$this->assertGreaterThan( 1, OPENSTATION_GRID_FALLBACK_ROWS );
		$this->assertGreaterThan( 1, OPENSTATION_GRID_FALLBACK_COLS );
	}

	public function test_the_desktop_reads_in_columns_and_a_folder_in_rows() {
		$this->assertSame( 'column', openstation_files_grid_order( 0 ) );
		$this->assertSame( 'row', openstation_files_grid_order( 7 ) );

		$this->assertSame(
			1,
			preg_match(
				'/return 0 === folderId \? \'column\' : \'row\';/',
				(string) file_get_contents(
					dirname( dirname( dirname( __DIR__ ) ) ) . '/src/desktop-files/layer.ts'
				)
			),
			'orderForFolder() in src/desktop-files/layer.ts and ' .
			'openstation_files_grid_order() have to answer the same question the ' .
			'same way, or the server files a tile somewhere the client never packs.'
		);
	}

	public function test_a_cell_round_trips_through_pixels() {
		foreach ( array( array( 0, 0 ), array( 0, 4 ), array( 3, 2 ) ) as $cell ) {
			list( $col, $row ) = $cell;
			$point             = openstation_files_grid_cell_to_point( $col, $row );
			$this->assertSame(
				array( $col, $row ),
				openstation_files_grid_point_to_cell( $point['x'], $point['y'] )
			);
		}
	}

	public function test_off_grid_coordinates_snap_to_the_nearest_cell() {

		$this->assertSame(
			array( 0, 1 ),
			openstation_files_grid_point_to_cell( 16, 126 )
		);
		$this->assertSame(
			array( 1, 0 ),
			openstation_files_grid_point_to_cell( 112, 16 )
		);
	}

	public function test_the_desktop_scan_fills_a_column_then_wraps() {
		$occupied = array();
		$cells    = array();
		for ( $i = 0; $i < OPENSTATION_GRID_FALLBACK_ROWS + 2; $i++ ) {
			$cells[] = openstation_files_grid_next_free( $occupied, 'column' );
		}

		for ( $row = 0; $row < OPENSTATION_GRID_FALLBACK_ROWS; $row++ ) {
			$this->assertSame( array( 0, $row ), $cells[ $row ] );
		}

		$this->assertSame(
			array( 1, 0 ),
			$cells[ OPENSTATION_GRID_FALLBACK_ROWS ]
		);
		$this->assertSame(
			array( 1, 1 ),
			$cells[ OPENSTATION_GRID_FALLBACK_ROWS + 1 ]
		);
	}

	public function test_a_folder_scan_fills_a_row_then_wraps() {
		$occupied = array();
		$cells    = array();
		for ( $i = 0; $i < OPENSTATION_GRID_FALLBACK_COLS + 1; $i++ ) {
			$cells[] = openstation_files_grid_next_free( $occupied, 'row' );
		}
		for ( $col = 0; $col < OPENSTATION_GRID_FALLBACK_COLS; $col++ ) {
			$this->assertSame( array( $col, 0 ), $cells[ $col ] );
		}
		$this->assertSame(
			array( 0, 1 ),
			$cells[ OPENSTATION_GRID_FALLBACK_COLS ]
		);
	}

	public function test_no_slot_is_ever_invented_past_the_assumed_canvas() {

		$occupied = array();
		$max_y    = OPENSTATION_GRID_PADDING
			+ ( OPENSTATION_GRID_FALLBACK_ROWS - 1 ) * OPENSTATION_GRID_CELL_H;
		for ( $i = 0; $i < 40; $i++ ) {
			list( $col, $row ) = openstation_files_grid_next_free( $occupied, 'column' );
			$point             = openstation_files_grid_cell_to_point( $col, $row );
			$this->assertLessThanOrEqual( $max_y, $point['y'] );
		}
	}

	public function test_occupancy_is_built_from_stored_coordinates() {
		$occupied = openstation_files_grid_occupied(
			array(
				array( 'x' => 16, 'y' => 16 ),
				array( 'x' => 16, 'y' => 136 ),
				array( 'x' => 'nonsense' ),
			)
		);
		$this->assertArrayHasKey( '0,0', $occupied );
		$this->assertArrayHasKey( '0,1', $occupied );
		$this->assertCount( 2, $occupied );

		$this->assertSame(
			array( 0, 2 ),
			openstation_files_grid_next_free( $occupied, 'column' )
		);
	}
}
