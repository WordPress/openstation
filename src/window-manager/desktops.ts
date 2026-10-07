import { doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import type { Desktop } from '../types';
import type { Window } from '../window';
import { showDesktopNameHud } from './desktop-name-hud';
import { computeOverviewLayout } from './geometry';
import {
	createOverviewLabel,
	prepareWindowForOverviewLayout,
	refreshOverviewTopBar,
	restoreWindowAfterOverviewLayout,
} from './overview';
import { overviewTopBarReserve } from './overview-constants';
import type { WindowManager } from './index';

export function getDesktops( mgr: WindowManager ): Desktop[] {
	return [ ...mgr._desktops ];
}

export function getActiveDesktop( mgr: WindowManager ): Desktop {
	const found = mgr._desktops.find( ( d ) => d.id === mgr._activeDesktopId );

	return found ?? mgr._desktops[ 0 ];
}

export function getActiveDesktopId( mgr: WindowManager ): string {
	return getActiveDesktop( mgr ).id;
}

export function applyDesktopVisibility( mgr: WindowManager, win: Window ): void {
	const visible = win.config.desktopId === mgr._activeDesktopId;
	win.element.style.display = visible ? '' : 'none';
	if ( visible && ! mgr._overviewActive ) {
		restoreWindowAfterOverviewLayout( win );
	}
}

export function refreshDesktopVisibility( mgr: WindowManager ): void {
	for ( const w of mgr._stack ) {
		applyDesktopVisibility( mgr, w );
	}
}

export function moveWindowToDesktop(
	mgr: WindowManager,
	windowId: string,
	desktopId: string,
): boolean {
	const win = mgr._stack.find( ( w ) => w.id === windowId );
	if ( ! win || ! mgr._desktops.some( ( d ) => d.id === desktopId ) ) {
		return false;
	}
	const from = win.config.desktopId || mgr._activeDesktopId;
	if ( from === desktopId ) {
		return true;
	}
	win.config.desktopId = desktopId;
	if ( mgr._overviewActive ) {
		relayoutOverviewForActiveDesktop( mgr );
	} else {
		applyDesktopVisibility( mgr, win );
	}
	doAction( HOOKS.WINDOW_DESKTOP_CHANGED, {
		windowId,
		from,
		to: desktopId,
	} );
	return true;
}

export function createDesktop(
	mgr: WindowManager,
	init?: { label?: string },
): Desktop {
	mgr._desktopSeq++;
	const desktop: Desktop = {
		id: `desktop-${ mgr._desktopSeq }`,
		label:
			init?.label?.trim().slice( 0, DESKTOP_LABEL_MAX_LENGTH ) ||

			sprintf( __( 'Workspace %d' ), mgr._desktopSeq ),
	};
	mgr._desktops.push( desktop );
	doAction( HOOKS.DESKTOP_CREATED, { desktopId: desktop.id } );
	return desktop;
}

export const DESKTOP_LABEL_MAX_LENGTH = 64;

export function renameDesktop(
	mgr: WindowManager,
	id: string,
	label: string,
): boolean {
	const desktop = mgr._desktops.find( ( d ) => d.id === id );
	if ( ! desktop ) {
		return false;
	}
	const next = label.trim().slice( 0, DESKTOP_LABEL_MAX_LENGTH );
	if ( ! next || next === desktop.label ) {
		return false;
	}
	const previousLabel = desktop.label;
	desktop.label = next;
	doAction( HOOKS.DESKTOP_RENAMED, {
		desktopId: id,
		label: next,
		previousLabel,
	} );
	return true;
}

export interface SwitchDesktopOptions {

	direction?: 'next' | 'prev';

	skipFocus?: boolean;
}

export function switchDesktop(
	mgr: WindowManager,
	id: string,
	opts?: SwitchDesktopOptions,
): void {
	if ( id === mgr._activeDesktopId ) {
		return;
	}
	if ( ! mgr._desktops.some( ( d ) => d.id === id ) ) {
		return;
	}
	const previousId = mgr._activeDesktopId;
	mgr._activeDesktopId = id;

	if ( mgr._overviewActive ) {
		relayoutOverviewForActiveDesktop( mgr );
		refreshOverviewTopBar( mgr );
	} else {
		refreshDesktopVisibility( mgr );
		if ( opts?.direction ) {
			animateDesktopSwitch( mgr, opts.direction );
		}

		if ( ! opts?.skipFocus ) {
			const topOnNew = [ ...mgr._stack ]
				.reverse()
				.find(
					( w ) =>
						w.config.desktopId === id && w.state !== 'minimized',
				);
			if ( topOnNew ) {
				mgr.focus( topOnNew );
			}
		}

		const landed = mgr._desktops.find( ( d ) => d.id === id );
		if ( landed ) {
			showDesktopNameHud( mgr._desktop, landed.label );
		}
	}

	doAction( HOOKS.DESKTOP_SWITCHED, {
		from: previousId,
		to: id,
	} );
}

function animateDesktopSwitch(
	mgr: WindowManager,
	direction: 'next' | 'prev',
): void {
	const el = mgr._desktop;
	const cls =
		direction === 'next'
			? 'os-area--sliding-from-right'
			: 'os-area--sliding-from-left';
	el.classList.remove(
		'os-area--sliding-from-right',
		'os-area--sliding-from-left',
	);
	void el.offsetWidth;
	el.classList.add( cls );
	const onEnd = ( e: AnimationEvent ): void => {
		if ( ! e.animationName.startsWith( 'os-area-slide-from-' ) ) {
			return;
		}
		el.classList.remove( cls );
		el.removeEventListener( 'animationend', onEnd );
	};
	el.addEventListener( 'animationend', onEnd );
}

export function closeDesktop( mgr: WindowManager, id: string ): void {
	if ( mgr._desktops.length <= 1 ) {
		return;
	}
	const idx = mgr._desktops.findIndex( ( d ) => d.id === id );
	if ( idx === -1 ) {
		return;
	}

	const survivorIdx = idx > 0 ? idx - 1 : 1;
	const survivor = mgr._desktops[ survivorIdx ];

	for ( const w of mgr._stack ) {
		if ( w.config.desktopId === id ) {
			w.config.desktopId = survivor.id;
		}
	}

	mgr._desktops.splice( idx, 1 );

	const wasActive = mgr._activeDesktopId === id;
	if ( wasActive ) {
		mgr._activeDesktopId = survivor.id;
	}

	if ( mgr._overviewActive ) {
		relayoutOverviewForActiveDesktop( mgr );
	} else {
		refreshDesktopVisibility( mgr );
	}

	doAction( HOOKS.DESKTOP_CLOSED, {
		desktopId: id,
		migratedTo: survivor.id,
	} );

	if ( wasActive ) {
		doAction( HOOKS.DESKTOP_SWITCHED, {
			from: id,
			to: survivor.id,
		} );
	}
}

export function relayoutOverviewForActiveDesktop( mgr: WindowManager ): void {
	for ( const [ winId, snap ] of mgr._overviewSnapshot ) {
		const w = mgr.getById( winId );
		if ( w ) {
			w.element.style.transform = snap.transform;
			w.element.style.transition = snap.transition;
			w.element.classList.remove( 'os-window--overview' );
			restoreWindowAfterOverviewLayout(
				w,
				w.config.desktopId === mgr._activeDesktopId,
			);
		}
	}
	for ( const label of mgr._overviewLabels.values() ) {
		label.remove();
	}
	mgr._overviewLabels.clear();
	mgr._overviewSnapshot.clear();

	refreshDesktopVisibility( mgr );

	const eligible = mgr._stack.filter(
		( w ) =>
			w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	for ( const w of eligible ) {
		mgr._overviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
		prepareWindowForOverviewLayout( w );
	}

	const live = mgr._desktop.getBoundingClientRect();
	const targetRect = new DOMRect( 0, 0, live.width, live.height );
	const layout = computeOverviewLayout(
		eligible,
		targetRect,
		overviewTopBarReserve( mgr._overviewTopBar ),
	);
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'os-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;
		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;
		const label = createOverviewLabel( item );
		el.insertAdjacentElement( 'afterend', label );
		mgr._overviewLabels.set( item.win.id, label );
	}
}

export function seedDesktops(
	mgr: WindowManager,
	desktops: Desktop[],
	activeDesktopId: string,
): void {
	if ( desktops.length === 0 ) {
		return;
	}
	mgr._desktops = desktops.map( ( d ) => ( { ...d } ) );
	mgr._activeDesktopId = desktops.some( ( d ) => d.id === activeDesktopId )
		? activeDesktopId
		: desktops[ 0 ].id;

	let highest = 0;
	for ( const d of desktops ) {
		const match = d.id.match( /^desktop-(\d+)$/ );
		if ( match ) {
			const n = parseInt( match[ 1 ], 10 );
			if ( Number.isFinite( n ) && n > highest ) {
				highest = n;
			}
		}
	}
	mgr._desktopSeq = Math.max( mgr._desktopSeq, highest );
}
