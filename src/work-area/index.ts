/**
 * The work area — one answer to "where may content go?".
 *
 * Every surface that places or frames something on the desktop used
 * to guess at the reachable rectangle on its own: `.os-area` reserved
 * the dock with a hardcoded `padding-bottom: 80px` whatever edge the
 * dock was on, the window manager halved `parent.clientWidth`, the
 * widgets clamped against the whole area, the Corkboard fitted a
 * graph into its whole host. Each guess was wrong in a different way,
 * and the user saw the dock covering content and actions.
 *
 * This module owns the one rectangle they all read now. It measures
 * the desktop area and every dock rail in the shell body, works out
 * which bands of the area the chrome overlays (`./compute.ts` has the
 * rules), and publishes the result three ways:
 *
 * - **CSS custom properties on `#os-shell`** —
 *   `--os-work-area-inset-{top,right,bottom,left}` plus
 *   `--os-work-area-{width,height}`, so a stylesheet can reserve the
 *   same band the JS does (`.os-area`'s padding, the icon grid's
 *   bottom inset, the widget column).
 * - **A JS query** — {@link getWorkArea} for the latest snapshot,
 *   {@link workAreaRectOf} for the rect derived from an element's
 *   live size, {@link workAreaInsetsOf} for how far an arbitrary
 *   element hangs outside the work area.
 * - **Change notifications** — {@link subscribeWorkArea}, the
 *   `os.work-area.changed` action and the `os-work-area-changed`
 *   CustomEvent on `document`, each firing once per actual change.
 *
 * The admin bar needs no special case: `.os-shell` already starts
 * below it when the user keeps it and at the viewport top when they
 * don't, so measuring the area's viewport rect is what makes the
 * `viewport` snapshot admin-bar-aware. Nor do the side docks: they
 * are flex siblings of the area, so the area is already narrower for
 * them and they overlap nothing. Only chrome that floats OVER the
 * area claims an inset, which today means the bottom dock pill —
 * and anything a custom dock-rail renderer floats over it, since
 * every `.os-dock` in the shell body is measured.
 *
 * State lives in a {@link createSharedStore} slot: the Corkboard is a
 * lazy bundle with its own compiled copy of every module, and a
 * module-level variable here would be empty there. One store, every
 * bundle.
 */

import { createSharedStore } from '../shared-store';
import { addAction, doAction, HOOKS, removeAction } from '../hooks';
import {
	computeInsets,
	elementInsets,
	insetsEqual,
	rectFromInsets,
	rectLike,
	rectsEqual,
	ZERO_INSETS,
	type RectLike,
	type WorkAreaInsets,
	type WorkAreaRect,
} from './compute';

export {
	WORK_AREA_GAP,
	computeInsets,
	edgeFor,
	elementInsets,
	rectFromInsets,
	type RectLike,
	type WorkAreaEdge,
	type WorkAreaInsets,
	type WorkAreaRect,
} from './compute';

/** The public CustomEvent dispatched on `document` after a change. */
export const WORK_AREA_CHANGED_EVENT = 'os-work-area-changed';

/**
 * The per-rail attribute the dock-behavior settings are stamped as
 * (`src/dock-behavior.ts`). A rail carrying `dynamic` claims no band.
 */
export const DYNAMIC_DOCK_ATTR = 'data-os-dock-behavior';

/**
 * What the shell knows about the reachable desktop, all at once.
 *
 * `rect` is in desktop-area-local coordinates — the space windows,
 * widgets and icon tiles position in. `viewport` is the same
 * rectangle in viewport coordinates, for anything reasoning about
 * `clientX` / `getBoundingClientRect()`. `area` is the full desktop
 * area's size, what consumers used to read off `clientWidth` /
 * `clientHeight`; `rect` is `area` minus `insets`.
 */
export interface WorkAreaSnapshot {
	insets: WorkAreaInsets;
	rect: WorkAreaRect;
	viewport: WorkAreaRect;
	area: { width: number; height: number };
}

