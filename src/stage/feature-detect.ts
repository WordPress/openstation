/**
 * Desktop Mode — HTML-in-Canvas feature detection.
 *
 * The canvas stage is built on the WICG HTML-in-Canvas proposal
 * (https://github.com/WICG/html-in-canvas), which at the time of
 * writing ships in Chrome 148+ behind an origin trial, or in any
 * Chromium build with `chrome://flags/#canvas-draw-element` enabled.
 * Everywhere else the API is simply absent.
 *
 * There is deliberately no fallback: without the API the shell renders
 * as plain DOM exactly as it always has, and OS Settings disables the
 * toggle with an explanatory notice rather than pretending.
 *
 * **Detect only what we actually use.** An earlier version of this file
 * also required the 2D `drawElementImage`, on the theory that the flag
 * lands the whole proposal at once. It does not necessarily, and the
 * stage never calls it — PixiJS uploads through the WebGL path. A check
 * for an unused capability is a false negative waiting to happen, so
 * the gate is now exactly the two things the renderer depends on.
 *
 * This module is imported by the main shell bundle (to gate boot) and
 * by the OS Settings panel bundle (to gate the toggle), so it must stay
 * dependency-free and side-effect-free.
 *
 * @since 0.9.8
 */

import {
	installTexElementImage2DShim,
	needsTexElementImage2DShim,
} from './webgl-compat';

/**
 * Per-capability breakdown, for diagnosing "why is the toggle
 * disabled?" without guessing. Surfaced as
 * `wp.desktop.stage.supportDetail()`.
 */
export interface StageSupportDetail {
	/** `canvas.requestPaint()` — how Pixi asks for a fresh snapshot. */
	requestPaint: boolean;
	/** The WebGL upload path Pixi's `HTMLSource` calls. */
	texElementImage2D: boolean;
	/** Which context prototype carried it, for the record. */
	texElementImage2DOn: string | null;
	/**
	 * The 2D half of the proposal. **Not required** by the stage —
	 * reported only because its presence or absence is a useful signal
	 * about how completely the browser has shipped the feature.
	 */
	drawElementImage: boolean;
	/** `<canvas layoutsubtree>` reflected as an IDL attribute. */
	layoutSubtree: boolean;
	/**
	 * Whether this browser exposes the finalised 3-argument
	 * `texElementImage2D` and therefore needs our argument shim (see
	 * `webgl-compat.ts`). PixiJS 8.19 still calls the 6-argument form.
	 */
	needsUploadShim: boolean;
}

type Proto = Record< string, unknown > | undefined;

function protoOf( name: string ): Proto {
	const ctor = ( window as unknown as Record< string, unknown > )[ name ] as
		| { prototype?: Record< string, unknown > }
		| undefined;
	return ctor?.prototype;
}

/**
 * A throwaway canvas + WebGL context used only for instance-level
 * probing, created lazily and reused. Prototype checks are the cheap
 * path, but they are not authoritative: an engine is free to install
 * these members on the instance, or on an interface we did not guess,
 * and a prototype-only check would then report "unsupported" on a
 * browser where the feature works perfectly. Probing a real object is
 * the ground truth.
 *
 * Deliberately not attached to the document — an orphaned canvas is
 * enough to read the shape of its API.
 */
let probeCanvas: HTMLCanvasElement | null = null;
let probeGl: unknown;
let probedGl = false;

function canvasProbe(): HTMLCanvasElement | null {
	if ( ! probeCanvas && typeof document !== 'undefined' ) {
		try {
			probeCanvas = document.createElement( 'canvas' );
		} catch {
			probeCanvas = null;
		}
	}
	return probeCanvas;
}

function glProbe(): Record< string, unknown > | null {
	if ( probedGl ) {
		return ( probeGl as Record< string, unknown > ) ?? null;
	}
	probedGl = true;
	const canvas = canvasProbe();
	if ( ! canvas ) {
		return null;
	}
	try {
		// A real context is the only way to see what the engine actually
		// exposes. `failIfMajorPerformanceCaveat` is left off on purpose:
		// we are inspecting the API surface, not committing to render.
		probeGl =
			canvas.getContext( 'webgl2' ) ?? canvas.getContext( 'webgl' );
	} catch {
		probeGl = null;
	}
	return ( probeGl as Record< string, unknown > ) ?? null;
}

