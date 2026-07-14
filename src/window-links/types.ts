/**
 * Desktop Mode — Window content-relations types.
 *
 * A window may carry a **content identity**: the piece of content it
 * shows ("I am post 123", "I am comment 45 *of* post 123"). Identities
 * form **relation groups** keyed by their root — the post/page (or any
 * third-party object) every child references. The relations engine
 * (`engine.ts`) owns the grouping; the pluggable link renderers
 * (`renderer-registry.ts`) own how a group is visualised on the
 * desktop.
 *
 * Grouping is purely mechanical — the engine never interprets `type`.
 * A ref without `root` IS a root; a ref with `root` is a child of it.
 * Third parties join by namespacing their `type` (`vendor/order`) and
 * pointing `root` wherever they like.
 *
 * @since 0.9.4
 */

import type { WindowState } from '../types';

/**
 * A reference to the piece of content a window displays, and —
 * through `root` — the relation group it belongs to.
 */
export interface WindowContentRef {
	/**
	 * Object type. Built-ins the chromeless bridge emits: any post
	 * type slug (`post`, `page`, CPTs), `comment`, `media`. Third
	 * parties namespace `vendor/sub-type`. Must match
	 * `/^[a-z0-9_/-]+$/` — the same id convention every other
	 * registry uses.
	 */
	type: string;
	/**
	 * Object id. WordPress objects use their numeric id; third-party
	 * types may use any non-empty string.
	 */
	id: number | string;
	/**
	 * The root of this ref's relation group. Omit when this window
	 * IS the root (a post edit window). A comment window of post 123
	 * carries `{ type: 'post', id: 123 }`.
	 */
	root?: {
		type: string;
		id: number | string;
	};
	/**
	 * Outbound references from this window's content to OTHER objects
	 * — e.g. the internal hyperlinks inside a post's content, resolved
	 * server-side by the chromeless bridge. Not part of group
	 * membership — links draw ties without re-rooting anything.
	 *
	 * DIRECTION SEMANTICS (single, deliberate reading — relational
	 * structure, never navigation history): an edge points at the
	 * thing its source belongs to or refers to.
	 *
	 *  - `rel: 'references'` (the default): "my content points at
	 *    that" — the edge runs from THIS window to the referenced one
	 *    (a post hyperlinking another post). Mutual references merge
	 *    into one bidirectional edge.
	 *  - `rel: 'child'`: "that belongs to ME" — the edge runs from the
	 *    referenced window to THIS one, exactly like a `root` tie
	 *    (media embedded in a post is the post's child, even though
	 *    only the post knows about the relationship at announce time).
	 */
	links?: Array< {
		type: string;
		id: number | string;
		rel?: 'references' | 'child';
	} >;
	/**
	 * Optional human-readable label (post title, comment excerpt) for
	 * renderers and tooltips.
	 */
	label?: string;
	/**
	 * Provenance, stamped by the engine — never set it yourself:
	 * `'config'` (seeded from `WindowConfig.content`), `'bridge'`
	 * (announced by the chromeless iframe bridge), `'api'`
	 * (`wp.desktop.relations.set()`).
	 */
	source?: 'config' | 'bridge' | 'api';
}

/**
 * A computed relation group: every open window whose identity resolves
 * to the same root.
 */
export interface WindowLinkGroup {
	/** Stable group key, `'<rootType>:<rootId>'` (e.g. `'post:123'`). */
	key: string;
	/** The root object the group hangs off. */
	root: {
		type: string;
		id: number | string;
	};
	/**
	 * Ids of open windows whose OWN identity is the root object,
	 * ordered by focus recency (most recently focused first). Empty
	 * when the root window isn't open — the group still exists so
	 * callers can offer "open the parent post".
	 */
	rootWindowIds: string[];
	/** Child members — windows whose identity points at `root`. */
	children: Array< {
		windowId: string;
		content: WindowContentRef;
	} >;
}

/**
 * A directed logical tie between two open windows, derived by the
 * relations engine from the stored content identities:
 *
 *  - `child-root` — the `from` window's content belongs to the `to`
 *    window's content (comment → its post). The built-in renderer
 *    marks the root end with its larger endpoint dot.
 *  - `reference` — the `from` window's content links to the `to`
 *    window's content (a post hyperlinking another post). Mutual
 *    references collapse into ONE edge with `bidirectional: true`;
 *    the built-in renderer puts the larger dot at both ends.
 */
export interface WindowLinkEdge {
	fromWindowId: string;
	toWindowId: string;
	kind: 'child-root' | 'reference';
	bidirectional: boolean;
}

/**
 * The per-frame snapshot handed to a window-link renderer: every
 * renderable group with the live geometry of its member windows.
 */
