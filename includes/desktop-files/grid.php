<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_GRID_PADDING = 16;

const OPENSTATION_GRID_CELL_W = 108;
const OPENSTATION_GRID_CELL_H = 120;

const OPENSTATION_GRID_FALLBACK_ROWS = 5;
const OPENSTATION_GRID_FALLBACK_COLS = 4;

const OPENSTATION_GRID_SCAN_LIMIT = 999;

function openstation_files_grid_order( $parent_id ) {
	return 0 === (int) $parent_id ? 'column' : 'row';
}

function openstation_files_grid_point_to_cell( $x, $y ) {
	$col = (int) round( ( (int) $x - OPENSTATION_GRID_PADDING ) / OPENSTATION_GRID_CELL_W );
	$row = (int) round( ( (int) $y - OPENSTATION_GRID_PADDING ) / OPENSTATION_GRID_CELL_H );
	return array( max( 0, $col ), max( 0, $row ) );
}

function openstation_files_grid_cell_to_point( $col, $row ) {
	return array(
		'x' => OPENSTATION_GRID_PADDING + max( 0, (int) $col ) * OPENSTATION_GRID_CELL_W,
		'y' => OPENSTATION_GRID_PADDING + max( 0, (int) $row ) * OPENSTATION_GRID_CELL_H,
	);
}

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
