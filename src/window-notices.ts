/**
 * Window-notice registry — top-of-window banners.
 *
 * Plugins call {@link registerWindowNotice} to surface a banner at the
 * top of any window matching the registration's `match` predicate.
 * The banner is rendered as a `<wpd-notice>` element appended to the
 * window's `after-titlebar` slot — the slot host the window-chrome
 * framework already exposes for "below the title bar, above the body,
 * full window width" affordances.
 *
 * Why a dedicated registry on top of `registerWindowSlot()`: notices
 * are pure declarative data (tone, message, dismissibility,
 * persistence id) that every plugin describes the same way. Forcing
 * each author to write the slot's render callback by hand bloats
 * plugin code, fragments the close-button affordance, and breaks the
 * "dismissal persisted per user" promise. Wrapping the slot system
 * lets the framework own the rendering rules and gives plugin authors
 * a one-line API.
 *
 * Cross-bundle state: the registry routes through
 * {@link createSharedStore} (key `desktop-mode/window-notices`) so the
 * lazy `window-system[.min].js` bundle and the main `desktop.ts`
 * bundle share the same `Map` of entries.
 */

import { createSharedStore } from './shared-store';
import {
	registerWindowSlot,
	unregisterWindowSlot,
} from './window-chrome/slots/registry';
import type { Window as DesktopWindow } from './window';
import {
	clearNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/wpd-notice/storage';
// Side-effect import — registers the `<wpd-notice>` custom element so
// the element we synthesize in `buildNoticeElement` upgrades
// synchronously. Idempotent: harmless if another bundle (or the
// barrel) already loaded the module.
import './ui/components/wpd-notice/wpd-notice';

/**
 * Tone palette accepted by {@link WindowNoticeEntry}. Mirrors
 * `<wpd-notice>`'s `tone` attribute.
 */
export type WindowNoticeTone =
	| 'info'
	| 'success'
	| 'warning'
	| 'error'
	| 'danger'
	| 'neutral';

/**
 * Predicate handed `(window)`; return `true` to render the notice on
 * that window.
 */
export type WindowNoticeMatch = ( win: DesktopWindow ) => boolean;

/**
 * One declarative window-notice. The `id` is also the persistence key
 * — when the user dismisses the notice we record `id → true` in
 * localStorage and the `<wpd-notice>` self-hides on subsequent mounts.
 */
export interface WindowNoticeEntry {
	/**
	 * Persistence + dedupe key. Recommended format
	 * `<plugin>/<notice-slug>` so two plugins won't collide.
	 */
	id: string;
	/**
	 * HTML message body. Allowed: `<a>`, `<strong>`, `<em>`, `<br>`,
	 * and other inline formatting. The string is written via
	 * `innerHTML` — callers MUST sanitize untrusted input themselves
	 * (PHP authors: pass it through `wp_kses_post()`).
	 */
	message: string;
	/** Color palette. Default `info`. */
	tone?: WindowNoticeTone;
	/** Show a close button. Default `true`. */
	dismissible?: boolean;
	/** Optional Dashicons class for a leading glyph (e.g. `dashicons-info`). */
	icon?: string;
	/**
	 * Window-match predicate. Return `true` to render the notice on a
	 * given window. Defaults to "every window".
	 */
	match?: WindowNoticeMatch;
	/** Sort order — lower renders higher. Default 100. */
	order?: number;
	/**
	 * Owner tag — typically the WordPress script handle that
	 * registered the notice. Set to live-unregister on plugin
	 * deactivation.
	 */
	owner?: string;
}

interface RegistryState {
	entries: Map< string, WindowNoticeEntry >;
}

const store = createSharedStore< RegistryState >(
	'desktop-mode/window-notices',
	() => ( { entries: new Map() } ),
);

const ID_PATTERN = /^[a-z0-9_/-]+$/;

function slotIdFor( id: string ): string {
	return `desktop-mode-notice/${ id.toLowerCase() }`;
}

function buildNoticeElement( entry: WindowNoticeEntry ): HTMLElement {
	const el = document.createElement( 'wpd-notice' );
	el.setAttribute( 'tone', entry.tone ?? 'info' );
	el.setAttribute( 'notice-id', entry.id );
	if ( entry.dismissible === false ) {
		el.setAttribute( 'not-dismissible', '' );
	}
	if ( entry.icon ) {
		el.setAttribute( 'icon', entry.icon );
	}
	// `innerHTML` is intentional — `message` is HTML so plugins can
	// include links and formatting. The contract is documented on the
	// entry's `message` field; PHP callers should use
	// `wp_kses_post()`.
	el.innerHTML = entry.message;
	return el;
}

/**
 * Register (or replace) a window notice. Returns an unregister
 * function for convenience.
 *
 * @example
 * ```ts
 * wp.desktop.registerWindowNotice( {
 *     id: 'my-plugin/welcome',
 *     tone: 'info',
 *     message: 'Welcome! <a href="…">Read the docs</a>.',
 *     match: ( w ) => w.id === 'edit-php',
 * } );
 * ```
 */
export function registerWindowNotice(
	entry: WindowNoticeEntry,
): () => void {
	if ( ! entry || typeof entry !== 'object' ) {
		return () => {};
	}
	const id = String( entry.id ?? '' ).trim().toLowerCase();
	if ( ! id || ! ID_PATTERN.test( id ) ) {
		return () => {};
	}
	if ( typeof entry.message !== 'string' || entry.message === '' ) {
		return () => {};
	}

	const normalised: WindowNoticeEntry = { ...entry, id };
	store.state.entries.set( id, normalised );

	const slotId = slotIdFor( id );
	registerWindowSlot( {
		id: slotId,
		slot: 'after-titlebar',
		order: normalised.order ?? 100,
		// Append rather than clear — every notice slot entry appends
		// its own `<wpd-notice>` so multiple notices stack.
		replace: false,
		owner: normalised.owner,
		match: ( win ) => {
			const def = store.state.entries.get( id );
			if ( ! def ) {
				return false;
			}
			if ( typeof def.match !== 'function' ) {
				return true;
			}
			try {
				return def.match( win ) === true;
			} catch {
				return false;
			}
		},
		render: ( host ) => {
			const def = store.state.entries.get( id );
			if ( ! def ) {
				return;
			}
			host.appendChild( buildNoticeElement( def ) );
		},
	} );

	return () => unregisterWindowNotice( id );
}

/**
 * Remove a window notice by id. Idempotent.
 */
export function unregisterWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	if ( store.state.entries.delete( key ) ) {
		unregisterWindowSlot( slotIdFor( key ) );
	}
}

/**
 * Defensive snapshot of every registered notice. Sorted by `(order,
 * id)` so iteration is deterministic.
 */
export function listWindowNotices(): WindowNoticeEntry[] {
	return Array.from( store.state.entries.values() ).sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

/**
 * Imperatively mark a notice as dismissed for the current user.
 * Future mounts will start in the hidden state.
 */
export function dismissWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	markNoticeDismissed( key );
}

/**
 * Clear a previous dismissal so the notice shows again on next
 * mount.
 */
export function undismissWindowNotice( id: string ): void {
	const key = String( id ?? '' ).trim().toLowerCase();
	if ( ! key ) {
		return;
	}
	clearNoticeDismissed( key );
}

/**
 * Test-only escape hatch — drops every registered notice + every
 * dismissal record so tests start from a clean slate.
 *
 * @internal
 */
export function _resetWindowNoticesForTests(): void {
	for ( const id of Array.from( store.state.entries.keys() ) ) {
		unregisterWindowSlot( slotIdFor( id ) );
	}
	store.state.entries.clear();
}
