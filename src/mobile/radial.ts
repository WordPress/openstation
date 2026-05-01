/**
 * Mobile radial launcher.
 *
 * Replaces the bottom thumbnail strip with a single floating "+"
 * button that expands into a radial fan of icons above it. Items
 * scroll left/right by horizontal pan. Tapping a leaf opens (or
 * focuses) its window; tapping a parent re-roots the radial on
 * that item and fans out its submenu, with a back affordance on
 * the centre. Items whose URL matches an open window get an
 * "active" ring so the radial doubles as the app switcher — tap
 * to focus instead of re-open.
 *
 * @since 0.7.0
 */

import { addAction, applyFilters, HOOKS } from '../hooks';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig, DockItemConfig } from '../types';
import { urlMatchKey } from '../utils';

interface RadialNode {
	id: string;
	title: string;
	icon: string;
	url: string;
	children: RadialNode[];
	/**
	 * When set, tapping this node focuses the matching open
	 * window directly (by `windowManager.getById`) instead of
	 * routing through the URL-match-or-open path. Used for the
	 * "open windows" prefix at the root of the radial.
	 */
	windowId?: string;
	/**
	 * Whether this admin page supports multiple simultaneous
	 * windows. List screens (Posts, Pages, Media, Users) are
	 * true; singletons (Dashboard, Settings) are false. Drives
	 * the "tap icon = open new" vs. "tap icon = focus existing"
	 * branch in `activate()`.
	 */
	multi: boolean;
	/**
	 * Native-window id (`config.nativeWindows[].id`). When set,
	 * tapping routes through `wp.desktop.openWindow(id)` —
	 * native windows have no admin URL to load, only a registered
	 * id the shell resolves to a `<template>` clone.
	 */
	nativeId?: string;
}

const ARC_RADIUS = 140;
/** Step in radians between adjacent items inside the visible arc. ~46°. */
const ITEM_STEP = ( 46 * Math.PI ) / 180;
/** Visible half-arc in radians (items outside collapse + fade). ~95°. */
const VISIBLE_HALF = ( 95 * Math.PI ) / 180;
/**
 * Outside the visible cone we collapse adjacent items into the same
 * angular slot so they overlap at the edge — that overlap reads as
 * "more icons live here, scroll to reveal" without spreading the
 * out-of-view items wide enough to need extra screen real estate.
 */
const OFF_ARC_COMPRESSION = 0.18;

function adaptDockItem( item: DockItemConfig ): RadialNode {
	const multi = !! item.multi;
	const parentIcon = item.icon || 'dashicons-admin-generic';
	return {
		id: item.id,
		title: item.title,
		icon: parentIcon,
		url: item.url,
		multi,
		children: ( item.submenu || [] ).map( ( s, idx ) => ( {
			id: `${ item.id }/sub-${ idx }`,
			title: s.title,
			// Submenu items inherit the parent's icon — the radial
			// reads "I'm inside Posts" via the centre FAB switching
			// to the Posts dashicon, and every fan-out tile sharing
			// that same icon reinforces "still in Posts" rather
			// than displaying a generic chevron that says nothing.
			icon: parentIcon,
			url: s.url,
			children: [],
			// Submenu items inherit the parent's multi flag — a
			// "Posts > All Posts" landing is just as multi-able as
			// "Posts" itself, while "Settings > General" stays
			// singleton-by-default.
			multi,
		} ) ),
	};
}

export class RadialLauncher {
	private manager: WindowManager;
	private config: DesktopConfig;
	private root: HTMLElement;
	private fab: HTMLButtonElement;
	private arc: HTMLElement;
	private gesturePad!: HTMLElement;
	private backdrop: HTMLElement;
	private centreLabel: HTMLElement;
	private preview!: HTMLDivElement;
	private actions!: HTMLDivElement;
	private rotation = 0;
	private isOpen = false;
	/** Stack of nodes representing the current drill path. Top = current parent. */
	private path: Array< RadialNode | null > = [ null ];
	private hookNs = 'wp-desktop-mode/mobile-radial';
	/** State machine for the FAB visibility — peeking (half hidden) ↔ revealed. */
	private peekState: 'peeking' | 'revealed' = 'peeking';
	private peekTimer: number | null = null;
	private readonly PEEK_TIMEOUT_MS = 3000;
	/** Pixels of movement that disqualify a pointerup as a tap. */
	private readonly DRAG_THRESHOLD_PX = 8;
	/** Last rendered scene id. Used to decide enter animations. */
	private lastSceneId: string | null = null;

