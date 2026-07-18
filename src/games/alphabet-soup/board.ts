/**
 * Alphabet Soup — the Pixi board.
 *
 * Owns the letter grid's display objects: the simmering backdrop,
 * the letter tiles (with a staggered drop-in on every new wave),
 * the live selection capsule that follows the player's drag, the
 * locked capsules of found words, and the brief red flash of a
 * wrong guess. Geometry (which cells a drag covers) lives in
 * `soup-gen.ts`; this module only draws.
 *
 * All animation is time-based via `update( dt )` — the board never
 * owns a ticker; the game orchestrator drives it.
 *
 * @since 0.9.8
 */

import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from '../pixi-types';
import type { SoupCell, SoupGrid } from './soup-gen';

/** Font stack for the letter tiles. */
export const TILE_FONT = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif';

/** Deep-pot backdrop and letter colors. */
export const BACKDROP_COLOR = 0x1c1233;
const BACKDROP_GLOW_A = 0x3b2a68;
const BACKDROP_GLOW_B = 0x232a5c;
const CELL_COLOR = 0xffffff;
const LETTER_COLOR = 0xf3efff;
const LOCKED_LETTER_COLOR = 0x241736;
export const SELECTION_COLOR = 0xffd166;

/** Capsule palette for found words — one color per find, cycling. */
export const WORD_COLORS: readonly number[] = [
	0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xc77dff,
	0xf4978e, 0x90e0ef, 0xffe066, 0x80ed99, 0xf9c74f,
];

/** Seconds one tile's drop-in takes. */
const ENTRANCE_SECONDS = 0.3;

/** Stagger between neighboring diagonals on entrance. */
const ENTRANCE_STAGGER = 0.035;

/** Seconds a found word's letters pop. */
const POP_SECONDS = 0.35;

/** Seconds the wrong-guess flash lives. */
const FLASH_SECONDS = 0.45;

interface TileNode {
	node: PixiText;
	cell: SoupCell;
	/** Entrance delay in seconds (diagonal stagger). */
	delay: number;
	/** Age since setGrid, drives the entrance tween. */
	age: number;
	/** Pop animation age, or -1 when idle. */
	popAge: number;
	popDelay: number;
}

interface FlashFx {
	cells: SoupCell[];
	age: number;
}

interface LockedWord {
	cells: SoupCell[];
	color: number;
}

export interface SoupBoard {
	/** Replace the grid (new wave). Restarts the entrance animation. */
	setGrid: ( grid: SoupGrid ) => void;
	/** Recompute layout after a resize; repositions everything. */
	relayout: ( width: number, height: number ) => void;
	/** The cell under a canvas-space point, or null. */
	cellAt: ( x: number, y: number ) => SoupCell | null;
	/** Canvas-space center of a cell. */
	cellCenter: ( cell: SoupCell ) => { x: number; y: number };
	/** Draw the live selection capsule through these cells. */
	showSelection: ( cells: SoupCell[] ) => void;
	clearSelection: () => void;
	/** Permanently lock a found word's capsule + pop its letters. */
	lockWord: ( cells: SoupCell[], color: number ) => void;
	/** Brief red capsule flash for a wrong selection. */
	flashInvalid: ( cells: SoupCell[] ) => void;
	/** Advance animations. */
	update: ( dt: number ) => void;
	destroy: () => void;
}

