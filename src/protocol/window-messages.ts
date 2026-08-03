/**
 * Window-bridge postMessage protocol — typed message catalogue for
 * traffic between the parent shell and a chromeless iframe.
 *
 * **Why this lives here.** Before architecture-0.8.1 these unions
 * lived inline in `src/types.ts` (~1,860 LOC of mixed shape
 * definitions). Consumers across the codebase grep'd for the
 * literal `data?.type === 'os-…'` strings to recognize
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
	| { type: 'os-title-change'; title: string }
	| { type: 'os-navigate'; url: string; target: 'self' | 'new' }
	| { type: 'os-notification'; title: string; body: string }
	| { type: 'os-ready' }
	| { type: 'os-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
	| {
		type: 'os-screen-meta-state';
		open: 'screen-options' | 'help' | null;
	}
	| { type: 'os-commands-list'; commands: HarvestedCommand[] }
	// Content-identity announcement — the chromeless bridge resolved
	// which object the page shows (post / comment / media, plus the
	// root post a child belongs to) in real admin context. Posted on
	// EVERY page load, `identity: null` included, so navigating away
	// from an identified screen clears the stale identity in the
	// parent's relations engine (`src/window-links/engine.ts`).
	| {
		type: 'os-content-identity';
		identity: WindowContentRef | null;
	}
	// Activity-footprint launcher — a "View activity footprint" row
	// action inside the chromeless `users.php` iframe escalates a
	// click to the parent shell, which opens the My WordPress window
	// on that user's footprint route. `userName` seeds the breadcrumb
	// before the REST payload resolves (empty string when unknown).
	| {
		type: 'os-open-user-footprint';
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
		type: 'os-editor-autosave-response';
		requestId: string;
		status: 'saved' | 'no-editor' | 'not-dirty' | 'error';
		previewUrl?: string;
	}
	// Live-preview settle — while a live watch is active the editor
	// page autosaved after a typing pause (Gutenberg) or a core
	// autosave tick (classic). The shell reloads the paired preview
	// window. `previewUrl` as above.
	| {
		type: 'os-editor-live-saved';
		watchId: string;
		previewUrl?: string;
	}
	// -------------------------------------------------------------------
	// Cross-window connection bridge — extensible pub/sub between any
	// parent-side caller (e.g. a plugin's title-bar dropdown) and a
	// chromeless iframe. The shell only routes; topic semantics are
	// plugin-defined. See `wp.os.connect()` and
	// `wp.os.iframe.publish/subscribe`.
	// -------------------------------------------------------------------
	| {
		type: 'os-bridge-handshake-ack';
		connectionId: string;
	}
	| {
		type: 'os-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'os-bridge-disconnect';
		connectionId: string;
	}
	// Pointer position inside the iframe, in the iframe's own client
	// coordinates. Only sent while the parent has armed the frame
	// with `os-pointer-track`; throttled to ~25 Hz by the
	// forwarder. The parent rebases through the iframe element's
	// bounding rect — see `src/mio/pointer.ts`.
	| {
		type: 'os-pointer-move';
		x: number;
		y: number;
	};

/** Bridge events sent from the parent shell to a chromeless iframe. */
export type BridgeEventToIframe =
	| { type: 'os-focus' }
	| { type: 'os-color-scheme'; scheme: string }
	| { type: 'os-toggle-panel'; panel: 'screen-options' | 'help' }
	| { type: 'os-commands-subscribe' }
	| { type: 'os-commands-unsubscribe' }
	| { type: 'os-commands-invoke'; name: string }
	// Editor-autosave request — sent by the shell's editor-preview
	// module before opening the front-end preview, so the preview
	// reflects on-screen content (Gutenberg's own Preview button does
	// the same). The standalone iframe bridge answers with
	// `os-editor-autosave-response`, immediately when
	// there's no editor on the page.
	| {
		type: 'os-editor-autosave-request';
		requestId: string;
	}
	// Live-preview watch control — sent by the editor-preview module
	// when a preview pairing opens (watch) and on teardown (unwatch).
	// The iframe-side watcher owns typing detection; `debounceMs` is
	// the settle window after the last edit (clamped 500–30000).
	| {
		type: 'os-editor-live-watch';
		watchId: string;
		debounceMs: number;
	}
	| {
		type: 'os-editor-live-unwatch';
		watchId: string;
	}
	| {
		type: 'os-bridge-handshake';
		connectionId: string;
		targetWindowId?: string;
		topics: string[];
	}
	| {
		type: 'os-bridge-publish';
		connectionId: string;
		topic: string;
		payload: unknown;
	}
	| {
		type: 'os-bridge-disconnect';
		connectionId: string;
	}
	// Arm / disarm the iframe's pointer forwarder. Off by default:
	// a shell with no consumer never sends this and the iframe never
	// installs a hot-path listener. Sent on consumer start (to every
	// live iframe), on every `os-bridge-ready` while a
	// consumer is active, and with `enabled: false` on teardown.
	| {
		type: 'os-pointer-track';
		enabled: boolean;
	};

/** All bridge messages, in either direction. */
export type BridgeEvent = BridgeEventFromIframe | BridgeEventToIframe;

/** Discriminator: the `type` literal of every bridge message. */
export type BridgeEventType = BridgeEvent[ 'type' ];

/**
 * The `os-*` message-type strings covered by the typed
 * `BridgeEvent` union. NOT exhaustive — several bridge messages
 * (window-send/publish, iframe-admin-link, iframe-error,
 * iframe-network, chrome-*, …) are not yet catalogued here.
 */
export const BRIDGE_EVENT_TYPES: ReadonlySet< BridgeEventType > = new Set( [
	// From iframe.
	'os-title-change',
	'os-navigate',
	'os-notification',
	'os-ready',
	'os-screen-meta',
	'os-screen-meta-state',
	'os-commands-list',
	'os-content-identity',
	'os-open-user-footprint',
	'os-editor-autosave-response',
	'os-editor-live-saved',
	'os-bridge-handshake-ack',
	'os-pointer-move',
	// To iframe.
	'os-focus',
	'os-color-scheme',
	'os-toggle-panel',
	'os-commands-subscribe',
	'os-commands-unsubscribe',
	'os-commands-invoke',
	'os-editor-autosave-request',
	'os-editor-live-watch',
	'os-editor-live-unwatch',
	'os-bridge-handshake',
	'os-pointer-track',
	// Both directions share the same names.
	'os-bridge-publish',
	'os-bridge-disconnect',
] );
