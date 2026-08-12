/**
 * Electron Adapter — host detection and URL rules.
 *
 * Pure functions over `window`, kept apart from the controller in
 * `./index.ts` so the interesting decisions — is a host present, is it
 * a version we understand, what does its menu row say, what URL should
 * a freed window load — can be exercised without a shell, a window
 * manager, or a DOM.
 *
 * The detection rule is deliberately strict. A page can be *hosted by*
 * the desktop app (the shell) or *be* a freed window, and those are
 * different capabilities: the shell can free windows, a freed window
 * cannot. Confusing the two would put a "Send to your Mac" row inside
 * a window that is already on the Mac.
 */

import type { DesktopFrameBridge, DesktopHostBridge } from './types';

/**
 * Highest host protocol this adapter knows how to talk.
 *
 * A host reporting a *higher* number is a newer app against an older
 * plugin. Decline rather than guess: the app's own fallbacks are
 * better than a shell calling methods with payloads it may be shaping
 * wrong. A lower number is fine — this version has only added to the
 * contract.
 */
export const HOST_PROTOCOL = 1;

interface HostGlobals {
	openStationDesktopHost?: Partial< DesktopHostBridge >;
	openStationDesktopFrame?: Partial< DesktopFrameBridge >;
}

/**
 * The host bridge, or null.
 *
 * @param scope Window-like object to probe. Defaults to `window`.
 * @return The bridge when one is present, understood, and complete
 *         enough to call; null in a browser.
 */
export function getHostBridge(
	scope: unknown = typeof window === 'undefined' ? undefined : window,
): DesktopHostBridge | null {
	if ( ! scope ) {
		return null;
	}
	const candidate = ( scope as HostGlobals ).openStationDesktopHost;
	if ( ! candidate || true !== candidate.isDesktopHost ) {
		return null;
	}
	const protocol = Number( candidate.protocol );
	if ( ! Number.isFinite( protocol ) || protocol > HOST_PROTOCOL ) {
		return null;
	}
	// Guard the one method every host-dependent path calls, so a
	// half-injected preload reads as "no host" rather than throwing on
	// first use.
	if ( 'function' !== typeof candidate.freeWindow ) {
		return null;
	}
	return candidate as DesktopHostBridge;
}

/**
 * The freed-window bridge, or null.
 *
 * @param scope Window-like object to probe. Defaults to `window`.
 * @return The bridge when this page IS a freed window; null otherwise.
 */
export function getFrameBridge(
	scope: unknown = typeof window === 'undefined' ? undefined : window,
): DesktopFrameBridge | null {
	if ( ! scope ) {
		return null;
	}
	const candidate = ( scope as HostGlobals ).openStationDesktopFrame;
	if ( ! candidate || true !== candidate.isFreedWindow ) {
		return null;
	}
	return candidate as DesktopFrameBridge;
}

/**
 * The ⋯-menu label for setting a window free, adapted to the host OS.
 *
 * The host reports its own name ("Mac", "Windows PC", "Linux desktop")
 * rather than the adapter deriving one from the user agent: the app
 * knows what it is running on, and a new platform should only need the
 * app updated.
 *
 * @param osLabel   Host-reported OS name.
 * @param translate Optional translator, so the caller supplies wp.i18n.
 * @return Menu row text, e.g. "Send to your Mac".
 */
export function sendLabel(
	osLabel: string,
	translate: ( text: string ) => string = ( text ) => text,
): string {
	const label = String( osLabel || '' ).trim();
	if ( ! label ) {
		return translate( 'Send to your desktop' );
	}
	return translate( 'Send to your %s' ).replace( '%s', label );
}

/** Minimal window shape `freedWindowUrl` reads. */
export interface WindowLike {
	id: string;
	config: { native?: boolean; title?: string };
	getCurrentUrl?: () => string;
}

/**
 * Build the URL a freed native window should load.
 *
 * This is the one piece of knowledge the host app must not have. Two
 * shapes, and the difference matters:
 *
 *   - **Iframe windows** already have an admin URL, and it is already
 *     chromeless — literally the `src` the in-shell iframe was
 *     showing. Reusing it means the freed window is not a re-render of
 *     the page but the same page, at the same point in the same
 *     session, with every plugin's admin JS running as it was.
 *   - **Native windows** have no URL at all; they are painted into the
 *     shell's DOM by a registered render callback. So point the native
 *     window at the shell itself in solo mode, which boots the whole
 *     framework and paints that one window. Heavier, and unavoidable:
 *     a native window without its framework is not a window, it is an
 *     unrendered callback.
 *
 * @param win            The OpenStation window.
 * @param opts           URL context.
 * @param opts.adminUrl  Admin base URL from the shell config.
 * @param opts.soloParam Query var that triggers solo mode.
 * @param opts.origin    Base for resolving a relative current URL.
 * @return An absolute http(s) URL, or '' when one cannot be built.
 */
export function freedWindowUrl(
	win: WindowLike,
	opts: { adminUrl: string; soloParam: string; origin?: string },
): string {
	const isNative = !! win.config?.native;
	const current = win.getCurrentUrl ? win.getCurrentUrl() : '';

	if ( ! isNative && current ) {
		try {
			const url = new URL( current, opts.origin || undefined );
			if ( ! /^https?:$/.test( url.protocol ) ) {
				return '';
			}
			// The in-shell iframe is already chromeless, but a window
			// whose user navigated inside it may have dropped the flag
			// on a redirect. Setting it is idempotent and cheap.
			url.searchParams.set( 'openstation_chromeless', '1' );
			return url.toString();
		} catch {
			return '';
		}
	}

	if ( ! opts.adminUrl || ! win.id ) {
		return '';
	}
	try {
		const solo = new URL( 'index.php', opts.adminUrl );
		solo.searchParams.set( opts.soloParam || 'openstation_solo', win.id );
		return solo.toString();
	} catch {
		return '';
	}
}
