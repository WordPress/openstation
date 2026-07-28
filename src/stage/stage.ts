/**
 * Desktop Mode — the canvas stage.
 *
 * Wraps `#desktop-mode-shell` in a `<canvas layoutsubtree>` and mirrors
 * it into a PixiJS texture through the experimental HTML-in-Canvas
 * API, so a chain of fragment shaders can post-process the entire
 * desktop — wallpaper, dock, widgets, windows and all.
 *
 * The shell is *moved*, not cloned. `layoutsubtree` makes the canvas's
 * direct children lay out, hit-test and expose themselves to the
 * accessibility tree exactly as they did before; they simply paint
 * invisibly, and Pixi paints their pixels instead. Every window,
 * iframe, text field and link therefore keeps working untouched — the
 * canvas is a display surface, never an input surface.
 *
 * Two consequences drive the whole design:
 *
 * 1. **Moving the shell re-parents every `<iframe>` inside it, which
 *    reloads them.** So the stage is started at boot before any window
 *    exists, and the runtime toggle refuses to wrap while iframe
 *    windows are open (see `src/stage/loader.ts`).
 * 2. **Children of a `layoutsubtree` canvas paint nothing until they
 *    are drawn.** Between the wrap and Pixi's first frame the desktop
 *    would be blank, so `start()` does the whole sequence — wrap,
 *    init, first render — before returning, and callers keep the boot
 *    curtain down until it resolves.
 *
 * @since 0.9.8
 */

import { doAction, HOOKS } from '../hooks';
import { chainsAreEqual } from './chain';
import {
	createStageSource,
	type SourceStats,
	type StageSource,
} from './element-source';
import { probeElementUpload } from './feature-detect';
import { promoteWindow } from './window-fx/promote';
import { installTexElementImage2DShim } from './webgl-compat';
import type {
	ResolvedScreenEffect,
	ScreenEffectContext,
	ScreenEffectDef,
} from './types';
import type { StageRect } from './window-fx/types';

/**
 * The Pixi namespace as it exists once BOTH vendor bundles have loaded:
 * `pixi.min.js` for the core and `pixi-html-source.min.js`, which
 * `Object.assign`s `HTMLSource` and its texture uploaders onto the same
 * `window.PIXI` global.
 */
type PixiNamespace = typeof import( 'pixi.js' ) &
	typeof import( 'pixi.js/html-source' );

type PixiFilter = InstanceType< PixiNamespace[ 'Filter' ] >;
type PixiApplication = InstanceType< PixiNamespace[ 'Application' ] >;
type PixiSprite = InstanceType< PixiNamespace[ 'Sprite' ] >;
type PixiHtmlSource = InstanceType< PixiNamespace[ 'HTMLSource' ] >;
type PixiTexture = InstanceType< PixiNamespace[ 'Texture' ] >;

/** DOM id of the canvas the stage creates. */
export const STAGE_CANVAS_ID = 'desktop-mode-stage';

/**
 * How many upload failures to tolerate before the stage gives up and
 * restores plain DOM rendering. Small on purpose — a single bad frame
 * can be a transient GPU hiccup, but a handful means the API is not
 * usable and the user is looking at a blank desktop.
 */
const UPLOAD_ERROR_LIMIT = 5;

/**
 * How long `afterNextSnapshot()` waits for a paint before giving up and
 * running its callback against whatever is on screen.
 *
 * Only reached when the browser has stopped painting the canvas — a
 * backgrounded tab, mostly. Deliberately close to a couple of frames:
 * every millisecond here is a millisecond a window transition has not
 * started yet, and at 100 ms that stall was visible as the real window
 * carrying on for a beat before the animation took over.
 */
const SNAPSHOT_TIMEOUT_MS = 40;

/**
 * Trailing edge: how long after the LAST resize event to rebuild, so a
 * drag always ends on a correct frame. Short enough that letting go
 * feels immediate.
 */
const RESIZE_SETTLE_MS = 80;

/**
 * Leading edge: minimum gap between rebuilds while a resize is still in
 * progress, giving roughly four correct frames a second during a drag
 * instead of one stretched preview until it ends.
 *
 * Not zero, and not per-frame: every rebuild allocates a full-screen
 * RGBA texture (several megabytes at a typical window size), so doing it
 * on every resize event would thrash GPU memory for frames that are on
 * screen for 16 ms. This is the compromise between "live" and "cheap".
 */
const RESIZE_REBUILD_THROTTLE_MS = 250;

/** Body class that hides the admin bar, changing the stage's top inset. */
const FULLSCREEN_BODY_CLASS = 'desktop-mode-has-fullscreen-window';

/** Class added to the shell while it lives inside the canvas. */
export const STAGED_SHELL_CLASS = 'desktop-mode-shell--staged';

export interface CanvasStageOptions {
	/** The shell root — `#desktop-mode-shell`. */
	shell: HTMLElement;
}

/**
 * A window promoted to its own live texture.
 *
 * While held, the window element is a direct child of the stage canvas
 * and `texture` re-uploads from it on every canvas paint — the pixels
 * are LIVE, not a snapshot: a video keeps playing, a spinner keeps
 * spinning, typing keeps rendering, all while an effect deforms them.
 */
export interface LiveWindowCapture {
	/** The window's live texture, refreshed on every canvas paint. */
	texture: PixiTexture;
	/**
	 * Send the element back to its home in the shell and freeze the
	 * texture at its last upload. Idempotent. The texture stays valid
	 * (frozen) until it is retired through the normal path — an
	 * effect's settle phase can keep sampling it.
	 */
	demote(): void;
	/** Whether {@link demote} has run. */
	readonly demoted: boolean;
}

/**
 * Owns the canvas, the Pixi application and the live filter chain.
 * One instance per page; `src/stage/index.ts` holds the singleton.
 */
