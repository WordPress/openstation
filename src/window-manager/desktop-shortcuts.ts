import { isMobileStamped } from '../mode/stamp';
import { isTextEntryFocus } from './switcher';
import { refreshOverviewTopBar } from './overview';
import type { WindowManager } from './index';

export type DesktopDirection = 'prev' | 'next';

export function switchToAdjacentDesktop(
	mgr: WindowManager,
	direction: DesktopDirection,
): boolean {
	const desktops = mgr.getDesktops();
	if ( desktops.length < 2 ) {
		return false;
	}
	const activeId = mgr.getActiveDesktopId();
	const idx = desktops.findIndex( ( d ) => d.id === activeId );
	if ( idx === -1 ) {
		return false;
	}
	const step = direction === 'next' ? 1 : -1;

	const targetIdx = ( idx + step + desktops.length ) % desktops.length;
	if ( targetIdx === idx ) {
		return false;
	}
	mgr.switchDesktop( desktops[ targetIdx ].id, { direction } );
	return true;
}

export function cycleOverviewCursor(
	mgr: WindowManager,
	direction: DesktopDirection,
): boolean {
	if ( ! mgr._overviewActive ) {
		return false;
	}
	const desktops = mgr.getDesktops();

	const cycleLength = desktops.length + 1;
	const ADD_INDEX = desktops.length;
	const currentIdx = mgr._overviewAddTileFocused
		? ADD_INDEX
		: desktops.findIndex( ( d ) => d.id === mgr.getActiveDesktopId() );
	if ( currentIdx === -1 ) {
		return false;
	}
	const step = direction === 'next' ? 1 : -1;
	const targetIdx = ( currentIdx + step + cycleLength ) % cycleLength;
	if ( targetIdx === currentIdx ) {
		return false;
	}

	if ( targetIdx === ADD_INDEX ) {
		mgr._overviewAddTileFocused = true;
		refreshOverviewTopBar( mgr );
		return true;
	}

	mgr._overviewAddTileFocused = false;
	mgr.switchDesktop( desktops[ targetIdx ].id, { direction } );
	return true;
}

export function toggleOverview( mgr: WindowManager ): boolean {
	if ( mgr._overviewActive ) {
		mgr.exitOverview();
	} else {
		mgr.enterOverview();
	}
	return true;
}

export function toggleShowDesktop( mgr: WindowManager ): boolean {
	if ( mgr._overviewActive ) {
		return false;
	}
	if ( mgr.getAll().length === 0 ) {
		return false;
	}
	mgr.toggleShowDesktop();
	return true;
}

export function exitOverviewIfActive( mgr: WindowManager ): boolean {
	if ( ! mgr._overviewActive ) {
		return false;
	}
	mgr.exitOverview();
	return true;
}

function isModalOpen(): boolean {
	return null !== document.querySelector(
		'os-modal[open], os-confirm-dialog[open]',
	);
}

function isShowDesktopActive( mgr: WindowManager ): boolean {
	const all = mgr.getAll();
	if ( all.length === 0 ) {
		return false;
	}
	return all.every( ( w ) => w.state === 'minimized' );
}

export function exitShowDesktopIfActive( mgr: WindowManager ): boolean {
	if ( ! isShowDesktopActive( mgr ) ) {
		return false;
	}

	mgr.toggleShowDesktop();
	return true;
}

let installed = false;

export function installDesktopArrowShortcuts( mgr: WindowManager ): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ) {
				return;
			}

			if ( isMobileStamped() ) {
				return;
			}
			if (
				e.code !== 'ArrowLeft' &&
				e.code !== 'ArrowRight' &&
				e.code !== 'ArrowUp' &&
				e.code !== 'ArrowDown'
			) {
				return;
			}
			if ( isTextEntryFocus( document ) ) {
				return;
			}
			if ( isModalOpen() ) {
				return;
			}

			let handled = false;
			switch ( e.code ) {
				case 'ArrowLeft':
					handled = mgr._overviewActive
						? cycleOverviewCursor( mgr, 'prev' )
						: switchToAdjacentDesktop( mgr, 'prev' );
					break;
				case 'ArrowRight':
					handled = mgr._overviewActive
						? cycleOverviewCursor( mgr, 'next' )
						: switchToAdjacentDesktop( mgr, 'next' );
					break;
				case 'ArrowUp':

					handled =
						exitOverviewIfActive( mgr ) ||
						exitShowDesktopIfActive( mgr ) ||
						toggleOverview( mgr );
					break;
				case 'ArrowDown':

					handled = exitOverviewIfActive( mgr ) || toggleShowDesktop( mgr );
					break;
			}

			if ( handled ) {
				e.preventDefault();
			}
		},
		true,
	);
}