export interface WindowLinkFrame {
	groups: Array< {
		key: string;
		root: WindowLinkGroup[ 'root' ];
		members: Array< {
			windowId: string;
			role: 'root' | 'child';
			content: WindowContentRef;
			/**
			 * Window geometry relative to the link layer (which shares
			 * `#desktop-mode-area` as offset parent with the windows).
			 * `null` when the window is minimized, on another virtual
			 * desktop, or otherwise not visible — skip its edges.
			 */
			rect: {
				x: number;
				y: number;
				width: number;
				height: number;
			} | null;
			focused: boolean;
			state: WindowState;
		} >;
	} >;
	/**
	 * The drawable ties, with endpoint geometry resolved. This is what
	 * renderers should iterate — it already encodes direction
	 * (`child-root` points at the root; `reference` points at the
	 * referenced window; `bidirectional` reference pairs are merged).
	 * A `null` rect on either end means that endpoint isn't visible
	 * (minimized / other desktop) — skip the edge.
	 */
	edges: Array< {
		fromWindowId: string;
		toWindowId: string;
		kind: WindowLinkEdge[ 'kind' ];
		bidirectional: boolean;
		/** True when either endpoint window is focused. */
		focused: boolean;
		from: { x: number; y: number; width: number; height: number } | null;
		to: { x: number; y: number; width: number; height: number } | null;
		/** Endpoint stacking positions, for occlusion-aware anchoring. */
		fromZIndex: number | null;
		toZIndex: number | null;
		/**
		 * True when this edge touches the FOCUSED window — renderers
		 * should draw it into `ctx.elevatedContainer` so it rides above
		 * the other windows while the group is surfaced. Every other
		 * edge belongs in `ctx.container`, behind the windows.
		 */
		elevated: boolean;
	} >;
	/**
	 * Every visible window on the desk (group member or not), with its
	 * stacking position — the occluder set for visible-edge anchoring
	 * (see `src/window-links/geometry.ts`). Renderers that anchor on
	 * window borders should prefer a border stretch not covered by a
	 * higher window, so a tie never appears to sprout from a window
	 * that is merely hiding its real endpoint.
	 */
	obstacles: Array< {
		windowId: string;
		rect: { x: number; y: number; width: number; height: number };
		zIndex: number;
	} >;
	/** Current size of the link layer, for sizing an SVG or canvas. */
	container: {
		width: number;
		height: number;
	};
}

/**
 * Context handed to a renderer's `mount()`. Supports pull (canvas
 * renderers polling from their own ticker) and push (DOM/SVG
 * renderers redrawing on demand) equally.
 */
export interface WindowLinkRendererContext {
	/**
	 * The shell's BASE link layer — absolutely positioned over the
	 * desktop area, `pointer-events: none`, stacked between the widget
	 * layer and the windows (always behind every window). The renderer
	 * owns its children; the host wipes them after teardown as a
	 * safety net.
	 */
	container: HTMLElement;
	/**
	 * A sibling layer the host lifts to the focused group's z-ceiling
	 * (and drops back when focus leaves the group). Draw an edge here
	 * when `edge.elevated` is true so the focused window's ties stay
	 * visible above other windows; ignore it entirely to keep the old
	 * everything-behind-windows behavior.
	 */
	elevatedContainer: HTMLElement;
	/** Pull the current frame snapshot. */
	getFrame: () => WindowLinkFrame;
	/**
	 * Subscribe to frame updates — fires rAF-coalesced during window
	 * drag/resize and on any group-structure change. Returns an
	 * unsubscribe. Renderers running their own ticker (Pixi) can skip
	 * this and poll {@link getFrame} per tick instead.
	 */
	onFrame: ( cb: ( frame: WindowLinkFrame ) => void ) => () => void;
}

/**
 * A pluggable window-link renderer — how relation groups are drawn on
 * the desktop. The built-in `svg-splines` registers through the same
 * public API (`wp.desktop.registerWindowLinkRenderer`) a plugin would
 * use; the user picks the active renderer in OS Settings → Effects.
 */
export interface WindowLinkRendererDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`; namespace plugin ids
	 * `vendor/sub-id`. `none` is the reserved "don't draw" sentinel
	 * and is rejected.
	 */
	id: string;
	/** Human-readable label shown in the OS Settings selector. */
	label: string;
	/** Optional one-line description shown under the selector. */
	description?: string;
	/**
	 * Mount into the link layer. Return (or resolve to) a teardown
	 * that undoes everything `mount` did — same contract as a native
	 * window's `render()`.
	 */
	mount: (
		ctx: WindowLinkRendererContext,
	) => void | ( () => void ) | Promise< void | ( () => void ) >;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * renderer. Set it so plugin deactivation live-unregisters the
	 * renderer (mirrors commands / unfocus effects).
	 */
	owner?: string;
}

/**
 * The `wp.desktop.relations` public API surface.
 */
export interface WindowRelationsApi {
	/** Current content identity of a window, if any. */
	get: ( windowId: string ) => WindowContentRef | undefined;
	/**
	 * Set (or clear, with `null`) a window's content identity.
	 * Throws a `RegistrationError` on a malformed ref.
	 */
	set: ( windowId: string, ref: WindowContentRef | null ) => void;
	/** Every current relation group (filter applied). */
	groups: () => WindowLinkGroup[];
	/**
	 * The derived directed ties between open windows (filter applied)
	 * — what the active renderer draws. See {@link WindowLinkEdge}.
	 */
	edges: () => WindowLinkEdge[];
	/** The group a window belongs to, if any. */
	groupOf: ( windowId: string ) => WindowLinkGroup | undefined;
	/**
	 * Ids of the other windows tied to this one — same-group members
	 * plus reference-edge endpoints, the window itself excluded.
	 */
	related: ( windowId: string ) => string[];
	/**
	 * Subscribe to relation changes (identity set/cleared, group
	 * membership changed). Returns an unsubscribe.
	 */
	subscribe: ( cb: () => void ) => () => void;
}