interface WorkAreaState {
	snapshot: WorkAreaSnapshot;
	/** Set once {@link installWorkArea} has measured for real. */
	installed: boolean;
	/** The area element being measured — for {@link workAreaRectOf}'s default. */
	areaEl: HTMLElement | null;
}

/** Store key — shared by every bundle that imports this module. */
export const WORK_AREA_STORE_KEY = 'os/work-area';

function emptySnapshot(): WorkAreaSnapshot {
	return {
		insets: { ...ZERO_INSETS },
		rect: { x: 0, y: 0, width: 0, height: 0 },
		viewport: { x: 0, y: 0, width: 0, height: 0 },
		area: { width: 0, height: 0 },
	};
}

const store = createSharedStore< WorkAreaState >( WORK_AREA_STORE_KEY, () => ( {
	snapshot: emptySnapshot(),
	installed: false,
	areaEl: null,
} ) );

/** Wiring the installer needs from the shell boot path. */
export interface WorkAreaInstallDeps {
	/** `#os-shell` — receives the CSS custom properties. */
	shell: HTMLElement;
	/** `.os-shell__body` — the flex row the docks and the area share. */
	shellBody: HTMLElement;
	/** `#os-area` — the desktop area the work area is carved out of. */
	area: HTMLElement;
	/**
	 * Selector for the chrome that may float over the area. Every
	 * match inside `shellBody` is measured. Defaults to `.os-dock`.
	 */
	chromeSelector?: string;
}

/** Handle returned by {@link installWorkArea}. */
export interface WorkAreaController {
	/** Re-measure now. Idempotent: no change, no notification. */
	refresh(): void;
	/** Disconnect every observer. The last snapshot stays readable. */
	destroy(): void;
}

const CSS_PROPS = {
	top: '--os-work-area-inset-top',
	right: '--os-work-area-inset-right',
	bottom: '--os-work-area-inset-bottom',
	left: '--os-work-area-inset-left',
	width: '--os-work-area-width',
	height: '--os-work-area-height',
} as const;

function cloneSnapshot( s: Readonly< WorkAreaSnapshot > ): WorkAreaSnapshot {
	return {
		insets: { ...s.insets },
		rect: { ...s.rect },
		viewport: { ...s.viewport },
		area: { ...s.area },
	};
}

/**
 * The latest snapshot. A copy — mutate freely, nothing downstream
 * notices. Before {@link installWorkArea} has run (or in a document
 * without a shell) everything is zero, which every consumer treats
 * as "no chrome claims anything".
 */
export function getWorkArea(): WorkAreaSnapshot {
	return cloneSnapshot( store.state.snapshot );
}

/** The current insets, by reference to a fresh copy. */
export function getWorkAreaInsets(): WorkAreaInsets {
	return { ...store.state.snapshot.insets };
}

/**
 * The work-area rect derived from `areaEl`'s LIVE size and the
 * current insets, in `areaEl`'s coordinate space.
 *
 * Prefer this over {@link getWorkArea}`().rect` inside the shell: a
 * consumer running synchronously after a layout change (a maximize
 * right after the dock moved, a ResizeObserver tick of its own) reads
 * `clientWidth` / `clientHeight` fresh instead of the last measured
 * value, and the insets are the part that only this module knows.
 * With no insets it is exactly the `clientWidth` / `clientHeight`
 * pair every call site used to read — which is also what keeps the
 * shell correct in a test document with no layout.
 *
 * `areaEl` defaults to the installed desktop area.
 */
export function workAreaRectOf( areaEl?: HTMLElement | null ): WorkAreaRect {
	const el = areaEl ?? store.state.areaEl;
	if ( ! el ) {
		return { ...store.state.snapshot.rect };
	}
	// `clientWidth` is 0 for an element that isn't laid out (display:
	// none, detached, jsdom); fall back to the bounding rect the way
	// the widget clamp always has, so a caller measuring during a
	// transition still gets a number.
	const width = el.clientWidth || el.getBoundingClientRect().width;
	const height = el.clientHeight || el.getBoundingClientRect().height;
	return rectFromInsets( width, height, store.state.snapshot.insets );
}

