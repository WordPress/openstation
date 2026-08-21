/**
 * OpenStation — Widget layer.
 *
 * Owns the right-side `#os-widgets` column + the floating
 * overlay for widgets the user has liberated via drag. Responsibilities:
 *
 *   - Load the enabled-id list + floating-widget geometry from
 *     localStorage on boot
 *   - Mount each enabled widget, choosing column-docked vs floating
 *     based on the widget def (`movable`) + persisted state
 *   - Render the trailing `+` tile that opens the picker
 *   - Handle card remove + liberate-on-drag transitions
 *   - Persist changes back to localStorage (+ fire add/remove actions)
 *
 * Drag + resize pointer logic lives in {@link ./frame.ts}; persistence
 * in {@link ./state.ts}. This file is orchestration only so the
 * mental model of each module stays narrow.
 *
 * Widgets paint above the wallpaper (z-index: 1) but under windows
 * (which start at z-index 100). The column never intercepts window
 * drag / resize — only its own cards + `+` button are interactive,
 * everything else passes through.
 */

import { doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import * as registry from './registry';
import {
	openWidgetPicker,
	refreshWidgetPicker,
	repositionWidgetPicker,
} from './picker';
import { applyGeometry, buildFrame, type Frame } from './frame';
import {
	loadDockedHeights,
	loadEnabledIds,
	loadGeometry,
	readRawEnabled,
	saveDockedHeights,
	saveEnabledIds,
	saveGeometry,
} from './state';
import { createWidgetStorage } from './storage';
import type { WidgetGeometry, WidgetTeardown } from './types';

/** First-run default — the clock. Removable like any other. */
const DEFAULT_ENABLED_IDS = [ 'clock' ];

/**
 * How far outside the column the pointer still counts as "near" for
 * the add-widget pill. Generous enough that approaching the column
 * reveals the pill before the pointer lands on a card, tight enough
 * that it stays out of the way of the rest of the desktop.
 */
const HOVER_PADDING = 40;

/** Gap between the bottom of the widget stack and the add pill. */
const ADD_TILE_GAP = 12;

/** Internal record of a mounted widget. */
interface MountedWidget {
	id: string;
	frame: Frame;
	/** Generation at mount time — races compare against this. */
	generation: number;
	/** Teardown fn the def returned. `null` until mount resolves. */
	teardown: WidgetTeardown | null;
	/** True when the widget is absolutely positioned (not in the column). */
	floating: boolean;
}

export class WidgetLayer {
	private root: HTMLElement;
	private listEl: HTMLElement;
	private floatingHost: HTMLElement;
	private addTile: HTMLButtonElement;

	private pluginUrl: string;
	private enabledIds: string[];
	private geometry: Record< string, WidgetGeometry >;
	private dockedHeights: Record< string, number >;
	private mounted: Map< string, MountedWidget > = new Map();

	/**
	 * Monotonic counter incremented on every mount / unmount so async
	 * mounts that resolve after the user flipped the widget off can
	 * detect they're stale and tear themselves down silently.
	 */
	private generation = 0;

	/** Teardown for the pointer-proximity watch. */
	private unwatchPointer: ( () => void ) | null = null;

	/**
	 * @param root         The column element (`#os-widgets`).
	 * @param pluginUrl    Absolute plugin URL — passed to widget ctx.
	 * @param floatingHost Parent for liberated (floating) widgets.
	 *                     Defaults to the column's parent (the desktop
	 *                     area) so floats are bounded by the visible
	 *                     desktop, not the 320 px-wide column.
	 */
	constructor(
		root: HTMLElement,
		pluginUrl: string,
		floatingHost?: HTMLElement,
	) {
		this.root = root;
		this.pluginUrl = pluginUrl;
		this.enabledIds = loadEnabledIds();
		this.geometry = loadGeometry();
		this.dockedHeights = loadDockedHeights();
		this.floatingHost = floatingHost ?? root.parentElement ?? root;

		this.listEl = document.createElement( 'div' );
		this.listEl.className = 'os-widgets__list';
		this.root.appendChild( this.listEl );

		this.addTile = this.buildAddTile();
		this.root.appendChild( this.addTile );

		this.paintEmptyState();
		this.watchPointerProximity();
	}

	/**
	 * Mount every widget the user has enabled (per localStorage).
	 * Called once during shell boot, AFTER the registry seed has run
	 * so built-ins are available. Safe to call multiple times — the
	 * `mounted` map dedupes.
	 */
	public hydrate(): void {
		// First-run: no saved list at all → seed with the default
		// (currently just 'clock'). This writes through so the next
		// boot sees an explicit empty [] if the user removed it,
		// distinct from first-run.
		if ( readRawEnabled() === null ) {
			this.enabledIds = DEFAULT_ENABLED_IDS.filter(
				( id ) => !! registry.get( id ),
			);
			saveEnabledIds( this.enabledIds );
		}

		for ( const id of this.enabledIds ) {
			if ( this.mounted.has( id ) ) {
				continue;
			}
			this.mountById( id );
		}
		this.paintEmptyState();
	}

	/**
	 * Add a widget by id — called by the picker after the user
	 * selects an available entry. Idempotent.
	 */
	public add( id: string ): void {
		if ( this.enabledIds.includes( id ) ) {
			return;
		}
		if ( ! registry.get( id ) ) {
			// Unknown id — don't persist a broken entry. Most likely a
			// plugin was deactivated between picker-open and click.
			return;
		}
		this.enabledIds.push( id );
		saveEnabledIds( this.enabledIds );
		this.mountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_ADDED, { id } );
		refreshWidgetPicker();
	}

	/**
	 * Remove a widget by id — called from the card's × button and
	 * from the picker. Idempotent.
	 */
	public remove( id: string ): void {
		const before = this.enabledIds.length;
		this.enabledIds = this.enabledIds.filter( ( e ) => e !== id );
		if ( this.enabledIds.length === before ) {
			return;
		}
		saveEnabledIds( this.enabledIds );
		// Drop any persisted geometry so a re-add starts docked.
		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}
		// Same for the docked-height record — a re-add starts at the
		// widget's natural (content-driven) height.
		if ( this.dockedHeights[ id ] !== undefined ) {
			delete this.dockedHeights[ id ];
			saveDockedHeights( this.dockedHeights );
		}
		this.unmountById( id );
		this.paintEmptyState();
		doAction( HOOKS.WIDGET_REMOVED, { id } );
		refreshWidgetPicker();
	}

	/** Public read for the picker / external callers. */
	public getEnabledIds(): string[] {
		return [ ...this.enabledIds ];
	}

	/**
	 * Open the widget picker, anchored to the add pill. The pill is
	 * the click target that normally does this, but it's also the
	 * anchor the popover positions against, so the wallpaper's
	 * right-click menu comes through here too rather than growing a
	 * second, differently-placed panel.
	 *
	 * The `--picking` flag keeps the pill on screen for as long as
	 * the popover is open. Without it, moving the pointer onto the
	 * panel takes it out of the column's proximity zone and the
	 * anchor fades out from under the menu.
	 */
	public openPicker(): void {
		this.positionAddTile();
		this.root.classList.add( 'os-widgets--picking' );
		openWidgetPicker( {
			anchor: this.addTile,
			registry: () => registry.all(),
			enabledIds: () => [ ...this.enabledIds ],
			onAdd: ( id ) => this.add( id ),
			onClose: () =>
				this.root.classList.remove( 'os-widgets--picking' ),
		} );
	}

	/**
	 * Mount a widget ONLY if it's already in the user's enabled
	 * list AND not currently mounted. No-op when the widget isn't
	 * enabled (user never opted in) and no-op when it's already on
	 * screen. Used by the server-driven sync: when a plugin
	 * activates mid-session, its widget def registers via the
	 * sync's path; if the user had previously enabled that widget
	 * (in a prior session or before the plugin was deactivated),
	 * we want to bring it back on screen without toggling the
	 * "enabled" state or firing a `WIDGET_ADDED` action.
	 *
	 * The net behaviour is "rehydrate this one widget now that
	 * its def is finally registered," which is subtly different
	 * from `ensureMounted` (which OPT-INs the user into enabling
	 * the widget for the first time).
	 */
	public mountIfEnabled( id: string ): void {
		if ( ! registry.get( id ) ) {
			return;
		}
		if ( ! this.enabledIds.includes( id ) ) {
			return;
		}
		if ( this.mounted.has( id ) ) {
			return;
		}
		this.mountById( id );
		this.paintEmptyState();
	}

	/**
	 * Unmount a widget without touching the persisted enablement.
	 * Used by the server-driven widget-registry sync: when a plugin
	 * deactivates mid-session, its widget defs disappear from the
	 * registry and we need to pull any mounted instance off the
	 * screen — but we deliberately KEEP the id in the user's
	 * enabled list so re-activating the plugin re-mounts it
	 * automatically through `hydrate()`.
	 *
	 * Idempotent; a no-op when the widget isn't currently mounted.
	 */
	public unmount( id: string ): void {
		if ( ! this.mounted.has( id ) ) {
			return;
		}
		this.unmountById( id );
		this.paintEmptyState();
	}

	/**
	 * Guarantee the widget identified by `id` is currently mounted,
	 * adding it to the enabled list if it isn't. No-op when the
	 * widget is already on screen. Intended for companion plugins
	 * that want to pin their widget programmatically — a monitor
	 * plugin that auto-pins itself on the first error burst, a
	 * first-run onboarding flow that ensures the quick-start widget
	 * is present, etc.
	 *
	 * Returns `true` when the widget is mounted (either newly added
	 * or already present), `false` when the id isn't registered —
	 * callers can branch on the failure without having to maintain
	 * their own registry snapshot.
	 */
	public ensureMounted( id: string ): boolean {
		if ( ! registry.get( id ) ) {
			return false;
		}
		if ( this.enabledIds.includes( id ) ) {
			return true;
		}
		this.add( id );
		return true;
	}

	/**
	 * Tear down every widget. Called on shell unload via `pagehide`
	 * so intervals / RAF loops stop before the beacon flush.
	 */
	public disposeAll(): void {
		for ( const id of Array.from( this.mounted.keys() ) ) {
			this.unmountById( id );
		}
		this.unwatchPointer?.();
		this.unwatchPointer = null;
	}

	// --- Internal ---------------------------------------------------

	private mountById( id: string ): void {
		const def = registry.get( id );
		if ( ! def ) {
			return;
		}
		const gen = ++this.generation;
		const initialGeometry = def.movable === true ? this.geometry[ id ] : undefined;
		const frame = buildFrame(
			def,
			{
				floatingParent: this.floatingHost,
				geometry: initialGeometry,
				dockedHeight: this.dockedHeights[ id ],
			},
			{
				onRemove: () => this.remove( id ),
				onGeometryChanged: ( geom ) => this.persistGeometry( id, geom ),
				onDockedHeightChanged: ( height ) =>
					this.persistDockedHeight( id, height ),
				onLiberate: ( geom ) => this.liberate( id, geom ),
				onRedock: () => this.redock( id ),
			},
		);

		const floating = !! initialGeometry;
		const record: MountedWidget = {
			id,
			frame,
			generation: gen,
			teardown: null,
			floating,
		};
		this.mounted.set( id, record );
		this.placeCard( frame.card, floating );

		const ctx = {
			id,
			pluginUrl: this.pluginUrl,
			storage: createWidgetStorage( id ),
		};
		doAction( HOOKS.WIDGET_MOUNTING, { id, container: frame.body, ctx } );

		const onResolve = ( teardown: WidgetTeardown ): void => {
			// Race check: user flipped this widget off (or the whole
			// layer was disposed) before mount resolved.
			const current = this.mounted.get( id );
			if ( ! current || current.generation !== gen ) {
				try {
					teardown();
				} catch {
					/* best-effort */
				}
				return;
			}
			current.teardown = teardown;
			// An async mount paints its content now, so the card can
			// be taller than it was when the pill was last placed.
			// On a hover device the next pointermove would fix it, but
			// where the pill is always on (touch) nothing else would.
			this.positionAddTile();
			doAction( HOOKS.WIDGET_MOUNTED, { id, container: frame.body, ctx } );
		};

		let result;
		try {
			result = def.mount( frame.body, ctx );
		} catch ( err ) {
			this.handleMountFailure( id, err );
			return;
		}
		if ( isThenable( result ) ) {
			result.then( onResolve, ( err ) => {
				if ( this.mounted.get( id )?.generation === gen ) {
					this.handleMountFailure( id, err );
				}
			} );
			return;
		}
		onResolve( result );
	}

	private unmountById( id: string ): void {
		const record = this.mounted.get( id );
		if ( ! record ) {
			return;
		}
		doAction( HOOKS.WIDGET_UNMOUNTING, { id } );
		try {
			record.teardown?.();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'widget-teardown', id, error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] Widget "${ id }" teardown threw:`,
					err,
				);
			}
		}
		// Bumping the generation here ensures any in-flight async
		// mount that resolves AFTER this point also tears itself down.
		this.generation++;
		record.frame.dispose();
		this.mounted.delete( id );
	}

	private handleMountFailure( id: string, err: unknown ): void {
		const record = this.mounted.get( id );
		if ( record ) {
			record.frame.dispose();
			this.mounted.delete( id );
		}
		doAction( HOOKS.WIDGET_MOUNT_FAILED, { id, error: err } );
		doAction( HOOKS.SHELL_ERROR, { scope: 'widget-mount', id, error: err } );
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[openstation] Widget "${ id }" failed to mount:`,
				err,
			);
		}
	}

	private buildAddTile(): HTMLButtonElement {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'os-widgets__add';
		tile.setAttribute( 'aria-label', __( 'Add widget' ) );
		const plus = document.createElement( 'span' );
		plus.className = 'os-widgets__add-plus';
		plus.setAttribute( 'aria-hidden', 'true' );
		plus.textContent = '+';
		const label = document.createElement( 'span' );
		label.className = 'os-widgets__add-label';
		label.textContent = __( 'Add widget' );
		tile.appendChild( plus );
		tile.appendChild( label );
		tile.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			this.openPicker();
		} );
		return tile;
	}

	/**
	 * Reveal the add-widget pill while the pointer is near the
	 * column, hide it otherwise.
	 *
	 * Can't be a plain CSS `:hover` — the column is
	 * `pointer-events: none` so a drag grazing its margin falls
	 * through to the window underneath, and that also means it never
	 * receives hover. So the proximity test runs off a passive
	 * document-level `pointermove` instead, against a rect cached
	 * between layout changes.
	 *
	 * The cache needs a `ResizeObserver`, not just a resize listener:
	 * the column is absolute inside `.os-area`, which is a flex child
	 * of `.os-shell__body` alongside the dock. Move the dock to the
	 * left or right in Preferences and the area narrows, taking the
	 * column with it, with no window resize to notice. A stale rect
	 * leaves the reveal zone hovering over empty desktop.
	 */
	private watchPointerProximity(): void {
		let rect: DOMRect | null = null;
		let frame = 0;

		const invalidate = (): void => {
			rect = null;
			this.positionAddTile();
		};
		// The reveal itself is a cached-rect comparison, cheap enough
		// to run on every move. Re-measuring the stack is not — it
		// reads layout — so it's collapsed to one pass per frame,
		// which is all a repaint can show anyway.
		const remeasure = (): void => {
			if ( frame ) {
				return;
			}
			frame = requestAnimationFrame( () => {
				frame = 0;
				this.positionAddTile();
			} );
		};
		const onMove = ( e: PointerEvent ): void => {
			if ( ! rect ) {
				rect = this.root.getBoundingClientRect();
			}
			const near =
				e.clientX >= rect.left - HOVER_PADDING &&
				e.clientX <= rect.right + HOVER_PADDING &&
				e.clientY >= rect.top - HOVER_PADDING &&
				e.clientY <= rect.bottom + HOVER_PADDING;
			this.root.classList.toggle( 'os-widgets--hovered', near );
			if ( near ) {
				// Follow a widget dragged over the column instead of
				// waiting for the drop to catch up.
				remeasure();
			}
		};
		const onLeave = (): void => {
			this.root.classList.remove( 'os-widgets--hovered' );
		};

		document.addEventListener( 'pointermove', onMove, { passive: true } );
		document.documentElement.addEventListener( 'pointerleave', onLeave );
		window.addEventListener( 'resize', invalidate );

		// The column itself keeps its 320 px whatever the dock does,
		// so watch the desktop area too — that's the box that actually
		// changes when the dock takes width out of the flex row.
		let observer: ResizeObserver | null = null;
		if ( typeof ResizeObserver === 'function' ) {
			observer = new ResizeObserver( invalidate );
			observer.observe( this.root );
			if ( this.root.parentElement ) {
				observer.observe( this.root.parentElement );
			}
		}

		this.unwatchPointer = () => {
			if ( frame ) {
				cancelAnimationFrame( frame );
				frame = 0;
			}
			observer?.disconnect();
			document.removeEventListener( 'pointermove', onMove );
			document.documentElement.removeEventListener(
				'pointerleave',
				onLeave,
			);
			window.removeEventListener( 'resize', invalidate );
		};
	}

	/**
	 * Drop a card into the right parent based on its floating state.
	 * Docked cards append to the column list above the `+` tile;
	 * floating cards append to the desktop-area-level host so they
	 * sit above the wallpaper and can range across the viewport.
	 */
	private placeCard( card: HTMLElement, floating: boolean ): void {
		if ( floating ) {
			this.floatingHost.appendChild( card );
		} else {
			this.listEl.appendChild( card );
		}
	}

	/**
	 * Move a widget from the column into the floating host. Called by
	 * the frame on the user's first drag of a movable widget.
	 */
	private liberate( id: string, geometry: WidgetGeometry ): void {
		const record = this.mounted.get( id );
		if ( ! record || record.floating ) {
			return;
		}
		record.floating = true;
		this.floatingHost.appendChild( record.frame.card );
		applyGeometry( record.frame.card, geometry );
		this.persistGeometry( id, geometry );
		this.paintEmptyState();
	}

	/**
	 * Inverse of {@link liberate}: move a floating card back into
	 * the column and drop its persisted geometry so a subsequent
	 * shell boot brings it up docked. Called when the user clicks
	 * the re-dock button in the card's chrome header, or
	 * programmatically by companion plugins via
	 * `wp.os.widgets.redock( id )` /
	 * `wp.os.widgetLayer.redock( id )`.
	 *
	 * Idempotent — a docked widget silently no-ops, an unknown id
	 * silently no-ops. The `--floating` class on the card is
	 * removed as part of the same write so CSS rules that depend
	 * on it (re-dock button visibility, absolute positioning) flip
	 * back in one paint.
	 */
	public redock( id: string ): void {
		const record = this.mounted.get( id );
		if ( ! record || ! record.floating ) {
			return;
		}
		record.floating = false;
		// Clear the persisted geometry BEFORE re-parenting so a
		// concurrent boot doesn't pick up stale floating coords.
		if ( this.geometry[ id ] ) {
			delete this.geometry[ id ];
			saveGeometry( this.geometry );
		}
		// Strip the inline geometry so the card renders back at its
		// flex-column natural size — no phantom left/top offsets
		// bleed into column layout. A persisted docked height (from a
		// previous column resize) is re-applied instead of cleared.
		const card = record.frame.card;
		card.classList.remove( 'os-widgets__card--floating' );
		card.style.left = '';
		card.style.top = '';
		card.style.width = '';
		const dockedHeight = this.dockedHeights[ id ];
		card.style.height =
			dockedHeight !== undefined ? `${ dockedHeight }px` : '';
		// Re-append before the add-tile so the card lands at the
		// bottom of the existing stack (matches the new-widget
		// insertion order — "most recently added / redocked is last").
		this.listEl.appendChild( card );
		this.paintEmptyState();
	}

	private persistGeometry( id: string, geometry: WidgetGeometry ): void {
		this.geometry[ id ] = geometry;
		saveGeometry( this.geometry );
		this.positionAddTile();
	}

	/**
	 * Park the add pill just under the lowest widget standing in the
	 * column, so it always reads as the end of that stack.
	 *
	 * The docked cards are in the column's own flow, so their extent
	 * is a plain `offsetHeight` read. Floating cards are not: dragging
	 * a widget out of the column re-parents it to the desktop area,
	 * and it can be dropped straight back over the column, where it
	 * still looks like part of the stack but contributes nothing to
	 * the column's layout. Those get measured and folded in — but only
	 * when they cover at least half the column's width, so a widget
	 * merely grazing the column's edge doesn't drag the pill down with
	 * it.
	 */
	private positionAddTile(): void {
		const colRect = this.root.getBoundingClientRect();
		if ( ! colRect.height ) {
			return;
		}
		let bottom = this.listEl.offsetTop + this.listEl.offsetHeight;
		for ( const record of this.mounted.values() ) {
			if ( ! record.floating ) {
				continue;
			}
			const rect = record.frame.card.getBoundingClientRect();
			const overlap =
				Math.min( rect.right, colRect.right ) -
				Math.max( rect.left, colRect.left );
			if ( overlap < colRect.width / 2 ) {
				continue;
			}
			bottom = Math.max(
				bottom,
				rect.bottom - colRect.top + this.root.scrollTop,
			);
		}
		// Never past the column's visible foot — a tall stack pushes
		// the pill onto the last card rather than off the screen.
		const limit =
			colRect.height + this.root.scrollTop - this.addTile.offsetHeight;
		const top = Math.max( 0, Math.min( bottom + ADD_TILE_GAP, limit ) );
		if ( this.addTile.style.top === `${ top }px` ) {
			return;
		}
		this.addTile.style.top = `${ top }px`;
		// The picker anchors to the pill, so it has to come along.
		repositionWidgetPicker();
	}

	private persistDockedHeight( id: string, height: number ): void {
		if ( ! Number.isFinite( height ) || height <= 0 ) {
			return;
		}
		this.dockedHeights[ id ] = height;
		saveDockedHeights( this.dockedHeights );
	}

	/**
	 * Toggle a `--has-widgets` modifier so CSS can hide the column's
	 * decorative backdrop when nothing's mounted (keeps the empty
	 * state clean — just the `+` tile floating in the corner).
	 *
	 * Floating widgets don't count toward "has widgets" in the column
	 * sense — if every enabled widget is floating, the column itself
	 * shows only the empty state + add tile.
	 */
	private paintEmptyState(): void {
		let docked = 0;
		for ( const record of this.mounted.values() ) {
			if ( ! record.floating ) {
				docked++;
			}
		}
		this.root.classList.toggle(
			'os-widgets--has-widgets',
			docked > 0,
		);
		this.positionAddTile();
	}
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isThenable( x: unknown ): x is PromiseLike< WidgetTeardown > {
	return (
		!! x &&
		( typeof x === 'object' || typeof x === 'function' ) &&
		typeof ( x as { then?: unknown } ).then === 'function'
	);
}
