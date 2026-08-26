<?php
/**
 * OpenStation — the icon grid, server side.
 *
 * The PHP mirror of `src/desktop-files/grid.ts`. Same pitch, same
 * fallbacks, same reading order — because the server picks cells for
 * tiles the client then has to lay out, and the two disagreeing is
 * visible on the wallpaper.
 *
 * It disagreed for a while. The client's grid was retuned to a
 * 108 × 120 pitch and this side kept the 96 × 110 one it was written
 * against, so every coordinate the server minted landed off-grid;
 * from the seventh row down two server rows aliased onto the same
 * client cell and the tiles had to be displaced on sight. Worse, the
 * server packed a column to unbounded depth — it has no viewport and
 * asked nothing about one — so a desktop with more icons than fit in
 * one column always had a tile stored past the bottom edge of a layer
 * that doesn't scroll. The client's rescue pass then repacked the
 * whole wallpaper to bring it back, and the desktop the user knew
 * came back rearranged.
 *
 * Hence {@see openstation_files_grid_fallback_rows()}: the server
 * can't measure the canvas, so it assumes a small one and wraps
 * early. Wrapping one cell early costs a column the desktop had room
 * for. Wrapping one cell late loses a tile.
 *
 * `Tests_OpenStation_DesktopFilesGrid` parses the TypeScript and
 * fails if either side moves without the other.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Gutter from the top / inline-start edge of an icon canvas.
 *
 * Mirrors `GRID_PADDING` / `--os-grid-padding`.
 */
const OPENSTATION_GRID_PADDING = 16;

/**
 * Cell pitch — the tile box plus the air after it.
 *
 * Mirrors `GRID_CELL_W` / `GRID_CELL_H`, which are themselves derived
 * (`--os-tile-w` + `--os-grid-gap-x`, `--os-tile-h` + `--os-grid-gap-y`).
 * Declared here rather than derived because PHP has no reason to know
 * a cell is made of two things; the test proves the total agrees.
 */
const OPENSTATION_GRID_CELL_W = 108;
const OPENSTATION_GRID_CELL_H = 120;

/**
 * How far a scan runs along the axis it wraps on.
 *
 * The server never measures a canvas, so it always uses these.
 * Mirrors `GRID_FALLBACK_ROWS` / `GRID_FALLBACK_COLS`.
 */
const OPENSTATION_GRID_FALLBACK_ROWS = 5;
const OPENSTATION_GRID_FALLBACK_COLS = 4;

/**
 * Upper bound on a scan's unbounded axis. Packing 999 columns of
 * icons is not a layout, it's a runaway loop.
 */
const OPENSTATION_GRID_SCAN_LIMIT = 999;

/**
 * Which way a canvas reads.
 *
 * The desktop root reads in columns — it is tall, and every desktop
 * metaphor worth copying fills a column before starting the next. A
 * folder reads in rows: it is wide and short, and a column-major fill
 * would run a two-item folder off the bottom of its own window.
 *
 * The same rule as `orderForFolder()` in `src/desktop-files/layer.ts`.
 *
 * @param int $parent_id Folder id. `0` is the desktop root.
 * @return string `'column'` or `'row'`.
 */
function openstation_files_grid_order( $parent_id ) {
	return 0 === (int) $parent_id ? 'column' : 'row';
}

/**
 * Snap a stored pixel coordinate to the cell it belongs to.
 *
 * Rounds rather than floors, so a coordinate that predates a pitch
 * change — or that a plugin wrote by hand — is read as the cell it is
 * nearest to instead of leaving a phantom hole one cell up and left.
 * The client's `pointToCell()` does the same, which is what keeps an
 * occupancy set built here and one built there describing the same
 * canvas.
 *
 * @param int $x Horizontal pixel offset.
 * @param int $y Vertical pixel offset.
 * @return array{0:int,1:int} `array( $col, $row )`, both >= 0.
 */
function openstation_files_grid_point_to_cell( $x, $y ) {
	$col = (int) round( ( (int) $x - OPENSTATION_GRID_PADDING ) / OPENSTATION_GRID_CELL_W );
	$row = (int) round( ( (int) $y - OPENSTATION_GRID_PADDING ) / OPENSTATION_GRID_CELL_H );
	return array( max( 0, $col ), max( 0, $row ) );
}

/**
 * The pixel coordinate of a cell.
 *
 * @param int $col Column index.
 * @param int $row Row index.
 * @return array{x:int,y:int} Placement coordinates.
 */
function openstation_files_grid_cell_to_point( $col, $row ) {
	return array(
		'x' => OPENSTATION_GRID_PADDING + max( 0, (int) $col ) * OPENSTATION_GRID_CELL_W,
		'y' => OPENSTATION_GRID_PADDING + max( 0, (int) $row ) * OPENSTATION_GRID_CELL_H,
	);
}

/**
 * Build an occupancy set from rows carrying `x` / `y`.
 *
 * Keys are `"<col>,<row>"`, the same convention `cellKey()` uses on
 * the client.
 *
 * @param array $rows Rows with `x` and `y` keys.
 * @return array<string,bool> Occupancy set.
 */
function openstation_files_grid_occupied( $rows ) {
	$occupied = array();
	foreach ( (array) $rows as $row ) {
		if ( ! isset( $row['x'], $row['y'] ) ) {
			continue;
		}
		list( $col, $r )         = openstation_files_grid_point_to_cell( $row['x'], $row['y'] );
		$occupied[ "$col,$r" ]   = true;
	}
	return $occupied;
}

/**
 * First free cell in `$order`, wrapping at the assumed canvas edge.
 *
 * Marks the cell it returns, so a caller allocating several in a row
 * gets consecutive slots without bookkeeping of its own.
 *
 * @param array<string,bool> $occupied Occupancy set, by reference.
 * @param string             $order    `'column'` or `'row'`.
 * @return array{0:int,1:int} `array( $col, $row )`.
 */
function openstation_files_grid_next_free( &$occupied, $order = 'column' ) {
	if ( 'row' === $order ) {
		$outer = OPENSTATION_GRID_SCAN_LIMIT;
		$inner = OPENSTATION_GRID_FALLBACK_COLS;
	} else {
		$outer = OPENSTATION_GRID_SCAN_LIMIT;
		$inner = OPENSTATION_GRID_FALLBACK_ROWS;
	}
	for ( $o = 0; $o < $outer; $o++ ) {
		for ( $i = 0; $i < $inner; $i++ ) {
			$col = 'row' === $order ? $i : $o;
			$row = 'row' === $order ? $o : $i;
			if ( ! isset( $occupied[ "$col,$row" ] ) ) {
				$occupied[ "$col,$row" ] = true;
				return array( $col, $row );
			}
		}
	}
	$occupied['0,0'] = true;
	return array( 0, 0 );
}
