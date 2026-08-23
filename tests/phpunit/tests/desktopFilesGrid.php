<?php
/**
 * One icon grid, three languages.
 *
 * `assets/css/variables.css` declares the grid, `src/desktop-files/grid.ts`
 * mirrors it for the layout maths (a vitest suite proves that half), and
 * `includes/desktop-files/grid.php` mirrors it again because the server
 * picks cells for tiles it will never see rendered.
 *
 * The PHP mirror is the one that drifted. It kept a 96 × 110 pitch after
 * the client moved to 108 × 120, and it packed a column 999 cells deep
 * for a viewport it had never asked about — so a desktop with more icons
 * than fit in one column always had one stored past the bottom edge, and
 * the client's rescue pass repacked the whole wallpaper to bring it back.
 * The user's icons arrived in rows.
 *
 * This parses the TypeScript. When it fails it is telling you a number
 * moved in one language and not the other, and it names which.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_DesktopFilesGrid extends WP_UnitTestCase {

	/** @var string */
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

	/**
	 * Read an `export const NAME = 123;` declaration out of the TS.
	 *
	 * @param string $name Exported constant name.
	 * @return int Declared value.
	 */
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

	/**
	 * @covers ::openstation_files_grid_cell_to_point
	 */
	public function test_pitch_mirrors_the_typescript() {
		$tile_w = $this->ts_const( 'TILE_W' );
		$tile_h = $this->ts_const( 'TILE_H' );
		$gap_x  = $this->ts_const( 'GRID_GAP_X' );
		$gap_y  = $this->ts_const( 'GRID_GAP_Y' );

		$this->assertSame( $this->ts_const( 'GRID_PADDING' ), OPENSTATION_GRID_PADDING );
		// The cell is tile + gap on both sides. PHP declares the total
		// because it has no reason to know a cell is made of two things;
		// this is where that shortcut gets checked.
		$this->assertSame( $tile_w + $gap_x, OPENSTATION_GRID_CELL_W );
		$this->assertSame( $tile_h + $gap_y, OPENSTATION_GRID_CELL_H );
	}

	/**
	 * @covers ::openstation_files_grid_next_free
	 */
	public function test_fallback_bounds_mirror_the_typescript() {
		$this->assertSame(
			$this->ts_const( 'GRID_FALLBACK_ROWS' ),
			OPENSTATION_GRID_FALLBACK_ROWS
		);
		$this->assertSame(
			$this->ts_const( 'GRID_FALLBACK_COLS' ),
			OPENSTATION_GRID_FALLBACK_COLS
		);
		// A one-cell bound is a row wearing a column's name — the exact
		// degeneracy this whole mirror exists to prevent.
		$this->assertGreaterThan( 1, OPENSTATION_GRID_FALLBACK_ROWS );
		$this->assertGreaterThan( 1, OPENSTATION_GRID_FALLBACK_COLS );
	}

	/**
	 * @covers ::openstation_files_grid_order
	 */
	public function test_the_desktop_reads_in_columns_and_a_folder_in_rows() {
		$this->assertSame( 'column', openstation_files_grid_order( 0 ) );
		$this->assertSame( 'row', openstation_files_grid_order( 7 ) );
		// Same rule as `orderForFolder()` on the client.
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

	/**
	 * @covers ::openstation_files_grid_point_to_cell
	 * @covers ::openstation_files_grid_cell_to_point
	 */
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

	/**
	 * @covers ::openstation_files_grid_point_to_cell
	 */
	public function test_off_grid_coordinates_snap_to_the_nearest_cell() {
		// Rows written under the old 96 × 110 pitch, and anything a
		// plugin wrote by hand, still have to resolve to the cell they
		// LOOK like they are in — otherwise the occupancy set has a
		// phantom hole and the next tile is filed on top of one.
		$this->assertSame(
			array( 0, 1 ),
			openstation_files_grid_point_to_cell( 16, 126 )
		);
		$this->assertSame(
			array( 1, 0 ),
			openstation_files_grid_point_to_cell( 112, 16 )
		);
	}

	/**
	 * @covers ::openstation_files_grid_next_free
	 */
	public function test_the_desktop_scan_fills_a_column_then_wraps() {
		$occupied = array();
		$cells    = array();
		for ( $i = 0; $i < OPENSTATION_GRID_FALLBACK_ROWS + 2; $i++ ) {
			$cells[] = openstation_files_grid_next_free( $occupied, 'column' );
		}
		// Column 0, top to bottom …
		for ( $row = 0; $row < OPENSTATION_GRID_FALLBACK_ROWS; $row++ ) {
			$this->assertSame( array( 0, $row ), $cells[ $row ] );
		}
		// … then the next column, back at the top.
		$this->assertSame(
			array( 1, 0 ),
			$cells[ OPENSTATION_GRID_FALLBACK_ROWS ]
		);
		$this->assertSame(
			array( 1, 1 ),
			$cells[ OPENSTATION_GRID_FALLBACK_ROWS + 1 ]
		);
	}

	/**
	 * @covers ::openstation_files_grid_next_free
	 */
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

	/**
	 * @covers ::openstation_files_grid_next_free
	 */
	public function test_no_slot_is_ever_invented_past_the_assumed_canvas() {
		// The defect in one assertion: the server has no viewport, so
		// every slot it hands out has to sit inside the canvas it is
		// entitled to assume. A tile below that line is not below the
		// fold — the layer does not scroll — it is gone, and the
		// client's rescue repacks the whole desktop to find it.
		$occupied = array();
		$max_y    = OPENSTATION_GRID_PADDING
			+ ( OPENSTATION_GRID_FALLBACK_ROWS - 1 ) * OPENSTATION_GRID_CELL_H;
		for ( $i = 0; $i < 40; $i++ ) {
			list( $col, $row ) = openstation_files_grid_next_free( $occupied, 'column' );
			$point             = openstation_files_grid_cell_to_point( $col, $row );
			$this->assertLessThanOrEqual( $max_y, $point['y'] );
		}
	}

	/**
	 * @covers ::openstation_files_grid_occupied
	 */
	public function test_occupancy_is_built_from_stored_coordinates() {
		$occupied = openstation_files_grid_occupied(
			array(
				array( 'x' => 16, 'y' => 16 ),
				array( 'x' => 16, 'y' => 136 ),
				array( 'x' => 'nonsense' ), // Missing `y` — skipped, not fatal.
			)
		);
		$this->assertArrayHasKey( '0,0', $occupied );
		$this->assertArrayHasKey( '0,1', $occupied );
		$this->assertCount( 2, $occupied );

		// And the next free slot steps over both.
		$this->assertSame(
			array( 0, 2 ),
			openstation_files_grid_next_free( $occupied, 'column' )
		);
	}
}
