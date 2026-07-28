/**
 * Desktop Mode — promoting a window to a direct child of the stage
 * canvas, and sending it home again.
 *
 * The HTML-in-Canvas API will only draw an element that is a **direct
 * child** of the `<canvas layoutsubtree>` ("The element must be a
 * direct child of the canvas in the most recent rendering update").
 * Windows normally live inside `#desktop-mode-area`, nested two levels
 * down in the shell — so to give one window its own live texture, the
 * element has to move.
 *
 * Moving DOM nodes the ordinary way (`appendChild` = remove + insert)
 * reloads every `<iframe>` in the subtree, which is the reason the
 * whole stage is built around never re-parenting windows. What makes
 * promotion viable is `Node.moveBefore()` — the atomic,
 * state-preserving move that keeps iframe documents, focus, selection
 * and running CSS animations intact. Every browser with HTML-in-Canvas
 * has it (`moveBefore` shipped in Chromium 133; the canvas API needs
 * 147+), but both are feature-checked and callers must handle `null`.
 *
 * **Geometry: the element's CSS position stops meaning anything.** A
 * `layoutsubtree` child is laid out at the canvas origin — the window's
 * inline `left`/`top`, which the window manager keeps writing all
 * through a drag, no longer move it. What DOES still move it is
 * `transform`: the explainer is explicit that transforms on a canvas
 * child are ignored for drawing but "continue to affect hit testing/
 * accessibility", and its own sync pattern (`getElementTransform` →
 * `element.style.transform`) exists precisely because layout position
 * and drawn position are decoupled. So the promotion runs a per-frame
 * sync that mirrors "where the window manager thinks the window is"
 * (area origin + inline `left`/`top`) into a translate, measured
 * against where layout actually put the element — self-calibrating, so
 * it stays correct whether the engine lays the child out at the origin
 * or honours its insets. Inline `transition: none` for the duration,
 * because the base window CSS transitions `transform` over 0.2s and a
 * mirrored value that lags its own measurement oscillates.
 *
 * @since 0.9.8
 */

/** A promoted window, ready to be sent home. */
export interface PromotedWindow {
	/**
	 * Move the element back to its original parent and restore its
	 * inline transform/transition. Idempotent, and safe when the
	 * original slot is gone — the element is appended at the end of
	 * its old parent instead.
	 */
	demote(): void;
	/** Whether {@link demote} has run. */
	readonly demoted: boolean;
}

/** The slice of `Node` this module feature-checks. */
interface MovableParent extends HTMLElement {
	moveBefore?( node: Node, child: Node | null ): void;
}

/**
 * Whether `element` can be promoted into `canvas` and back.
 *
 * @param element A window element.
 * @param canvas  The stage canvas.
 * @return `true` when both moves are possible.
 */
export function canPromoteWindow(
	element: HTMLElement,
	canvas: HTMLCanvasElement,
): boolean {
	const parent = element.parentElement as MovableParent | null;
	return (
		!! parent &&
		parent !== ( canvas as HTMLElement ) &&
		typeof ( canvas as MovableParent ).moveBefore === 'function' &&
		typeof parent.moveBefore === 'function' &&
		// A fullscreen window is `position: fixed` — a compensating
		// transform would both shift it and turn it into a containing
		// block for its own fixed descendants. Not worth it for a
		// state the user is about to leave anyway.
		! element.classList.contains( 'desktop-mode-window--fullscreen' ) &&
		// The promotion OWNS the inline transform while it lasts (see
		// the sync loop). A window that already carries one — a
		// desktop-switch scale, an overview tile — would be fighting
		// it; the frozen fallback handles those rare moments fine.
		! element.style.transform
	);
}

/**
 * Move a window element into the canvas, keeping its on-screen
 * geometry and hit-testing where the window manager believes it is.
 *
 * @param element A window element currently inside the shell.
 * @param canvas  The stage canvas that should become its parent.
 * @return The promotion, or `null` when the move is not possible.
 */
export function promoteWindow(
	element: HTMLElement,
	canvas: HTMLCanvasElement,
): PromotedWindow | null {
	if ( ! canPromoteWindow( element, canvas ) ) {
		return null;
	}
	const parent = element.parentElement as MovableParent;

	const nextSibling = element.nextSibling;
	const previousTransition = element.style.transition;

	try {
		( canvas as MovableParent ).moveBefore!( element, null );
	} catch {
		// An element mid-removal, a detached canvas — nothing moved,
		// so there is nothing to undo.
		return null;
	}

	// Instant transform writes for the whole promotion — the sync
	// below runs every frame and measures its own output.
	element.style.transition = 'none';

	let demoted = false;
	let appliedX = 0;
	let appliedY = 0;
	let frame = 0;

	/**
	 * One step of the geometry mirror.
	 *
	 * `base` is where LAYOUT put the element (its current rect minus
	 * the translate already applied); `desired` is where the window
	 * manager's numbers say it belongs (area origin + inline
	 * `left`/`top`). The difference is the translate. Measuring `base`
	 * fresh each frame is what makes this model-independent: if the
	 * engine lays the child out at the canvas origin, `base` is the
	 * origin; if it honours the insets, `base` tracks them, and the
	 * translate converges to plain dock-offset compensation.
	 */
	const sync = (): void => {
		const rect = element.getBoundingClientRect();
		const hostRect = parent.getBoundingClientRect();
		const left = parseFloat( element.style.left );
		const top = parseFloat( element.style.top );
		const tx =
			hostRect.left +
			( Number.isFinite( left ) ? left : 0 ) -
			( rect.left - appliedX );
		const ty =
			hostRect.top +
			( Number.isFinite( top ) ? top : 0 ) -
			( rect.top - appliedY );
		if ( tx !== appliedX || ty !== appliedY ) {
			appliedX = tx;
			appliedY = ty;
			element.style.transform = `translate(${ tx }px, ${ ty }px)`;
		}
	};

	const loop = (): void => {
		sync();
		frame = requestAnimationFrame( loop );
	};
	// First sync runs synchronously, before the browser can paint the
	// canvas with the element at its layout position.
	sync();
	frame = requestAnimationFrame( loop );

	return {
		get demoted() {
			return demoted;
		},
		demote() {
			if ( demoted ) {
				return;
			}
			demoted = true;
			cancelAnimationFrame( frame );
			try {
				parent.moveBefore!(
					element,
					nextSibling && nextSibling.parentNode === parent
						? nextSibling
						: null,
				);
			} catch {
				// The old parent left the document (a stage teardown
				// mid-effect). Better a plain append — losing sibling
				// order, which windows do not rely on — than a window
				// stranded inside a canvas that is about to be removed.
				try {
					parent.appendChild( element );
				} catch {
					// Both failed: the parent is truly gone. Leave the
					// element where it is; the caller's teardown owns it.
				}
			}
			// `canPromoteWindow` guaranteed the inline transform was
			// empty, so clearing is restoring — but it MUST be
			// committed before transitions come back. The base window
			// CSS transitions `transform` over 0.2s, and if the clear
			// and the transition restore land in the same style recalc,
			// the browser animates the mirror's last translate away IN
			// THE NEW containing block: the window renders displaced by
			// the whole mirror offset and slides home over 200 ms — a
			// second, phantom reposition right after the drop. Reading
			// a layout property flushes the cleared transform while
			// transitions are still off; the value is unused, the read
			// is the work.
			element.style.transform = '';
			void element.offsetHeight;
			element.style.transition = previousTransition;
		},
	};
}