export class CanvasStage {
	private readonly _shell: HTMLElement;

	private _canvas: HTMLCanvasElement | null = null;
	private _app: PixiApplication | null = null;
	private _source: PixiHtmlSource | null = null;
	private _sprite: PixiSprite | null = null;
	private _overlay: InstanceType< PixiNamespace[ 'Container' ] > | null = null;
	private _bodyClassObserver: MutationObserver | null = null;
	private _schemeObserver: MutationObserver | null = null;
	private _resizeSettleTimer: ReturnType< typeof setTimeout > | null = null;
	private _lastRebuildAt = 0;

	/**
	 * Windows currently promoted to direct canvas children. Tracked so
	 * `stop()` can send every one of them home BEFORE the canvas is
	 * removed — an element left inside would be torn out of the
	 * document with it.
	 */
	private _liveWindows = new Set< LiveWindowCapture >();

	private readonly _onViewportChange = (): void => {
		this._resize();
	};

	/** Live filters, keyed by effect id so a rebuild can reuse them. */
	private _filters = new Map< string, PixiFilter >();
	private _chain: ResolvedScreenEffect[] = [];
	private _running = false;
	private _startedAt = 0;

	private readonly _tick = (): void => {
		this._onTick();
	};

	/**
	 * Runtime failsafe for upload errors.
	 *
	 * PixiJS uploads from inside the browser's `paint` event, downstream
	 * of its own emitter, so a throwing uploader cannot be caught by any
	 * try/catch of ours — it simply throws on every frame, forever,
	 * while the shell sits inside a canvas that never receives pixels.
	 * The pre-flight probe in `start()` should make this unreachable,
	 * but "unreachable" is a poor thing to bet a user's desktop on: if
	 * it happens anyway, unwrap rather than leave them staring at a
	 * blank screen filling the console.
	 */
	private _uploadErrors = 0;
	private readonly _onWindowError = ( event: ErrorEvent ): void => {
		const message = event.message ?? '';
		if ( ! message.includes( 'texElementImage2D' ) ) {
			return;
		}
		this._uploadErrors++;
		if ( this._uploadErrors < UPLOAD_ERROR_LIMIT ) {
			return;
		}
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[desktop-mode/stage] texElementImage2D() failed ${ this._uploadErrors } times; ` +
					'stopping the canvas stage and restoring plain DOM rendering. ' +
					'Last error: ' +
					message,
			);
		}
		doAction( HOOKS.SHELL_ERROR, {
			scope: 'stage-upload',
			error: message,
		} );
		this.stop();
	};

	constructor( options: CanvasStageOptions ) {
		this._shell = options.shell;
	}

	/** Whether the shell is currently rendering through the canvas. */
	get isActive(): boolean {
		return this._running;
	}

	/** The canvas element, or `null` while the stage is stopped. */
	get canvas(): HTMLCanvasElement | null {
		return this._canvas;
	}

	/**
	 * Wrap the shell and start rendering. Resolves only once the first
	 * frame has been drawn, so the caller can hold a loading curtain
	 * over the swap. Rejects — after unwrapping cleanly — if Pixi or the
	 * browser API is unavailable.
	 *
	 * @param chain Effects to start with. May be empty.
	 */
	async start( chain: ResolvedScreenEffect[] = [] ): Promise< void > {
		if ( this._running ) {
			await this.setEffects( chain );
			return;
		}

		const pixi = readPixi();
		if ( ! pixi ) {
			throw new Error(
				'[desktop-mode/stage] window.PIXI is undefined — load the `pixijs` and `pixi-html-source` modules before starting the stage.',
			);
		}
		if ( typeof pixi.HTMLSource !== 'function' ) {
			throw new Error(
				'[desktop-mode/stage] PIXI.HTMLSource is missing — the `pixi-html-source` vendor bundle did not load.',
			);
		}

		// Translate PixiJS 8.19's legacy 6-argument `texElementImage2D`
		// call into the 3-argument signature Chromium 150+ finalised on.
		// Idempotent, and a no-op on browsers that still want the old
		// shape. Must run before the probe, which measures the real call.
		installTexElementImage2DShim();

		// Prove the upload works BEFORE touching the shell.
		//
		// Uploads happen inside the browser's paint event, downstream of
		// PixiJS's own event emitter, so a failure there cannot be caught
		// from here — it just throws on every frame forever. And by then
		// the shell is already inside a canvas that never receives
		// pixels, i.e. an invisible desktop. Checking that the method
		// *exists* is not enough on an experimental API whose signature
		// can drift from the one PixiJS was built against; the only
		// honest test is to actually call it once.
		const probe = probeElementUpload();
		if ( ! probe.ok ) {
			throw new Error(
				`[desktop-mode/stage] the browser's texElementImage2D() rejected a test upload, so the desktop was left as plain DOM. ` +
					`This usually means the browser's HTML-in-Canvas signature differs from the one PixiJS ${
						( pixi as { VERSION?: string } ).VERSION ?? ''
					} expects. Reported: ${ probe.error ?? 'unknown error' }` +
					( probe.arity === undefined
						? ''
						: ` (texElementImage2D.length = ${ probe.arity })` ),
			);
		}

		try {
			this._wrap();
			await this._createApp( pixi );
			this._createSource( pixi );
			// Size before building filters: `_resize()` establishes the
			// stage's `filterArea`, and a filter chain rendered without
			// one measures its bounds from a sprite whose texture has
			// not had its first paint yet.
			this._resize();
			await this.setEffects( chain );
			this._app?.render();
			this._app?.ticker.add( this._tick );
			this._uploadErrors = 0;
			window.addEventListener( 'error', this._onWindowError );
			this._running = true;
			this._startedAt = performance.now();
			doAction( HOOKS.STAGE_STARTED, { canvas: this._canvas } );
		} catch ( err ) {
			// Never leave the shell inside a canvas we failed to drive —
			// its children would paint nothing and the desktop would be a
			// black rectangle.
			this._teardownPixi();
			this._unwrap();
			throw err;
		}
	}

	/**
	 * Stop rendering and put the shell back where it was. Safe to call
	 * when already stopped.
	 */
	stop(): void {
		if ( ! this._running && ! this._canvas ) {
			return;
		}
		// Promoted windows first: they are direct children of the
		// canvas, and `_unwrap()` removes it. `demote()` mutates the
		// set, so iterate a copy.
		for ( const live of Array.from( this._liveWindows ) ) {
			live.demote();
		}
		this._liveWindows.clear();
		this._teardownPixi();
		this._unwrap();
		this._running = false;
		this._chain = [];
		doAction( HOOKS.STAGE_STOPPED, {} );
	}

	/**
	 * Swap in a new effect chain. Filters for effects that survive the
	 * change are reused and merely re-parameterised, so dragging a
	 * slider never rebuilds a shader program.
	 *
	 * @param chain Resolved effects, already ordered.
	 */
	async setEffects( chain: ResolvedScreenEffect[] ): Promise< void > {
		// The `_app` check is load-bearing, not just a fast path. A
		// `setEffects()` call made before the stage started records the
		// chain and returns without building anything; without this
		// guard the identical chain arriving from `start()` would look
		// like a no-op and the filters would never be created.
		if (
			this._app &&
			this._chain.length > 0 &&
			chainsAreEqual( this._chain, chain )
		) {
			return;
		}

		const pixi = readPixi();
		const app = this._app;
		if ( ! pixi || ! app ) {
			// Not started yet — remember the chain so `start()` uses it.
			this._chain = chain;
			return;
		}

		const next = new Map< string, PixiFilter >();
		const filters: PixiFilter[] = [];

		for ( const entry of chain ) {
			const ctx = this._context( entry.def, entry.params, pixi );
			let filter = this._filters.get( entry.def.id );

			if ( filter ) {
				try {
					entry.def.update?.( filter, ctx );
				} catch ( err ) {
					reportEffectError( entry.def.id, 'update', err );
				}
			} else {
				try {
					filter = entry.def.createFilter( ctx );
				} catch ( err ) {
					reportEffectError( entry.def.id, 'createFilter', err );
					continue;
				}
			}

			next.set( entry.def.id, filter );
			filters.push( filter );
		}

		// Destroy filters that dropped out of the chain.
		for ( const [ id, filter ] of this._filters ) {
			if ( ! next.has( id ) ) {
				try {
					filter.destroy();
				} catch {
					// A filter that throws on destroy is already gone as far
					// as we are concerned; dropping the reference is enough.
				}
			}
		}

		this._filters = next;
		this._chain = chain;
		app.stage.filters = filters;
		app.render();
	}

	/** The vendor-loaded Pixi namespace, or `null` when not running. */
	get pixi(): PixiNamespace | null {
		return this._running ? readPixi() : null;
	}

	/** The stage ticker, for effects that drive their own animation. */
	get ticker(): PixiApplication[ 'ticker' ] | null {
		return this._app?.ticker ?? null;
	}

	/**
	 * Paint and upload counts since the stage started.
	 *
	 * The stage asks the browser to re-record the shell every frame, but
	 * only uploads when the paint reports something actually changed —
	 * see `./element-source`. This is how to tell whether that is
	 * working on a given machine rather than taking it on trust:
	 * `skipped` should climb on an idle desktop and stall the moment
	 * anything moves.
	 *
	 * `null` when the stage is not running.
	 */
	get stats(): SourceStats | null {
		return ( this._source as unknown as { stats?: SourceStats } )?.stats ?? null;
	}

	/**
	 * Container sitting above the desktop sprite, below nothing. Window
	 * transition effects mount their sprites here so they animate over
	 * the desktop rather than inside its texture.
	 */
	get overlay(): InstanceType< PixiNamespace[ 'Container' ] > | null {
		return this._overlay;
	}

	/**
	 * Run `cb` once the desktop snapshot reflects the DOM as it is now.
	 *
	 * The stage does not draw the shell — it draws a picture of it,
	 * recorded in the browser's `paint` event and uploaded on the
	 * following render. So the pixels on screen are always a frame or two
	 * behind the DOM, and anything that reads them straight after
	 * mutating it reads the past. Two callers care:
	 *
	 * - {@link captureRegion}, which would otherwise freeze a window as
	 *   it looked BEFORE it was raised — complete with whatever was
	 *   sitting on top of it.
	 * - A window that has just been created, which is not in the picture
	 *   at all until the next paint.
	 *
	 * Waiting on the source's own `update` event rather than counting
	 * frames: that event IS the paint having happened, which is the fact
	 * the caller actually needs, and it arrives on the very next paint.
	 *
	 * `cb` is then deferred by one task rather than run inline, and this
	 * is not incidental. The event fires inside the browser's `paint`
	 * step, and its callers do GPU work — `captureRegion()` runs a whole
	 * `renderer.render()`. An earlier version hopped through
	 * `ticker.addOnce()` instead, which put that render INSIDE PixiJS's
	 * own render loop: re-entrant rendering, which PixiJS does not
	 * support, and which cost both frame rate and a wasted frame of
	 * latency. A task hop lands after the paint and before the next
	 * animation frame — outside both loops, with the paint record still
	 * cached and the source still flagged dirty, so the capture that
	 * follows uploads the fresh image.
	 *
	 * Falls back to a timer if no paint arrives at all — a hidden tab
	 * stops painting, and the caller must not be stranded.
	 *
	 * @param cb Runs with a current snapshot. Called synchronously if the
	 *           stage is not running, so callers always make progress.
	 * @return Cancels the pending call.
	 */
	afterNextSnapshot( cb: () => void ): () => void {
		const source = this._source;
		if ( ! source || ! this._running ) {
			cb();
			return () => undefined;
		}

		let fired = false;
		let hop: ReturnType< typeof setTimeout > | null = null;
		const onUpdate = (): void => {
			source.off( 'update', onUpdate );
			hop = setTimeout( run, 0 );
		};
		const cancel = (): void => {
			source.off( 'update', onUpdate );
			if ( hop ) {
				clearTimeout( hop );
			}
			clearTimeout( timer );
		};
		function run(): void {
			if ( fired ) {
				return;
			}
			fired = true;
			cancel();
			cb();
		}

		const timer = setTimeout( run, SNAPSHOT_TIMEOUT_MS );
		source.on( 'update', onUpdate );
		return () => {
			fired = true;
			cancel();
		};
	}

	/**
	 * Promote a window to a direct canvas child and hand back a LIVE
	 * texture of it.
	 *
	 * This is the spec's own pattern for deforming HTML (see the
	 * Chrome "deformable page" demo): the element is a direct child of
	 * the `layoutsubtree` canvas, `texElementImage2D` re-uploads it on
	 * every paint, and whatever the effect builds from the texture
	 * shows the element as it IS — a window being dragged as cloth
	 * keeps playing its video and rendering its keystrokes.
	 *
	 * Three properties fall out of the move itself, with no correction
	 * machinery:
	 *
	 * - The element leaves the shell's subtree, so the next shell paint
	 *   no longer contains it — the pixels *behind* the window appear
	 *   in the desktop texture automatically. No hiding, and therefore
	 *   no iframe-throttling workaround.
	 * - The element still lays out, hit-tests and keeps every kind of
	 *   state (`moveBefore` is the atomic, state-preserving move — no
	 *   iframe reload, no lost focus or pointer capture).
	 * - Stacking is trivial: a promoted window is being dragged or
	 *   opened, which is exactly when it is topmost.
	 *
	 * Returns `null` when the stage is not running or the move is not
	 * possible (no `moveBefore`, fullscreen window, detached element) —
	 * callers fall back to {@link captureRegion}'s frozen snapshot.
	 *
	 * @param element The window element to promote.
	 * @return The live capture, or `null`.
	 */
	acquireLiveWindow( element: HTMLElement ): LiveWindowCapture | null {
		const canvas = this._canvas;
		const pixi = readPixi();
		if ( ! canvas || ! pixi || ! this._running ) {
			return null;
		}

		const promoted = promoteWindow( element, canvas );
		if ( ! promoted ) {
			return null;
		}

		let source: StageSource;
		try {
			source = createStageSource( pixi, {
				resource: element,
				canvas,
				autoUpdate: true,
				autoRequestPaint: true,
				// Upload on EVERY paint. A live window must not freeze
				// between idle-skip heartbeats — content inside its
				// iframe can change without `changedElements` saying so.
				skipIdlePaints: false,
			} );
		} catch ( err ) {
			promoted.demote();
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode/stage] failed to create a live window source:',
					err,
				);
			}
			return null;
		}

		const texture = new pixi.Texture( {
			source: source as never,
		} ) as PixiTexture;

		const live: LiveWindowCapture = {
			texture,
			get demoted() {
				return promoted.demoted;
			},
			demote: () => {
				if ( promoted.demoted ) {
					return;
				}
				// Listener off FIRST: one more upload after the element
				// stops being a canvas child would throw inside the
				// browser's paint event — where the stage's failsafe
				// counts errors toward shutting the whole canvas down.
				source.detachPaintListener();
				promoted.demote();
				this._liveWindows.delete( live );
			},
		};
		this._liveWindows.add( live );
		return live;
	}

	/**
	 * Freeze a rectangle of the live desktop into its own texture.
	 *
	 * This is what lets a single window become an independent PixiJS
	 * object without reparenting it into the canvas: the stage's texture
	 * already contains every window, so a window "becomes" a sprite by
	 * copying its rectangle out. `generateTexture` renders through the
	 * GPU into a new render target, so the result is a genuine snapshot
	 * — it keeps the pixels as they were even after the real element is
	 * hidden or destroyed, which is precisely what a close animation
	 * needs.
	 *
	 * The rectangle is copied out of the snapshot, so it carries whatever
	 * that picture holds — including a window that was overlapping at the
	 * time. Callers that have just changed the stacking order can put that
	 * right with {@link afterNextSnapshot} and {@link recaptureRegion}.
	 *
	 * @param rect Region in CSS pixels, relative to the stage canvas.
	 * @return A texture of that region, or `null` when the stage is not
	 *         running or the rect is empty.
	 */
	captureRegion( rect: StageRect ): PixiTexture | null {
		const app = this._app;
		const sprite = this._sprite;
		const pixi = readPixi();
		if ( ! app || ! sprite || ! pixi || ! this._running ) {
			return null;
		}
		if ( rect.width <= 0 || rect.height <= 0 ) {
			return null;
		}

		try {
			return app.renderer.generateTexture( {
				target: sprite,
				frame: new pixi.Rectangle(
					rect.x,
					rect.y,
					rect.width,
					rect.height,
				),
				resolution: window.devicePixelRatio || 1,
			} );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode/stage] failed to capture a window region:',
					err,
				);
			}
			return null;
		}
	}

	/**
	 * Redraw a region of the live desktop into a texture already on
	 * screen, in place.
	 *
	 * This is what lets a capture be *corrected* rather than merely
	 * delayed. A window that was raised a moment ago is not yet on top in
	 * the snapshot, so freezing it immediately catches the window that
	 * was overlapping it — but waiting for the snapshot to catch up means
	 * the animation cannot start until it does, and that delay is
	 * visible. Capturing at once and repainting the same texture one
	 * snapshot later gets both: the stand-in is up in the frame the
	 * gesture began, and its pixels are right from the next one.
	 *
	 * Same texture object throughout, deliberately — an effect may have
	 * built a mesh or a hundred particle sprites around it by now, and
	 * swapping the object underneath them would mean an API for something
	 * that is really just new pixels.
	 *
	 * @param texture A texture from {@link captureRegion}.
	 * @param rect    Region in CSS pixels, relative to the stage canvas.
	 *                Must be the same size as the original capture.
	 * @return Whether the texture was repainted. `false` means the caller
	 *         keeps what it already had, which is stale but valid.
	 */
	recaptureRegion( texture: PixiTexture, rect: StageRect ): boolean {
		const app = this._app;
		const sprite = this._sprite;
		const pixi = readPixi();
		if ( ! app || ! sprite || ! pixi || ! this._running ) {
			return false;
		}
		// `generateTexture` truncates the region to whole pixels, so match
		// its arithmetic rather than comparing raw floats. A size change
		// means the window was resized between the two captures and the
		// texture no longer fits; leaving the old pixels is the safe
		// answer.
		const width = Math.trunc( Math.max( rect.width, 1 ) );
		const height = Math.trunc( Math.max( rect.height, 1 ) );
		if ( texture.width !== width || texture.height !== height ) {
			return false;
		}

		try {
			app.renderer.render( {
				container: sprite,
				// The same framing `generateTexture` applies: shift the
				// desktop so the region lands at the texture's origin.
				transform: new pixi.Matrix().translate( -rect.x, -rect.y ),
				target: texture as never,
				clearColor: [ 0, 0, 0, 0 ],
			} );
			texture.source.updateMipmaps();
			return true;
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode/stage] failed to refresh a window capture:',
					err,
				);
			}
			return false;
		}
	}

	/**
	 * Re-measure the canvas and push the new size through the renderer,
	 * the texture source and the sprite. Called by the ResizeObserver
	 * and once during `start()`.
	 */
	private _resize(): void {
		const app = this._app;
		const canvas = this._canvas;
		const pixi = readPixi();
		if ( ! app || ! canvas || ! pixi ) {
			return;
		}

		// Re-apply the explicit canvas dimensions first, then render at
		// exactly those numbers. Measuring `clientWidth` instead would
		// reintroduce the replaced-element trap: an unstyled canvas
		// reports its intrinsic 300×150, and feeding that back into the
		// renderer draws the desktop into a corner.
		this._applyGeometry();
		const { width, height } = viewportBox();
		if ( width === 0 || height === 0 ) {
			return;
		}
		const resolution = window.devicePixelRatio || 1;

		app.renderer.resize( width, height, resolution );

		/*
		 * Deliberately NOT resizing the source or the sprite here.
		 *
		 * `HTMLSource` measures its own element — `resourceWidth` is the
		 * shell's `offsetWidth` in CSS pixels — and re-derives its
		 * dimensions on every `update()`. The renderer's coordinate space
		 * is also CSS pixels (the device pixel ratio lives in the
		 * `resolution` argument above, not in the coordinates), and the
		 * shell fills the canvas exactly. So the sprite's natural size
		 * already equals the screen and drawing it at scale 1 is correct.
		 *
		 * Overriding all three — a `resolution` on the source, an
		 * explicit `source.resize()`, and a forced `sprite.width/height`
		 * — is what produced a hugely magnified desktop drawn into part
		 * of the viewport: each one re-scaled a value the others had
		 * already scaled. Let the texture size itself.
		 */

		// Filters need an explicit area: the stage container's bounds are
		// derived from its children, and a sprite whose texture has not
		// produced its first paint yet measures as empty.
		app.stage.filterArea = new pixi.Rectangle( 0, 0, width, height );

		/*
		 * Re-measure the texture, then force the upload the resize ate.
		 *
		 * `TextureSource.update()` is:
		 *
		 *     if ( this.resource ) {
		 *         const didResize = this.resize( resourceWidth / res, … );
		 *         if ( didResize ) return;   // ← no 'update' emitted
		 *     }
		 *     this.emit( 'update', this );
		 *
		 * A size change therefore SWALLOWS the update event, and 'update'
		 * is what marks the GPU texture dirty. During a drag every frame
		 * changes size, so every call takes the early return, no upload
		 * ever happens, and Pixi stretches the last good snapshot across
		 * the new sprite dimensions — which is exactly what a resize
		 * looked like: windows smeared out of shape.
		 *
		 * Two calls: the first absorbs the new size, the second finds
		 * nothing to resize and emits. Then ask the browser for fresh
		 * pixels. One frame can still show the previous snapshot scaled
		 * (the paint record is only refreshed on the browser's own
		 * schedule) but it corrects on the very next frame instead of
		 * staying wrong for the whole gesture.
		 */
		const source = this._source;
		if ( source ) {
			source.update();
			source.update();
			source.requestPaint();
		}

		// Re-run every effect's `update` so shaders that key off the
		// screen size pick the new one up.
		this._refreshParams( pixi );

		// Draw at the new size straight away rather than waiting for the
		// next ticker frame — a resize should feel instant.
		app.render();

		/*
		 * Rebuild the texture once the gesture settles.
		 *
		 * Keeping a live `HTMLSource` in step with a resizing element
		 * means keeping three things agreeing — the source's logical
		 * size, the GPU texture's contents, and the sprite's dimensions
		 * — across an API that swallows its own update event whenever
		 * the size changes. Any one of them lagging shows up as the
		 * whole desktop smeared out of shape, and it is invisible on the
		 * wallpaper (a flat gradient stretches to look identical), so it
		 * reads as "the windows are distorted".
		 *
		 * Constructing a fresh source sidesteps all of that: the new one
		 * measures the element as it is now. A resize is a coarse,
		 * infrequent event, so paying for a rebuild is cheap next to
		 * carrying a subtle scaling bug.
		 */
		// Leading edge — refresh straight away if it has been a moment
		// since the last rebuild, so a slow drag stays roughly live
		// rather than showing one stretched preview throughout.
		const now = performance.now();
		if ( now - this._lastRebuildAt >= RESIZE_REBUILD_THROTTLE_MS ) {
			this._rebuildSource();
		}

		// Trailing edge — always finish on a correct frame, however the
		// gesture ended.
		if ( this._resizeSettleTimer ) {
			clearTimeout( this._resizeSettleTimer );
		}
		this._resizeSettleTimer = setTimeout( () => {
			this._resizeSettleTimer = null;
			this._rebuildSource();
		}, RESIZE_SETTLE_MS );
	}

	/**
	 * Replace the texture source and sprite with fresh ones measured
	 * against the element's current size. Filters live on `app.stage`,
	 * not on the sprite, so the user's effect chain is untouched.
	 */
	private _rebuildSource(): void {
		const pixi = readPixi();
		const app = this._app;
		if ( ! pixi || ! app || ! this._running ) {
			return;
		}

		// Deliberately NOT destroying `_overlay` — see `_createSource`.
		// It is detached and re-added, so running effects keep their
		// sprites.
		if ( this._overlay ) {
			try {
				app.stage.removeChild( this._overlay );
			} catch {
				// Already detached.
			}
		}
		if ( this._sprite ) {
			try {
				app.stage.removeChild( this._sprite );
				this._sprite.destroy();
			} catch {
				// A sprite that objects to being torn down is being
				// replaced anyway; dropping the reference is enough.
			}
			this._sprite = null;
		}
		try {
			this._source?.destroy();
		} catch {
			// Same: the source is on its way out regardless.
		}
		this._source = null;

		this._lastRebuildAt = performance.now();

		try {
			this._createSource( pixi );
			app.render();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode/stage] failed to rebuild the texture after a resize:',
					err,
				);
			}
		}
	}

	/** Per-frame work: keep the mirror fresh and drive animated effects. */
	private _onTick(): void {
		const pixi = readPixi();
		if ( ! pixi ) {
			return;
		}

		// Ask for a fresh snapshot every frame rather than relying on the
		// browser's own `paint` invalidation. Scrolling inside a window's
		// iframe can be composited off the main thread without the parent
		// canvas ever seeing a change, and a desktop that silently stops
		// updating is a far worse failure than an extra texture upload.
		this._source?.requestPaint();

		if ( this._chain.length === 0 ) {
			return;
		}
		const elapsed = ( performance.now() - this._startedAt ) / 1000;
		for ( const entry of this._chain ) {
			if ( ! entry.def.tick ) {
				continue;
			}
			const filter = this._filters.get( entry.def.id );
			if ( ! filter ) {
				continue;
			}
			try {
				entry.def.tick(
					filter,
					elapsed,
					this._context( entry.def, entry.params, pixi ),
				);
			} catch ( err ) {
				reportEffectError( entry.def.id, 'tick', err );
			}
		}
	}

	private _refreshParams( pixi: PixiNamespace ): void {
		for ( const entry of this._chain ) {
			const filter = this._filters.get( entry.def.id );
			if ( ! filter || ! entry.def.update ) {
				continue;
			}
			try {
				entry.def.update(
					filter,
					this._context( entry.def, entry.params, pixi ),
				);
			} catch ( err ) {
				reportEffectError( entry.def.id, 'update', err );
			}
		}
	}

	private _context(
		_def: ScreenEffectDef,
		params: Record< string, number >,
		pixi: PixiNamespace,
	): ScreenEffectContext {
		return {
			pixi,
			params,
			screen: {
				width: this._canvas?.clientWidth ?? 0,
				height: this._canvas?.clientHeight ?? 0,
			},
			resolution: window.devicePixelRatio || 1,
			reducedMotion:
				typeof window.matchMedia === 'function' &&
				window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches,
		};
	}

	// -----------------------------------------------------------------
	// DOM wrap / unwrap
	// -----------------------------------------------------------------

	/**
	 * Insert the canvas at the shell's exact position in the document
	 * and move the shell inside it. The canvas is placed *before* the
	 * shell first, so the shell's original slot in the parent is what
	 * the canvas now occupies — `_unwrap()` reverses this precisely.
	 */
	private _wrap(): void {
		const parent = this._shell.parentNode;
		if ( ! parent ) {
			throw new Error(
				'[desktop-mode/stage] the shell is not in the document.',
			);
		}

		const canvas = document.createElement( 'canvas' );
		canvas.id = STAGE_CANVAS_ID;
		canvas.className = 'desktop-mode-stage';
		// Deliberately NO `aria-hidden` and no `role` here. The shell
		// becomes a child of this canvas, and `layoutsubtree` keeps that
		// subtree in the accessibility tree — hiding the canvas would
		// take the entire desktop out of it. The shell's own
		// `role="application"` + label remain the only ARIA that matters.
		// Pixi's HTMLSource sets `layoutsubtree` itself (autoLayout), but
		// setting it here means the attribute is already in place for the
		// very first layout pass rather than one frame later.
		canvas.setAttribute( 'layoutsubtree', '' );

		/*
		 * Mirror the shell's color-scheme attribute onto the canvas.
		 *
		 * The scheme's custom properties are scoped to
		 * `.desktop-mode-shell[data-desktop-mode-scheme=…]`
		 * (variables.css). A window promoted to a direct canvas child
		 * (`acquireLiveWindow`) leaves that subtree, and without this
		 * mirror its recorded image would repaint in the default
		 * scheme for the duration of the effect. `variables.css`
		 * matches the same attribute on `.desktop-mode-stage`.
		 */
		const mirrorScheme = (): void => {
			const scheme = this._shell.getAttribute(
				'data-desktop-mode-scheme',
			);
			if ( scheme === null ) {
				canvas.removeAttribute( 'data-desktop-mode-scheme' );
			} else {
				canvas.setAttribute( 'data-desktop-mode-scheme', scheme );
			}
		};
		mirrorScheme();
		this._schemeObserver = new MutationObserver( mirrorScheme );
		this._schemeObserver.observe( this._shell, {
			attributes: true,
			attributeFilter: [ 'data-desktop-mode-scheme' ],
		} );

		/*
		 * Geometry is set INLINE, not left to `stage.css`.
		 *
		 * The renderer measures `canvas.clientWidth` to size its backing
		 * store, so if the stylesheet has not reached the page — not
		 * enqueued, blocked, cached stale, overridden — the canvas keeps
		 * its intrinsic 300×150 and Pixi renders the whole desktop into
		 * a corner at the wrong scale. That is a silent, confusing
		 * failure for something this element cannot function without, so
		 * the layout that MUST be right lives with the code that creates
		 * the element. `stage.css` keeps only what genuinely belongs in
		 * a stylesheet (the fullscreen-window override).
		 */
		canvas.style.setProperty( 'position', 'fixed' );
		canvas.style.setProperty( 'inset-inline-start', '0' );
		canvas.style.setProperty( 'display', 'block' );
		canvas.style.setProperty( 'z-index', 'var(--desktop-mode-z-base, 100)' );

		parent.insertBefore( canvas, this._shell );
		canvas.appendChild( this._shell );

		// Same reasoning for the shell: inside the canvas it must fill
		// its new containing block, and it carries `position: fixed`
		// plus an admin-bar offset from `desktop.css` that the canvas has
		// now taken over. All of this is removed again in `_unwrap()`.
		this._shell.classList.add( STAGED_SHELL_CLASS );
		this._shell.style.setProperty( 'position', 'absolute' );
		this._shell.style.setProperty( 'inset', '0' );
		this._shell.style.setProperty( 'width', '100%' );
		this._shell.style.setProperty( 'height', '100%' );

		this._canvas = canvas;
		this._applyGeometry();

		window.addEventListener( 'resize', this._onViewportChange );
		// The admin bar is hidden when a window goes fullscreen, which
		// changes the canvas's top offset without firing a resize.
		// Only the fullscreen class changes the stage's box. Reacting to
		// EVERY body class change meant that minimising or maximising a
		// window — which touches body classes — scheduled a texture
		// rebuild in the middle of that window's own transition effect.
		let hadFullscreen = document.body.classList.contains(
			FULLSCREEN_BODY_CLASS,
		);
		this._bodyClassObserver = new MutationObserver( () => {
			const hasFullscreen = document.body.classList.contains(
				FULLSCREEN_BODY_CLASS,
			);
			if ( hasFullscreen === hadFullscreen ) {
				return;
			}
			hadFullscreen = hasFullscreen;
			this._onViewportChange();
		} );
		this._bodyClassObserver.observe( document.body, {
			attributes: true,
			attributeFilter: [ 'class' ],
		} );
	}

	/**
	 * Position and size the canvas in CSS pixels.
	 *
	 * **A `<canvas>` is a replaced element**, so `position: fixed` with
	 * `inset: 0` does NOT stretch it the way it would a `<div>` — for
	 * replaced elements `width: auto` resolves to the *intrinsic* size,
	 * which for a canvas is its `width`/`height` attributes (300×150 by
	 * default). The insets are then over-constrained and ignored. The
	 * only way to make a canvas fill a region is to give it explicit
	 * dimensions, which is what this does.
	 *
	 * Getting this wrong is silent: the desktop renders correctly but
	 * into a 300×150 box in the corner.
	 */
	private _applyGeometry(): void {
		const canvas = this._canvas;
		if ( ! canvas ) {
			return;
		}
		const { top, width, height } = viewportBox();
		canvas.style.setProperty( 'inset-block-start', `${ top }px` );
		canvas.style.setProperty( 'width', `${ width }px` );
		canvas.style.setProperty( 'height', `${ height }px` );
	}

	/** Move the shell back out and drop the canvas. Idempotent. */
	private _unwrap(): void {
		const canvas = this._canvas;
		this._canvas = null;
		if ( ! canvas ) {
			return;
		}

		this._shell.classList.remove( STAGED_SHELL_CLASS );
		this._shell.style.removeProperty( 'position' );
		this._shell.style.removeProperty( 'inset' );
		this._shell.style.removeProperty( 'width' );
		this._shell.style.removeProperty( 'height' );
		canvas.parentNode?.insertBefore( this._shell, canvas );
		canvas.remove();
	}

	// -----------------------------------------------------------------
	// Pixi lifecycle
	// -----------------------------------------------------------------

	private async _createApp( pixi: PixiNamespace ): Promise< void > {
		const canvas = this._canvas;
		if ( ! canvas ) {
			throw new Error( '[desktop-mode/stage] canvas missing.' );
		}

		const app = new pixi.Application();
		await app.init( {
			canvas,
			// Explicit, because Pixi's default is 800×600 and the canvas
			// is styled to fill the viewport. Without this the very first
			// frame renders the whole desktop into an 800×600 corner
			// before `_resize()` corrects it. Not using `resizeTo: window`
			// — the canvas is inset by the admin-bar height, so tracking
			// the window would leave the renderer taller than its display
			// area and vertically squash the desktop.
			width: viewportBox().width,
			height: viewportBox().height,
			// WebGL, not WebGPU: Pixi's HTML-in-Canvas upload path under
			// WebGL is `gl.texElementImage2D`, and our shaders ship GLSL
			// only. Pinning it also keeps the renderer choice from
			// drifting with Pixi's auto-detection.
			preference: 'webgl',
			antialias: false,
			// The desktop is opaque; a transparent stage would let the
			// classic admin page behind the shell show through.
			backgroundAlpha: 1,
			background: 0x000000,
			// We size the backing store ourselves in `_resize()` — the
			// canvas's display size comes from `stage.css`, and letting
			// Pixi write inline width/height styles would fight it.
			autoDensity: false,
			resolution: window.devicePixelRatio || 1,
			powerPreference: 'high-performance',
		} );

		this._app = app;

		// No ResizeObserver on the canvas: we set its dimensions
		// ourselves in `_applyGeometry()`, so observing it would feed our
		// own writes back in. The window `resize` listener and the
		// body-class observer installed in `_wrap()` cover every case
		// that actually changes the stage's box.
	}

	private _createSource( pixi: PixiNamespace ): void {
		const canvas = this._canvas;
		const app = this._app;
		if ( ! canvas || ! app ) {
			throw new Error( '[desktop-mode/stage] app missing.' );
		}

		// The shell must already be a direct child of this canvas —
		// HTMLSource throws otherwise, by design.
		// No `resolution` override. `HTMLSource` derives its size from
		// the element's `offsetWidth`/`offsetHeight`, which are CSS
		// pixels — the same space the renderer's coordinates live in
		// (the device pixel ratio is carried by the renderer's own
		// `resolution`, not by these numbers). Passing a resolution here
		// divides the logical size by the DPR, so the sprite's natural
		// size came out at half the screen on any Retina display. It
		// only looked correct at DPR 1.
		// `createStageSource` rather than `new pixi.HTMLSource` — same
		// class, plus a guard that drops the upload when the browser
		// reports that nothing on the canvas changed. See there.
		const source = createStageSource( pixi, {
			resource: this._shell,
			canvas,
			autoUpdate: true,
			autoRequestPaint: true,
		} ) as unknown as PixiHtmlSource;

		const sprite = pixi.Sprite.from( new pixi.Texture( { source } ) );
		sprite.x = 0;
		sprite.y = 0;
		app.stage.addChild( sprite );

		/*
		 * Overlay for window transition effects.
		 *
		 * Created ONCE and kept across source rebuilds. Destroying it on
		 * rebuild — which a resize triggers — tore down any in-flight
		 * effect sprite without telling its animation, and the next
		 * ticker frame then wrote to a destroyed object:
		 *
		 *   Cannot set properties of null (setting 'x')
		 *
		 * Re-adding it after the desktop sprite keeps it on top, which is
		 * all the rebuild actually needs.
		 */
		if ( ! this._overlay ) {
			this._overlay = new pixi.Container();
		}
		app.stage.addChild( this._overlay );

		this._source = source;
		this._sprite = sprite;
	}

	private _teardownPixi(): void {
		window.removeEventListener( 'error', this._onWindowError );
		window.removeEventListener( 'resize', this._onViewportChange );
		if ( this._resizeSettleTimer ) {
			clearTimeout( this._resizeSettleTimer );
			this._resizeSettleTimer = null;
		}
		this._bodyClassObserver?.disconnect();
		this._bodyClassObserver = null;
		this._schemeObserver?.disconnect();
		this._schemeObserver = null;

		this._app?.ticker.remove( this._tick );

		for ( const filter of this._filters.values() ) {
			try {
				filter.destroy();
			} catch {
				// See `setEffects` — a throwing destroy is not actionable.
			}
		}
		this._filters.clear();

		try {
			this._source?.destroy();
		} catch {
			// The source detaches its own paint listener in destroy(); if
			// that throws the canvas is going away regardless.
		}
		this._source = null;
		this._overlay = null;

		// Detach the sprite explicitly before the app goes. `destroy({
		// children: true })` below would take it too, but doing it here
		// keeps the order unambiguous: the sprite's texture wraps the
		// source we just destroyed, so it must not be rendered again.
		if ( this._sprite ) {
			try {
				this._app?.stage.removeChild( this._sprite );
				this._sprite.destroy();
			} catch {
				// Teardown of a sprite whose source is already gone can
				// throw; the whole application is going away regardless.
			}
			this._sprite = null;
		}

		// `removeView: false` — the canvas still holds the shell at this
		// point and is removed by `_unwrap()` once the shell is out. Never
		// pass a literal `true` here: that releases Pixi's page-global
		// resource pools out from under every other live Application
		// (canvas wallpapers, games, the About scene).
		this._app?.destroy( { removeView: false }, { children: true } );
		this._app = null;
	}
}

/**
 * The region the stage should cover, in CSS pixels: the viewport below
 * the admin bar.
 *
 * Reads the admin bar's live height rather than the
 * `--wp-admin--admin-bar--height` custom property, so the
 * fullscreen-window case (where the bar is hidden with
 * `display: none`) needs no special handling — a hidden bar measures
 * zero and the stage reclaims the strip automatically.
 */
function viewportBox(): { top: number; width: number; height: number } {
	const bar = document.getElementById( 'wpadminbar' );
	const top = bar ? bar.offsetHeight : 0;
	return {
		top,
		width: window.innerWidth,
		height: Math.max( 0, window.innerHeight - top ),
	};
}

function readPixi(): PixiNamespace | null {
	return (
		( window as unknown as { PIXI?: PixiNamespace } ).PIXI ?? null
	);
}

function reportEffectError(
	id: string,
	phase: string,
	err: unknown,
): void {
	if ( typeof console !== 'undefined' ) {
		console.error(
			`[desktop-mode/stage] screen effect "${ id }" threw in ${ phase }:`,
			err,
		);
	}
	doAction( HOOKS.SHELL_ERROR, {
		scope: 'screen-effect',
		effectId: id,
		phase,
		error: err,
	} );
}
