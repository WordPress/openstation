/**
 * Desktop Mode — Window-reveal types.
 *
 * A "window reveal" is the transition that uncovers a window's content
 * once it has finished loading. The shell paints an opaque surface over
 * the window body while the content boots (the same span the
 * `<wpd-spinner>` overlay covers), then animates that surface's
 * `clip-path` away — so the page appears to be wiped, irised, or
 * shuttered into view.
 *
 * The surface lives in the SHELL's DOM, as a sibling of the `<iframe>`
 * inside `.desktop-mode-window__body`. Nothing is ever injected into
 * the framed document, and the iframe itself is never clipped: a reveal
 * cannot interfere with the page it is revealing, and a plugin's native
 * window content is equally untouched.
 *
 * A def is deliberately tiny — two `clip-path` values and a duration.
 * The engine owns *when* a reveal plays; the def owns *what shape* it
 * plays.
 *
 * ## The interpolation contract
 *
 * CSS only interpolates a `clip-path` between two values that use the
 * SAME shape function, and — for `polygon()` — the same vertex count
 * and fill rule. `from` and `to` are therefore a matched pair, not two
 * independent values: `registerWindowReveal` rejects a def whose
 * endpoints use different functions, because the browser's fallback
 * for a non-interpolable pair is a hard jump at the halfway mark,
 * which reads as a flicker rather than an animation.
 *
 * Helpers in `./shapes` build matched pairs for the common cases.
 */

export interface WindowRevealDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/` — lower-case alphanum plus
	 * hyphen, underscore, and slash so plugins can namespace
	 * `vendor/sub-id`, the same convention every other JS registry uses
	 * (`registerCommand`, `registerUnfocusEffect`, …).
	 */
	id: string;
	/** Human-readable label shown in the OS Settings selector. */
	label: string;
	/** Optional one-line description shown under the selector. */
	description?: string;
	/**
	 * `clip-path` value for the covering surface at the START of the
	 * reveal. Must describe a shape that covers the whole window body —
	 * anything it leaves uncovered shows the content early.
	 */
	from: string;
	/**
	 * `clip-path` value at the END of the reveal. Must describe an
	 * empty (or fully off-box) shape, so the content is completely
	 * uncovered when the animation lands.
	 *
	 * Must use the same shape function as {@link from} — see the
	 * interpolation contract above.
	 */
	to: string;
	/**
	 * Animation duration in ms. Defaults to
	 * `DEFAULT_REVEAL_DURATION_MS`. Values outside 80–4000 ms are
	 * clamped by the engine: a reveal is an accent on a page load, and
	 * one that outlasts the load it is decorating stops reading as
	 * polish.
	 */
	duration?: number;
	/** CSS easing. Defaults to `DEFAULT_REVEAL_EASING`. */
	easing?: string;
	/**
	 * Paint for the covering surface, overriding the
	 * `--desktop-mode-window-reveal-surface` theme token. Any CSS
	 * `background` value — a colour, a gradient, an image.
	 *
	 * Almost no reveal should set this. The token is the site's to
	 * choose — a reveal is normally a *shape*, and a def that hard-codes
	 * paint takes the colour decision away from every theme it will
	 * ever run under.
	 *
	 * The one shipped exception is `obturator`, whose whole identity is
	 * a camera shutter's near-black blades — it would not be that
	 * reveal in another colour. Reach for this only when the paint IS
	 * the reveal.
	 */
	surfaceColor?: string;
	/**
	 * How far, in ms, the reveal's leading EDGE trails the surface
	 * itself. Defaults to `DEFAULT_REVEAL_EDGE_LAG_MS`; `0` disables
	 * the edge entirely. Clamped to 0–600.
	 *
	 * The edge is a second layer painted in
	 * `--desktop-mode-window-reveal-edge` that sits BEHIND the surface
	 * and runs the very same `from` → `to` keyframes, just over a
	 * slightly longer duration. Being always a little less far along,
	 * it peeks out beyond the surface as a band hugging the clip
	 * boundary — and because it is the same shape, every reveal gets a
	 * correctly-shaped edge for free: six thin lines on `blinds`, an
	 * opening ring on `iris`, a rotating spoke on `radar`, without any
	 * of them describing an edge shape.
	 *
	 * The band's thickness scales with how fast that part of the shape
	 * is moving, which is why it reads as a fine line on a reveal whose
	 * pieces each travel a short distance and as a broad band on one
	 * that crosses the whole window.
	 *
	 * **The edge is off unless a theme turns it on.** The colour token
	 * ships as `transparent`, and while it computes that way the shell
	 * drops the layer rather than animating something invisible. A
	 * theme that gives the token a colour also gets
	 * `--desktop-mode-window-reveal-edge-thickness`, which overrides
	 * this field outright — thickness is a property of the theme's
	 * look, not of any one reveal.
	 */
	edgeLag?: number;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * reveal. Set this when plugin deactivation should live-unregister
	 * the reveal (mirrors commands / settings tabs / unfocus effects).
	 * Reveals without an owner survive until the next reload.
	 */
	owner?: string;
}