/** Is `key` a callable on the prototype, or failing that, on `instance`? */
function hasMethod(
	proto: Proto,
	instance: Record< string, unknown > | null,
	key: string,
): boolean {
	if ( proto && typeof proto[ key ] === 'function' ) {
		return true;
	}
	return !! instance && typeof instance[ key ] === 'function';
}

/**
 * Inspect each capability separately.
 *
 * @return Which pieces of the API this browser exposes.
 */
export function stageSupportDetail(): StageSupportDetail {
	if ( typeof window === 'undefined' ) {
		return {
			requestPaint: false,
			texElementImage2D: false,
			texElementImage2DOn: null,
			drawElementImage: false,
			layoutSubtree: false,
			needsUploadShim: false,
		};
	}

	const canvasProto = protoOf( 'HTMLCanvasElement' );
	const canvasEl = canvasProbe() as unknown as Record<
		string,
		unknown
	> | null;

	// Chromium installs `WebGLRenderingContextBase` members on both
	// context prototypes, but which one is present at all depends on
	// the build — and a WebGL2-only rollout is entirely plausible. Ask
	// both, then fall back to a live context.
	let texElementImage2DOn: string | null = null;
	for ( const name of [ 'WebGL2RenderingContext', 'WebGLRenderingContext' ] ) {
		const proto = protoOf( name );
		if ( proto && typeof proto.texElementImage2D === 'function' ) {
			texElementImage2DOn = name;
			break;
		}
	}
	if ( ! texElementImage2DOn ) {
		const gl = glProbe();
		if ( gl && typeof gl.texElementImage2D === 'function' ) {
			texElementImage2DOn = 'instance';
		}
	}

	// Prototype-only, deliberately: this capability does not gate the
	// stage, so it is not worth spinning up a 2D context to confirm.
	const ctx2dProto = protoOf( 'CanvasRenderingContext2D' );
	const drawElementImage =
		!! ctx2dProto && typeof ctx2dProto.drawElementImage === 'function';

	return {
		requestPaint: hasMethod( canvasProto, canvasEl, 'requestPaint' ),
		texElementImage2D: texElementImage2DOn !== null,
		texElementImage2DOn,
		drawElementImage,
		layoutSubtree:
			( !! canvasProto && 'layoutSubtree' in canvasProto ) ||
			( !! canvasEl && 'layoutSubtree' in canvasEl ),
		needsUploadShim: needsTexElementImage2DShim(),
	};
}

/**
 * Whether this browser can host the canvas stage.
 *
 * Gated on **exactly one** primitive: `gl.texElementImage2D()`. That is
 * not a guess — it is the only call in PixiJS's `glUploadHTMLResource`
 * that throws when the API is absent, and it throws on the first
 * rendered frame, i.e. after the shell has already been moved into the
 * canvas. Everything else in the proposal degrades quietly:
 *
 * - `canvas.requestPaint()` is **optional** to PixiJS itself
 *   (`HTMLSource` does `this._isReady = !this._autoUpdate ||
 *   !canvas.requestPaint`, and its own `requestPaint()` returns `false`
 *   rather than throwing when the browser lacks it). Requiring it here
 *   was stricter than the library we render through, and produced a
 *   false "unsupported" on a Canary where the feature works.
 * - `ctx2d.drawElementImage()` is never called by the stage at all.
 *
 * Both are still reported by {@link stageSupportDetail} — they are
 * useful signals, just not gates.
 *
 * @return `true` when the stage can start.
 */
export function isStageSupported(): boolean {
	return stageSupportDetail().texElementImage2D;
}

/**
 * Result of actually attempting an element upload, as opposed to
 * sniffing for a method name.
 */
export interface StageUploadProbe {
	ok: boolean;
	/** Whether the legacy→final argument shim was in force for this probe. */
	shimmed?: boolean;
	/** The thrown message when `ok` is false. */
	error?: string;
	/** Declared arity of `texElementImage2D`, useful when the call fails. */
	arity?: number;
	/**
	 * A non-fatal message from the probe — the call shape was accepted
	 * but the browser declined this particular upload, almost always
	 * because the throwaway element has not been painted yet.
	 */
	note?: string;
}

/**
 * Actually perform one `texElementImage2D()` upload on a throwaway
 * canvas and report whether it worked.
 *
 * **Why this exists.** `isStageSupported()` only proves the *method
 * exists*. This is an experimental API on a moving spec, and a browser
 * can ship a `texElementImage2D` whose signature does not match the one
 * PixiJS's uploader was written against. When that happens the call
 * throws on every uploaded frame — from inside the browser's own paint
 * event, where the stage cannot catch it — and the user is left with a
 * blank desktop spewing errors, because the shell has already been
 * moved inside a canvas that never receives pixels.
 *
 * So the stage proves the upload works *before* it touches the shell.
 * A probe is cheap and runs once; a bricked desktop is not.
 *
 * Mirrors PixiJS's `glUploadHTMLResource` call shape exactly — if that
 * shape is wrong for this browser, we want to find out here.
 */
