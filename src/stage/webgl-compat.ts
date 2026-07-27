/**
 * Desktop Mode — `texElementImage2D` signature shim.
 *
 * The HTML-in-Canvas WebGL entry point changed shape while the proposal
 * was being finalised, and PixiJS 8.19.0 still calls the older form:
 *
 * ```
 * legacy  gl.texElementImage2D( target, level, internalformat, format, type, source )   // 6 args
 * final   gl.texElementImage2D( target, internalformat, source )                        // 3 args
 * ```
 *
 * Chromium 150+ implements the finalised 3-argument signature strictly.
 * Given the legacy call it performs WebIDL conversion on argument 3 —
 * `gl.RGBA`, a number — against the `(Element or ElementImage)` union
 * and throws:
 *
 * > Failed to execute 'texElementImage2D' on 'WebGL2RenderingContext':
 * > The provided value is not of type '(Element or ElementImage)'.
 *
 * Because PixiJS uploads from inside the browser's `paint` event, that
 * throw is uncatchable from our side and repeats every frame, leaving a
 * blank desktop and a console full of errors.
 *
 * So we translate. This is the same shim Chrome's own PixiJS demo ships
 * (chrome.dev/html-in-canvas/demos/pixijs-demo.html) — patching the
 * prototype is the only seam available, since the offending call is
 * inside vendored library code.
 *
 * Two safeguards make this narrow:
 *
 * - It only installs when `texElementImage2D.length === 3`, i.e. when
 *   the browser actually has the new signature. On a browser with the
 *   legacy signature — or none at all — it does nothing.
 * - It only rewrites calls that arrive with the legacy argument count.
 *   Native 3-argument callers pass straight through, so any other code
 *   on the page (including a future PixiJS that has been fixed) is
 *   unaffected.
 *
 * **Remove this when PixiJS ships the 3-argument call.** Track
 * `glUploadHTMLResource` in `pixi.js/html-source`; once it passes
 * `( target, internalformat, source )`, this module can go and the
 * `installTexElementImage2DShim()` call in `stage.ts` with it.
 *
 * @since 0.9.8
 */

type GlProto = Record< string, unknown > & {
	texElementImage2D?: ( ( ...args: unknown[] ) => unknown ) & {
		/** Set by us so a second install is a no-op. */
		__desktopModeShimmed?: boolean;
	};
	RGBA?: number;
	RGBA8?: number;
};

/** Whether the shim has been installed on at least one prototype. */
let installed = false;

/**
 * Install the legacy→final argument translation on both WebGL context
 * prototypes, if this browser needs it. Idempotent.
 *
 * @return `true` when a shim is in place (or was already), `false` when
 *         the browser did not need one.
 */
export function installTexElementImage2DShim(): boolean {
	if ( installed ) {
		return true;
	}
	if ( typeof window === 'undefined' ) {
		return false;
	}

	let patchedAny = false;

	for ( const name of [ 'WebGL2RenderingContext', 'WebGLRenderingContext' ] ) {
		const ctor = ( window as unknown as Record< string, unknown > )[ name ] as
			| { prototype?: GlProto }
			| undefined;
		const proto = ctor?.prototype;
		const original = proto?.texElementImage2D;

		if ( ! proto || typeof original !== 'function' ) {
			continue;
		}
		if ( original.__desktopModeShimmed ) {
			patchedAny = true;
			continue;
		}
		// Arity is the signal: 3 means the finalised signature, anything
		// else means this browser still wants what PixiJS already sends.
		if ( original.length !== 3 ) {
			continue;
		}

		const shim = function shimmedTexElementImage2D(
			this: GlProto,
			target: unknown,
			...args: unknown[]
		): unknown {
			if ( args.length > 2 ) {
				// Legacy: ( target, level, internalformat, format, type, source )
				const internalFormat = args[ 1 ];
				const source = args[ 4 ];

				// The finalised signature wants a SIZED internal format;
				// PixiJS sends unsized `RGBA`, which the new entry point
				// rejects. `RGBA8` is its sized equivalent.
				const sizedFormat =
					internalFormat === this.RGBA && this.RGBA8 !== undefined
						? this.RGBA8
						: internalFormat;

				return original.call( this, target, sizedFormat, source );
			}
			// Already the finalised shape — pass through untouched.
			return original.apply( this, [ target, ...args ] );
		} as GlProto[ 'texElementImage2D' ] & { __desktopModeShimmed?: boolean };

		( shim as { __desktopModeShimmed?: boolean } ).__desktopModeShimmed = true;
		proto.texElementImage2D = shim;
		patchedAny = true;
	}

	installed = patchedAny;
	return patchedAny;
}

/**
 * Whether this browser exposes the finalised 3-argument signature, and
 * therefore needs the shim. Reported through
 * `wp.desktop.stage.supportDetail()` so a future signature change is
 * diagnosable from the console rather than from a stack trace.
 */
export function needsTexElementImage2DShim(): boolean {
	if ( typeof window === 'undefined' ) {
		return false;
	}
	for ( const name of [ 'WebGL2RenderingContext', 'WebGLRenderingContext' ] ) {
		const ctor = ( window as unknown as Record< string, unknown > )[ name ] as
			| { prototype?: GlProto }
			| undefined;
		const fn = ctor?.prototype?.texElementImage2D;
		if ( typeof fn === 'function' ) {
			return fn.__desktopModeShimmed === true || fn.length === 3;
		}
	}
	return false;
}
