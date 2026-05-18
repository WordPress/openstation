/**
 * Desktop Mode — PWA install affordance.
 *
 * Registers a persistent system-tile on the dock so the install
 * action is always within reach of the user. Clicking it dispatches
 * the browser's install prompt when the site is currently
 * installable; otherwise it shows a contextual toast.
 *
 * UX policy:
 *
 *   - **Always visible.** The tile registers unconditionally on boot
 *     so users see a stable affordance, even on platforms where
 *     `beforeinstallprompt` never fires (Safari) or where the site
 *     is already installed. The icon is the *entry point*, not the
 *     *trigger*; the trigger is whatever the browser will let us do
 *     when the user clicks.
 *
 *   - **Click → context-aware action.**
 *       - Installable now (we have a deferred `beforeinstallprompt`):
 *         show the browser dialog.
 *       - Already installed (`display-mode: standalone`): toast
 *         "<site> is already installed".
 *       - Not yet installable (no event fired): toast suggesting the
 *         user keep using the page; Chrome's heuristic fires the
 *         event after a few seconds of engagement.
 *
 *   - **Survives page reloads.** Because we register from JS each
 *     boot, the tile is present whether or not a prior session ever
 *     saw `beforeinstallprompt`. Plugins reading `listSystemTiles()`
 *     will see it consistently.
 *
 *   - **Safari (iOS / iPadOS)** still gets the icon — clicking shows
 *     a "your browser doesn't support automatic install" toast;
 *     users use Share → Add to Home Screen for the actual install.
 *     The `apple-mobile-web-app-*` meta tags emitted from PHP make
 *     that work.
 *
 * @since 0.8.0
 */

import { __, sprintf } from '../i18n';
import type { ToastOptions } from '../toast';
import { getSwRegistrationStatus } from './sw-register';

/** Stable id for the tile — exported so tests can assert against it. */
export const PWA_INSTALL_TILE_ID = 'desktop-mode-pwa-install';

/**
 * Subset of the spec-shaped `BeforeInstallPromptEvent`. Typed locally
 * because TS's lib.dom.d.ts doesn't ship the type — Chromium-only.
 */
interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	prompt: () => Promise< void >;
	userChoice: Promise< { outcome: 'accepted' | 'dismissed' } >;
}

/** Detect whether the browser thinks we're already running standalone. */
export function isStandaloneDisplay(): boolean {
	if ( typeof window === 'undefined' ) {
		return false;
	}
	if ( window.matchMedia?.( '(display-mode: standalone)' ).matches ) {
		return true;
	}
	// Safari-specific — `navigator.standalone` is non-standard but the
	// only signal iOS exposes for "added to home screen".
	const nav = window.navigator as unknown as { standalone?: boolean };
	return nav.standalone === true;
}

/**
 * Best-effort "is this PWA installed in the current browser profile?"
 * detector, working from a regular browser tab (not the standalone
 * window). Two signals are checked, in order:
 *
 *   1. `display-mode: standalone` — current document is the PWA
 *      window itself.
 *   2. `navigator.getInstalledRelatedApps()` — Chrome / Edge surface
 *      that returns the PWAs installed at this origin. Requires the
 *      manifest to list the site under `related_applications`
 *      (we add that automatically in the PHP manifest builder).
 *
 * Returns `false` when neither signal fires — which is also the case
 * on Safari and any platform without `getInstalledRelatedApps`. The
 * caller falls back to a generic "install option unavailable" toast,
 * which is still a better message than the previous "try again later"
 * because it acknowledges the most common cause (already installed)
 * without falsely claiming we know the answer.
 */
export async function isLikelyInstalled(): Promise< boolean > {
	if ( isStandaloneDisplay() ) {
		return true;
	}
	const nav = window.navigator as unknown as {
		getInstalledRelatedApps?: () => Promise<
			Array< { platform?: string; url?: string; id?: string } >
		>;
	};
	if ( typeof nav.getInstalledRelatedApps !== 'function' ) {
		return false;
	}
	try {
		const apps = await nav.getInstalledRelatedApps();
		return Array.isArray( apps ) && apps.length > 0;
	} catch {
		return false;
	}
}

let _deferred: BeforeInstallPromptEvent | null = null;

/**
 * Wire up install detection. Attaches the `beforeinstallprompt` and
 * `appinstalled` window listeners so the rest of the module can react
 * to install state changes.
 *
 * Tile registration is **separate** — see {@link getInstallTileDef}.
 * desktop.ts inserts the tile next to the OS Settings tile with the
 * `'core'` rail affinity so it lands on the side dock (Classic
 * layout) or the primary rail (Unified / Spatial), matching where
 * users expect shell-owned affordances. Putting that placement
 * decision in desktop.ts keeps `install.ts` framework-agnostic — it
 * doesn't need to know about `layoutDispatcher` or affinities.
 *
 * Idempotent — a second call de-dupes listeners.
 */
