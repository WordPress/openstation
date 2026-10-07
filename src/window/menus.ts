import { HOOKS, doAction } from '../hooks';
import { urlMatchKey } from '../utils';
import {
	isActionChecked,
	isActionVisible,
	listWindowActions,
	resolveActionIcon,
	resolveActionLabel,
	subscribeWindowActions,
} from '../window-actions/registry';
import type { Window } from './index';

export function describeActionsMenu( win: Window ): string[] {
	const panel = win.element.querySelector( '.os-window__menu-panel' );
	if ( ! panel ) {
		return [];
	}
	const labels = Array.from(
		panel.querySelectorAll( 'os-menu-item:not(.os-window__menu-item--action)' ),
	).map( ( row ) => row.textContent?.trim() ?? '' );
	for ( const def of listWindowActions() ) {
		if ( isActionVisible( def, win ) ) {
			labels.push( resolveActionLabel( def, win ) );
		}
	}
	return labels.filter( Boolean );
}

export function toggleActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.os-window__menu-panel',
	) as HTMLElement | null;
	if ( ! panel ) {
		return;
	}
	if ( panel.hidden ) {
		openActionsMenu( win );
	} else {
		closeActionsMenu( win );
	}
}

export function openActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.os-window__menu-panel',
	) as HTMLElement | null;
	const btn = win.element.querySelector<HTMLElement>(
		'.os-window__menu-btn',
	);
	if ( ! panel || ! btn ) {
		return;
	}
	panel.hidden = false;
	btn.setAttribute( 'aria-expanded', 'true' );

	const startup = panel.querySelector<HTMLElement>(
		'.os-window__menu-item--startup',
	);
	if ( startup ) {
		refreshStartupCheckState( win, startup );
	}

	paintWindowActions( win, panel );

	win._unsubscribeWindowActions?.();
	win._unsubscribeWindowActions = subscribeWindowActions( () => {
		if ( ! panel.hidden ) {
			paintWindowActions( win, panel );
		}
	} );

	doAction( HOOKS.WINDOW_MENU_OPENED, {
		windowId: win.id,
		element: panel,
	} );

	if ( ! win._boundOnDocumentPointerDown ) {
		win._boundOnDocumentPointerDown = ( e: PointerEvent ) => {
			const target = e.target as Node | null;
			if ( ! target ) {
				return;
			}
			if ( panel.contains( target ) || btn.contains( target ) ) {
				return;
			}
			closeActionsMenu( win );
		};
	}

	setTimeout( () => {
		if ( win._boundOnDocumentPointerDown ) {
			document.addEventListener(
				'pointerdown',
				win._boundOnDocumentPointerDown,
				true,
			);
		}
	}, 0 );

	const firstItem = panel.querySelector<HTMLElement>( '[role="menuitem"]' );
	firstItem?.focus();
}

export function closeActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.os-window__menu-panel',
	) as HTMLElement | null;
	const btn = win.element.querySelector<HTMLElement>(
		'.os-window__menu-btn',
	);
	if ( panel ) {
		panel.hidden = true;
	}
	if ( btn ) {
		btn.setAttribute( 'aria-expanded', 'false' );
	}
	if ( win._boundOnDocumentPointerDown ) {
		document.removeEventListener(
			'pointerdown',
			win._boundOnDocumentPointerDown,
			true,
		);
	}

	win._unsubscribeWindowActions?.();
	win._unsubscribeWindowActions = null;
}

export function flipMenuItemCheckOptimistically( item: HTMLElement ): void {
	const isChecked = item.hasAttribute( 'checked' );
	if ( isChecked ) {
		item.removeAttribute( 'checked' );
	} else {
		item.setAttribute( 'checked', '' );
	}
}

export function refreshStartupCheckState(
	win: Window,
	item: HTMLElement,
): void {
	const pref = window.wp?.os?.config?.defaultWindow;
	let isDefault = false;
	if ( pref && pref.enabled && typeof pref.url === 'string' ) {
		if ( win.config.native ) {
			isDefault = pref.url === `native:${ win.id }`;
		} else {
			try {
				const currentKey = urlMatchKey( win.getCurrentUrl() );
				const prefKey = urlMatchKey( pref.url );
				isDefault = currentKey === prefKey;
			} catch {
				isDefault = false;
			}
		}
	}
	if ( isDefault ) {
		item.setAttribute( 'checked', '' );
	} else {
		item.removeAttribute( 'checked' );
	}
}

export function paintWindowActions( win: Window, panel: HTMLElement ): void {
	for ( const stale of Array.from(
		panel.querySelectorAll( '.os-window__menu-item--action' ),
	) ) {
		stale.remove();
	}

	for ( const def of listWindowActions() ) {
		if ( ! isActionVisible( def, win ) ) {
			continue;
		}
		const label = resolveActionLabel( def, win );
		if ( ! label ) {
			continue;
		}

		const item = document.createElement( 'os-menu-item' );
		item.setAttribute( 'value', def.id );
		item.classList.add( 'os-window__menu-item' );
		item.classList.add( 'os-window__menu-item--action' );
		item.setAttribute( 'data-action-id', def.id );
		item.textContent = label;

		if ( def.checkable ) {
			item.setAttribute( 'role', 'menuitemcheckbox' );
			if ( isActionChecked( def, win ) ) {
				item.setAttribute( 'checked', '' );
			}
		} else {
			item.setAttribute( 'role', 'menuitem' );
			const icon = resolveActionIcon( def, win );
			if ( icon ) {
				item.setAttribute( 'icon', icon );
			}
		}

		const closeOnSelect = def.closeOnSelect ?? ! def.checkable;

		item.addEventListener( 'os-menu-item-click', ( e: Event ) => {
			e.stopPropagation();
			if ( def.checkable ) {
				flipMenuItemCheckOptimistically( item );
			}
			if ( closeOnSelect ) {
				closeActionsMenu( win );
			}
			try {
				def.onSelect( win );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[openstation] window action "${ def.id }" threw:`,
						err,
					);
				}
			}
		} );

		panel.appendChild( item );
	}
}
