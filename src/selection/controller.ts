/**
 * OpenStation — selection controller.
 *
 * Binds a {@link SelectionModel} to a canvas of tiles: the pointer
 * and keyboard gestures on the way in, the `selected` attribute and
 * the ARIA roles on the way out. Every tile surface in the shell —
 * the wallpaper, folder windows, every My WordPress list — mounts
 * one of these instead of tracking a `selectedId` of its own.
 *
 * Gestures, matching Finder and Explorer because that is what the
 * muscle memory expects:
 *
 *   click                replace the selection
 *   Ctrl / Cmd + click   toggle one tile
 *   Shift + click        extend from the anchor
 *   click on empty space clear
 *   drag on empty space  marquee (additive with a modifier held)
 *   Ctrl / Cmd + A       select all
 *   Escape               clear
 *   arrows               move and select; Shift extends
 *
 * Painting goes through the `selected` ATTRIBUTE, never the
 * `--selected` class: `<os-tile>._paint()` derives the class from
 * the attribute on every repaint, so a hand-set class survives only
 * until the next attribute change and then silently vanishes. The
 * class is set alongside purely so non-component tiles (plain
 * elements in a drill-in list) still light up.
 */

import { createSelectionModel, type SelectionModel } from './model';

/** Canonical tile class — the default item selector. */
const DEFAULT_ITEM_SELECTOR = '.os-file-tile';
const SELECTED_CLASS = 'os-file-tile--selected';
const MARQUEE_CLASS = 'os-selection-marquee';

/** Minimum drag distance before a background press becomes a marquee. */
const MARQUEE_THRESHOLD_PX = 4;

/** How close to a scrollable edge the pointer auto-scrolls the canvas. */
const MARQUEE_EDGE_PX = 36;

/** Pixels scrolled per frame while the band is held at the edge. */
const MARQUEE_SCROLL_PX = 12;

/**
 * Marker on `<body>` while a band is live. CSS keys off it to turn
 * text selection off shell-wide — see {@link suppressNativeSelection}.
 */
const MARQUEE_ACTIVE_ATTR = 'data-os-marquee';

/**
 * Whether `el` is a scroller the USER could scroll themselves.
 *
 * Overflowing content is not the question — the desktop area is
 * `overflow: hidden` and its icons plus its 80px bottom padding
 * overflow it constantly, so `scrollHeight > clientHeight` is true
 * there and answering that question alone made a marquee dragged to
 * the bottom of the screen scroll the WALLPAPER: a surface with no
 * scrollbar, that nothing else can scroll, sliding under the user's
 * band. The question is whether the box is a scroll container at
 * all.
 */
function isUserScrollable( el: HTMLElement ): boolean {
	if ( el.scrollHeight <= el.clientHeight ) {
		return false;
	}
	const overflowY = el.ownerDocument?.defaultView
		?.getComputedStyle( el )
		?.overflowY;
	return (
		overflowY === 'auto' ||
		overflowY === 'scroll' ||
		overflowY === 'overlay'
	);
}

/**
 * Stop the browser from running its OWN selection under ours.
 *
 * A tile can't start a native text selection — tiles are
 * `user-select: none`. The bare canvas a marquee starts from is not,
 * so the browser begins a text selection on the same press, and it
 * keeps extending as the pointer travels. Inside our canvas there is
 * nothing selectable for it to land on and it stays invisible; drag
 * out past the window and it starts highlighting whatever is behind
 * — another window's text, in blue, mid-gesture.
 *
 * Two measures, because they cover different moments: `selectstart`
 * refuses any selection the browser tries to begin from here on, and
 * the body marker turns `user-select` off shell-wide for anything
 * that slipped through. Whatever the first few pixels already
 * selected is dropped outright.
 *
 * Returns the teardown. `ref` is any node in the document being
 * suppressed — the selection is read through its own view rather
 * than a global, so a canvas mounted in another document (a
 * chromeless iframe) suppresses ITS selection and not the shell's.
 */
