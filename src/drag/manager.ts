/**
 * OpenStation — DragManager.
 *
 * Single source of truth for in-shell drag gestures. Sources call
 * `manager.start()` from a `pointerdown` handler; the manager attaches
 * its own document-level move/up/cancel listeners and drives the
 * gesture from there. This deliberately avoids `setPointerCapture` —
 * pointer capture redirects events to the captured element and breaks
 * HTML5 drag detection on tiles that are also `draggable=true` (the
 * long-standing My WordPress entity-tile drag bug).
 *
 * Lifecycle:
 *
 *   1. `start({ payload, origin, … })` records the origin pointer,
 *      attaches `pointermove` / `pointerup` / `pointercancel` to
 *      `document`, and lazily installs the recovery handlers on the
 *      first call.
 *   2. On each `pointermove` below `DRAG_THRESHOLD_PX`: nothing
 *      visible happens. The session is "armed" but not "lifted".
 *   3. On the first `pointermove` past the threshold: the ghost is
 *      mounted, `--dragging` is added to the source, the START
 *      CustomEvent fires.
 *   4. On further `pointermove`s: the ghost follows; the registry
 *      hit-tests under the cursor; ENTER/LEAVE events fire on
 *      transitions; the ghost's accept/reject visual flips.
 *   5. On `pointerup`: hit-test once more (with the ghost hidden);
 *      if a target accepts, fire its `onDrop` and the COMMIT event;
 *      otherwise fire CANCEL with `'no-target'` or `'rejected'`.
 *   6. Cleanup funnels through `_commit()` / `_cancel()` — both end
 *      in `_cleanupDom()`, idempotently via the `_finished` marker.
 *
 * Cancellation paths (Escape, blur, visibilitychange, pointercancel,
 * manual `session.cancel()`) all funnel into the same
 * `_cancel( session, reason )` exit.
 */

import { isMobileStamped } from '../mode/stamp';
import { DropTargetRegistry } from './drop-target-registry';
import { mountGhost, type GhostHandle } from './ghost';
import { installRecovery } from './recovery';
import {
	DRAG_EVENTS,
	DRAG_THRESHOLD_PX,
	type CancelReason,
	type DragManagerApi,
	type DragSession,
	type DropTarget,
	type StartOpts,
} from './types';

const SOURCE_DRAGGING_CLASS = 'os-file-tile--dragging';
const TARGET_DROP_ACTIVE_CLASS = 'os-file-tile--drop-target';
const TRASH_DROP_ACTIVE_ATTR = 'data-os-trash-drop-active';
const FILES_DROP_ACTIVE_ATTR = 'data-files-drop-active';

/**
 * Body-level attributes set by the manager while a drag is in flight.
 * CSS rules across the shell react to these to render coordinated
 * visual cues (animated outline on the wallpaper, pulse on accepting
 * folder tiles, etc.) without each surface having to subscribe to the
 * DragManager's CustomEvents.
 */
const BODY_DRAGGING_ATTR = 'data-os-dragging';
const BODY_DRAG_TYPE_ATTR = 'data-os-drag-type';
const BODY_DRAG_MODE_ATTR = 'data-os-drag-mode';

interface InternalSession extends DragSession {
	_origin: PointerEvent;
	_pointerId: number;
	_lifted: boolean;
	_finished: boolean;
	_callbacks: {
		onClickOnly?: () => void;
		onCancel?: ( reason: CancelReason ) => void;
		onCommit?: ( target: DropTarget ) => void;
	};
	_ghost: GhostHandle | null;
	_currentTarget: DropTarget | null;
	_currentAccepted: boolean;
}

export class DragManager implements DragManagerApi {
	private readonly _registry = new DropTargetRegistry();
	private _active: InternalSession | null = null;
	private _docListenersAttached = false;
	/**
	 * `Date.now()` of the last LIFTED-drag's pointerup/cancel. Used
	 * by surfaces that bind plain `click` handlers (e.g. the
	 * wallpaper's Show-Desktop toggle) to ignore the synthesized
	 * click that fires immediately after a real drag ends. The click
	 * normally targets whichever element was under the cursor at
	 * release — for a drop onto a window, that's not the wallpaper,
	 * but ghost teardown + browser quirks can bubble a click up to
	 * the desktop area regardless. Without this marker, every
	 * successful cross-window drag would also minimize every window.
	 */
	private _lastLiftedEndAt = 0;