	constructor( manager: WindowManager, config: DesktopConfig ) {
		this.manager = manager;
		this.config = config;

		this.root = document.createElement( 'div' );
		this.root.className = 'wp-desktop-radial';
		this.root.setAttribute( 'role', 'navigation' );
		this.root.setAttribute( 'aria-label', 'Mobile launcher' );

		this.backdrop = document.createElement( 'div' );
		this.backdrop.className = 'wp-desktop-radial__backdrop';
		this.backdrop.addEventListener( 'pointerup', () => this.close() );
		this.root.appendChild( this.backdrop );

		// Gesture pad — a wide invisible hit-area covering the
		// entire arc region (and some breathing room around it).
		// Drag anywhere inside this pad rotates the radial; the
		// previous design only registered drags on the 1×1 arc
		// origin, so the user had to start from a tile to scroll.
		// Sits behind the actual arc element in z-order so taps on
		// individual tiles still reach the tile (the gesture
		// handler uses `elementFromPoint` to tell the two apart).
		this.gesturePad = document.createElement( 'div' );
		this.gesturePad.className = 'wp-desktop-radial__gesture-pad';
		this.gesturePad.setAttribute( 'aria-hidden', 'true' );
		this.root.appendChild( this.gesturePad );

		this.arc = document.createElement( 'div' );
		this.arc.className = 'wp-desktop-radial__arc';
		this.root.appendChild( this.arc );

		// Centre-preview thumbnail. When the user pans the radial
		// the icon nearest the apex "snaps" into focus; if a window
		// of that kind is already open we float a translucent
		// thumbnail in the middle of the screen so the user can
		// jump to the existing instance with one tap. Hidden by
		// default, populated on snap.
		this.preview = document.createElement( 'div' );
		this.preview.className = 'wp-desktop-radial__preview';
		this.preview.setAttribute( 'aria-hidden', 'true' );
		this.preview.setAttribute( 'role', 'group' );
		this.root.appendChild( this.preview );

		// Window action chips — Refresh + Close for the currently
		// focused window. Title bars are removed in mobile mode so
		// these chips are the user's only path to those actions.
		// They fan out either side of the FAB only while the radial
		// is open and a window is focused; closed-radial mode keeps
		// the bottom edge clean for the peeking FAB alone.
		this.actions = document.createElement( 'div' );
		this.actions.className = 'wp-desktop-radial__actions';
		this.actions.setAttribute( 'aria-hidden', 'true' );
		this.actions.innerHTML = `
			<button type="button"
				class="wp-desktop-radial__action wp-desktop-radial__action--reload"
				aria-label="Reload current window">
				<span class="dashicons dashicons-update-alt" aria-hidden="true"></span>
			</button>
			<button type="button"
				class="wp-desktop-radial__action wp-desktop-radial__action--close"
				aria-label="Close current window">
				<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
			</button>
		`;
		const reloadBtn = this.actions.querySelector< HTMLButtonElement >(
			'.wp-desktop-radial__action--reload',
		);
		const closeBtn = this.actions.querySelector< HTMLButtonElement >(
			'.wp-desktop-radial__action--close',
		);
		reloadBtn?.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			this.markInteraction();
			const focused = this.manager.getFocused();
			if ( focused && typeof ( focused as unknown as { reload?: () => void } ).reload === 'function' ) {
				try {
					( focused as unknown as { reload: () => void } ).reload();
				} catch {
					/* swallow */
				}
			}
		} );
		closeBtn?.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			this.markInteraction();
			const focused = this.manager.getFocused();
			if ( focused ) {
				try {
					focused.close();
				} catch {
					/* swallow */
				}
			}
			this.close();
		} );
		this.root.appendChild( this.actions );

		// Sweep hint — a small double-arrow icon that animates back
		// and forth along the radial's arc border (above the items).
		// Visible only while the radial is open. Pure SVG so the
		// motion path stays smooth at any device pixel ratio.
		const sweep = document.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		sweep.setAttribute( 'class', 'wp-desktop-radial__sweep' );
		sweep.setAttribute( 'viewBox', '-250 -220 500 250' );
		sweep.setAttribute( 'aria-hidden', 'true' );
		sweep.innerHTML = `
			<g class="wp-desktop-radial__sweep-arrow">
				<path
					d="M -10 -4 L -16 0 L -10 4 M -16 0 L 16 0 M 10 -4 L 16 0 L 10 4"
					fill="none"
					stroke="rgba(255,255,255,0.95)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</g>
		`;
		this.root.appendChild( sweep );

		this.fab = document.createElement( 'button' );
		this.fab.type = 'button';
		this.fab.className = 'wp-desktop-radial__fab';
		this.fab.setAttribute( 'aria-label', 'Open launcher' );
		this.fab.setAttribute( 'aria-expanded', 'false' );

		// Two stacked icons inside the FAB. CSS toggles which one is
		// visible based on the `--peeking` state so the user sees a
		// "lift me up" chevron when the FAB is half-hidden, and the
		// canonical plus glyph when it's at rest.
		this.centreLabel = document.createElement( 'span' );
		this.centreLabel.className = 'wp-desktop-radial__fab-icon dashicons dashicons-plus-alt2';
		this.fab.appendChild( this.centreLabel );

		const peekIcon = document.createElement( 'span' );
		peekIcon.className =
			'wp-desktop-radial__fab-peek-icon dashicons dashicons-arrow-up-alt2';
		peekIcon.setAttribute( 'aria-hidden', 'true' );
		this.fab.appendChild( peekIcon );

		this.fab.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			// Peeking branch FIRST — we don't want
			// `markInteraction()` to silently flip the state to
			// `revealed` before this check, which would have made
			// a peeking tap fall through to `toggle()` instead of
			// the explicit reveal+open path. Each branch resets
			// the auto-peek timer through its own callees
			// (`reveal()` / `open()` / `pop()` / `toggle()` all
			// schedule).
			if ( this.peekState === 'peeking' ) {
				this.reveal();
				this.open();
				return;
			}
			this.markInteraction();
			if ( this.path.length > 1 ) {
				this.pop();
				return;
			}
			this.toggle();
		} );
		this.root.appendChild( this.fab );

		this.bindGestures();
		this.scheduleAutoPeek();
	}

	mount(): void {
		const shell = document.getElementById( 'wp-desktop-shell' );
		if ( ! shell ) {
			return;
		}
		shell.appendChild( this.root );

		const repaint = (): void => {
			if ( this.isOpen ) {
				this.paint();
			}
		};
		const onWindowChange = (): void => {
			repaint();
			this.refreshFocusState();
		};
		addAction( HOOKS.WINDOW_OPENED, this.hookNs, onWindowChange );
		addAction( HOOKS.WINDOW_CLOSED, this.hookNs, onWindowChange );
		addAction( HOOKS.WINDOW_FOCUSED, this.hookNs, onWindowChange );
		addAction( HOOKS.WINDOW_TITLE_CHANGED, this.hookNs, onWindowChange );
		// Menu-refresh path: when the chromeless bridge captures a
		// fresh `wp-desktop-plugins-changed` payload, the shell
		// rebuilds the dock + desktop-icons grid. Both fire their
		// own "after-render" hooks. We piggy-back to invalidate the
		// scene cache so the next paint pulls the updated
		// `config.dockItems` / `config.nativeWindows` rather than
		// the stale snapshot the radial first rendered.
		const onMenuRefresh = (): void => {
			this.lastSceneId = null;
			repaint();
		};
		addAction( HOOKS.DOCK_AFTER_RENDER, this.hookNs, onMenuRefresh );
		addAction( HOOKS.DESKTOP_ICONS_RENDERED, this.hookNs, onMenuRefresh );
		this.refreshFocusState();

		// Boot in peeking state — the FAB sits half-hidden until the
		// user taps it. Class is applied here (rather than in the
		// constructor) so the transition runs cleanly the first time
		// the user reveals it.
		this.root.classList.add( 'wp-desktop-radial--peeking' );
	}

	unmount(): void {
		const raw = window.wp?.hooks;
		if ( raw ) {
			for ( const name of [
				HOOKS.WINDOW_OPENED,
				HOOKS.WINDOW_CLOSED,
				HOOKS.WINDOW_FOCUSED,
				HOOKS.WINDOW_TITLE_CHANGED,
				HOOKS.DOCK_AFTER_RENDER,
				HOOKS.DESKTOP_ICONS_RENDERED,
			] ) {
				raw.removeAction( name, this.hookNs );
			}
		}
		this.root.remove();
	}

	toggle(): void {
		if ( this.isOpen ) {
			this.close();
		} else {
			this.open();
		}
	}

	open(): void {
		this.isOpen = true;
		this.path = [ null ];
		this.rotation = 0;
		this.root.classList.add( 'wp-desktop-radial--open' );
		this.root.classList.remove( 'wp-desktop-radial--peeking' );
		this.fab.setAttribute( 'aria-expanded', 'true' );
		this.peekState = 'revealed';
		this.paint();
		this.markInteraction();
		// Initial snap so the apex item triggers a preview if it
		// matches an open window.
		const nodes = this.currentNodes();
		if ( nodes.length > 0 ) {
			this.updateCenterPreview( nodes[ Math.floor( ( nodes.length - 1 ) / 2 ) ] );
		}
	}

	close(): void {
		this.isOpen = false;
		this.path = [ null ];
		this.rotation = 0;
		this.root.classList.remove( 'wp-desktop-radial--open' );
		this.root.classList.remove( 'wp-desktop-radial--drilled' );
		this.fab.setAttribute( 'aria-expanded', 'false' );
		this.centreLabel.className =
			'wp-desktop-radial__fab-icon dashicons dashicons-plus-alt2';
		this.fab.setAttribute( 'aria-label', 'Open launcher' );
		this.preview.classList.remove( 'wp-desktop-radial__preview--visible' );
		this.preview.setAttribute( 'aria-hidden', 'true' );
		this.preview.tabIndex = -1;
		this.preview.onclick = null;
		this.scheduleAutoPeek();
	}

	/** Drill down: replace centre with `node`, fan its children out. */
	private push( node: RadialNode ): void {
		if ( ! node.children.length ) {
			// Leaf — open / focus instead of drilling.
			this.activate( node );
			return;
		}
		this.path.push( node );
		this.rotation = 0;
		this.root.classList.add( 'wp-desktop-radial--drilled' );
		this.centreLabel.className =
			`wp-desktop-radial__fab-icon dashicons ${ node.icon }`;
		this.fab.setAttribute( 'aria-label', `Back from ${ node.title }` );
		this.paint();
	}

	private pop(): void {
		this.path.pop();
		if ( this.path.length === 1 ) {
			this.root.classList.remove( 'wp-desktop-radial--drilled' );
			this.centreLabel.className =
				'wp-desktop-radial__fab-icon dashicons dashicons-plus-alt2';
			this.fab.setAttribute( 'aria-label', 'Open launcher' );
		} else {
			const parent = this.path[ this.path.length - 1 ];
			if ( parent ) {
				this.centreLabel.className =
					`wp-desktop-radial__fab-icon dashicons ${ parent.icon }`;
			}
		}
		this.rotation = 0;
		this.paint();
		this.markInteraction();
	}

	private activate( node: RadialNode ): void {
		// Direct-id path for "open window" tiles — tapping one of
		// the open-window prefix tiles always focuses that exact
		// window instance, even if multiple windows share a URL.
		if ( node.windowId ) {
			const win = this.manager.getById( node.windowId );
			if ( win ) {
				if ( win.state === 'minimized' ) {
					win.maximize();
				}
				this.manager.focus( win );
				this.close();
				return;
			}
		}

		// Native-window path — OS Settings, Code Editor, Recycle
		// Bin, plugin-registered native windows. OS Settings has
		// its own dedicated entry point (`openOsSettings`) because
		// it isn't routed through the public native-window
		// registry; everything else goes through `openWindow(id)`.
		if ( node.nativeId ) {
			try {
				const api = window.wp?.desktop;
				if ( node.nativeId === 'wp-desktop-os-settings' && api?.openOsSettings ) {
					api.openOsSettings();
				} else {
					api?.openWindow?.( node.nativeId );
				}
			} catch {
				/* swallow */
			}
			this.close();
			return;
		}

		// Tapping a dock-item icon while a window of that kind is
		// already open:
		//   • multi = true  → stack a new instance (Posts, Pages,
		//                     Media — list screens where you'd
		//                     want two side-by-side comparison
		//                     windows).
		//   • multi = false → focus the existing one (Settings,
		//                     Dashboard, Tools — singleton pages
		//                     where two of the same is nonsense).
		// The "Tap to switch" preview thumb is the dedicated
		// affordance for focusing an existing instance regardless
		// of `multi` — it lives outside this code path.
		const target = urlMatchKey( node.url );
		const existing = this.manager
			.getAll()
			.find( ( w ) => !! w.config.url && urlMatchKey( w.config.url ) === target );

		if ( existing && ! node.multi ) {
			if ( existing.state === 'minimized' ) {
				existing.maximize();
			}
			this.manager.focus( existing );
		} else if ( existing && node.multi ) {
			// Open a sibling instance via `openNew()` so the
			// existing window keeps its identity and the new one
			// gets a unique id from the manager.
			this.manager.openNew( {
				id: node.id,
				url: node.url,
				title: node.title,
				icon: node.icon,
			} );
		} else {
			this.manager.open( {
				id: node.id,
				url: node.url,
				title: node.title,
				icon: node.icon,
			} );
		}
		this.close();
	}

	private currentNodes(): RadialNode[] {
		const top = this.path[ this.path.length - 1 ];
		const dockItems = this.config.dockItems || [];

		let nodes: RadialNode[];
		if ( top ) {
			// Prepend the parent itself as a leaf so the user can open
			// the parent's own page (e.g. the Plugins landing screen),
			// not only its submenu items.
			nodes = [
				{
					id: `${ top.id }/__self__`,
					title: top.title,
					icon: top.icon,
					url: top.url,
					children: [],
					multi: top.multi,
				},
				...top.children,
			];
		} else {
			// Root level — every actionable thing the user could
			// reach from the desktop, in priority order:
			//
			//   1. Currently-open windows (radial doubles as
			//      app switcher).
			//   2. Native shell windows (OS Settings, Code Editor,
			//      Recycle Bin, Cron Jobs, …) registered via
			//      `wp_register_desktop_window()`.
			//   3. Server-registered desktop icons (the wallpaper
			//      shortcut tiles).
			//   4. Every admin-menu top-level item (the dock list).
			//
			// Tapping #2 routes through `wp.desktop.openWindow(id)`
			// because native windows don't have an admin URL.
			// Tapping #3 routes through the URL flow when the icon
			// targets a URL, or through `openWindow(id)` when it
			// targets a native window.
			const openWindowNodes: RadialNode[] = this.manager
				.getAll()
				.filter( ( w ) => w.config.url || w.config.title )
				.map( ( w ) => ( {
					id: `__win__/${ w.id }`,
					title: w.config.title || w.id,
					icon: w.config.icon || 'dashicons-desktop',
					url: w.config.url ?? '',
					children: [],
					windowId: w.id,
					multi: false,
				} ) );

			const nativeWindowNodes: RadialNode[] = ( this.config.nativeWindows ?? [] )
				.filter( ( n ) => n.placement !== 'none' )
				.map( ( n ) => ( {
					id: `__native__/${ n.id }`,
					title: n.title,
					icon: n.icon || 'dashicons-admin-generic',
					url: '',
					children: [],
					multi: false,
					nativeId: n.id,
				} ) );

			// OS Settings is an internal shell window — it isn't
			// registered through the public `wp_register_desktop_window`
			// API so it's missing from `config.nativeWindows`. Add it
			// manually with a sentinel `nativeId` the activation path
			// recognises and routes through `openOsSettings()`.
			nativeWindowNodes.push( {
				id: '__native__/wp-desktop-os-settings',
				title: 'OS Settings',
				icon: 'dashicons-admin-generic',
				url: '',
				children: [],
				multi: false,
				nativeId: 'wp-desktop-os-settings',
			} );

			const desktopIconNodes: RadialNode[] = ( this.config.desktopIcons ?? [] )
				// Skip icons whose id collides with a native window
				// — many plugins register both a native window and
				// a desktop-icon shortcut for the same target.
				.filter(
					( i ) =>
						! nativeWindowNodes.some(
							( n ) => n.nativeId === ( i.window || '' ),
						),
				)
				.map( ( i ) => ( {
					id: `__icon__/${ i.id }`,
					title: i.title,
					icon: i.icon || 'dashicons-admin-generic',
					url: i.url || '',
					children: [],
					multi: false,
					nativeId: i.window || undefined,
				} ) );

			nodes = [
				...openWindowNodes,
				...nativeWindowNodes,
				...desktopIconNodes,
				...dockItems.map( adaptDockItem ),
			];
		}

		// Plugins can rewrite or extend the radial — same hook that the
		// (now-removed) bottom switcher used, but the payload is a flat
		// list of nodes instead of Window instances.
		return applyFilters< RadialNode[], [ { level: number; parent: RadialNode | null } ] >(
			'desktop_mode_mobile_app_switcher',
			nodes,
			{ level: this.path.length - 1, parent: top },
		);
	}

	private bindGestures(): void {
		// Single pointer-event handler attached to the arc layer.
		// Tracks movement; if the pointer ends up >= DRAG_THRESHOLD_PX
		// from where it started, treat as a drag (rotate, suppress
		// tile click). Otherwise treat the release as a tap on the
		// nearest tile and dispatch its node action. Works for mouse,
		// touch, and pen via a single code path.
		let startX = 0;
		let startY = 0;
		let startRot = 0;
		let active = false;
		let dragged = false;
		let pid = -1;

		const onDown = ( ev: PointerEvent ): void => {
			// Only react to primary button / first finger.
			if ( ev.button !== 0 && ev.pointerType === 'mouse' ) {
				return;
			}
			active = true;
			dragged = false;
			pid = ev.pointerId;
			startX = ev.clientX;
			startY = ev.clientY;
			startRot = this.rotation;
			this.markInteraction();
			try {
				this.gesturePad.setPointerCapture( pid );
			} catch {
				/* swallow */
			}
		};

		const onMove = ( ev: PointerEvent ): void => {
			if ( ! active || ev.pointerId !== pid ) {
				return;
			}
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			if ( ! dragged && dx * dx + dy * dy >= this.DRAG_THRESHOLD_PX * this.DRAG_THRESHOLD_PX ) {
				dragged = true;
				this.arc.classList.add( 'wp-desktop-radial__arc--dragging' );
			}
			if ( ! dragged ) {
				return;
			}
			// 1px → 0.005 rad (~0.29°). Tweak feel without shrinking
			// the maximum reach because the rotation clamp scales with
			// item count.
			const next = startRot + dx * 0.005;
			const nodes = this.currentNodes();
			const max = Math.max(
				0,
				( ( nodes.length - 1 ) * ITEM_STEP ) / 2,
			);
			this.rotation = Math.max( -max, Math.min( max, next ) );
			this.paintArc( nodes );
			this.markInteraction();
		};

		const onUp = ( ev: PointerEvent ): void => {
			if ( ev.pointerId !== pid ) {
				return;
			}
			active = false;
			this.arc.classList.remove( 'wp-desktop-radial__arc--dragging' );
			try {
				this.gesturePad.releasePointerCapture( pid );
			} catch {
				/* swallow */
			}
			pid = -1;
			if ( dragged ) {
				// Snap the rotation so the nearest item lands at
				// the apex (angle 0 = straight up) and update the
				// centre preview if there's a matching open window.
				this.snapToCenter();
				this.markInteraction();
				return;
			}
			// Tap — find which tile the pointer is over and activate it.
			// `setPointerCapture` redirects pointerup `target` to the
			// captured element (the arc), so `ev.target` is useless
			// here. `document.elementFromPoint` looks up the node
			// under the actual release coordinates instead, which
			// reliably resolves to the tile the user lifted on.
			const hit = document.elementFromPoint( ev.clientX, ev.clientY );
			const tile = hit?.closest( '.wp-desktop-radial__tile' ) as
				| HTMLElement
				| null;
			if ( tile && tile.dataset.nodeId ) {
				const nodes = this.currentNodes();
				const node = nodes.find( ( n ) => n.id === tile.dataset.nodeId );
				if ( node ) {
					this.push( node );
				}
			}
			this.markInteraction();
		};

		// Bind on the root so events from EITHER the gesture pad
		// (empty area) OR the tiles inside the arc bubble up to a
		// single handler. The FAB and action chips stopPropagation
		// in their own click handlers, so they never reach here.
		this.root.addEventListener( 'pointerdown', onDown );
		this.root.addEventListener( 'pointermove', onMove );
		this.root.addEventListener( 'pointerup', onUp );
		this.root.addEventListener( 'pointercancel', onUp );
	}

	/**
	 * Snap the rotation so the item nearest the apex (angle 0)
	 * lands exactly there, then refresh the centre preview. Runs
	 * after every drag-release so a partial swipe always settles
	 * on a discrete tile.
	 */
	private snapToCenter(): void {
		const nodes = this.currentNodes();
		if ( nodes.length === 0 ) {
			return;
		}
		const N = nodes.length;
		let bestIdx = 0;
		let bestDist = Infinity;
		for ( let i = 0; i < N; i++ ) {
			const baseAngle = ( i - ( N - 1 ) / 2 ) * ITEM_STEP;
			const angle = baseAngle + this.rotation;
			const d = Math.abs( angle );
			if ( d < bestDist ) {
				bestDist = d;
				bestIdx = i;
			}
		}
		const targetBase = ( bestIdx - ( N - 1 ) / 2 ) * ITEM_STEP;
		this.rotation = -targetBase;
		this.paintArc( nodes );
		this.updateCenterPreview( nodes[ bestIdx ] );
	}

	/**
	 * Refresh the centre-screen preview for the currently-snapped
	 * node. If at least one window is open whose URL matches the
	 * node, render a translucent thumb the user can tap to focus
	 * the existing instance. With no match, hide the preview.
	 */
	private updateCenterPreview( node: RadialNode ): void {
		const matches = this.manager
			.getAll()
			.filter(
				( w ) =>
					!! w.config.url &&
					urlMatchKey( w.config.url ) === urlMatchKey( node.url ),
			);
		if ( matches.length === 0 || ! this.isOpen ) {
			this.hidePreview();
			return;
		}

		this.preview.innerHTML = '';
		this.preview.classList.toggle(
			'wp-desktop-radial__preview--multi',
			matches.length > 1,
		);

		if ( matches.length === 1 ) {
			// Single match — one big card. The whole card is the
			// click target; tapping focuses the window.
			const target = matches[ 0 ];
			const card = this.buildPreviewCard(
				node.icon || 'dashicons-desktop',
				target.config.title || node.title,
				'Tap to switch',
			);
			card.addEventListener( 'click', ( ev ) => {
				ev.stopPropagation();
				this.markInteraction();
				if ( target.state === 'minimized' ) {
					target.maximize();
				}
				this.manager.focus( target );
				this.close();
			} );
			this.preview.appendChild( card );
		} else {
			// Multiple matches — header + horizontal pill strip,
			// one pill per open window. Tapping a pill focuses
			// that specific window so the user can pick exactly
			// which instance to bring forward.
			const header = document.createElement( 'div' );
			header.className = 'wp-desktop-radial__preview-header';
			const headerIc = document.createElement( 'span' );
			headerIc.className = `wp-desktop-radial__preview-icon dashicons ${
				node.icon || 'dashicons-desktop'
			}`;
			header.appendChild( headerIc );
			const headerLabel = document.createElement( 'span' );
			headerLabel.className = 'wp-desktop-radial__preview-label';
			headerLabel.textContent = `${ matches.length } open · ${ node.title }`;
			header.appendChild( headerLabel );
			this.preview.appendChild( header );

			const strip = document.createElement( 'div' );
			strip.className = 'wp-desktop-radial__preview-strip';
			matches.forEach( ( target, idx ) => {
				const pill = document.createElement( 'button' );
				pill.type = 'button';
				pill.className = 'wp-desktop-radial__preview-pill';
				pill.dataset.windowId = target.id;
				const pillTitle = document.createElement( 'span' );
				pillTitle.className =
					'wp-desktop-radial__preview-pill-title';
				pillTitle.textContent = target.config.title || `#${ idx + 1 }`;
				pill.appendChild( pillTitle );
				if ( target === this.manager.getFocused() ) {
					pill.classList.add(
						'wp-desktop-radial__preview-pill--focused',
					);
				}
				pill.addEventListener( 'click', ( ev ) => {
					ev.stopPropagation();
					this.markInteraction();
					if ( target.state === 'minimized' ) {
						target.maximize();
					}
					this.manager.focus( target );
					this.close();
				} );
				strip.appendChild( pill );
			} );
			this.preview.appendChild( strip );
		}

		this.preview.classList.add( 'wp-desktop-radial__preview--visible' );
		this.preview.setAttribute( 'aria-hidden', 'false' );
	}

	private buildPreviewCard(
		icon: string,
		title: string,
		hint: string,
	): HTMLElement {
		const card = document.createElement( 'button' );
		card.type = 'button';
		card.className = 'wp-desktop-radial__preview-card';
		const ic = document.createElement( 'span' );
		ic.className = `wp-desktop-radial__preview-icon dashicons ${ icon }`;
		card.appendChild( ic );
		const label = document.createElement( 'span' );
		label.className = 'wp-desktop-radial__preview-label';
		label.textContent = title;
		card.appendChild( label );
		const hintEl = document.createElement( 'span' );
		hintEl.className = 'wp-desktop-radial__preview-hint';
		hintEl.textContent = hint;
		card.appendChild( hintEl );
		return card;
	}

	private refreshFocusState(): void {
		const hasFocus = !! this.manager.getFocused();
		this.root.classList.toggle( 'wp-desktop-radial--has-focus', hasFocus );
	}

	private hidePreview(): void {
		this.preview.classList.remove( 'wp-desktop-radial__preview--visible' );
		this.preview.classList.remove( 'wp-desktop-radial__preview--multi' );
		this.preview.setAttribute( 'aria-hidden', 'true' );
		this.preview.innerHTML = '';
	}

	/**
	 * State machine — `peeking` ↔ `revealed`.
	 *
	 * `peeking`: FAB is half-hidden below the viewport edge. Tapping
	 * it lifts to `revealed`. After a 3-second window of no
	 * interaction the FAB returns to `peeking`.
	 */
	private reveal(): void {
		this.peekState = 'revealed';
		this.root.classList.remove( 'wp-desktop-radial--peeking' );
		this.scheduleAutoPeek();
	}

	private peek(): void {
		// Auto-retract: 3 s of inactivity collapses the whole
		// radial back to the peeking state. If the radial happens
		// to be open we close it inline (skipping `close()` so we
		// don't kick off yet another auto-peek timer).
		if ( this.isOpen ) {
			this.isOpen = false;
			this.path = [ null ];
			this.rotation = 0;
			this.root.classList.remove( 'wp-desktop-radial--open' );
			this.root.classList.remove( 'wp-desktop-radial--drilled' );
			this.fab.setAttribute( 'aria-expanded', 'false' );
			this.centreLabel.className =
				'wp-desktop-radial__fab-icon dashicons dashicons-plus-alt2';
			this.fab.setAttribute( 'aria-label', 'Open launcher' );
			this.preview.classList.remove( 'wp-desktop-radial__preview--visible' );
			this.preview.setAttribute( 'aria-hidden', 'true' );
			this.preview.tabIndex = -1;
			this.preview.onclick = null;
		}
		this.peekState = 'peeking';
		this.root.classList.add( 'wp-desktop-radial--peeking' );
		if ( this.peekTimer !== null ) {
			window.clearTimeout( this.peekTimer );
			this.peekTimer = null;
		}
	}

	private markInteraction(): void {
		if ( this.peekState === 'peeking' ) {
			this.reveal();
		}
		this.scheduleAutoPeek();
	}

	private scheduleAutoPeek(): void {
		if ( this.peekTimer !== null ) {
			window.clearTimeout( this.peekTimer );
		}
		this.peekTimer = window.setTimeout( () => {
			this.peekTimer = null;
			this.peek();
		}, this.PEEK_TIMEOUT_MS );
	}

	private paint(): void {
		const nodes = this.currentNodes();
		this.paintArc( nodes );
	}

	private paintArc( nodes: RadialNode[] ): void {
		// Diff-driven render: reuse tiles whose node id is still in
		// the active set, animate-out tiles that no longer match,
		// build only what's actually new. Rotation re-renders fly
		// through the "everything matches" branch — no DOM churn,
		// no transition restart, no flicker.

		// Track scene changes (open ↔ close, drill in/out) so we
		// only run the entry animation on new tiles when the user
		// actually navigated. During rotation the scene id stays
		// the same; new tiles wandering into view from compression
		// fade in via their normal `--open` transition without
		// kicking the keyframe animation.
		const sceneId = this.path
			.map( ( n ) => ( n ? n.id : 'root' ) )
			.join( '/' );
		const sceneChanged = this.lastSceneId !== sceneId;
		this.lastSceneId = sceneId;

		// Open windows: build a fast lookup so the active ring lights
		// up for any item whose url matches a live window.
		const openKeys = new Set<string>();
		for ( const w of this.manager.getAll() ) {
			if ( w.config.url ) {
				openKeys.add( urlMatchKey( w.config.url ) );
			}
		}
		const focusedKey = ( () => {
			const f = this.manager.getFocused();
			return f && f.config.url ? urlMatchKey( f.config.url ) : '';
		} )();

		// Distribute nodes around the arc with a fixed angular step so
		// adding items extends the scrollable range instead of shrinking
		// individual icons. Centre item sits at the top (angle 0).
		// Outside the visible cone we compress the spacing so out-of-
		// view items stack tightly at the edge — this reads as a
		// "more behind here" stack without eating screen space.
		const N = nodes.length;
		let offLeft = 0;
		let offRight = 0;

		// Index existing live tiles by node id so we can decide
		// reuse vs. exit-animate.
		const existing = new Map<string, HTMLElement>();
		for ( const el of Array.from( this.arc.children ) as HTMLElement[] ) {
			if ( el.classList.contains( 'wp-desktop-radial__tile--leaving' ) ) {
				continue;
			}
			const id = el.dataset.nodeId;
			if ( id ) {
				existing.set( id, el );
			}
		}

		const placedIds = new Set<string>();

		for ( let i = 0; i < N; i++ ) {
			const node = nodes[ i ];
			const baseAngle = ( i - ( N - 1 ) / 2 ) * ITEM_STEP;
			const angle = baseAngle + this.rotation;
			const absAngle = Math.abs( angle );
			const overshoot = absAngle - VISIBLE_HALF;

			let placedAngle = angle;
			let visibility = 1;
			if ( overshoot > 0 ) {
				const sign = angle < 0 ? -1 : 1;
				placedAngle =
					sign *
					( VISIBLE_HALF +
						Math.min( overshoot * OFF_ARC_COMPRESSION, ITEM_STEP * 0.9 ) );
				visibility = Math.max( 0, 1 - overshoot / ( ITEM_STEP * 1.2 ) );
				if ( sign < 0 ) {
					offLeft++;
				} else {
					offRight++;
				}
				if ( visibility <= 0.05 ) {
					continue;
				}
			}

			const x = Math.sin( placedAngle ) * ARC_RADIUS;
			const y = -Math.cos( placedAngle ) * ARC_RADIUS;

			const key = urlMatchKey( node.url );
			const isOpen = openKeys.has( key );
			const isFocused = key === focusedKey && focusedKey !== '';
			const hasChildren = node.children.length > 0;

			const isWindowTile = !! node.windowId;

			let tile = existing.get( node.id );
			if ( ! tile ) {
				tile = this.buildTile( node );
				if ( isWindowTile ) {
					tile.classList.add( 'wp-desktop-radial__tile--window' );
				}
				if ( sceneChanged ) {
					// Stamp the entry animation. The CSS keyframe
					// runs from scale(0.4)+opacity 0 to the configured
					// placement; without this the tile would have
					// matched the `--open` rules immediately on append
					// and skipped the transition entirely.
					tile.classList.add( 'wp-desktop-radial__tile--entering' );
					const t = tile;
					window.setTimeout( () => {
						t.classList.remove( 'wp-desktop-radial__tile--entering' );
					}, 360 );
				}
				this.arc.appendChild( tile );
			}
			placedIds.add( node.id );
			this.applyPlacement( tile, x, y, visibility );
			tile.classList.toggle( 'wp-desktop-radial__tile--open', isOpen );
			tile.classList.toggle( 'wp-desktop-radial__tile--focused', isFocused );
			tile.classList.toggle( 'wp-desktop-radial__tile--has-children', hasChildren );
		}

		// Anything in `existing` that wasn't placed is leaving —
		// add the leaving class and schedule removal after the CSS
		// transition completes. `--leaving` defines its own scaled-
		// down + fade-out target so the inline visibility var no
		// longer wins.
		for ( const [ id, el ] of existing ) {
			if ( placedIds.has( id ) ) {
				continue;
			}
			el.classList.add( 'wp-desktop-radial__tile--leaving' );
			window.setTimeout( () => el.remove(), 260 );
		}

		this.arc.classList.toggle( 'wp-desktop-radial__arc--has-left', offLeft > 0 );
		this.arc.classList.toggle( 'wp-desktop-radial__arc--has-right', offRight > 0 );
	}

	/** Build a fresh tile DOM tree for `node`. Position-agnostic. */
	private buildTile( node: RadialNode ): HTMLElement {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'wp-desktop-radial__tile';
		tile.dataset.nodeId = node.id;
		tile.setAttribute( 'aria-label', node.title );

		const ic = document.createElement( 'span' );
		ic.className = `wp-desktop-radial__tile-icon dashicons ${ node.icon }`;
		tile.appendChild( ic );

		const labelText = node.title;
		if ( labelText ) {
			const ns = 'http://www.w3.org/2000/svg';
			const svg = document.createElementNS( ns, 'svg' );
			svg.setAttribute( 'class', 'wp-desktop-radial__tile-svg' );
			svg.setAttribute( 'viewBox', '0 0 64 64' );
			svg.setAttribute( 'aria-hidden', 'true' );

			const pathId = `wpdm-radial-curve-${ node.id }`.replace(
				/[^a-z0-9_-]/gi,
				'-',
			);
			const defs = document.createElementNS( ns, 'defs' );
			const path = document.createElementNS( ns, 'path' );
			path.setAttribute( 'id', pathId );
			// Inner bottom arc — ~170° sweep on a 27 px radius
			// inscribed inside a 64×64 tile. Endpoints at (5, 35)
			// and (59, 35), bulging down to ~y=62. Arc length is
			// ≈ 79 px — comfortably fits a 13-character label at
			// the configured 10 px font without any compression.
			path.setAttribute( 'd', 'M 5 35 A 27 27 0 0 0 59 35' );
			path.setAttribute( 'fill', 'none' );
			defs.appendChild( path );
			svg.appendChild( defs );

			const text = document.createElementNS( ns, 'text' );
			text.setAttribute( 'class', 'wp-desktop-radial__tile-curve-text' );
			const textPath = document.createElementNS( ns, 'textPath' );
			textPath.setAttribute( 'href', `#${ pathId }` );
			textPath.setAttribute( 'startOffset', '50%' );
			textPath.setAttribute( 'text-anchor', 'middle' );

			// Truncate at 13 chars with an ellipsis. No `textLength` /
			// `lengthAdjust` — those distort glyphs differently for
			// every label length, which reads as inconsistent typography
			// across the radial. Truncation keeps every visible label at
			// the same kerning and sized identically.
			const MAX_CHARS = 13;
			const display =
				labelText.length > MAX_CHARS
					? labelText.slice( 0, MAX_CHARS - 1 ) + '…'
					: labelText;
			textPath.textContent = display;

			text.appendChild( textPath );
			svg.appendChild( text );

			tile.appendChild( svg );
		}
		return tile;
	}

	/**
	 * Apply position + visibility to a tile. Visibility goes through
	 * a CSS variable so the open/leaving classes can fully override
	 * (an inline `opacity` would beat any class rule, breaking the
	 * exit animation).
	 */
	private applyPlacement(
		tile: HTMLElement,
		x: number,
		y: number,
		visibility: number,
	): void {
		tile.style.setProperty( '--wpdm-radial-x', `${ x }px` );
		tile.style.setProperty( '--wpdm-radial-y', `${ y }px` );
		tile.style.setProperty( '--wpdm-radial-visibility', String( visibility ) );
		tile.style.pointerEvents = visibility > 0.4 ? 'auto' : 'none';
	}
}
