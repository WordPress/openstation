import type { Window } from '../window';
import type { WindowManager } from './index';

export type CycleDirection = 'next' | 'prev';

function cycleableWindows( mgr: WindowManager ): Window[] {
	const activeDesktopId = mgr.getActiveDesktopId();
	const domOrder = Array.from( mgr._desktop.children );
	return mgr
		.getAll()
		.filter( ( w ) => {
			const winDesktop = w.config.desktopId || activeDesktopId;
			return winDesktop === activeDesktopId;
		} )
		.sort(
			( a, b ) =>
				domOrder.indexOf( a.element ) - domOrder.indexOf( b.element ),
		);
}

export function cycleFocus( mgr: WindowManager, direction: CycleDirection ): void {
	if ( mgr._overviewActive ) {
		return;
	}
	const list = cycleableWindows( mgr );
	if ( list.length < 2 ) {
		return;
	}

	const focused = mgr.getFocused();
	const currentIdx = focused ? list.indexOf( focused ) : -1;
	const step = direction === 'next' ? 1 : -1;

	const nextIdx = ( currentIdx + step + list.length ) % list.length;
	const target = list[ nextIdx ];

	if ( target.state === 'minimized' ) {
		target.restore();
	} else {
		mgr.focus( target );
	}
}

let installed = false;

export function isTextEntryFocus( doc: Document ): boolean {
	let el: Element | null = doc.activeElement;
	while ( el && el.shadowRoot && el.shadowRoot.activeElement ) {
		el = el.shadowRoot.activeElement;
	}
	return isTextEntryElement( el );
}

export function isTextEntryElement( el: Element | null ): boolean {
	if ( ! el ) {
		return false;
	}
	if ( el instanceof HTMLIFrameElement ) {
		return true;
	}
	if ( el instanceof HTMLTextAreaElement ) {
		return true;
	}
	if ( el instanceof HTMLInputElement ) {
		const textTypes = new Set( [
			'text',
			'search',
			'url',
			'email',
			'password',
			'tel',
			'number',
			'date',
			'datetime-local',
			'month',
			'week',
			'time',
		] );
		return textTypes.has( el.type );
	}
	if ( el instanceof HTMLElement && el.isContentEditable === true ) {
		return true;
	}

	const ce = el.getAttribute( 'contenteditable' );
	return ce !== null && ce !== 'false';
}

export function installWindowSwitcherShortcut( mgr: WindowManager ): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( e.ctrlKey || e.metaKey || e.altKey ) {
				return;
			}
			if ( e.code !== 'Backquote' ) {
				return;
			}
			if ( isTextEntryFocus( document ) ) {
				return;
			}
			e.preventDefault();
			cycleFocus( mgr, e.shiftKey ? 'prev' : 'next' );
		},
		true,
	);

	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as
			| { type?: string; direction?: CycleDirection }
			| null;
		if ( ! data || data.type !== 'os-window-switch' ) {
			return;
		}
		cycleFocus( mgr, data.direction === 'prev' ? 'prev' : 'next' );
	} );
}
