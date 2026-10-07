import { doAction, HOOKS } from '../hooks';
import type { Window } from '../window';
import { computeOverviewLayout } from './geometry';
import { createOverviewLabel } from './overview';
import { oppositeHalfRect, type SnapZone } from './snap-zones';
import type { WindowManager } from './index';

export function enterSplitOverview(
	mgr: WindowManager,
	anchor: Window,
	zone: SnapZone,
): void {
	if ( mgr._splitOverviewActive ) {
		return;
	}
	mgr._splitOverviewActive = true;
	mgr._splitOverviewAnchor = anchor;
	mgr._splitOverviewZone = zone;

	const eligible = mgr._stack.filter(
		( w ) =>
			w !== anchor &&
			w.state !== 'minimized' &&
			w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		cleanupSplitOverviewState( mgr );
		return;
	}

	mgr._splitOverviewSnapshot.clear();
	for ( const w of eligible ) {
		mgr._splitOverviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
	}

	mgr._desktop.classList.add( 'os-area--split-overview' );
	const rect = oppositeHalfRect( mgr, zone );
	const layout = computeOverviewLayout( eligible, rect, 0 );

	mgr._splitOverviewLabels.clear();
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'os-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;
		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;

		const label = createOverviewLabel( item );
		el.insertAdjacentElement( 'afterend', label );
		mgr._splitOverviewLabels.set( item.win.id, label );
	}

	const pressTargetForEvent = (
		e: PointerEvent,
	): { id: string; element: HTMLElement } | null => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.os-window--overview',
		);
		if ( winEl ) {
			return {
				id: winEl.id.replace( /^wp-window-/, '' ),
				element: winEl,
			};
		}
		if ( target ) {
			return { id: 'dismiss', element: mgr._desktop };
		}
		return null;
	};

	mgr._splitOverviewPointerDown = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			mgr._splitOverviewPressTarget = null;
			return;
		}
		mgr._splitOverviewPressTarget = pressTargetForEvent( e );
		if ( mgr._splitOverviewPressTarget ) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	mgr._splitOverviewPointerUp = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const pressed = mgr._splitOverviewPressTarget;
		mgr._splitOverviewPressTarget = null;
		if ( ! pressed ) {
			return;
		}
		const r = pressed.element.getBoundingClientRect();
		const inside =
			e.clientX >= r.left &&
			e.clientX <= r.right &&
			e.clientY >= r.top &&
			e.clientY <= r.bottom;
		if ( ! inside ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		if ( pressed.id === 'dismiss' ) {
			exitSplitOverview( mgr );
			return;
		}
		const selected = mgr.getById( pressed.id );
		if ( ! selected ) {
			exitSplitOverview( mgr );
			return;
		}
		fillOppositeHalfAndExit( mgr, selected );
	};

	mgr._splitOverviewKey = ( e: KeyboardEvent ) => {
		if ( e.key === 'Escape' ) {
			exitSplitOverview( mgr );
		}
	};

	mgr._splitOverviewClickBlocker = ( e: MouseEvent ) => {
		e.stopPropagation();
		e.preventDefault();
	};

	mgr._desktop.addEventListener(
		'pointerdown',
		mgr._splitOverviewPointerDown,
		true,
	);
	mgr._desktop.addEventListener(
		'pointerup',
		mgr._splitOverviewPointerUp,
		true,
	);
	mgr._desktop.addEventListener(
		'click',
		mgr._splitOverviewClickBlocker,
		true,
	);
	document.addEventListener( 'keydown', mgr._splitOverviewKey );
}

export function fillOppositeHalfAndExit( mgr: WindowManager, selected: Window ): void {
	const anchorZone = mgr._splitOverviewZone;
	if ( ! anchorZone ) {
		exitSplitOverview( mgr );
		return;
	}
	const partnerZone: SnapZone = anchorZone === 'left' ? 'right' : 'left';

	selected.element.style.transform = '';

	selected.element.classList.remove( 'os-window--overview' );

	selected.applySnap( partnerZone );

	mgr._splitOverviewSnapshot.delete( selected.id );

	mgr.focus( selected );

	doAction( HOOKS.SNAP_SPLIT_FILLED, {
		windowId: selected.id,
		zone: partnerZone,
	} );

	exitSplitOverview( mgr );
}

export function exitSplitOverview( mgr: WindowManager ): void {
	if ( ! mgr._splitOverviewActive ) {
		return;
	}
	mgr._splitOverviewActive = false;

	for ( const [ id, snap ] of mgr._splitOverviewSnapshot ) {
		const w = mgr.getById( id );
		if ( ! w ) {
			continue;
		}
		w.element.style.transform = snap.transform;
	}

	for ( const label of mgr._splitOverviewLabels.values() ) {
		label.classList.add( 'os-overview-label--out' );
	}
	mgr._desktop.classList.remove( 'os-area--split-overview' );

	const ANIMATION_MS = 260;
	window.setTimeout( () => {
		for ( const w of mgr._stack ) {
			if ( mgr._splitOverviewSnapshot.has( w.id ) ) {
				w.element.classList.remove( 'os-window--overview' );
			}
		}
		for ( const label of mgr._splitOverviewLabels.values() ) {
			label.remove();
		}
		cleanupSplitOverviewState( mgr );
	}, ANIMATION_MS );

	if ( mgr._splitOverviewPointerDown ) {
		mgr._desktop.removeEventListener(
			'pointerdown',
			mgr._splitOverviewPointerDown,
			true,
		);
		mgr._splitOverviewPointerDown = null;
	}
	if ( mgr._splitOverviewPointerUp ) {
		mgr._desktop.removeEventListener(
			'pointerup',
			mgr._splitOverviewPointerUp,
			true,
		);
		mgr._splitOverviewPointerUp = null;
	}
	if ( mgr._splitOverviewClickBlocker ) {
		mgr._desktop.removeEventListener(
			'click',
			mgr._splitOverviewClickBlocker,
			true,
		);
		mgr._splitOverviewClickBlocker = null;
	}
	if ( mgr._splitOverviewKey ) {
		document.removeEventListener( 'keydown', mgr._splitOverviewKey );
		mgr._splitOverviewKey = null;
	}
	mgr._splitOverviewPressTarget = null;
}

function cleanupSplitOverviewState( mgr: WindowManager ): void {
	mgr._splitOverviewSnapshot.clear();
	mgr._splitOverviewLabels.clear();
	mgr._splitOverviewAnchor = null;
	mgr._splitOverviewZone = null;
	mgr._splitOverviewActive = false;
}
