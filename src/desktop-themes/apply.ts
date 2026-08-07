/**
 * Desktop-theme activation.
 *
 * Three things happen when a theme becomes active:
 *
 *   1. `data-os-desktop-theme` lands on the shell root and
 *      `os-desktop-theme-<slug>` on `<body>` — the two
 *      halves of the compiled stylesheet's doubled selector. Both
 *      are needed: the shell root covers the desktop and windows,
 *      the body class covers toasts / dialogs / tooltips / context
 *      menus, which mount OUTSIDE `#os-shell`.
 *   2. The stylesheet is linked (uploaded themes) or injected
 *      (code-registered themes, which have no file).
 *   3. The icon map is published so `resolveThemedIcon()` starts
 *      answering.
 *
 * **Boot is free.** PHP already stamped the attribute, printed the
 * body class, and enqueued the stylesheet before the shell ran, so
 * there is no flash of the default palette. This module detects that
 * pre-stamped state and adopts it instead of rebuilding it.
 */

import { doAction, HOOKS } from '../hooks';
import { getDesktopTheme, getStore } from './registry';

/** `id` WordPress gives the `<link>` for the theme style handle. */
const LINK_ID = 'os-desktop-theme-css';
/** `id` WordPress gives the `<style>` for the inline (code-theme) variant. */
const INLINE_ID = 'os-desktop-theme-inline-css';
/** Marker on the element THIS module owns. */
const OWNED_ATTR = 'data-os-desktop-theme-css';

/** Public CustomEvent name for a real desktop-theme change. */
export const DESKTOP_THEME_CHANGED_EVENT = 'os-desktop-theme-changed';

/** Detail shape of {@link DESKTOP_THEME_CHANGED_EVENT}. */
export interface DesktopThemeChangedDetail {
	themeId: string | null;
	previous: string | null;
}

function shellRoot(): HTMLElement | null {
	return document.getElementById( 'os-shell' );
}

/**
 * Every element that could be carrying theme CSS right now: the two
 * WordPress-printed boot elements plus whatever we injected.
 */
function styleElements(): HTMLElement[] {
	const found: HTMLElement[] = [];
	for ( const id of [ LINK_ID, INLINE_ID ] ) {
		const el = document.getElementById( id );
		if ( el ) {
			found.push( el );
		}
	}
	document.querySelectorAll< HTMLElement >( `[${ OWNED_ATTR }]` ).forEach(
		( el ) => {
			if ( ! found.includes( el ) ) {
				found.push( el );
			}
		},
	);
	return found;
}

function removeStyleElements(): void {
	for ( const el of styleElements() ) {
		el.remove();
	}
}

/**
 * Whether PHP already set up this exact theme for this page load.
 *
 * When true we adopt the server's work wholesale rather than
 * tearing down a perfectly good `<link>` and re-requesting the same
 * stylesheet — that round-trip is precisely the FOUC the server-side
 * stamp exists to prevent.
 */
function bootAlreadyApplied( slug: string ): boolean {
	const shell = shellRoot();
	if ( ! shell ) {
		return false;
	}
	if ( shell.getAttribute( 'data-os-desktop-theme' ) !== slug ) {
		return false;
	}
	return styleElements().length > 0;
}

function applyBodyClass( slug: string | null ): void {
	const body = document.body;
	if ( ! body ) {
		return;
	}
	const stale: string[] = [];
	body.classList.forEach( ( name ) => {
		if ( name.startsWith( 'os-desktop-theme-' ) ) {
			stale.push( name );
		}
	} );
	for ( const name of stale ) {
		if ( slug === null || name !== `os-desktop-theme-${ slug }` ) {
			body.classList.remove( name );
		}
	}
	if ( slug !== null ) {
		body.classList.add( `os-desktop-theme-${ slug }` );
	}
}

/**
 * Activate a desktop theme, or return to the system default.
 *
 * Safe to call on every `OsSettings.apply()` — a call that doesn't
 * change the active theme costs two comparisons and returns. That
 * is why the single wiring point is `apply()`: boot, picking a
 * theme, resetting settings, and rolling back a failed save all
 * route through it, and none of them need to know about themes.
 *
 * @public
 *
 * @param themeId Theme slug or id. `''` / `null` = system default.
 */
export function applyDesktopTheme( themeId: string | null | undefined ): void {
	const store = getStore();
	const previous = store.state.activeId;

	const requested = typeof themeId === 'string' ? themeId.trim() : '';
	const theme = requested === '' ? null : getDesktopTheme( requested );
	// An id that isn't in the library (deleted theme, deactivated
	// plugin) degrades to the system default rather than erroring —
	// same contract the PHP enqueue side follows.
	const nextId = theme ? theme.slug : null;

	if ( nextId === previous ) {
		return;
	}

	const shell = shellRoot();

	if ( ! theme ) {
		shell?.removeAttribute( 'data-os-desktop-theme' );
		applyBodyClass( null );
		removeStyleElements();
		store.setState( {
			activeId: null,
			activeIcons: null,
			activeIconColors: null,
		} );
	} else {
		if ( ! bootAlreadyApplied( theme.slug ) ) {
			removeStyleElements();
			if ( theme.cssUrl !== '' ) {
				const link = document.createElement( 'link' );
				link.id = LINK_ID;
				link.rel = 'stylesheet';
				link.href = theme.cssUrl;
				link.setAttribute( OWNED_ATTR, theme.slug );
				document.head.appendChild( link );
			} else if ( theme.cssText !== '' ) {
				const style = document.createElement( 'style' );
				style.setAttribute( OWNED_ATTR, theme.slug );
				style.textContent = theme.cssText;
				document.head.appendChild( style );
			}
		}
		shell?.setAttribute( 'data-os-desktop-theme', theme.slug );
		applyBodyClass( theme.slug );
		store.setState( {
			activeId: theme.slug,
			// A theme with no icon overrides still publishes `{}` —
			// NOT null. `null` is reserved for "no theme at all", and
			// conflating the two would make the resolver's fast path
			// lie about an active theme.
			activeIcons: theme.icons,
			activeIconColors: theme.iconColors,
		} );
	}

	const detail: DesktopThemeChangedDetail = {
		themeId: nextId,
		previous,
	};
	doAction( HOOKS.DESKTOP_THEME_CHANGED, detail );
	if ( typeof document !== 'undefined' ) {
		document.dispatchEvent(
			new CustomEvent< DesktopThemeChangedDetail >(
				DESKTOP_THEME_CHANGED_EVENT,
				{ detail },
			),
		);
	}
}