function suppressNativeSelection( ref: HTMLElement ): () => void {
	const doc = ref.ownerDocument;
	if ( ! doc ) {
		return () => undefined;
	}
	const onSelectStart = ( e: Event ): void => {
		e.preventDefault();
	};
	doc.addEventListener( 'selectstart', onSelectStart, true );
	doc.body?.setAttribute( MARQUEE_ACTIVE_ATTR, '' );
	try {
		doc.defaultView?.getSelection()?.removeAllRanges();
	} catch {
		// Some engines throw on an empty / detached selection. The
		// listener above is the part that matters.
	}
	return () => {
		doc.removeEventListener( 'selectstart', onSelectStart, true );
		doc.body?.removeAttribute( MARQUEE_ACTIVE_ATTR );
	};
}

/**
 * Subtrees a marquee never starts from. Windows and widgets are
 * children of the desktop area, so their pointer events bubble to the
 * wallpaper's own listener; without this a drag on a title bar would
 * both move the window and rubber-band the icons behind it.
 */
const DEFAULT_MARQUEE_EXCLUDE =
	'.os-window, .os-widgets__list, .os-widgets__card, .os-widgets__add';

/**
 * Class the window manager puts on the desktop area for the duration of
 * Overview. While it is present the area is a click surface, not a
 * selection canvas — see the guard in `onBackgroundPointerDown`.
 */
const OVERVIEW_ACTIVE_CLASS = 'os-area--overview';

export interface SelectionControllerOptions {
	/** CSS selector for selectable items under `root`. */
	itemSelector?: string;
	/** Stable key for an item element. Return null to skip it. */
	keyOf: ( el: HTMLElement ) => string | null;
	/**
	 * Element whose empty space clears the selection and hosts the
	 * marquee. Defaults to `root`. Pass the scroll/canvas host when
	 * the item container doesn't fill it.
	 */
	background?: HTMLElement;
	/** Set false for surfaces where a drag means something else. */
	marquee?: boolean;
	/**
	 * Subtrees inside `background` that a marquee must never start
	 * from. Defaults to the shell's own floating furniture — windows
	 * and widgets both live INSIDE the desktop area, so a press on a
	 * title bar or a widget's resize handle bubbles to the wallpaper
	 * and would otherwise rubber-band the icons underneath while the
	 * user drags the window.
	 */
	marqueeExclude?: string;
	/** Visual order override. Defaults to position-then-DOM order. */
	order?: () => string[];
	onChange?: ( keys: string[] ) => void;
	/** Surface slug for the public `os-selection-changed` event. */
	surface?: string;
	/** Free-form scope within the surface (folder id, entity id). */
	scope?: string;
	/** Accessible name for the listbox container. */
	ariaLabel?: string;
}

export interface SelectionHandle {
	model: SelectionModel< string >;
	/** Selected keys in visual order. */
	keys: () => string[];
	/** Live element for a key, or null when it isn't rendered. */
	elementFor: ( key: string ) => HTMLElement | null;
	/**
	 * Re-apply selected state and drop keys whose tiles are gone.
	 * Call after any repaint that rebuilds or reuses tile DOM.
	 */
	refresh: () => void;
	destroy: () => void;
}

/**
 * Attach a selection controller to `root`.
 *
 * @public
 */