	start( opts: StartOpts ): DragSession | null {
		// Reject when another session is in flight — at most one drag
		// at a time. The right behaviour: silently drop the new
		// pointerdown so it falls through to whatever click/select
		// handler the source has, rather than commandeering the
		// pointer and confusing the user.
		if ( this._active ) {
			return null;
		}
		// Primary button only.
		if ( opts.origin.button !== 0 ) {
			return null;
		}
		// A phone has no drag and drop. Every shell drag starts here,
		// so one refusal covers the tiles, the rows, the cards and the
		// cross-window bridge: the pointerdown falls through to the
		// source's own tap handling, as it does for a second button.
		if ( isMobileStamped() ) {
			return null;
		}

		const session: InternalSession = {
			payload: opts.payload,
			isFinished: () => session._finished,
			cancel: ( reason ) => this._cancel( session, reason ?? 'caller' ),
			_origin: opts.origin,
			_pointerId: opts.origin.pointerId,
			_lifted: false,
			_finished: false,
			_callbacks: {
				onClickOnly: opts.onClickOnly,
				onCancel: opts.onCancel,
				onCommit: opts.onCommit,
			},
			_ghost: null,
			_currentTarget: null,
			_currentAccepted: false,
		};
		this._active = session;
		this._ensureDocListeners();
		installRecovery( ( reason ) => {
			if ( this._active ) {
				this._cancel( this._active, reason );
			}
		} );
		return session;
	}

	registerDropTarget( target: DropTarget ): () => void {
		return this._registry.register( target );
	}

	isDragging(): boolean {
		return this._active !== null && this._active._lifted;
	}

	/**
	 * Whether a real (lifted) drag ended within `withinMs` of now.
	 * Surfaces that bind plain `click` listeners use this to ignore
	 * the synthesized click that fires after a drop. 500 ms is a
	 * generous default — browsers fire the click within 10–50 ms of
	 * pointerup, but plugins may chain post-drag work into a
	 * `requestAnimationFrame` and call back into a click-driven API.
	 *
	 * @public
	 */
	recentlyEndedDrag( withinMs = 500 ): boolean {
		if ( this._lastLiftedEndAt === 0 ) {
			return false;
		}
		return Date.now() - this._lastLiftedEndAt < withinMs;
	}

	getActive(): DragSession | null {
		return this._active;
	}

	debug(): {
			findOrphans(): Element[];
			listTargets(): readonly DropTarget[];
			} {
		return {
			findOrphans: () => findOrphans(),
			listTargets: () => this._registry.list(),
		};
	}

	// -----------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------

	private _ensureDocListeners(): void {
		if ( this._docListenersAttached ) {
			return;
		}
		this._docListenersAttached = true;
		document.addEventListener( 'pointermove', this._onPointerMove, true );
		document.addEventListener( 'pointerup', this._onPointerUp, true );
		document.addEventListener( 'pointercancel', this._onPointerCancel, true );
	}

	private readonly _onPointerMove = ( e: PointerEvent ): void => {
		const session = this._active;
		if ( ! session || session._pointerId !== e.pointerId ) {
			return;
		}
		const dx = e.clientX - session._origin.clientX;
		const dy = e.clientY - session._origin.clientY;
		if ( ! session._lifted ) {
			if ( Math.abs( dx ) < DRAG_THRESHOLD_PX && Math.abs( dy ) < DRAG_THRESHOLD_PX ) {
				return;
			}
			this._lift( session, e );
		}
		if ( ! session._ghost ) {
			return;
		}
		session._ghost.moveTo( e.clientX, e.clientY );
		this._updateHover( session, e.clientX, e.clientY );
		dispatchOnDocument( DRAG_EVENTS.MOVE, {
			payload: session.payload,
			clientX: e.clientX,
			clientY: e.clientY,
		} );
	};

