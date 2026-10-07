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

	private _lastLiftedEndAt = 0;

	start( opts: StartOpts ): DragSession | null {
		if ( this._active ) {
			return null;
		}

		if ( opts.origin.button !== 0 ) {
			return null;
		}

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
			session._finished = true;
			this._active = null;
			try {
				session._callbacks.onClickOnly?.();
			} catch ( err ) {
				console.error( '[openstation] drag onClickOnly threw:', err );
			}
			return;
		}

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
				console.error( '[openstation] drop target accept() threw:', target.id, err );
			}
			return { target, accepted };
		};

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

		this._lastLiftedEndAt = Date.now();

		fireLeave( target, session );
		this._cleanupDom( session );
		const prevActive = this._active;
		this._active = null;
		try {
			void target.onDrop( session, { clientX, clientY } );
		} catch ( err ) {
			console.error( '[openstation] drop target onDrop threw:', target.id, err );
		}
		try {
			session._callbacks.onCommit?.( target );
		} catch ( err ) {
			console.error( '[openstation] drag onCommit threw:', err );
		}
		dispatchOnDocument( DRAG_EVENTS.COMMIT, {
			payload: session.payload,
			targetId: target.id,
		} );
		dispatchOnDocument( DRAG_EVENTS.END, { payload: session.payload, reason: 'commit' } );

		if ( this._active === prevActive ) {
			this._active = null;
		}
	}

	private _cancel( session: InternalSession, reason: CancelReason ): void {
		if ( session._finished ) {
			return;
		}
		session._finished = true;

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
			console.error( '[openstation] drag onCancel threw:', err );
		}
		dispatchOnDocument( DRAG_EVENTS.CANCEL, { payload: session.payload, reason } );
		dispatchOnDocument( DRAG_EVENTS.END, { payload: session.payload, reason } );
	}

	private _cleanupDom( session: InternalSession ): void {
		try {
			session.payload.source.classList.remove( SOURCE_DRAGGING_CLASS );
		} catch {

		}
		session._ghost?.dispose();
		session._ghost = null;
		session._currentTarget = null;
		session._currentAccepted = false;

		if ( typeof document !== 'undefined' && document.body ) {
			document.body.removeAttribute( BODY_DRAGGING_ATTR );
			document.body.removeAttribute( BODY_DRAG_TYPE_ATTR );
			document.body.removeAttribute( BODY_DRAG_MODE_ATTR );
		}

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
		console.error( '[openstation] drop target onLeave threw:', target.id, err );
	}
	dispatchOnDocument( DRAG_EVENTS.LEAVE, {
		payload: session.payload,
		targetId: target.id,
	} );
}

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

function scrubOrphans(): void {
	for ( const el of findOrphans() ) {
		el.classList.remove( SOURCE_DRAGGING_CLASS, TARGET_DROP_ACTIVE_CLASS );
		el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
		el.removeAttribute( FILES_DROP_ACTIVE_ATTR );
	}
}