export function attachSelection(
	root: HTMLElement,
	options: SelectionControllerOptions,
): SelectionHandle {
	const itemSelector = options.itemSelector ?? DEFAULT_ITEM_SELECTOR;
	const background = options.background ?? root;
	const marqueeEnabled = options.marquee !== false;
	const marqueeExclude = options.marqueeExclude ?? DEFAULT_MARQUEE_EXCLUDE;

	const itemElements = (): HTMLElement[] =>
		Array.from( root.querySelectorAll< HTMLElement >( itemSelector ) ).filter(
			( el ) => options.keyOf( el ) !== null,
		);

	/**
	 * Visual order — what a Shift+click range walks.
	 *
	 * Tiles on these canvases are absolutely positioned from inline
	 * styles, so (top, left) is what the user sees; DOM order is
	 * arrival order and diverges the moment anything is dragged.
	 *
	 * Grouped by parent first, because a banded list (WooCommerce
	 * Orders splits into "Needs attention" / "Settled") is several
	 * canvases stacked vertically, each with its own coordinate space
	 * starting at zero. Sorting all their tiles by raw `top` would
	 * interleave the bands, and a range drawn across two of them would
	 * pick up rows the user never dragged over. Groups appear in
	 * document order, which is the order the bands are stacked.
	 */
	const defaultOrder = (): string[] => {
		const groups: HTMLElement[] = [];
		const byGroup = new Map<
			HTMLElement,
			Array< { key: string; top: number; left: number; index: number } >
		>();
		itemElements().forEach( ( el, index ) => {
			const parent = el.parentElement ?? root;
			let bucket = byGroup.get( parent );
			if ( ! bucket ) {
				bucket = [];
				byGroup.set( parent, bucket );
				groups.push( parent );
			}
			bucket.push( {
				key: options.keyOf( el ) as string,
				top: parseFloat( el.style.top ) || 0,
				left: parseFloat( el.style.left ) || 0,
				index,
			} );
		} );
		const out: string[] = [];
		for ( const group of groups ) {
			const bucket = byGroup.get( group ) ?? [];
			bucket.sort( ( a, b ) => {
				if ( a.top !== b.top ) {
					return a.top - b.top;
				}
				if ( a.left !== b.left ) {
					return a.left - b.left;
				}
				return a.index - b.index;
			} );
			for ( const entry of bucket ) {
				out.push( entry.key );
			}
		}
		return out;
	};

	const order = options.order ?? defaultOrder;

	const model = createSelectionModel< string >( {
		order,
		onChange: ( keys ) => {
			paint();
			options.onChange?.( keys );
			emitChanged( keys );
		},
	} );

	/**
	 * This controller's identity, for deciding whether the shared
	 * `lastActive` snapshot is ours to clear on destroy.
	 *
	 * Not `surface` + `scope`: two folder windows open on the SAME
	 * folder share both, and closing one would blank the snapshot the
	 * other just wrote. An object reference is the only thing that
	 * distinguishes two live controllers with identical descriptions.
	 */
	const identity = {};

	const emitChanged = ( keys: string[] ): void => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		lastActive = {
			surface: options.surface ?? '',
			scope: options.scope ?? '',
			keys: keys.slice(),
			count: keys.length,
		};
		lastActiveOwner = identity;
		document.dispatchEvent(
			new CustomEvent( 'os-selection-changed', { detail: lastActive } ),
		);
	};

	const elementFor = ( key: string ): HTMLElement | null =>
		itemElements().find( ( el ) => options.keyOf( el ) === key ) ?? null;

	/**
	 * Push the model's membership onto the DOM.
	 *
	 * Every write is guarded on the current value. Setting an
	 * attribute to what it already holds still fires
	 * `attributeChangedCallback`, and `<os-tile>._paint()` rebuilds
	 * the tile's inner DOM on every one of those — so an unguarded
	 * repaint of a 200-icon folder would rebuild 200 tiles to change
	 * the state of one.
	 */
	const paint = (): void => {
		for ( const el of itemElements() ) {
			const key = options.keyOf( el ) as string;
			const on = model.has( key );
			if ( on !== el.hasAttribute( 'selected' ) ) {
				if ( on ) {
					el.setAttribute( 'selected', '' );
				} else {
					el.removeAttribute( 'selected' );
				}
			}
			el.classList.toggle( SELECTED_CLASS, on );
			// `selectable` flips `<os-tile>` from `listitem` to
			// `option`, the only role allowed to carry aria-selected.
			if ( ! el.hasAttribute( 'selectable' ) ) {
				el.setAttribute( 'selectable', '' );
			}
			const ariaSelected = on ? 'true' : 'false';
			if ( el.getAttribute( 'aria-selected' ) !== ariaSelected ) {
				el.setAttribute( 'aria-selected', ariaSelected );
			}
		}
	};

	root.setAttribute( 'role', 'listbox' );
	root.setAttribute( 'aria-multiselectable', 'true' );
	if ( options.ariaLabel ) {
		root.setAttribute( 'aria-label', options.ariaLabel );
	}

	// ── Pointer ────────────────────────────────────────────────────

	/** Arrow-key cursor. See the keyboard handler for why it isn't the anchor. */
	let lead: string | null = null;

	const onClick = ( e: MouseEvent ): void => {
		if ( ! ( e.target instanceof Element ) ) {
			return;
		}
		const tile = e.target.closest< HTMLElement >( itemSelector );
		if ( tile && root.contains( tile ) ) {
			const key = options.keyOf( tile );
			if ( key === null ) {
				return;
			}
			lead = key;
			// The tile is a focusable button; without this the click
			// would also reach the background handler below and undo
			// the selection we just made.
			e.stopPropagation();
			if ( e.shiftKey ) {
				model.selectRange( key, e.ctrlKey || e.metaKey );
				return;
			}
			if ( e.ctrlKey || e.metaKey ) {
				model.toggle( key );
				return;
			}
			model.set( [ key ] );
			return;
		}
		// Empty space. A click that merely ended a marquee is not a
		// "clear" gesture — the marquee already said what it selected.
		if ( suppressNextBackgroundClick ) {
			suppressNextBackgroundClick = false;
			return;
		}
		model.clear();
	};
	background.addEventListener( 'click', onClick );

	// ── Marquee ────────────────────────────────────────────────────

	let marqueeEl: HTMLElement | null = null;
	/**
	 * Marquee origin, in the background's CONTENT coordinates — not
	 * viewport ones.
	 *
	 * This is the whole trick to a marquee that survives scrolling.
	 * The anchor belongs to the thing the user pressed on, and that
	 * thing moves when the canvas scrolls. Stored in viewport space,
	 * the box stays the same size while the content slides out from
	 * under it: scroll during a drag and the selection freezes.
	 */
	let marqueeStart: { x: number; y: number } | null = null;
	/** Latest pointer position, viewport coordinates. */
	let lastPointer: { x: number; y: number } | null = null;
	let marqueeBase: string[] = [];
	let suppressNextBackgroundClick = false;
	let autoScrollRaf = 0;
	let releaseSelectionSuppression: ( () => void ) | null = null;
	/** Pointer the band belongs to, while it holds capture. */
	let capturedPointerId: number | null = null;

	/**
	 * Take pointer capture for the band.
	 *
	 * Without it, a release over an IFRAME strands the gesture: an
	 * iframe window hosts its own document, so `pointerup` fires in
	 * there and the listeners out here never hear it. The band keeps
	 * following a button the user already let go of. (The WordPress
	 * dashboard's draggable metaboxes are a reliable way to find
	 * this — they swallow the event on their own side too.)
	 *
	 * Capture retargets every remaining event for this pointer to the
	 * canvas, so the release comes home whatever it happens over.
	 * They still bubble from there, so the document-level listeners
	 * below are unaffected.
	 *
	 * The DragManager deliberately avoids pointer capture — it breaks
	 * HTML5 `dragstart` detection on draggable tiles. A marquee never
	 * starts on a tile and emits no HTML5 drag, so the objection
	 * doesn't apply here.
	 */
	const capturePointer = ( pointerId: number ): void => {
		if ( typeof background.setPointerCapture !== 'function' ) {
			return;
		}
		try {
			background.setPointerCapture( pointerId );
			capturedPointerId = pointerId;
		} catch {
			// Unknown / already-released pointer id. The document
			// listeners remain as the fallback path.
		}
	};

	const releasePointer = (): void => {
		if (
			capturedPointerId === null ||
			typeof background.releasePointerCapture !== 'function'
		) {
			capturedPointerId = null;
			return;
		}
		try {
			if ( background.hasPointerCapture?.( capturedPointerId ) ) {
				background.releasePointerCapture( capturedPointerId );
			}
		} catch {
			// Already gone — nothing to release.
		}
		capturedPointerId = null;
	};

	/** Viewport point → the background's content coordinate space. */
	const toContent = (
		clientX: number,
		clientY: number,
	): { x: number; y: number } => {
		const host = background.getBoundingClientRect();
		return {
			x: clientX - host.left + background.scrollLeft,
			y: clientY - host.top + background.scrollTop,
		};
	};

	const endMarquee = (): void => {
		marqueeEl?.remove();
		marqueeEl = null;
		marqueeStart = null;
		lastPointer = null;
		releaseSelectionSuppression?.();
		releaseSelectionSuppression = null;
		releasePointer();
		if ( autoScrollRaf ) {
			cancelAnimationFrame( autoScrollRaf );
			autoScrollRaf = 0;
		}
		document.removeEventListener( 'pointermove', onMarqueeMove );
		document.removeEventListener( 'pointerup', onMarqueeUp );
		document.removeEventListener( 'pointercancel', onMarqueeCancel );
		background.removeEventListener( 'lostpointercapture', onMarqueeCancel );
		background.removeEventListener( 'scroll', renderMarquee );
		window.removeEventListener( 'blur', onMarqueeCancel );
	};

	/**
	 * Draw the band and re-run the hit-test from the current anchor +
	 * pointer. Called on pointermove AND on scroll — a wheel tick
	 * during a drag changes what the band covers just as surely as
	 * moving the mouse does.
	 */
	function renderMarquee(): void {
		if ( ! marqueeStart || ! lastPointer ) {
			return;
		}
		const cursor = toContent( lastPointer.x, lastPointer.y );
		const dx = cursor.x - marqueeStart.x;
		const dy = cursor.y - marqueeStart.y;
		if (
			! marqueeEl &&
			Math.abs( dx ) < MARQUEE_THRESHOLD_PX &&
			Math.abs( dy ) < MARQUEE_THRESHOLD_PX
		) {
			return;
		}
		if ( ! marqueeEl ) {
			marqueeEl = document.createElement( 'div' );
			marqueeEl.className = MARQUEE_CLASS;
			marqueeEl.setAttribute( 'aria-hidden', 'true' );
			// The marquee is absolutely positioned inside the
			// background so it clips with the canvas — a fixed overlay
			// would paint over the window's own chrome. Absolute
			// positioning also means content coordinates are exactly
			// what `left` / `top` want, so the band scrolls WITH the
			// icons it is drawn around.
			if ( getComputedStyle( background ).position === 'static' ) {
				background.style.position = 'relative';
			}
			background.appendChild( marqueeEl );
			suppressNextBackgroundClick = true;
			// From here the gesture is ours; the browser must not run
			// a text selection alongside it.
			releaseSelectionSuppression =
				suppressNativeSelection( background );
			startAutoScroll();
		}
		const left = Math.min( marqueeStart.x, cursor.x );
		const top = Math.min( marqueeStart.y, cursor.y );
		const width = Math.abs( dx );
		const height = Math.abs( dy );
		marqueeEl.style.left = `${ left }px`;
		marqueeEl.style.top = `${ top }px`;
		marqueeEl.style.width = `${ width }px`;
		marqueeEl.style.height = `${ height }px`;

		// Hit-testing reads element rects, which are viewport-space —
		// so convert the band back on the way out.
		const host = background.getBoundingClientRect();
		const originX = host.left - background.scrollLeft;
		const originY = host.top - background.scrollTop;
		const box = {
			left: left + originX,
			top: top + originY,
			right: left + width + originX,
			bottom: top + height + originY,
		};
		const hits: string[] = [];
		for ( const el of itemElements() ) {
			const rect = el.getBoundingClientRect();
			const intersects =
				rect.left < box.right &&
				rect.right > box.left &&
				rect.top < box.bottom &&
				rect.bottom > box.top;
			if ( intersects ) {
				hits.push( options.keyOf( el ) as string );
			}
		}
		model.set( Array.from( new Set( [ ...marqueeBase, ...hits ] ) ) );
	}

	/**
	 * Scroll the canvas when the band is dragged against its edge.
	 *
	 * Without it a marquee can only ever reach what is already on
	 * screen, which on a long list is most of the reason to draw one.
	 * Only runs while there is something to scroll, and stops with the
	 * gesture.
	 */
	function startAutoScroll(): void {
		if ( autoScrollRaf || typeof requestAnimationFrame !== 'function' ) {
			return;
		}
		const step = (): void => {
			autoScrollRaf = 0;
			if ( ! marqueeEl || ! lastPointer ) {
				return;
			}
			const host = background.getBoundingClientRect();
			const canScroll = isUserScrollable( background );
			if ( canScroll ) {
				let delta = 0;
				if ( lastPointer.y < host.top + MARQUEE_EDGE_PX ) {
					delta = -MARQUEE_SCROLL_PX;
				} else if ( lastPointer.y > host.bottom - MARQUEE_EDGE_PX ) {
					delta = MARQUEE_SCROLL_PX;
				}
				if ( delta !== 0 ) {
					const before = background.scrollTop;
					background.scrollTop += delta;
					if ( background.scrollTop !== before ) {
						renderMarquee();
					}
				}
			}
			autoScrollRaf = requestAnimationFrame( step );
		};
		autoScrollRaf = requestAnimationFrame( step );
	}

	const onMarqueeMove = ( e: PointerEvent ): void => {
		if ( ! marqueeStart ) {
			return;
		}
		lastPointer = { x: e.clientX, y: e.clientY };
		renderMarquee();
	};

	const onMarqueeUp = (): void => {
		if ( marqueeEl ) {
			lastMarqueeEndAt = Date.now();
		}
		endMarquee();
	};

	const onMarqueeCancel = (): void => {
		endMarquee();
	};

	const onBackgroundPointerDown = ( e: PointerEvent ): void => {
		if ( ! marqueeEnabled || e.button !== 0 ) {
			return;
		}
		if ( ! ( e.target instanceof Element ) ) {
			return;
		}
		// Overview repurposes the whole desktop area as a click surface:
		// window thumbnails and the desktops top bar are the only live
		// targets, and the icons / files layers this marquee selects from
		// are hidden underneath it. Starting a band here is both
		// meaningless AND destructive — `capturePointer()` retargets the
		// rest of the gesture (including the compatibility mouse events)
		// to the canvas, so the synthesized `click` lands on the desktop
		// area instead of the top-bar tile the user pressed, and
		// switching desktops from Overview silently does nothing.
		//
		// Thumbnails escaped this because Overview's own capture-phase
		// pointerdown handler stops propagation before the press reaches
		// this listener; top-bar presses and bare-backdrop presses do not
		// (the latter share this node, where `stopPropagation()` can't
		// unregister a same-node sibling listener).
		if ( background.classList.contains( OVERVIEW_ACTIVE_CLASS ) ) {
			return;
		}
		if ( e.target.closest( itemSelector ) ) {
			return; // Tile press — the drag manager owns that gesture.
		}
		// Floating furniture only counts when it sits INSIDE this
		// canvas. Windows and widgets are children of the desktop
		// area, so on the wallpaper this is what stops a title-bar
		// drag from rubber-banding the icons behind it.
		//
		// A canvas that lives inside a window is the mirror image:
		// the `.os-window` is an ANCESTOR of the background, and
		// excluding it would kill the marquee in every folder window
		// and every My WordPress list — which is exactly what it did.
		// `background.contains()` tells the two apart. (A press on
		// some other window can't reach this listener at all: the
		// event has no path through `background` to bubble along.)
		const foreign = e.target.closest< HTMLElement >( marqueeExclude );
		if ( foreign && foreign !== background && background.contains( foreign ) ) {
			return;
		}
		marqueeStart = toContent( e.clientX, e.clientY );
		lastPointer = { x: e.clientX, y: e.clientY };
		if ( typeof e.pointerId === 'number' ) {
			capturePointer( e.pointerId );
		}
		// Ctrl / Cmd / Shift keeps what was already selected, so a
		// marquee can add a second cluster to the first.
		marqueeBase =
			e.ctrlKey || e.metaKey || e.shiftKey ? model.keys() : [];
		if ( marqueeBase.length === 0 ) {
			model.clear();
		}
		document.addEventListener( 'pointermove', onMarqueeMove );
		document.addEventListener( 'pointerup', onMarqueeUp );
		document.addEventListener( 'pointercancel', onMarqueeCancel );
		// Safety nets for a capture we never get to release cleanly:
		// the browser handing it back (an alert, a context menu, a
		// touch interruption), or focus leaving the shell entirely —
		// which is what a click landing inside an iframe looks like
		// from out here.
		background.addEventListener( 'lostpointercapture', onMarqueeCancel );
		window.addEventListener( 'blur', onMarqueeCancel );
		// Wheel / trackpad scrolling mid-drag has to re-draw and
		// re-hit-test, exactly like a pointermove.
		background.addEventListener( 'scroll', renderMarquee, {
			passive: true,
		} );
	};
	background.addEventListener( 'pointerdown', onBackgroundPointerDown );

	// ── Keyboard ───────────────────────────────────────────────────

	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( e.key === 'a' && ( e.ctrlKey || e.metaKey ) ) {
			e.preventDefault();
			model.selectAll();
			return;
		}
		if ( e.key === 'Escape' ) {
			if ( marqueeEl || marqueeStart ) {
				endMarquee();
				return;
			}
			if ( model.size() > 0 ) {
				model.clear();
			}
			return;
		}
		const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
		const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
		if ( ! forward && ! backward ) {
			return;
		}
		const step = forward ? 1 : -1;
		const all = order();
		if ( all.length === 0 ) {
			return;
		}
		// The lead is the cursor the arrows move; the anchor is where
		// a range starts. They have to be separate — extending with
		// Shift+arrow leaves the anchor put, so if the arrows moved the
		// anchor too the range would never grow past one step.
		const cursor = lead ?? model.anchor();
		const from = cursor === null ? -1 : all.indexOf( cursor );
		const next = Math.min(
			all.length - 1,
			Math.max( 0, from < 0 ? 0 : from + step ),
		);
		e.preventDefault();
		const key = all[ next ];
		lead = key;
		if ( e.shiftKey ) {
			model.selectRange( key );
		} else {
			model.set( [ key ] );
		}
		elementFor( key )?.focus();
	};
	root.addEventListener( 'keydown', onKeyDown );

	paint();

	return {
		model,
		keys: () => model.keys(),
		elementFor,
		refresh() {
			model.prune();
			paint();
		},
		destroy() {
			endMarquee();
			background.removeEventListener( 'click', onClick );
			background.removeEventListener(
				'pointerdown',
				onBackgroundPointerDown,
			);
			root.removeEventListener( 'keydown', onKeyDown );
			// Only if the snapshot is still OURS. A controller that
			// closes after another one has taken over must not blank
			// the live window's selection out from under it.
			if ( lastActiveOwner === identity ) {
				lastActive = null;
				lastActiveOwner = null;
			}
		},
	};
}

