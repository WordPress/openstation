/**
 * Content Graph — building the board's display objects without
 * freezing the window.
 *
 * A node is a container, a hit area, two `Graphics` and, once it is
 * worth showing, two `Text`s; an edge is a `Graphics`. On a site of a
 * few thousand posts building all of that in one turn held the main
 * thread for seconds. Two things here keep it in slices:
 *
 *   - {@link runSliced} builds the nodes and edges across animation
 *     frames, each frame stopping once {@link SPRITE_BATCH_BUDGET_MS}
 *     is spent, so the browser paints and takes input in between. The
 *     run can be cancelled, and says whether it finished.
 *   - {@link createNodeIcon} and {@link createNodeLabel} build a
 *     node's glyph and label only when the scene first needs them:
 *     labels are invisible below the zoom fade, and in disc style the
 *     glyph only shows on hover or focus. The scene spends the same
 *     per-frame budget on them, so zooming into a large board does
 *     not trade the load freeze for a zoom freeze.
 *
 * @public
 */

import type {
	PixiContainer,
	PixiNamespace,
	PixiText,
} from './pixi-types';

/**
 * Per-frame time budget, in milliseconds, for building display
 * objects. Well under a 60 Hz frame on its own, so the frame still has
 * room for the simulation step and the paint.
 */
export const SPRITE_BATCH_BUDGET_MS = 10;

export interface SlicedRun {
	/**
	 * Resolves `true` once every item is built, `false` when the run is
	 * cancelled first. Rejects if building an item throws.
	 */
	readonly done: Promise< boolean >;
	/** Drop the run: no further item is built and no frame is asked for. */
	cancel(): void;
}

export interface SliceOptions {
	/** Called after each batch, e.g. to ask for a repaint. */
	onBatch?: () => void;
	budgetMs?: number;
	now?: () => number;
	requestFrame?: ( cb: () => void ) => number;
	cancelFrame?: ( handle: number ) => void;
}

/**
 * Call `work( i )` for every `i` below `total`, in batches across
 * animation frames. Each batch builds at least one item and stops once
 * the budget is spent. The first batch runs on the next frame, never
 * in the caller's turn.
 *
 * @param total Number of items.
 * @param work  Builds item `i`.
 * @param opts  See {@link SliceOptions}.
 */
export function runSliced(
	total: number,
	work: ( i: number ) => void,
	opts: SliceOptions = {},
): SlicedRun {
	const budget = opts.budgetMs ?? SPRITE_BATCH_BUDGET_MS;
	const now = opts.now ?? ( () => performance.now() );
	const requestFrame =
		opts.requestFrame ?? ( ( cb: () => void ) => window.requestAnimationFrame( cb ) );
	const cancelFrame =
		opts.cancelFrame ?? ( ( h: number ) => window.cancelAnimationFrame( h ) );

	let next = 0;
	let handle: number | null = null;
	let ended = false;
	let resolve: ( built: boolean ) => void = () => {};
	let reject: ( err: unknown ) => void = () => {};
	const done = new Promise< boolean >( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );

	const batch = (): void => {
		handle = null;
		if ( ended ) {
			return;
		}
		const deadline = now() + budget;
		try {
			do {
				work( next++ );
			} while ( next < total && now() < deadline );
		} catch ( err ) {
			ended = true;
			reject( err );
			return;
		}
		opts.onBatch?.();
		if ( next >= total ) {
			ended = true;
			resolve( true );
			return;
		}
		handle = requestFrame( batch );
	};

	if ( total <= 0 ) {
		ended = true;
		resolve( true );
	} else {
		handle = requestFrame( batch );
	}

	return {
		done,
		cancel: () => {
			if ( ended ) {
				return;
			}
			ended = true;
			if ( handle !== null ) {
				cancelFrame( handle );
				handle = null;
			}
			resolve( false );
		},
	};
}

/**
 * A node's Dashicon glyph, centred on the node. Its fill and size are
 * set per frame by the scene.
 *
 * @param pixi       Pixi namespace.
 * @param char       The glyph, or `null` for a post type with no
 *                   Dashicon (a black circle stands in).
 * @param fontSize   Initial size.
 * @param fill       Initial colour.
 * @param resolution Raster density.
 */
export function createNodeIcon(
	pixi: PixiNamespace,
	char: string | null,
	fontSize: number,
	fill: number,
	resolution: number,
): PixiText {
	return new pixi.Text( {
		text: char ?? '●', // black circle fallback
		style: {
			fontFamily: char ? 'dashicons' : 'sans-serif',
			fontSize,
			fill,
		},
		resolution,
		anchor: { x: 0.5, y: 0.5 },
	} );
}

/**
 * A node's title label on its white backing, as one container.
 *
 * Wrapping the backing rect and the text in a Container lets them and
 * the per-node alpha transform as one unit when the camera zooms. The
 * backing keeps labels readable over busy edge tangles + the dot-grid
 * background; unbacked labels are hard to read.
 *
 * @param pixi       Pixi namespace.
 * @param text       Label text, already truncated.
 * @param resolution Raster density.
 */
export function createNodeLabel(
	pixi: PixiNamespace,
	text: string,
	resolution: number,
): PixiContainer {
	const box = new pixi.Container();
	const bg = new pixi.Graphics();
	box.addChild( bg );

	const label = new pixi.Text( {
		text,
		style: {
			fill: 0x1f2937,
			fontSize: 11,
			fontFamily:
				'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
			fontWeight: '500',
		},
		resolution,
		anchor: { x: 0.5, y: 0 },
	} );
	box.addChild( label );

	// Draw the backing once now that the text has measured itself.
	// The text never changes after this, so re-painting per frame
	// would be pure waste.
	const padX = 5;
	const padY = 1;
	const lw = label.width + padX * 2;
	const lh = label.height + padY * 2;
	bg.roundRect( -lw / 2, -padY, lw, lh, 4 )
		.fill( { color: 0xffffff, alpha: 0.78 } )
		.stroke( {
			color: 0x000000,
			alpha: 0.06,
			width: 1,
		} );
	return box;
}