export function installPwaInstallAffordance(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): void {
	if ( typeof window === 'undefined' ) {
		return;
	}

	window.removeEventListener(
		'beforeinstallprompt',
		_handleBeforeInstall as EventListener,
	);
	window.addEventListener(
		'beforeinstallprompt',
		_handleBeforeInstall as EventListener,
	);

	window.removeEventListener( 'appinstalled', _handleAppInstalled );
	window.addEventListener( 'appinstalled', _handleAppInstalled );

	function _handleBeforeInstall( ev: Event ): void {
		// `preventDefault` suppresses Chromium's mini-info-bar — we'd
		// rather route the install through our dock tile than have
		// two affordances fighting for the user's attention.
		ev.preventDefault();
		_deferred = ev as BeforeInstallPromptEvent;
	}

	function _handleAppInstalled(): void {
		_deferred = null;
		// Soft confirmation. The browser also emits its own UI in
		// many cases; one toast on top of that is fine.
		showToast( {
			message: sprintf(
				/* translators: %s: site name */
				__( 'Installed %s as an app.' ),
				siteName,
			),
		} );
	}
}

/**
 * Build the {@link SystemDockItem} definition for the install tile.
 * desktop.ts hands this to `layoutDispatcher.appendSystemTile` with
 * the `'core'` affinity so the icon lands next to OS Settings on the
 * side dock.
 */
export function getInstallTileDef(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): {
	id: string;
	title: string;
	icon: string;
	onOpen: () => void;
} {
	return {
		id: PWA_INSTALL_TILE_ID,
		title: sprintf(
			/* translators: %s: site name */
			__( 'Install %s as an app' ),
			siteName,
		),
		// Dashicons class — the dock renderer prefers Dashicons
		// strings. `dashicons-download` is the closest match for
		// "install" in the WordPress glyph set without shipping
		// bespoke artwork.
		icon: 'dashicons-download',
		onOpen: () => {
			void onTileClick( siteName, showToast );
		},
	};
}

async function onTileClick(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): Promise< void > {
	if ( _deferred ) {
		const event = _deferred;
		// `prompt()` may only be called once per
		// `beforeinstallprompt`; drop the reference so a double-click
		// during the race window doesn't violate the spec.
		_deferred = null;
		try {
			await event.prompt();
			const choice = await event.userChoice;
			if ( choice.outcome === 'dismissed' ) {
				// "Not now" — leave the tile in place; the browser
				// may re-fire `beforeinstallprompt` on a future
				// visit.
				showToast( {
					message: __( 'Install cancelled.' ),
				} );
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[desktop-mode] install prompt failed:',
					err,
				);
			}
		}
		return;
	}

	if ( await isLikelyInstalled() ) {
		showToast( {
			message: sprintf(
				/* translators: %s: site name */
				__(
					'%s is already installed. Open it from your apps menu or home screen.',
				),
				siteName,
			),
		} );
		return;
	}

	// Foreign service worker blocked our registration → Chromium will
	// never fire `beforeinstallprompt` because the installability
	// criterion requires OUR SW to be controlling. The generic "not
	// available" fallback leaves the user with no path forward; this
	// branch names the cause and points at the operator-side knob.
	if ( getSwRegistrationStatus() === 'foreign-sw' ) {
		showToast( {
			message: __(
				"Install isn't available — another plugin's service worker is active on this site. A site admin can opt in by setting the desktop_mode_pwa_force_replace_sw filter to true.",
			),
		} );
		return;
	}

	showToast( {
		message: __(
			"Install isn't available right now. Keep using the page; if it still doesn't appear, the app may already be installed in this browser.",
		),
	} );
}

/**
 * Programmatic re-trigger — exposed on the public API so a plugin
 * settings tab can offer "Install as app" without going through the
 * dock tile. Resolves to `'unavailable'` when no deferred event is
 * cached (browser hasn't fired one, app is already installed, or
 * platform doesn't support installable web apps).
 */
export async function promptInstall(): Promise<
	'accepted' | 'dismissed' | 'unavailable'
	> {
	if ( ! _deferred ) {
		return 'unavailable';
	}
	const event = _deferred;
	_deferred = null;
	try {
		await event.prompt();
		const choice = await event.userChoice;
		return choice.outcome;
	} catch {
		return 'unavailable';
	}
}

/**
 * Reset the dismissal flag — kept as a public no-op-ish helper for
 * plugin authors who already wrote code against the v0.8.0 dismiss
 * surface. The framework no longer renders a dismissable pill, so
 * the flag is essentially decorative now, but the REST round-trip
 * still happens for forwards-compat with a possible future
 * "minimised" tile state.
 */
export function undismissInstallHint(): void {
	// Defer to the state module dynamically to avoid a hard import
	// loop with the rest of the PWA bundle.
	import( './state' ).then( ( m ) => {
		m.updatePwaState( { installHintDismissed: false } );
	} );
}

/** Test-only: clear the deferred event reference. */
export function _resetInstallAffordance(): void {
	_deferred = null;
}
