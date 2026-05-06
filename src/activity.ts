/**
 * Cross-plugin activity channel API.
 *
 * **What it is.** A thin, named-channel layer on top of `wp.hooks`
 * for plugin-internal events that other plugins might care about.
 * Example: an inbox plugin publishes `inbox/unread-changed`; a
 * global "what's happening?" widget subscribes and aggregates
 * without coupling to the inbox plugin's internals. A plugin
 * split across two bundles can subscribe to its own channel from
 * the second bundle without sharing module state with the first.
 *
 * **Why a thin wrapper.** `wp.hooks.doAction('inbox.unread-changed', …)`
 * already works. Three reasons to ship a typed shim anyway:
 *
 *   1. A documented naming convention (`<plugin>/<event>`,
 *      matching `createSharedStore` keys) so plugins don't bikeshed
 *      every new channel name.
 *   2. A predictable hook prefix (`desktop-mode.activity.<channel>`)
 *      so the devtools "what's firing" panel can list activity
 *      events as a discrete group.
 *   3. Type safety: callers can extend `ActivityChannelMap` in
 *      `.d.ts` so `publish( 'inbox/unread-changed', payload )`
 *      typechecks the payload shape.
 *
 * **The pattern.** Apps subscribe to OS lifecycle events
 * (`wp.desktop.onWindow`, `desktop-mode-window-*` CustomEvents) AND
 * to peer-app activity channels. They query window state when they
 * need to (`windowManager.isActive(id)`) and decide for themselves
 * what to do. The framework is the bus, not the policy.
 *
 * @since 0.5.5
 */

import {
	addAction,
	applyFilters,
	doAction,
	removeAction,
} from './hooks';

/**
 * Type-extension hook for plugin authors. Augment via:
 *
 * ```ts
 * declare module 'desktop-mode/activity' {
 *     interface ActivityChannelMap {
 *         'my-plugin/something-happened': { id: number; reason: string };
 *     }
 * }
 * ```
 *
 * The `publish`/`subscribe`/`filter` calls below pick up the
 * extended shape automatically.
 *
 * Framework channels (defined here) cover the cross-cutting
 * surfaces the shell publishes / filters: toast intents, attention
 * intents, badge changes. Each is documented next to the consumer
 * (`src/toast.ts`, `src/window/index.ts` requestAttention,
 * `src/dock.ts` setBadge).
 */
export interface ActivityChannelMap {
	/**
	 * Framework: a toast was *requested*. Filter this channel to
	 * cancel (`cancel: true`), mutate the message, or audit. Fires
	 * BEFORE the toast appears in the DOM; subscribers shouldn't
	 * use this for "show another toast" or you'll loop.
	 */
	'desktop-mode/toast-requested': {
		message: string;
		action?: { label: string; onClick: () => void };
		duration?: number;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};
	/**
	 * Framework: a toast was *shown*. Fire-and-forget broadcast
	 * for audit / aggregation widgets. Filtering this is a no-op —
	 * by the time it fires, the toast is on screen.
	 */
	'desktop-mode/toast-shown': {
		message: string;
		action?: { label: string; onClick: () => void };
		duration?: number;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};
	/**
	 * Framework: `wp.desktop.notify()` was called. Filter to cancel
	 * (`cancel: true`), mutate fields, or audit before the
	 * Notification surface (or its toast fallback) is rendered.
	 *
	 * @since 0.8.0
	 */
	'desktop-mode/notification-requested': {
		title: string;
		body?: string;
		icon?: string;
		tag?: string;
		requireInteraction?: boolean;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};
	/**
	 * Framework: a notification was rendered (real Notification or
	 * toast fallback). `fallback: 'toast'` flags the degraded path
	 * so analytics can distinguish "user has notifications muted"
	 * from "user explicitly hides nothing." `fallback: null` means
	 * a real OS-level notification went up.
	 *
	 * @since 0.8.0
	 */
	'desktop-mode/notification-shown': {
		title: string;
		body?: string;
		icon?: string;
		tag?: string;
		requireInteraction?: boolean;
		source?: string;
		meta?: Record< string, unknown >;
		fallback: 'toast' | null;
	};
	/**
	 * Framework: a window's `requestAttention` (or
	 * `Dock.setAttention`) was called. Filter to cancel
	 * (`cancel: true`) for DND modes / reduced-motion, mutate
	 * `mode` / `durationMs` / `intensity` to scale the
	 * animation, or audit.
	 */
	'desktop-mode/window-attention-requested': {
		windowId: string;
		mode: 'pulse' | 'shake' | 'bounce' | null;
		durationMs?: number;
		intensity?: 'subtle' | 'normal' | 'strong';
		source?: string;
		cancel?: boolean;
	};
	/**
	 * Framework: a tile's badge count changed. Useful for global
	 * notification-center widgets that aggregate across plugins
	 * without having to bind low-level DOM events or know which
	 * surface emitted the change.
	 *
	 * `rail` is the routing discriminator — `'dock'` (left-edge),
	 * `'taskbar'` (bottom), or `'icon'` (wallpaper shortcut). Every
	 * rail emits the same event shape so a single subscriber can
	 * compose a unified count without duplicating logic per
	 * surface.
	 */
	'desktop-mode/badge-changed': {
		itemId: string;
		count: number;
		/** Which rail painted the change. */
		rail: 'dock' | 'taskbar' | 'icon';
	};
	/**
	 * Framework: a caller asked to open a registered window —
	 * either a new instance OR re-focus an existing one. Fires
	 * BEFORE the manager decides which path to take, so
	 * subscribers see the user's intent independent of the
	 * outcome (`source: 'dock' | 'api' | 'shortcut' | …`).
	 *
	 * Distinct from `WINDOW_OPENED` (fires only on first creation)
	 * and `WINDOW_REOPENED` (fires only on already-open instances).
	 * Useful for analytics + DND that want "user requested" rather
	 * than "framework completed".
	 */
	'desktop-mode/open-requested': {
		windowId: string;
		source: string;
	};
	/**
	 * Framework: a user's presence transitioned. Mirrors the
	 * `desktop-mode-presence-changed` CustomEvent on the activity
	 * bus so plugins can subscribe through the unified API.
	 */
	'desktop-mode/presence-changed': {
		userId: number;
		oldStatus: 'online' | 'inactive' | 'offline' | null;
		newStatus: 'online' | 'inactive' | 'offline';
		lastSeenMs: number;
		lastActiveMs: number;
	};
	/**
	 * Framework: a presence snapshot was applied (a batch of one
	 * or more updates). Fires after the store has been mutated
	 * and per-transition events have fired. Useful for "redraw
	 * everything that depends on presence" callers that don't
	 * need per-user granularity.
	 */
	'desktop-mode/presence-snapshot-applied': {
		applied: number;
		transitions: number;
	};
	// Plugin channels go here. The catch-all index signature lets
	// third-party plugins fall through without explicit type
	// augmentation; declare specific channels in your own .d.ts
	// for compile-time payload checking.
	[ key: `${ string }/${ string }` ]: unknown;
}

