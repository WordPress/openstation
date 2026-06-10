/**
 * Desktop Mode — Window title-bar actions menu.
 *
 * Open / close lifecycle for the ⋯ menu in every window's title bar
 * (native and iframe). Items today: "Open on startup" (checkable),
 * optional "Open another <page>" for multi-capable pages, and — iframe
 * windows only — "Open in new window", "Reload", "Open in browser tab".
 * Each free function here takes the `Window` instance as its first arg.
 *
 * @since 0.8.1
 */

import { urlMatchKey } from '../utils';
import type { Window } from './index';

/** Toggle the title-bar actions menu open/closed. */
export function toggleActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.desktop-mode-window__menu-panel',
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

/**
 * Open the title-bar actions menu and wire an outside-click listener
 * that dismisses it. The listener uses pointerdown (capture phase) so
 * it fires before any click handler on the clicked target, which keeps
 * dock/icon clicks outside the menu from opening-then-immediately-
 * closing anything.
 */
export function openActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.desktop-mode-window__menu-panel',
	) as HTMLElement | null;
	const btn = win.element.querySelector<HTMLElement>(
		'.desktop-mode-window__menu-btn',
	);
	if ( ! panel || ! btn ) {
		return;
	}
	panel.hidden = false;
	btn.setAttribute( 'aria-expanded', 'true' );

	// Refresh "Open on startup" check state every time the menu opens.
	// The initial paint runs at window construction, BEFORE
	// `window.wp.desktop` is populated, so the first read would
	// silently fall back to unchecked. Reading on each open catches
	// that plus any external change (e.g. another window toggled
	// itself as default) that hasn't propagated yet.
	const startup = panel.querySelector<HTMLElement>(
		'.desktop-mode-window__menu-item--startup',
	);
	if ( startup ) {
		refreshStartupCheckState( win, startup );
	}

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
	// Attach on the next microtask so the same pointerdown that opened
	// the menu (bubbling up from the button) doesn't immediately close
	// it.
	setTimeout( () => {
		if ( win._boundOnDocumentPointerDown ) {
			document.addEventListener(
				'pointerdown',
				win._boundOnDocumentPointerDown,
				true,
			);
		}
	}, 0 );

	// Move focus into the panel for keyboard navigation.
	const firstItem = panel.querySelector<HTMLElement>( '[role="menuitem"]' );
	firstItem?.focus();
}

/** Close the title-bar actions menu. */
export function closeActionsMenu( win: Window ): void {
	const panel = win.element.querySelector(
		'.desktop-mode-window__menu-panel',
	) as HTMLElement | null;
	const btn = win.element.querySelector<HTMLElement>(
		'.desktop-mode-window__menu-btn',
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
}

/**
 * Flip the "Open on startup" check state immediately on click so the
 * user sees instant feedback — the REST round-trip confirms shortly
 * after via the `desktop-mode-default-window-changed` event, which
 * calls `refreshStartupCheckState` with the canonical state. If the
 * REST fails the optimistic flip stays (wrong) until the next menu
 * open, where the canonical check takes over.
 */
export function flipStartupCheckOptimistically( item: HTMLElement ): void {
	const isChecked = item.hasAttribute( 'checked' );
	if ( isChecked ) {
		item.removeAttribute( 'checked' );
	} else {
		item.setAttribute( 'checked', '' );
	}
	// The `<wpd-menu-item>` component mirrors `checked` into
	// `aria-checked` on its next render; no manual sync needed.
}

/**
 * Compare this window's current URL against the user's saved
 * default-window preference and paint the "Open on startup" menu
 * item's checked state accordingly. Called when the menu is built and
 * every time the public preference changes.
 */
export function refreshStartupCheckState(
	win: Window,
	item: HTMLElement,
): void {
	const pref = window.wp?.desktop?.config?.defaultWindow;
	let isDefault = false;
	if ( pref && pref.enabled && typeof pref.url === 'string' ) {
		// Native windows store their preference as `native:<id>` rather
		// than a URL — `urlMatchKey` would normalize an unrelated
		// string and false-match. Compare exactly for native windows;
		// fall back to URL-key matching for iframe windows.
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
