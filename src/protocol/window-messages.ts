/**
 * Window-bridge postMessage protocol — typed message catalogue for
 * traffic between the parent shell and a chromeless iframe.
 *
 * **Why this lives here.** Before architecture-1.0 these unions
 * lived inline in `src/types.ts` (~1,860 LOC of mixed shape
 * definitions). Consumers across the codebase grep'd for the
 * literal `data?.type === 'desktop-mode-…'` strings to recognize
 * messages, which produced ~23 separate inline catalogues that
 * drifted as new variants were added. The protocol has its own
 * folder now so the contract has one obvious home, can be
 * versioned via {@link PROTOCOL_VERSION}, and consumers reach for
 * the {@link isBridgeEventFromIframe} / {@link isBridgeEventToIframe}
 * type guards from `@protocol/guards` instead of hand-checking
 * literals.
 *
 * **Backwards compatibility.** `src/types.ts` continues to re-export
 * `BridgeEventFromIframe` and `BridgeEventToIframe` so existing
 * imports keep working; nothing on the public type surface
 * changes. New code should import from `@protocol/window-messages`.
 *
 * @since 1.0.0
 */

import type { HarvestedCommand } from '../types';

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
	};

/** Bridge events sent from the parent shell to a chromeless iframe. */
export type BridgeEventToIframe =
	| { type: 'desktop-mode-focus' }
	| { type: 'desktop-mode-color-scheme'; scheme: string }
	| { type: 'desktop-mode-toggle-panel'; panel: 'screen-options' | 'help' }
	| { type: 'desktop-mode-commands-subscribe' }
	| { type: 'desktop-mode-commands-unsubscribe' }
	| { type: 'desktop-mode-commands-invoke'; name: string }
	| {
		type: 'desktop-mode-bridge-handshake';
		connectionId: string;
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
	};

/** All bridge messages, in either direction. */
export type BridgeEvent = BridgeEventFromIframe | BridgeEventToIframe;

/** Discriminator: the `type` literal of every bridge message. */
export type BridgeEventType = BridgeEvent[ 'type' ];

/** All `desktop-mode-*` message-type strings recognised by this build. */
export const BRIDGE_EVENT_TYPES: ReadonlySet< BridgeEventType > = new Set( [
	// From iframe.
	'desktop-mode-title-change',
	'desktop-mode-navigate',
	'desktop-mode-notification',
	'desktop-mode-ready',
	'desktop-mode-screen-meta',
	'desktop-mode-screen-meta-state',
	'desktop-mode-commands-list',
	'desktop-mode-bridge-handshake-ack',
	// To iframe.
	'desktop-mode-focus',
	'desktop-mode-color-scheme',
	'desktop-mode-toggle-panel',
	'desktop-mode-commands-subscribe',
	'desktop-mode-commands-unsubscribe',
	'desktop-mode-commands-invoke',
	'desktop-mode-bridge-handshake',
	// Both directions share the same names.
	'desktop-mode-bridge-publish',
	'desktop-mode-bridge-disconnect',
] );