export function createSoupBoard(
	pixi: PixiNamespace,
	stage: PixiContainer,
): SoupBoard {
	const backdrop = new pixi.Graphics();
	backdrop.zIndex = 0;
	const lockLayer = new pixi.Graphics();
	lockLayer.zIndex = 5;
	const selectionLayer = new pixi.Graphics();
	selectionLayer.zIndex = 8;
	const flashLayer = new pixi.Graphics();
	flashLayer.zIndex = 9;
	const tileLayer = new pixi.Container();
	tileLayer.zIndex = 10;
	stage.addChild( backdrop );
	stage.addChild( lockLayer );
	stage.addChild( selectionLayer );
	stage.addChild( flashLayer );
	stage.addChild( tileLayer );

	let grid: SoupGrid | null = null;
	let tiles: TileNode[] = [];
	let locked: LockedWord[] = [];
	let flashes: FlashFx[] = [];
	let selection: SoupCell[] = [];
	let width = 0;
	let height = 0;
	let cell = 48;
	let originX = 0;
	let originY = 0;
	/** Cells whose letter now sits on a locked capsule. */
	const lockedCells = new Set< string >();

	const cellKey = ( c: SoupCell ): string => `${ c.row }:${ c.col }`;

	const computeLayout = (): void => {
		if ( ! grid ) {
			return;
		}
		const pad = 18;
		cell = Math.max(
			24,
			Math.min(
				( width - pad * 2 ) / grid.size,
				( height - pad * 2 ) / grid.size,
				64,
			),
		);
		originX = ( width - cell * grid.size ) / 2;
		originY = ( height - cell * grid.size ) / 2;
	};

	const center = ( c: SoupCell ): { x: number; y: number } => ( {
		x: originX + ( c.col + 0.5 ) * cell,
		y: originY + ( c.row + 0.5 ) * cell,
	} );

	const paintBackdrop = (): void => {
		backdrop.clear();
		if ( width <= 0 || height <= 0 ) {
			return;
		}
		backdrop.rect( 0, 0, width, height ).fill( BACKDROP_COLOR );
		// Soft simmering glows — cheap stand-ins for a gradient.
		backdrop
			.circle( width * 0.22, height * 0.2, Math.max( width, height ) * 0.4 )
			.fill( { color: BACKDROP_GLOW_A, alpha: 0.35 } );
		backdrop
			.circle( width * 0.85, height * 0.9, Math.max( width, height ) * 0.45 )
			.fill( { color: BACKDROP_GLOW_B, alpha: 0.4 } );
		if ( grid ) {
			// The pot: a rounded plate under the grid.
			const platePad = Math.min( 14, cell * 0.3 );
			backdrop
				.roundRect(
					originX - platePad,
					originY - platePad,
					cell * grid.size + platePad * 2,
					cell * grid.size + platePad * 2,
					Math.min( 22, cell * 0.5 ),
				)
				.fill( { color: 0x000000, alpha: 0.28 } );
			// Cell dots — a subtle grid rhythm.
			for ( let row = 0; row < grid.size; row++ ) {
				for ( let col = 0; col < grid.size; col++ ) {
					const p = center( { row, col } );
					backdrop
						.roundRect(
							p.x - cell * 0.42,
							p.y - cell * 0.42,
							cell * 0.84,
							cell * 0.84,
							cell * 0.2,
						)
						.fill( { color: CELL_COLOR, alpha: 0.05 } );
				}
			}
		}
	};

	const drawCapsule = (
		g: PixiGraphics,
		cells: SoupCell[],
		color: number,
		alpha: number,
	): void => {
		if ( 0 === cells.length ) {
			return;
		}
		const from = center( cells[ 0 ] );
		const thickness = cell * 0.78;
		if ( cells.length === 1 ) {
			g.circle( from.x, from.y, thickness / 2 ).fill( { color, alpha } );
			return;
		}
		const to = center( cells[ cells.length - 1 ] );
		g
			.moveTo( from.x, from.y )
			.lineTo( to.x, to.y )
			.stroke( { color, width: thickness, alpha, cap: 'round' } );
	};

	const repaintLocks = (): void => {
		lockLayer.clear();
		for ( const entry of locked ) {
			drawCapsule( lockLayer, entry.cells, entry.color, 0.85 );
		}
	};

	const repaintSelection = (): void => {
		selectionLayer.clear();
		if ( selection.length > 0 ) {
			drawCapsule( selectionLayer, selection, SELECTION_COLOR, 0.35 );
			// A brighter core dot on every covered cell.
			for ( const c of selection ) {
				const p = center( c );
				selectionLayer
					.circle( p.x, p.y, cell * 0.12 )
					.fill( { color: SELECTION_COLOR, alpha: 0.7 } );
			}
		}
	};

	const repaintFlashes = (): void => {
		flashLayer.clear();
		for ( const flash of flashes ) {
			const progress = Math.min( 1, flash.age / FLASH_SECONDS );
			drawCapsule(
				flashLayer,
				flash.cells,
				0xff5470,
				0.5 * ( 1 - progress ),
			);
		}
	};

	const positionTiles = (): void => {
		for ( const tile of tiles ) {
			const p = center( tile.cell );
			tile.node.x = p.x;
			tile.node.y = p.y;
		}
	};

	const rebuildTiles = (): void => {
		tileLayer.removeChildren();
		for ( const tile of tiles ) {
			tile.node.destroy();
		}
		tiles = [];
		if ( ! grid ) {
			return;
		}
		for ( let row = 0; row < grid.size; row++ ) {
			for ( let col = 0; col < grid.size; col++ ) {
				const node = new pixi.Text( {
					text: grid.letters[ row ][ col ].toUpperCase(),
					style: {
						fill: LETTER_COLOR,
						fontSize: Math.round( cell * 0.52 ),
						fontFamily: TILE_FONT,
						fontWeight: '700',
					},
					resolution: 2,
				} );
				node.anchor.set( 0.5 );
				node.alpha = 0;
				node.scale.set( 0 );
				tileLayer.addChild( node );
				tiles.push( {
					node,
					cell: { row, col },
					delay: ( row + col ) * ENTRANCE_STAGGER,
					age: 0,
					popAge: -1,
					popDelay: 0,
				} );
			}
		}
		positionTiles();
	};

	return {
		setGrid( next ) {
			grid = next;
			locked = [];
			flashes = [];
			selection = [];
			lockedCells.clear();
			computeLayout();
			paintBackdrop();
			repaintLocks();
			repaintSelection();
			repaintFlashes();
			rebuildTiles();
		},

		relayout( nextWidth, nextHeight ) {
			width = nextWidth;
			height = nextHeight;
			computeLayout();
			paintBackdrop();
			repaintLocks();
			repaintSelection();
			repaintFlashes();
			positionTiles();
			for ( const tile of tiles ) {
				tile.node.style.fill = lockedCells.has( cellKey( tile.cell ) )
					? LOCKED_LETTER_COLOR
					: LETTER_COLOR;
			}
		},

		cellAt( x, y ) {
			if ( ! grid ) {
				return null;
			}
			const col = Math.floor( ( x - originX ) / cell );
			const row = Math.floor( ( y - originY ) / cell );
			if ( row < 0 || row >= grid.size || col < 0 || col >= grid.size ) {
				return null;
			}
			return { row, col };
		},

		cellCenter( c ) {
			return center( c );
		},

		showSelection( cells ) {
			selection = cells;
			repaintSelection();
		},

		clearSelection() {
			selection = [];
			repaintSelection();
		},

		lockWord( cells, color ) {
			locked.push( { cells, color } );
			repaintLocks();
			for ( let i = 0; i < cells.length; i++ ) {
				lockedCells.add( cellKey( cells[ i ] ) );
				const tile = tiles.find(
					( t ) =>
						t.cell.row === cells[ i ].row &&
						t.cell.col === cells[ i ].col,
				);
				if ( tile ) {
					tile.node.style.fill = LOCKED_LETTER_COLOR;
					tile.popAge = 0;
					tile.popDelay = i * 0.03;
				}
			}
		},

		flashInvalid( cells ) {
			flashes.push( { cells, age: 0 } );
		},

		update( dt ) {
			let needsFlashRepaint = false;
			for ( const flash of flashes.slice() ) {
				flash.age += dt;
				needsFlashRepaint = true;
				if ( flash.age >= FLASH_SECONDS ) {
					flashes = flashes.filter( ( f ) => f !== flash );
				}
			}
			if ( needsFlashRepaint ) {
				repaintFlashes();
			}
			for ( const tile of tiles ) {
				tile.age += dt;
				const t = Math.min(
					1,
					Math.max( 0, ( tile.age - tile.delay ) / ENTRANCE_SECONDS ),
				);
				// Back-ease overshoot: pops past 1 then settles.
				const eased =
					1 + 2.7 * Math.pow( t - 1, 3 ) + 1.7 * Math.pow( t - 1, 2 );
				let scale = eased;
				tile.node.alpha = Math.min( 1, t * 1.6 );
				if ( tile.popAge >= 0 ) {
					tile.popAge += dt;
					const pt = Math.min(
						1,
						Math.max(
							0,
							( tile.popAge - tile.popDelay ) / POP_SECONDS,
						),
					);
					// Quick swell and settle: sin arc peaking at +35%.
					scale *= 1 + 0.35 * Math.sin( Math.PI * pt );
					if ( pt >= 1 ) {
						tile.popAge = -1;
					}
				}
				tile.node.scale.set( Math.max( 0, scale ) );
			}
		},

		destroy() {
			tileLayer.removeChildren();
			for ( const tile of tiles ) {
				tile.node.destroy();
			}
			tiles = [];
			stage.removeChild( backdrop );
			stage.removeChild( lockLayer );
			stage.removeChild( selectionLayer );
			stage.removeChild( flashLayer );
			stage.removeChild( tileLayer );
			backdrop.destroy();
			lockLayer.destroy();
			selectionLayer.destroy();
			flashLayer.destroy();
			tileLayer.destroy( { children: true } );
		},
	};
}