/** When the last marquee finished. See {@link recentlyMarqueed}. */
let lastMarqueeEndAt = 0;

/**
 * Whether a marquee ended within the last 500 ms.
 *
 * The browser synthesizes a `click` on the common ancestor after a
 * drag-shaped gesture, and on the wallpaper that ancestor is the
 * desktop area itself — the very element whose click handler runs
 * "Show desktop". Rubber-band-selecting a few icons would then
 * minimize every window. Mirrors `dragManager.recentlyEndedDrag()`,
 * which exists for exactly the same reason.
 *
 * @public
 */
export function recentlyMarqueed(): boolean {
	return lastMarqueeEndAt > 0 && Date.now() - lastMarqueeEndAt < 500;
}

/**
 * Snapshot of the most recent selection change, for
 * `wp.os.selection.active()`. Written by every controller; read by
 * plugins that want to know what the user is holding without having
 * to subscribe before the fact.
 */
let lastActive: {
	surface: string;
	scope: string;
	keys: string[];
	count: number;
} | null = null;

/** Which controller wrote {@link lastActive}. See `identity` above. */
let lastActiveOwner: object | null = null;

/** @public */
export function activeSelection(): {
	surface: string;
	scope: string;
	keys: string[];
	count: number;
} | null {
	return lastActive ? { ...lastActive, keys: lastActive.keys.slice() } : null;
}
