import { doAction, HOOKS } from '../hooks';
import { workAreaRectOf } from '../work-area';
import type { Window } from '../window';
import { snapHalfRect } from './geometry';
import { enterSplitOverview } from './split-overview';
import type { WindowManager } from './index';

export const SNAP_EDGE_THRESHOLD = 30;

const SNAP_COMMIT_MS = 260;

export type SnapZone = 'left' | 'right';

export function detectSnapZone(
	clientX: number,
	desktopRect: DOMRect,
): SnapZone | null {
	if ( clientX <= desktopRect.left + SNAP_EDGE_THRESHOLD ) {
		return 'left';
	}
	if ( clientX >= desktopRect.right - SNAP_EDGE_THRESHOLD ) {
		return 'right';
	}
	return null;
}

function snappedZoneOf( win: Window ): SnapZone | null {
	if ( win.state === 'snapped-left' ) {
		return 'left';
	}
	if ( win.state === 'snapped-right' ) {
		return 'right';
	}
	return null;
}

export function snapPartnerMinWidth(
	mgr: WindowManager,
	win: Window,
	zone: SnapZone,
): number {
	const opposite: SnapZone = zone === 'left' ? 'right' : 'left';
	let min = 0;
	for ( const other of mgr._stack ) {
		if (
			other !== win &&
			other.config.desktopId === win.config.desktopId &&
			snappedZoneOf( other ) === opposite
		) {
			min = Math.max( min, other.config.minWidth || 0 );
		}
	}
	return min;
}

export function snapZoneBounds(
	mgr: WindowManager,
	zone: SnapZone,
	win?: Window,
): { x: number; y: number; width: number; height: number } {
	const rect = snapHalfRect(
		workAreaRectOf( mgr._desktop ),
		zone,
		win?.config.minWidth || 0,
		win ? snapPartnerMinWidth( mgr, win, zone ) : 0,
	);
	return { ...rect, height: Math.floor( rect.height ) };
}

export function relayoutSnappedWindow( mgr: WindowManager, win: Window ): void {
	const zone = snappedZoneOf( win );
	const parent = win.element.parentElement;
	if ( ! zone || ! parent ) {
		return;
	}
	const rect = snapHalfRect(
		workAreaRectOf( parent ),
		zone,
		win.config.minWidth || 0,
		snapPartnerMinWidth( mgr, win, zone ),
	);
	const next = {
		left: `${ rect.x }px`,
		top: `${ rect.y }px`,
		width: `${ rect.width }px`,
		height: `${ rect.height }px`,
	};
	const style = win.element.style;
	if (
		style.left === next.left &&
		style.top === next.top &&
		style.width === next.width &&
		style.height === next.height
	) {
		return;
	}
	style.left = next.left;
	style.top = next.top;
	style.width = next.width;
	style.height = next.height;
}

export function installSnapPartnerReflow( mgr: WindowManager ): () => void {
	let snapshot = new Map< string, { zone: SnapZone; desktopId: string } >();

	const sync = (): void => {
		if ( mgr._overviewActive ) {
			return;
		}
		const next = new Map< string, { zone: SnapZone; desktopId: string } >();
		for ( const w of mgr._stack ) {
			const zone = snappedZoneOf( w );
			if ( zone ) {
				next.set( w.id, { zone, desktopId: w.config.desktopId || '' } );
			}
		}

		const touched = new Set< string >();
		const diff = (
			from: typeof snapshot,
			to: typeof snapshot,
		): void => {
			for ( const [ id, entry ] of from ) {
				const other = to.get( id );
				if (
					! other ||
					other.zone !== entry.zone ||
					other.desktopId !== entry.desktopId
				) {
					touched.add( entry.desktopId );
				}
			}
		};
		diff( snapshot, next );
		diff( next, snapshot );
		snapshot = next;
		if ( touched.size === 0 ) {
			return;
		}

		for ( const w of mgr._stack ) {
			const entry = next.get( w.id );
			if ( entry && touched.has( entry.desktopId ) ) {
				relayoutSnappedWindow( mgr, w );
			}
		}
	};

	document.addEventListener( 'os-window-changed', sync );
	document.addEventListener( 'os-window-closed', sync );
	return () => {
		document.removeEventListener( 'os-window-changed', sync );
		document.removeEventListener( 'os-window-closed', sync );
	};
}

export function oppositeHalfRect(
	mgr: WindowManager,
	zone: SnapZone,
): DOMRect {
	const rect = mgr._desktop.getBoundingClientRect();
	const halfW = Math.floor( rect.width / 2 );
	const height = Math.floor( rect.height );
	if ( zone === 'left' ) {
		return new DOMRect( halfW, 0, halfW, height );
	}
	return new DOMRect( 0, 0, halfW, height );
}

export function showSnapPreview(
	mgr: WindowManager,
	zone: SnapZone,
	win?: Window,
): void {
	if ( mgr._snapPendingZone === zone && mgr._snapPreviewEl ) {
		return;
	}
	mgr._snapPendingZone = zone;
	if ( ! mgr._snapPreviewEl ) {
		const el = document.createElement( 'div' );
		el.className = 'os-snap-preview';
		el.setAttribute( 'aria-hidden', 'true' );
		mgr._desktop.appendChild( el );
		mgr._snapPreviewEl = el;

		Promise.resolve().then( () => {
			el.classList.add( 'os-snap-preview--visible' );
		} );
	}
	const b = snapZoneBounds( mgr, zone, win );
	mgr._snapPreviewEl.style.left = `${ b.x }px`;
	mgr._snapPreviewEl.style.top = `${ b.y }px`;
	mgr._snapPreviewEl.style.width = `${ b.width }px`;
	mgr._snapPreviewEl.style.height = `${ b.height }px`;
	mgr._snapPreviewEl.dataset.zone = zone;
}

export function hideSnapPreview( mgr: WindowManager ): void {
	if ( ! mgr._snapPreviewEl ) {
		mgr._snapPendingZone = null;
		return;
	}
	const el = mgr._snapPreviewEl;
	mgr._snapPreviewEl = null;
	mgr._snapPendingZone = null;
	el.classList.remove( 'os-snap-preview--visible' );

	window.setTimeout( () => {
		el.remove();
	}, SNAP_COMMIT_MS );
}

export function updateSnapZoneForDrag(
	mgr: WindowManager,
	win: Window,
	clientX: number,
): void {
	if ( mgr._splitOverviewActive ) {
		return;
	}
	const rect = mgr._desktop.getBoundingClientRect();
	const zone = detectSnapZone( clientX, rect );
	const previous = mgr._snapPendingZone;
	if ( zone ) {
		showSnapPreview( mgr, zone, win );
		if ( previous !== zone ) {
			doAction( HOOKS.SNAP_ZONE_PENDING, {
				windowId: win.id,
				zone,
			} );
		}
	} else if ( previous ) {
		hideSnapPreview( mgr );
		doAction( HOOKS.SNAP_ZONE_CANCELED, { windowId: win.id } );
	}
}

export function commitSnapIfPending(
	mgr: WindowManager,
	win: Window,
): boolean {
	const zone = mgr._snapPendingZone;
	if ( ! zone ) {
		return false;
	}
	hideSnapPreview( mgr );

	win.snapTo( zone );

	doAction( HOOKS.SNAP_ZONE_COMMITTED, {
		windowId: win.id,
		zone,
	} );

	window.requestAnimationFrame( () => {
		enterSplitOverview( mgr, win, zone );
	} );

	return true;
}

export function abortSnapIfPending( mgr: WindowManager ): void {
	if ( mgr._snapPendingZone ) {
		hideSnapPreview( mgr );
	}
}