/**
 * How far `element` hangs outside the work area on each edge, in px
 * of its own box. Zero everywhere for an element fully inside it.
 *
 * For a surface that frames content inside its own box — the
 * Corkboard fitting a graph into its host, a canvas centring
 * something — subtract these from the box before centring, and the
 * framed content lands where the user can reach it even when the
 * host itself extends under the dock.
 */
export function workAreaInsetsOf( element: Element ): WorkAreaInsets {
	const { installed, snapshot } = store.state;
	if ( ! installed ) {
		return { ...ZERO_INSETS };
	}
	const v = snapshot.viewport;
	return elementInsets(
		rectLike( v.x, v.y, v.width, v.height ),
		element.getBoundingClientRect(),
	);
}

/**
 * Subscribe to changes. The callback receives a fresh copy of the
 * snapshot on every actual change (never on a no-op re-measure).
 * Returns the unsubscribe function.
 */
export function subscribeWorkArea(
	cb: ( snapshot: WorkAreaSnapshot ) => void,
): () => void {
	return store.subscribe( ( state ) => {
		cb( cloneSnapshot( state.snapshot ) );
	} );
}

/**
 * Measure `deps` into a snapshot. Exported for tests; production
 * code goes through {@link installWorkArea}.
 */
export function measureWorkArea( deps: WorkAreaInstallDeps ): WorkAreaSnapshot {
	const areaRect = areaViewportRect( deps );
	const chrome: RectLike[] = [];
	// A dynamic rail (OpenStation Preferences → Appearance → Desktop
	// layout; `data-os-dock-behavior="dynamic"` on the rail) folds
	// into a thin line at its edge and expands over content only when
	// summoned — transient chrome, like a popover. It claims nothing:
	// windows get the whole desktop, and the rail rides over them.
	// Per rail, because the Split layout's sidebar and bottom dock
	// answer independently.
	const nodes = deps.shellBody.querySelectorAll< HTMLElement >(
		deps.chromeSelector ?? '.os-dock',
	);
	for ( const node of Array.from( nodes ) ) {
		if ( node.hidden || node.getAttribute( DYNAMIC_DOCK_ATTR ) === 'dynamic' ) {
			continue;
		}
		chrome.push( node.getBoundingClientRect() );
	}
	const insets = computeInsets( areaRect, chrome );
	// `clientWidth` / `clientHeight` rather than the bounding rect's
	// size: the rect is fractional and transform-affected (the
	// desktop-switch slide animates `.os-area`), while the client
	// box is the integer space `style.left` / `style.top` resolve in.
	const width = deps.area.clientWidth || areaRect.width;
	const height = deps.area.clientHeight || areaRect.height;
	const rect = rectFromInsets( width, height, insets );
	return {
		insets,
		rect,
		viewport: {
			x: areaRect.left + rect.x,
			y: areaRect.top + rect.y,
			width: rect.width,
			height: rect.height,
		},
		area: { width, height },
	};
}

/**
 * The desktop area's viewport rect WITHOUT its own transform.
 *
 * `getBoundingClientRect()` includes transforms, and the desktop
 * switch slides `.os-area` sideways for 280ms (`window-states.css`,
 * `os-area--sliding-from-*`). A snapshot taken mid-slide would carry
 * a viewport origin up to 64px off, and nothing would correct it —
 * a transform moves no ResizeObserver. So the origin is rebuilt
 * from the offset chain instead: the shell body is the area's
 * offsetParent (`position: relative`) and never transforms, and
 * `offsetLeft` / `offsetTop` are layout values, not painted ones.
 * Falls back to the bounding rect where there is no layout to read
 * (a detached or jsdom element has `offsetWidth === 0`).
 */
