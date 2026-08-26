/**
 * OpenStation — Window title-bar actions menu.
 *
 * Open / close lifecycle for the ⋯ menu in every window's title bar
 * (native and iframe). Built-in items: "Open on startup" (checkable),
 * optional "Open another <page>" for multi-capable pages, and — iframe
 * windows only — "Open in new window", "Reload", "Open in browser tab".
 * Plugin-registered rows (`wp.os.registerWindowAction`) are appended
 * after those on every open by {@link paintWindowActions}, as verbs
 * or as checkboxes of their own.
 * Each free function here takes the `Window` instance as its first arg.
 */

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

/** Toggle the title-bar actions menu open/closed. */
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

/**
 * Open the title-bar actions menu and wire an outside-click listener
 * that dismisses it. The listener uses pointerdown (capture phase) so
 * it fires before any click handler on the clicked target, which keeps
 * dock/icon clicks outside the menu from opening-then-immediately-
 * closing anything.
 */
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

	// Refresh "Open on startup" check state every time the menu opens.
	// The initial paint runs at window construction, BEFORE
	// `window.wp.os` is populated, so the first read would
	// silently fall back to unchecked. Reading on each open catches
	// that plus any external change (e.g. another window toggled
	// itself as default) that hasn't propagated yet.
	const startup = panel.querySelector<HTMLElement>(
		'.os-window__menu-item--startup',
	);
	if ( startup ) {
		refreshStartupCheckState( win, startup );
	}

	// Plugin-registered actions repaint from scratch on every open —
	// see `paintWindowActions()` for why they cannot be built once.
	paintWindowActions( win, panel );

	/*
	 * Keep repainting while the menu stays open.
	 *
	 * An action registered a moment after the menu opened would
	 * otherwise not appear until the next open, and "open it twice"
	 * is a poor answer to "why isn't it there?". This is what lets a
	 * plugin answer `WINDOW_MENU_OPENED` with something asynchronous —
	 * a probe, a permission check — and still have its row land under
	 * the user's pointer.
	 */
	win._unsubscribeWindowActions?.();
	win._unsubscribeWindowActions = subscribeWindowActions( () => {
		if ( ! panel.hidden ) {
			paintWindowActions( win, panel );
		}
	} );

	/*
	 * Announced after the paint, so a subscriber that registers an
	 * action sees the repaint above rather than racing it.
	 */
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
	// Stop repainting a menu nobody is looking at.
	win._unsubscribeWindowActions?.();
	win._unsubscribeWindowActions = null;
}

/**
 * Flip a checkbox row's check state immediately on click so the user
 * sees instant feedback where they are looking, before whatever the
 * handler does to make it true has finished.
 *
 * For "Open on startup" that is a REST round-trip, confirmed shortly
 * after via the `os-default-window-changed` event, which calls
 * `refreshStartupCheckState` with the canonical state; if the REST
 * fails the optimistic flip stays (wrong) until the next menu open,
 * where the canonical check takes over. For a plugin's checkable
 * action the same bargain holds against its `checked()` reader, which
 * is re-read on every open.
 */
export function flipMenuItemCheckOptimistically( item: HTMLElement ): void {
	const isChecked = item.hasAttribute( 'checked' );
	if ( isChecked ) {
		item.removeAttribute( 'checked' );
	} else {
		item.setAttribute( 'checked', '' );
	}
	// The `<os-menu-item>` component mirrors `checked` into
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
	const pref = window.wp?.os?.config?.defaultWindow;
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

/**
 * Paint the plugin-registered rows of the ⋯ menu.
 *
 * Rebuilt from scratch on every open rather than kept in sync, and
 * that is the cheap correct choice rather than a lazy one: an action's
 * label, icon, visibility and check state are all allowed to be
 * functions of the window's current state, so "keeping them in sync"
 * would mean re-evaluating every predicate on every state change of
 * every window to catch the one menu that happens to be open. A menu
 * opens rarely and holds a handful of rows; rebuilding it costs
 * nothing and cannot drift. It is also what lets a plugin persist a
 * checkbox's value and repaint nothing — the row asks on open.
 *
 * A row whose handler throws is contained: the menu still closes and
 * the other rows still work. The ⋯ menu is shared surface, and one
 * plugin's bug must not cost the user their "Reload".
 *
 * The optimistic flip on a checkbox happens before the handler, so a
 * handler that throws leaves the tick where the user put it until the
 * next open re-reads `checked()` — the same bargain "Open on startup"
 * makes against a failed REST call.
 *
 * @param win   The window the menu belongs to.
 * @param panel The `<os-menu>` panel element.
 */
export function paintWindowActions( win: Window, panel: HTMLElement ): void {
	// Rows go in as direct children of the `role="menu"` panel, so the
	// previous pass is cleared by class rather than by emptying a
	// container — see the note in `createWindowElement()` for why there
	// is no container.
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
			// A checkbox reports state, so it gets the checkbox role and
			// the tick — and no leading glyph, which would compete with
			// the indicator for the same edge of the row.
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

		// A verb closes the menu, like every built-in one. A checkbox
		// stays open so the user watches the tick land — and so a row
		// they meant to flip twice does not cost them two menu opens.
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