	private readonly _onPointerUp = ( e: PointerEvent ): void => {
		const session = this._active;
		if ( ! session || session._pointerId !== e.pointerId ) {
			return;
		}
		if ( ! session._lifted ) {
			// Sub-threshold gesture — treat as a click. Do NOT call
			// onCommit. The source's onClickOnly callback (if any)
			// owns whatever the click meant.
			session._finished = true;
			this._active = null;
			try {
				session._callbacks.onClickOnly?.();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] drag onClickOnly threw:', err );
			}
			return;
		}
		// Lifted — commit or reject based on hit-test.
		const hit = this._hitTestNow( session, e.clientX, e.clientY );
		if ( hit && hit.accepted && hit.target ) {
			this._commit( session, hit.target, e.clientX, e.clientY );
			return;
		}
		this._cancel( session, hit && hit.target ? 'rejected' : 'no-target' );
	};

	private readonly _onPointerCancel = ( e: PointerEvent ): void => {
		const session = this._active;
		if ( ! session || session._pointerId !== e.pointerId ) {
			return;
		}
		this._cancel( session, 'pointercancel' );
	};

	private _lift( session: InternalSession, e: PointerEvent ): void {
		session._lifted = true;
		session.payload.source.classList.add( SOURCE_DRAGGING_CLASS );
		session._ghost = mountGhost( session.payload, e.clientX, e.clientY );
		// Body-level coordination — sets the shell-wide attributes
		// every other surface can react to. `_updateHover` will flip
		// the mode attribute as the cursor moves; the cleanup path
		// scrubs all three.
		if ( typeof document !== 'undefined' && document.body ) {
			document.body.setAttribute( BODY_DRAGGING_ATTR, '' );
			document.body.setAttribute(
				BODY_DRAG_TYPE_ATTR,
				String( session.payload.type ),
			);
			document.body.setAttribute( BODY_DRAG_MODE_ATTR, 'neutral' );
		}
		dispatchOnDocument( DRAG_EVENTS.START, { payload: session.payload } );
	}

	private _hitTestNow(
		session: InternalSession,
		clientX: number,
		clientY: number,
	): { target: DropTarget | null; accepted: boolean } {
		const run = (): { target: DropTarget | null; accepted: boolean } => {
			const el = document.elementFromPoint( clientX, clientY );
			const target = this._registry.hitTest( el );
			if ( ! target ) {
				return { target: null, accepted: false };
			}
			let accepted = false;
			try {
				accepted = target.accept( session.payload );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] drop target accept() threw:', target.id, err );
			}
			return { target, accepted };
		};
		// Hide the ghost so it doesn't show up as the topmost element
		// at (clientX, clientY).
		if ( session._ghost ) {
			return session._ghost.withHidden( run );
		}
		return run();
	}

	private _updateHover( session: InternalSession, clientX: number, clientY: number ): void {
		const next = this._hitTestNow( session, clientX, clientY );
		const prevTarget = session._currentTarget;
		if ( next.target === prevTarget && next.accepted === session._currentAccepted ) {
			return;
		}
		if ( prevTarget ) {
			fireLeave( prevTarget, session );
		}
		session._currentTarget = next.target;
		session._currentAccepted = next.accepted;
		let mode: 'accept' | 'reject';
		if ( next.target ) {
			if ( next.accepted ) {
				fireEnter( next.target, session );
				// Per-target accept label (e.g. recycle bin → "Move
				// to Trash") overrides the payload-default chip text
				// while the cursor is over this specific target.
				session._ghost?.setMode( 'accept', {
					acceptLabel: next.target.acceptLabel,
				} );
				mode = 'accept';
			} else {
				session._ghost?.setMode( 'reject' );
				dispatchOnDocument( DRAG_EVENTS.REJECTED, {
					payload: session.payload,
					targetId: next.target.id,
				} );
				mode = 'reject';
			}
		} else {
			session._ghost?.setMode( 'reject' );
			mode = 'reject';
		}
		if ( typeof document !== 'undefined' && document.body ) {
			document.body.setAttribute( BODY_DRAG_MODE_ATTR, mode );
		}
	}

	private _commit(
		session: InternalSession,
		target: DropTarget,
		clientX: number,
		clientY: number,
	): void {
		session._finished = true;
		// Stamp the marker so click handlers wired on the wallpaper
		// (Show Desktop) can ignore the synthesized click that fires
		// after pointerup. `_commit` only runs for lifted sessions —
		// safe to set unconditionally.
		this._lastLiftedEndAt = Date.now();
		// Drop the LEAVE on the active target before invoking onDrop
		// so target callbacks see a clean enter/leave pair.
		fireLeave( target, session );
		this._cleanupDom( session );
		const prevActive = this._active;
		this._active = null;
		try {
			void target.onDrop( session, { clientX, clientY } );
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[openstation] drop target onDrop threw:', target.id, err );
		}
		try {
			session._callbacks.onCommit?.( target );
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[openstation] drag onCommit threw:', err );
		}
		dispatchOnDocument( DRAG_EVENTS.COMMIT, {
			payload: session.payload,
			targetId: target.id,
		} );
		dispatchOnDocument( DRAG_EVENTS.END, { payload: session.payload, reason: 'commit' } );
		// Defensive: the assignment above already nulled `_active`,
		// but if some listener re-entered start() during the callbacks
		// above, leave that new session in place.
		if ( this._active === prevActive ) {
			this._active = null;
		}
	}

	private _cancel( session: InternalSession, reason: CancelReason ): void {
		if ( session._finished ) {
			return;
		}
		session._finished = true;
		// Same rationale as `_commit`: stamp the marker so the next
		// synthesized click on the wallpaper is ignored. Only stamp
		// when the gesture had actually lifted — a sub-threshold
		// click that gets cancelled here is genuinely a click and
		// should fall through to its surface's handler.
		if ( session._lifted ) {
			this._lastLiftedEndAt = Date.now();
		}
		if ( session._currentTarget ) {
			fireLeave( session._currentTarget, session );
		}
		this._cleanupDom( session );
		this._active = null;
		try {
			session._callbacks.onCancel?.( reason );
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[openstation] drag onCancel threw:', err );
		}
		dispatchOnDocument( DRAG_EVENTS.CANCEL, { payload: session.payload, reason } );
		dispatchOnDocument( DRAG_EVENTS.END, { payload: session.payload, reason } );
	}

	private _cleanupDom( session: InternalSession ): void {
		// Source class. The source may have been removed from the DOM
		// already (rare — the wallpaper layer rebuilds tiles on store
		// changes) but classList mutations on detached nodes are a
		// no-op.
		try {
			session.payload.source.classList.remove( SOURCE_DRAGGING_CLASS );
		} catch {
			// ignore
		}
		session._ghost?.dispose();
		session._ghost = null;
		session._currentTarget = null;
		session._currentAccepted = false;
		// Drop the shell-wide attributes that drive coordinated drop
		// affordances. Other surfaces watch these via CSS attribute
		// selectors; leaving them set would freeze every drop indicator
		// in the "in-flight" state after the drag ended.
		if ( typeof document !== 'undefined' && document.body ) {
			document.body.removeAttribute( BODY_DRAGGING_ATTR );
			document.body.removeAttribute( BODY_DRAG_TYPE_ATTR );
			document.body.removeAttribute( BODY_DRAG_MODE_ATTR );
		}
		// Belt-and-braces: scrub any stale drop-active markers anywhere
		// in the document. Targets that misbehave by leaving these on
		// (e.g. a plugin whose onLeave threw) shouldn't pollute the
		// next drag.
		scrubOrphans();
	}
}

