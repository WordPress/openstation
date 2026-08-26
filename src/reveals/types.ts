/**
 * OpenStation — Window-reveal types.
 *
 * A "window reveal" is the transition that uncovers a window's content
 * once it has finished loading. The shell paints an opaque surface over
 * the window body while the content boots (the same span the
 * `<os-spinner>` overlay covers), then animates that surface's
 * `clip-path` away — so the page appears to be wiped, irised, or
 * shuttered into view.
 *
 * The surface lives in the SHELL's DOM, as a sibling of the `<iframe>`
 * inside `.os-window__body`. Nothing is ever injected into
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

/**
 * One animated layer of a reveal — a matched `clip-path` pair, same
 * contract as a single-layer def's own `from` / `to`.
 */
export interface WindowRevealLayer {
	/** `clip-path` while this layer still covers its share of the body. */
	from: string;
	/** `clip-path` once it has retracted. Same shape function as `from`. */
	to: string;
	/**
	 * Paint for THIS layer, overriding the reveal's `surfaceColor` and
	 * the theme token.
	 *
	 * The thing that makes overlapping parts visible at all. Layers of
	 * one colour composite into a single silhouette however they are
	 * shaped — the part on top is indistinguishable from the part
	 * beneath it, so the overlap that makes a mechanism a mechanism
	 * simply does not render. Give neighbouring layers different tones
	 * and every overlap draws itself: the upper layer's tone wins, and
	 * its boundary across the lower one is the seam.
	 *
	 * `obturator` shades its six leaves as if lit from above, which is
	 * why you can see one lying across the next.
	 */
	color?: string;
}

/** Timing handed to a custom renderer when its reveal plays. */
export interface WindowRevealRenderContext {
	/** How long the reveal runs, in ms. Already resolved and clamped. */
	duration: number;
	/** CSS easing to use. */
	easing: string;
	/** ms to wait before starting, so the spinner's fade can settle. */
	delay: number;
}

/** What a custom renderer hands back to the shell. */
export interface WindowRevealRendered {
	/**
	 * The covering element. Appended into the window body as the
	 * reveal's single layer, and removed when the reveal finishes.
	 */
	element: HTMLElement;
	/**
	 * Start the animation. Return every `Animation` driving it — the
	 * shell hangs teardown off the longest-running one and cancels
	 * them all if the window reloads mid-reveal.
	 */
	play: ( ctx: WindowRevealRenderContext ) => Animation[];
}

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
	 *
	 * Required unless the def supplies {@link layers} instead.
	 */
	from?: string;
	/**
	 * `clip-path` value at the END of the reveal. Must describe an
	 * empty (or fully off-box) shape, so the content is completely
	 * uncovered when the animation lands.
	 *
	 * Must use the same shape function as {@link from} — see the
	 * interpolation contract above.
	 *
	 * Required unless the def supplies {@link layers} instead.
	 */
	to?: string;
	/**
	 * Several independent covering layers instead of one, each with its
	 * own matched pair. Supply this OR `from` / `to`, never both.
	 *
	 * Use it when the effect depends on pieces **overlapping** each
	 * other, which a single shape cannot express: one `clip-path` is
	 * one region, so anything it leaves uncovered is uncovered, full
	 * stop. With layers, what the user sees uncovered is whatever ALL
	 * of them leave uncovered — an intersection rather than a shape.
	 *
	 * That is exactly what a camera iris is, and why `obturator` uses
	 * this: six blades, each covering the half-plane beyond its own
	 * inner edge, leaving a hexagonal aperture between them that grows
	 * as they retract and slide across one another. Drawn as one hole
	 * in one surface it would be a growing hexagon, with no blades and
	 * nothing overlapping.
	 *
	 * Every layer animates over the same duration and easing, and each
	 * gets its own trailing edge — so a mechanism's parts stay visibly
	 * separate rather than fusing into one silhouette.
	 */
	layers?: WindowRevealLayer[];
	/**
	 * Build the covering DOM yourself, instead of describing it as
	 * `clip-path` layers. Supply this OR `from`/`to` OR `layers`.
	 *
	 * The escape hatch for effects a stack of clipped boxes cannot
	 * express. The case that forced it: a camera iris has a **cyclic**
	 * overlap — every leaf over the next, the last back under the
	 * first — and paint order is a line, so no stack of layers can
	 * represent it. Rendered as SVG the problem disappears, because
	 * the leaves are paths under one mask rather than boxes in a
	 * z-order, and the animation reduces to a rotation per leaf.
	 *
	 * You still get the shell's timing for free: when the reveal plays,
	 * how long it runs, the user's speed override, the spinner
	 * hand-off, reduced-motion, and teardown. What you own is the DOM
	 * and the animations over it.
	 *
	 * Called once per window load, so keep it cheap and stateless.
	 */
	render?: () => WindowRevealRendered;
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
	 * `--os-window-reveal-surface` theme token. Any CSS
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
	 * Paint for the trailing edge, overriding the
	 * `--os-window-reveal-edge` theme token.
	 *
	 * Same warning as {@link surfaceColor}, with one extra use: a
	 * multi-layer reveal usually wants an edge DARKER than its own
	 * surface, because that dark sliver along each layer's inner border
	 * is the only thing separating one overlapping part from the next.
	 * `obturator` sets both for that reason — without it, six
	 * same-coloured blades read as a single mass.
	 */
	edgeColor?: string;
	/**
	 * How far, in ms, the reveal's leading EDGE trails the surface
	 * itself. Defaults to `DEFAULT_REVEAL_EDGE_LAG_MS`; `0` disables
	 * the edge entirely. Clamped to 0–600.
	 *
	 * The edge is a second layer painted in
	 * `--os-window-reveal-edge` that sits BEHIND the surface
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
	 * `--os-window-reveal-edge-thickness`, which overrides
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