function areaViewportRect( deps: WorkAreaInstallDeps ): RectLike {
	const { area } = deps;
	if ( area.offsetWidth > 0 && area.offsetParent === deps.shellBody ) {
		const body = deps.shellBody.getBoundingClientRect();
		return rectLike(
			body.left + area.offsetLeft,
			body.top + area.offsetTop,
			area.offsetWidth,
			area.offsetHeight,
		);
	}
	return area.getBoundingClientRect();
}

function writeCssProps( shell: HTMLElement, s: WorkAreaSnapshot ): void {
	shell.style.setProperty( CSS_PROPS.top, `${ s.insets.top }px` );
	shell.style.setProperty( CSS_PROPS.right, `${ s.insets.right }px` );
	shell.style.setProperty( CSS_PROPS.bottom, `${ s.insets.bottom }px` );
	shell.style.setProperty( CSS_PROPS.left, `${ s.insets.left }px` );
	shell.style.setProperty( CSS_PROPS.width, `${ s.rect.width }px` );
	shell.style.setProperty( CSS_PROPS.height, `${ s.rect.height }px` );
}

function snapshotsEqual(
	a: Readonly< WorkAreaSnapshot >,
	b: Readonly< WorkAreaSnapshot >,
): boolean {
	return (
		insetsEqual( a.insets, b.insets ) &&
		rectsEqual( a.rect, b.rect ) &&
		rectsEqual( a.viewport, b.viewport ) &&
		a.area.width === b.area.width &&
		a.area.height === b.area.height
	);
}

/**
 * Start measuring. Call once from the shell boot path after the
 * desktop area and the dock element(s) exist; the layout dispatcher
 * may rebuild the rails later and that is covered.
 *
 * What triggers a re-measure:
 *
 * - the desktop area resizing (browser resize, a side rail
 *   appearing, the admin-bar mode changing the shell's inset);
 * - any measured rail resizing — a dock-size change, a tile added,
 *   the overview collapse animating the pill away and back;
 * - a rail element being added to or removed from the shell body
 *   (the split layout synthesises its sidebar);
 * - `os-layout-changed`, the dispatcher's own signal;
 * - {@link WorkAreaController.refresh}.
 *
 * Every trigger funnels into one synchronous measure that compares
 * against the last snapshot and notifies only on change, so a
 * ResizeObserver firing for the area's padding (which this module
 * itself drives through the CSS properties) settles in one tick.
 *
 * **The overview freezes the snapshot.** Exposé collapses every rail
 * to width 0 over 280ms and grows it back on exit; measured live,
 * the bottom inset would walk 84 → 0 → 84 one frame at a time, and
 * every subscriber — maximized windows reflowing, the icon grid, the
 * area padding — would follow it there and back for a mode that lays
 * its own grid out against the whole area anyway. So measuring stops
 * at `OVERVIEW_ENTERING` and resumes with one measure at
 * `OVERVIEW_EXITED`, once the rails have landed. A window maximized
 * from a thumbnail sizes against the pre-overview insets, which are
 * the ones it will have when the animation ends.
 */
