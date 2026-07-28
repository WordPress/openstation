/**
 * Desktop Mode — the stage's texture source, with idle frames skipped.
 *
 * The stage mirrors the shell by asking the browser for a fresh paint
 * record every frame and uploading it. Asking every frame is not
 * negotiable: scrolling inside a window's iframe can be composited off
 * the main thread, so waiting for the browser's own invalidation would
 * let the desktop silently stop updating, which is a far worse failure
 * than a wasted upload.
 *
 * **Uploading every frame is negotiable, though.** The `paint` event
 * reports which of the canvas's children actually changed, and PixiJS's
 * `HTMLSource` only uses that list to skip paints belonging to *other*
 * children. When it says nothing changed at all, the recorded pixels are
 * identical to the ones already on the GPU and re-sending a full-screen
 * RGBA texture buys precisely nothing — at a 2× device pixel ratio on a
 * 1440p display that is roughly 850 MB/s of pure waste.
 *
 * @since 0.9.8
 */

/** How many consecutive idle paints before uploading anyway. */
const HEARTBEAT_PAINTS = 30;

/** What the browser hands us on the canvas's `paint` event. */
interface PaintEventLike {
	changedElements?: unknown[];
}

/** Counters, for answering "is it actually skipping?" from the console. */
export interface SourceStats {
	/** Paints seen since the stage started. */
	paints: number;
	/** Of those, how many became GPU uploads. */
	uploads: number;
	/** And how many were skipped as identical. */
	skipped: number;
}

export interface StageSource {
	stats: SourceStats;
	/**
	 * Stop listening to the canvas's `paint` event without destroying
	 * the source, freezing the GPU texture at its last upload.
	 *
	 * A demoted window needs exactly this: the element is no longer a
	 * direct child of the canvas, so the next upload would hand
	 * `texElementImage2D` an element it must reject — and the stage
	 * counts those errors toward shutting itself down. Destroying the
	 * source instead would free the GPU texture while an effect's mesh
	 * is still sampling it. Detaching the listener is the only exit
	 * that is safe on both fronts; the texture is destroyed later
	 * through the normal retire path.
	 */
	detachPaintListener(): void;
	[ key: string ]: unknown;
}

/**
 * The slice of the Pixi namespace this needs — just the class to extend.
 */
interface SourcePixi {
	HTMLSource: new ( options: Record< string, unknown > ) => object;
}

/**
 * Build the stage's `HTMLSource`, skipping uploads for idle paints.
 *
 * @param pixi    The vendor-loaded Pixi namespace.
 * @param options Passed straight to `HTMLSource`, plus one of ours:
 *                `skipIdlePaints: false` uploads on every paint even
 *                when the browser reports nothing changed. The live
 *                window sources use it — content inside a window's
 *                iframe (a playing video, a CSS animation) can change
 *                without the canvas's `changedElements` ever saying
 *                so, and a "live" texture that freezes between
 *                heartbeats defeats its purpose. The cost is bounded
 *                by the window's size and the effect's duration.
 * @return The source, carrying live {@link SourceStats}.
 */
export function createStageSource(
	pixi: unknown,
	options: Record< string, unknown > & { skipIdlePaints?: boolean },
): StageSource {
	const Base = ( pixi as SourcePixi ).HTMLSource as unknown as new (
		opts: Record< string, unknown >,
	) => Record< string, unknown >;

	/*
	 * Subclassed rather than wrapped because `HTMLSource` binds its
	 * paint handler in its own constructor — `this._onPaint.bind(this)`
	 * — so the bound copy resolves through the prototype chain at
	 * construction time. An override on the subclass is picked up;
	 * a patch applied to the instance afterwards would not be.
	 *
	 * Not `autoUpdate: false` plus a listener of our own, which would
	 * look tidier: that flag also decides `_isReady`, which would then
	 * be true before the first paint had been recorded, and PixiJS
	 * would try to upload an element with no cached paint record and
	 * throw on the stage's very first render.
	 */
	const skipIdle = options.skipIdlePaints !== false;

	class SkippingSource extends Base {
		public stats: SourceStats = { paints: 0, uploads: 0, skipped: 0 };
		/**
		 * Consecutive idle paints.
		 *
		 * The skip is a bet that an empty `changedElements` really means
		 * identical pixels. If that bet is ever wrong the desktop would
		 * freeze, which is exactly the failure the per-frame repaint
		 * exists to prevent — so an upload is forced periodically
		 * regardless. A wrong bet then costs staleness measured in a few
		 * frames rather than forever.
		 */
		private _idle = 0;
		/** Whether a paint has ever been accepted. */
		private _seeded = false;

		public detachPaintListener(): void {
			// `HTMLSource` stores the bound copy of `_onPaint` it
			// registered in its constructor; removing by that exact
			// reference is the only way to unhook it. The property is
			// unmangled in the vendored bundle (`assets/vendor/
			// pixi-html-source.min.js`), and `destroy()` doing the same
			// removal later is a harmless no-op.
			const self = this as unknown as {
				canvas?: {
					removeEventListener(
						type: string,
						listener: unknown,
					): void;
				} | null;
				_onPaintBound?: unknown;
			};
			if ( self.canvas && self._onPaintBound ) {
				self.canvas.removeEventListener( 'paint', self._onPaintBound );
			}
		}

		public _onPaint( event: PaintEventLike ): void {
			this.stats.paints++;

			const changed = event?.changedElements;
			const idle = Array.isArray( changed ) && changed.length === 0;

			// Never skip before the first accepted paint: the base class
			// flips its own `ready` flag in there, and a source that is
			// never ready is never uploaded at all — a black desktop.
			if ( skipIdle && this._seeded && idle && this._idle < HEARTBEAT_PAINTS ) {
				this._idle++;
				this.stats.skipped++;
				return;
			}

			this._idle = 0;
			this._seeded = true;
			this.stats.uploads++;
			const base = Base.prototype as unknown as {
				_onPaint( e: PaintEventLike ): void;
			};
			base._onPaint.call( this, event );
		}
	}

	return new SkippingSource( options ) as unknown as StageSource;
}