const HOOK_PREFIX = 'desktop-mode.activity.';

function hookName< K extends keyof ActivityChannelMap >( channel: K ): string {
	return `${ HOOK_PREFIX }${ String( channel ) }`;
}

/**
 * Counter that produces unique handler namespaces inside this
 * module so multiple subscribers to the same channel don't
 * clobber each other when removed.
 */
let subscribeSeq = 0;

export interface ActivityApi {
	/**
	 * Publish an activity event. Subscribers registered against
	 * the same channel fire synchronously. Filters registered
	 * against the same channel can mutate the payload BEFORE the
	 * action fires — see {@link filter}.
	 *
	 * @param channel `<plugin>/<event>` slug — namespaced to your plugin.
	 * @param payload Optional payload.
	 */
	publish< K extends keyof ActivityChannelMap >(
		channel: K,
		payload?: ActivityChannelMap[ K ],
	): void;

	/**
	 * Register a subscriber for `channel`. Returns an
	 * unsubscribe function (calling it twice is safe).
	 */
	subscribe< K extends keyof ActivityChannelMap >(
		channel: K,
		cb: ( payload: ActivityChannelMap[ K ] ) => void,
	): () => void;

	/**
	 * Run the registered filters for `channel` against `value`.
	 * Returns the (possibly mutated) value. Use this when a
	 * publisher wants to let plugins veto / shape the event before
	 * it goes out — e.g. `<plugin>/outgoing-payload` so a logging
	 * plugin can redact PII before peers see it.
	 */
	filter< K extends keyof ActivityChannelMap >(
		channel: K,
		value: ActivityChannelMap[ K ],
		...args: unknown[]
	): ActivityChannelMap[ K ];
}

/**
 * Shared singleton — every bundle that imports this module ends up
 * with the same handler-namespace counter via the underlying
 * `wp.hooks` global. Safe to call from anywhere.
 */
export const activity: ActivityApi = {
	publish( channel, payload ) {
		doAction( hookName( channel ), payload );
	},
	subscribe( channel, cb ) {
		const ns = `desktop-mode/activity-sub/${ ++subscribeSeq }`;
		const hook = hookName( channel );
		addAction( hook, ns, ( payload: unknown ) =>
			( cb as ( p: unknown ) => void )( payload ),
		);
		let removed = false;
		return () => {
			if ( removed ) {
				return;
			}
			removed = true;
			removeAction( hook, ns );
		};
	},
	filter( channel, value, ...args ) {
		return applyFilters( hookName( channel ), value, ...args ) as typeof value;
	},
};
