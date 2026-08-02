/**
 * Window-bridge postMessage protocol — typed message catalogue for
 * traffic between the parent shell and a chromeless iframe.
 *
 * **Why this lives here.** Before architecture-0.8.1 these unions
 * lived inline in `src/types.ts` (~1,860 LOC of mixed shape
 * definitions). Consumers across the codebase grep'd for the
 * literal `data?.type === 'desktop-mode-…'` strings to recognize
 * messages, which produced ~23 separate inline catalogues that
 * drifted as new variants were added. The protocol has its own
 * folder now so the contract has one obvious home, can be
 * versioned via {@link PROTOCOL_VERSION}, and new code should reach
 * for the {@link isBridgeEventFromIframe} /
 * {@link isBridgeEventToIframe} type guards from `@protocol/guards`
 * instead of hand-checking literals (most existing consumers still
 * hand-check; adoption is incremental).
 *
 * **Backwards compatibility.** `src/types.ts` continues to re-export
 * `BridgeEventFromIframe` and `BridgeEventToIframe` so existing
 * imports keep working; nothing on the public type surface
 * changes. New code should import from `@protocol/window-messages`.
 */

import type { HarvestedCommand } from '../types';
import type { WindowContentRef } from '../window-links/types';

/** Bridge events sent from a chromeless iframe to the parent shell. */
export type BridgeEventFromIframe =
	| { type: 'desktop-mode-title-change'; title: string }
	| { type: 'desktop-mode-navigate'; url: string; target: 'self' | 'new' }
	| { type: 'desktop-mode-notification'; title: string; body: string }
	| { type: 'desktop-mode-ready' }
	| { type: 'desktop-mode-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
	| {
		type: 'desktop-mode-screen-meta-state';
		open: 'screen-options' | 'help' | null;
	}
	| { type: 'desktop-mode-commands-list'; commands: HarvestedCommand[] }
	// Content-identity announcement — the chromeless bridge resolved
	// which object the page shows (post / comment / media, plus the
	// root post a child belongs to) in real admin context. Posted on
	// EVERY page load, `identity: null` included, so navigating away
	// from an identified screen clears the stale identity in the
	// parent's relations engine (`src/window-links/engine.ts`).
	| {
		type: 'desktop-mode-content-identity';
		identity: WindowContentRef | null;
	}
	// Activity-footprint launcher — a "View activity footprint" row
	// action inside the chromeless `users.php` iframe escalates a
	// click to the parent shell, which opens the My WordPress window
	// on that user's footprint route. `userName` seeds the breadcrumb
	// before the REST payload resolves (empty string when unknown).
	| {
		type: 'desktop-mode-open-user-footprint';
		userId: number;
		userName: string;
	}
	// Editor-autosave answer — the standalone iframe bridge finished
	// (or declined) the autosave the parent requested before opening
	// the front-end preview. `previewUrl` is only present on the
	// Gutenberg `__unstableSaveForPreview()` path, which resolves to
	// the freshest preview link; other paths let the parent fall back
	// to the identity's server-computed `previewUrl`.
	| {
		type: 'desktop-mode-editor-autosave-response';
		requestId: string;
		status: 'saved' | 'no-editor' | 'not-dirty' | 'error';
		previewUrl?: string;
	}
	// Live-preview settle — while a live watch is active the editor
	// page autosaved after a typing pause (Gutenberg) or a core
	// autosave tick (classic). The shell reloads the paired preview
	// window. `previewUrl` as above.
	| {
		type: 'desktop-mode-editor-live-saved';
		watchId: string;
		previewUrl?: string;
	}
	// -------------------------------------------------------------------
	// Cross-window connection bridge — extensible pub/sub between any
	// parent-side caller (e.g. a plugin's title-bar dropdown) and a
	// chromeless iframe. The shell only routes; topic semantics are
	// plugin-defined. See `wp.desktop.connect()` and
	// `wp.desktop.iframe.publish/subscribe`.
	// -------------------------------------------------------------------
	| {
		type: 'desktop-mode-bridge-handshake-ack';
		connectionId: string;
	}
	| {
		type: 'desktop-mode-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'desktop-mode-bridge-disconnect';
		connectionId: string;
	}
	// Pointer position inside the iframe, in the iframe's own client
	// coordinates. Only sent while the parent has armed the frame
	// with `desktop-mode-pointer-track`; throttled to ~25 Hz by the
	// forwarder. The parent rebases through the iframe element's
	// bounding rect — see `src/mio/pointer.ts`.
	| {
		type: 'desktop-mode-pointer-move';
		x: number;
		y: number;
	};

/** Bridge events sent from the parent shell to a chromeless iframe. */
export type BridgeEventToIframe =
	| { type: 'desktop-mode-focus' }
	| { type: 'desktop-mode-color-scheme'; scheme: string }
	| { type: 'desktop-mode-toggle-panel'; panel: 'screen-options' | 'help' }
	| { type: 'desktop-mode-commands-subscribe' }
	| { type: 'desktop-mode-commands-unsubscribe' }
	| { type: 'desktop-mode-commands-invoke'; name: string }
	// Editor-autosave request — sent by the shell's editor-preview
	// module before opening the front-end preview, so the preview
	// reflects on-screen content (Gutenberg's own Preview button does
	// the same). The standalone iframe bridge answers with
	// `desktop-mode-editor-autosave-response`, immediately when
	// there's no editor on the page.
	| {
		type: 'desktop-mode-editor-autosave-request';
		requestId: string;
	}
	// Live-preview watch control — sent by the editor-preview module
	// when a preview pairing opens (watch) and on teardown (unwatch).
	// The iframe-side watcher owns typing detection; `debounceMs` is
	// the settle window after the last edit (clamped 500–30000).
	| {
		type: 'desktop-mode-editor-live-watch';
		watchId: string;
		debounceMs: number;
	}
	| {
		type: 'desktop-mode-editor-live-unwatch';
		watchId: string;
	}
	| {
		type: 'desktop-mode-bridge-handshake';
		connectionId: string;
		targetWindowId?: string;
		topics: string[];
	}
	| {
		type: 'desktop-mode-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'desktop-mode-bridge-disconnect';
		connectionId: string;
	}
	// Arm / disarm the iframe's pointer forwarder. Off by default:
	// a shell with no consumer never sends this and the iframe never
	// installs a hot-path listener. Sent on consumer start (to every
	// live iframe), on every `desktop-mode-bridge-ready` while a
	// consumer is active, and with `enabled: false` on teardown.
	| {
		type: 'desktop-mode-pointer-track';
		enabled: boolean;
	};

/** All bridge messages, in either direction. */
export type BridgeEvent = BridgeEventFromIframe | BridgeEventToIframe;

/** Discriminator: the `type` literal of every bridge message. */
export type BridgeEventType = BridgeEvent[ 'type' ];

/**
 * The `desktop-mode-*` message-type strings covered by the typed
 * `BridgeEvent` union. NOT exhaustive — several bridge messages
 * (window-send/publish, iframe-admin-link, iframe-error,
 * iframe-network, chrome-*, …) are not yet catalogued here.
 */
export const BRIDGE_EVENT_TYPES: ReadonlySet< BridgeEventType > = new Set( [
	// From iframe.
	'desktop-mode-title-change',
	'desktop-mode-navigate',
	'desktop-mode-notification',
	'desktop-mode-ready',
	'desktop-mode-screen-meta',
	'desktop-mode-screen-meta-state',
	'desktop-mode-commands-list',
	'desktop-mode-content-identity',
	'desktop-mode-open-user-footprint',
	'desktop-mode-editor-autosave-response',
	'desktop-mode-editor-live-saved',
	'desktop-mode-bridge-handshake-ack',
	'desktop-mode-pointer-move',
	// To iframe.
	'desktop-mode-focus',
	'desktop-mode-color-scheme',
	'desktop-mode-toggle-panel',
	'desktop-mode-commands-subscribe',
	'desktop-mode-commands-unsubscribe',
	'desktop-mode-commands-invoke',
	'desktop-mode-editor-autosave-request',
	'desktop-mode-editor-live-watch',
	'desktop-mode-editor-live-unwatch',
	'desktop-mode-bridge-handshake',
	'desktop-mode-pointer-track',
	// Both directions share the same names.
	'desktop-mode-bridge-publish',
	'desktop-mode-bridge-disconnect',
] );