function dispatchOnDocument( type: string, detail: unknown ): void {
	if ( typeof document === 'undefined' ) {
		return;
	}
	document.dispatchEvent( new CustomEvent( type, { detail } ) );
}

function fireEnter( target: DropTarget, session: DragSession ): void {
	try {
		target.onEnter?.( session );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] drop target onEnter threw:', target.id, err );
	}
	dispatchOnDocument( DRAG_EVENTS.ENTER, {
		payload: session.payload,
		targetId: target.id,
	} );
}

function fireLeave( target: DropTarget, session: DragSession ): void {
	try {
		target.onLeave?.( session );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] drop target onLeave threw:', target.id, err );
	}
	dispatchOnDocument( DRAG_EVENTS.LEAVE, {
		payload: session.payload,
		targetId: target.id,
	} );
}

/** Find any DOM nodes carrying drag-related state classes/attributes. */
function findOrphans(): Element[] {
	if ( typeof document === 'undefined' ) {
		return [];
	}
	const out: Element[] = [];
	for ( const sel of [
		`.${ SOURCE_DRAGGING_CLASS }`,
		`.${ TARGET_DROP_ACTIVE_CLASS }`,
		`[${ TRASH_DROP_ACTIVE_ATTR }]`,
		`[${ FILES_DROP_ACTIVE_ATTR }]`,
	] ) {
		document.querySelectorAll( sel ).forEach( ( el ) => out.push( el ) );
	}
	return out;
}

/** Strip any drag-related state classes/attributes from the document. */
function scrubOrphans(): void {
	for ( const el of findOrphans() ) {
		el.classList.remove( SOURCE_DRAGGING_CLASS, TARGET_DROP_ACTIVE_CLASS );
		el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
		el.removeAttribute( FILES_DROP_ACTIVE_ATTR );
	}
}
