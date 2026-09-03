/**
 * Per-Space dock: the admin menu on the dock follows the active
 * desktop's admin.
 *
 * A site Space hosts another admin (see `src/multisite/spaces.ts`), and
 * its dock should be THAT admin's menu — the network menu in the
 * Network Admin Space, a site's own menu in its Space, the shell's own
 * menu on every ordinary desktop. A plain admin page emits only a menu
 * signature, not its dock menu, so a Space's menu is not sitting there
 * to read: this controller harvests it once, lazily, the first time the
 * user enters the Space — one hidden probe against that admin, the same
 * mechanism `bindMenuRefresh()` uses for live refresh — caches it, and
 * swaps the dock on every switch through `applyDockItems()`.
 *
 * Only the dock's ADMIN MENU is swapped. System tiles (Mio, Overview,
 * the Network Admin tile, …) are held separately by the dispatcher and
 * stay on every desktop. The full-payload quarantine in
 * `src/boot/menu-refresh.ts` still stands: a foreign admin's native
 * windows, widgets and the rest must never register in this shell —
 * only its dock items are borrowed, and only to paint them.
 */

import type { DockItem } from '../dock';

/** How long to wait for a probe's payload before giving up. */
const HARVEST_TIMEOUT_MS = 8000;

export interface SpaceDockDeps {
	/** Swap the dock's admin-menu items (dock-only repaint). */
	applyDockItems: ( items: DockItem[] ) => void;
	/**
	 * The shell's own live dock items — read fresh each time, since the
	 * normal live-refresh path keeps them current for the home admin.
	 */
	getHomeDockItems: () => DockItem[];
	/** The shell's own admin scope (`src/admin-scope.ts`). */
	homeScope: string;
	/** Same-origin base for probe URLs — `window.location.origin`. */
	origin: string;
	/**
	 * Harvest one admin's dock items by loading its menu-refresh probe
	 * in a hidden iframe. Injectable so tests drive the swap logic
	 * without a DOM. Resolves `null` on timeout or a payload-less
	 * response.
	 */
	harvest?: ( probeUrl: string ) => Promise< DockItem[] | null >;
}

export interface SpaceDockController {
	/**
	 * React to a desktop switch. `scope` is the desktop's admin scope
	 * (`Desktop.scope`) or undefined for an ordinary desktop.
	 */
	onSwitch: ( scope: string | undefined ) => void;
	/**
	 * The shell's own live refresh landed — a full payload from one of
	 * the home admin's windows, or the home probe. Painted only while
	 * the dock is showing the home menu: inside a Space the Space's
	 * menu stays put, and the fresh home items wait in
	 * `getHomeDockItems()` for the next switch home. Without this, a
	 * home-admin window that lives on a Space (`plugins.php` opened
	 * there, or a restored one) repaints the Space's dock with the
	 * home menu the moment it loads.
	 */
	applyHomeDockItems: ( items: DockItem[] ) => void;
}

/**
 * Default harvest: a 1×1 off-screen iframe at the admin's menu-refresh
 * probe, disposed as soon as its `os-plugins-changed` payload lands.
 * Mirrors `bindMenuRefresh()`'s probe, scoped to a given base.
 */
function harvestViaProbe( probeUrl: string ): Promise< DockItem[] | null > {
	return new Promise( ( resolve ) => {
		let settled = false;
		const iframe = document.createElement( 'iframe' );
		iframe.setAttribute( 'aria-hidden', 'true' );
		iframe.tabIndex = -1;
		iframe.style.cssText =
			'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';

		const finish = ( items: DockItem[] | null ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			window.clearTimeout( timer );
			window.removeEventListener( 'message', onMessage );
			if ( iframe.parentNode ) {
				iframe.parentNode.removeChild( iframe );
			}
			resolve( items );
		};

		const onMessage = ( e: MessageEvent ): void => {
			if ( e.source !== iframe.contentWindow ) {
				return;
			}
			const data = e.data as
				| { type?: string; payload?: { dockItems?: unknown } }
				| null;
			if ( ! data || data.type !== 'os-plugins-changed' ) {
				return;
			}
			const items = data.payload?.dockItems;
			finish(
				Array.isArray( items ) && items.length > 0
					? ( items as DockItem[] )
					: null,
			);
		};

		const timer = window.setTimeout(
			() => finish( null ),
			HARVEST_TIMEOUT_MS,
		);
		window.addEventListener( 'message', onMessage );
		iframe.src = probeUrl;
		document.body.appendChild( iframe );
	} );
}

export function createSpaceDockController(
	deps: SpaceDockDeps,
): SpaceDockController {
	const harvest = deps.harvest ?? harvestViaProbe;
	const cache = new Map< string, DockItem[] >();
	const inFlight = new Set< string >();
	// The scope whose menu the dock currently paints. Starts home; the
	// caller drives it from the first real switch (and from boot, when
	// a restored session lands the user straight in a Space).
	let activeScope = deps.homeScope;

	const paint = ( scope: string ): void => {
		if ( scope === deps.homeScope ) {
			deps.applyDockItems( deps.getHomeDockItems() );
			return;
		}
		const items = cache.get( scope );
		if ( items ) {
			deps.applyDockItems( items );
		}
		// No cache yet: leave the current dock until the harvest lands
		// (harvestFor applies it then, if still active). Better a beat
		// of the previous menu than an empty dock.
	};

	const probeUrl = ( scope: string ): string | null => {
		try {
			// `scope` is a rooted admin path with a trailing slash
			// (`/site2/wp-admin/`); its admin.php probe carries the
			// harvest flags.
			const url = new URL(
				`${ scope }admin.php`,
				deps.origin,
			);
			url.searchParams.set( 'openstation_chromeless', '1' );
			url.searchParams.set( 'openstation_menu_refresh', '1' );
			return url.toString();
		} catch {
			return null;
		}
	};

	const harvestFor = ( scope: string ): void => {
		if ( cache.has( scope ) || inFlight.has( scope ) ) {
			return;
		}
		const url = probeUrl( scope );
		if ( ! url ) {
			return;
		}
		inFlight.add( scope );
		void harvest( url )
			.then( ( items ) => {
				if ( items ) {
					cache.set( scope, items );
					// Apply only if the user is still standing in this
					// Space — they may have switched away while it
					// loaded.
					if ( activeScope === scope ) {
						deps.applyDockItems( items );
					}
				}
			} )
			.finally( () => {
				inFlight.delete( scope );
			} );
	};

	return {
		onSwitch: ( scope ) => {
			const target = scope ?? deps.homeScope;
			if ( target === activeScope ) {
				return;
			}
			activeScope = target;
			paint( target );
			if ( target !== deps.homeScope ) {
				harvestFor( target );
			}
		},
		applyHomeDockItems: ( items ) => {
			if ( activeScope === deps.homeScope ) {
				deps.applyDockItems( items );
			}
		},
	};
}