export function installWorkArea( deps: WorkAreaInstallDeps ): WorkAreaController {
	const railObservers = new Map< Element, ResizeObserver >();
	let areaObserver: ResizeObserver | null = null;
	let bodyObserver: MutationObserver | null = null;
	let destroyed = false;
	let frozen = false;
	let controller: WorkAreaController | null = null;

	const measure = (): void => {
		if ( destroyed || frozen ) {
			return;
		}
		const next = measureWorkArea( deps );
		const first = ! store.state.installed;
		if ( ! first && snapshotsEqual( store.state.snapshot, next ) ) {
			return;
		}
		writeCssProps( deps.shell, next );
		store.setState( { snapshot: next, installed: true, areaEl: deps.area } );
		const detail = cloneSnapshot( next );
		doAction( HOOKS.WORK_AREA_CHANGED, detail );
		document.dispatchEvent(
			new CustomEvent( WORK_AREA_CHANGED_EVENT, { detail } ),
		);
	};

	const hasResizeObserver = typeof ResizeObserver !== 'undefined';

	const observeRails = (): void => {
		if ( ! hasResizeObserver ) {
			return;
		}
		const live = new Set< Element >(
			Array.from(
				deps.shellBody.querySelectorAll( deps.chromeSelector ?? '.os-dock' ),
			),
		);
		for ( const [ el, ro ] of railObservers ) {
			if ( ! live.has( el ) ) {
				ro.disconnect();
				railObservers.delete( el );
			}
		}
		for ( const el of live ) {
			if ( railObservers.has( el ) ) {
				continue;
			}
			const ro = new ResizeObserver( measure );
			ro.observe( el );
			railObservers.set( el, ro );
		}
	};

	if ( hasResizeObserver ) {
		areaObserver = new ResizeObserver( measure );
		areaObserver.observe( deps.area );
	}
	if ( typeof MutationObserver !== 'undefined' ) {
		bodyObserver = new MutationObserver( () => {
			observeRails();
			measure();
		} );
		bodyObserver.observe( deps.shellBody, { childList: true } );
	}
	const onLayoutChanged = (): void => {
		observeRails();
		measure();
	};
	document.addEventListener( 'os-layout-changed', onLayoutChanged );
	window.addEventListener( 'resize', measure );

	const onOverviewEntering = (): void => {
		frozen = true;
	};
	const onOverviewExited = (): void => {
		frozen = false;
		measure();
	};
	addAction( HOOKS.OVERVIEW_ENTERING, HOOKS_NAMESPACE, onOverviewEntering );
	addAction( HOOKS.OVERVIEW_EXITED, HOOKS_NAMESPACE, onOverviewExited );

	observeRails();
	measure();

	controller = {
		refresh: measure,
		destroy: () => {
			destroyed = true;
			areaObserver?.disconnect();
			bodyObserver?.disconnect();
			for ( const ro of railObservers.values() ) {
				ro.disconnect();
			}
			railObservers.clear();
			document.removeEventListener( 'os-layout-changed', onLayoutChanged );
			window.removeEventListener( 'resize', measure );
			removeAction( HOOKS.OVERVIEW_ENTERING, HOOKS_NAMESPACE );
			removeAction( HOOKS.OVERVIEW_EXITED, HOOKS_NAMESPACE );
			if ( installed === controller ) {
				installed = null;
			}
		},
	};
	installed = controller;
	return controller;
}

/** Namespace for the hook-bus subscriptions the installer owns. */
const HOOKS_NAMESPACE = 'openstation/work-area';

/** The live installer, for {@link refreshWorkArea}. Main bundle only. */
let installed: WorkAreaController | null = null;

/**
 * Re-measure now, if the work area is installed. For the paths that
 * change what counts as chrome without moving any element — the
 * dock-behavior pick flipping the body class is the one today. A
 * no-op before boot and in any bundle but the shell's.
 */
export function refreshWorkArea(): void {
	installed?.refresh();
}

/**
 * Reset the shared store. Tests only — a fresh module graph per test
 * file does not reset the window-level slot the store lives in.
 */
export function _resetWorkAreaForTests(): void {
	store.reset();
}

/** The shape plugins get on `wp.os.workArea`. */
export interface WorkAreaApi {
	/** Latest snapshot (a copy). */
	get(): WorkAreaSnapshot;
	/** Work-area rect for an area element's live size; defaults to the desktop area. */
	rectOf( areaEl?: HTMLElement | null ): WorkAreaRect;
	/** How far `element` hangs outside the work area, per edge, in px. */
	insetsOf( element: Element ): WorkAreaInsets;
	/** Subscribe to changes; returns the unsubscribe function. */
	subscribe( cb: ( snapshot: WorkAreaSnapshot ) => void ): () => void;
}

export const workAreaApi: WorkAreaApi = {
	get: getWorkArea,
	rectOf: workAreaRectOf,
	insetsOf: workAreaInsetsOf,
	subscribe: subscribeWorkArea,
};