let cachedProbe: StageUploadProbe | null = null;

export function probeElementUpload(): StageUploadProbe {
	// The answer cannot change within a page session, and the probe
	// spins up a WebGL context — memoize it.
	if ( cachedProbe ) {
		return cachedProbe;
	}
	cachedProbe = runProbe();
	return cachedProbe;
}

function runProbe(): StageUploadProbe {
	if ( typeof document === 'undefined' ) {
		return { ok: false, error: 'no document' };
	}

	let canvas: HTMLCanvasElement | null = null;
	let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
	let texture: WebGLTexture | null = null;
	let shimmed = false;

	try {
		// Chromium 150+ finalised `texElementImage2D` to a 3-argument
		// signature; PixiJS 8.19 still calls the 6-argument one. Install
		// the translation BEFORE probing, so the probe measures the call
		// shape the stage will actually make.
		shimmed = installTexElementImage2DShim();

		canvas = document.createElement( 'canvas' );
		canvas.width = 4;
		canvas.height = 4;
		// `layoutsubtree` is what makes the child eligible to be drawn;
		// without it the upload would fail for reasons unrelated to the
		// signature we are testing. Kept out of the viewport rather than
		// unattached — the child must lay out to be uploadable.
		canvas.setAttribute( 'layoutsubtree', '' );
		canvas.setAttribute( 'aria-hidden', 'true' );
		canvas.style.cssText =
			'position:fixed;inset-block-start:0;inset-inline-start:-9999px;width:4px;height:4px;pointer-events:none;';

		const child = document.createElement( 'div' );
		child.style.cssText = 'width:4px;height:4px;';
		canvas.appendChild( child );
		document.body.appendChild( canvas );

		gl =
			( canvas.getContext( 'webgl2' ) as WebGL2RenderingContext | null ) ??
			( canvas.getContext( 'webgl' ) as WebGLRenderingContext | null );
		if ( ! gl ) {
			return { ok: false, error: 'no WebGL context' };
		}

		const upload = ( gl as unknown as Record< string, unknown > )
			.texElementImage2D as
			| ( ( ...args: unknown[] ) => void )
			| undefined;
		if ( typeof upload !== 'function' ) {
			return { ok: false, error: 'texElementImage2D is not a function' };
		}

		texture = gl.createTexture();
		gl.bindTexture( gl.TEXTURE_2D, texture );

		upload.call(
			gl,
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			child,
		);

		return { ok: true, arity: upload.length, shimmed };
	} catch ( err ) {
		const upload = ( gl as unknown as Record< string, unknown > | null )
			?.texElementImage2D as { length?: number } | undefined;
		const message = err instanceof Error ? err.message : String( err );
		const arity =
			typeof upload?.length === 'number' ? upload.length : undefined;

		/*
		 * Distinguish "this browser rejects our call shape" from "this
		 * particular upload could not happen right now".
		 *
		 * Only the former means unsupported. A WebIDL conversion failure
		 * — a `TypeError`, e.g. "The provided value is not of type
		 * '(Element or ElementImage)'" — means the arguments are wrong
		 * and every frame would throw.
		 *
		 * Anything else means the arguments were ACCEPTED and the
		 * operation itself declined. The common one is "No cached paint
		 * record for element": the spec requires an element to have been
		 * painted at least once before it can be uploaded, and this
		 * probe calls synchronously, before any rendering update. That
		 * is a property of the probe, not of the browser — the real
		 * stage never hits it, because PixiJS's uploader allocates,
		 * calls `requestPaint()` and returns early until the source
		 * reports ready. Treating it as failure would disable the
		 * feature on browsers where it works perfectly.
		 */
		const isSignatureFailure =
			err instanceof TypeError || /not of type|not a function/i.test( message );

		if ( isSignatureFailure ) {
			return { ok: false, shimmed, error: message, arity };
		}
		return { ok: true, shimmed, arity, note: message };
	} finally {
		try {
			if ( gl && texture ) {
				gl.deleteTexture( texture );
			}
			canvas?.remove();
		} catch {
			// Cleanup of a throwaway probe is not worth reporting.
		}
	}
}
