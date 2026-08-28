/**
 * OpenStation — the service worker's two per-user flags, and the
 * messages that move them.
 *
 * Extracted from `sw.ts` for the same reason `SpeculativeStore` and
 * `sw-policy` were: inside the worker this logic sits behind
 * `self.addEventListener( 'message', … )`, module-level `let`s and
 * `caches`, none of which a unit test can reach. Here it is a pure
 * function over a flag pair, so the contract can be pinned.
 *
 * **Why the flags arrive by message at all.** They used to be baked
 * into the served worker bytes. Both are per-user preferences and a
 * service worker is origin-wide, so that made the body differ between
 * an anonymous and a logged-in request — and any in-scope logged-out
 * navigation (the interim-login iframe, logging out) then served
 * different bytes, which the browser installs as an update, activates,
 * and the shell's `controllerchange` handler hard-reloads the desktop
 * out from under the user. The worker now starts with both flags off
 * and the shell pushes the real values at boot, so until the message
 * lands the worker does less, never more.
 */

/** The worker's two per-user opt-ins. */
export interface SwFlags {
	/** Hover-intent prewarming of window documents. */
	windowPrewarm: boolean;
	/** The shared, origin-wide admin-asset cache. */
	adminAssetCache: boolean;
}

/** What the worker should do about a flag message. */
export interface SwFlagUpdate {
	/** The flags after applying the message. */
	flags: SwFlags;
	/** Drop speculatively-rendered documents held in memory. */
	clearSpeculative: boolean;
	/** Also delete the on-disk session cache. */
	dropSessionCache: boolean;
}

/**
 * Apply a flag message, or return `null` if it isn't one.
 *
 * Two message types, and the difference between them is deliberate:
 *
 * - **`os-sw-set-prewarm`** is the user moving the toggle. Turning it
 *   off drops what is already held — both the in-memory speculations
 *   and the session cache on disk. Leaving rendered pages around after
 *   someone opted out is the one thing the toggle exists to prevent.
 *   It carries `enabled` and says nothing about the other flag.
 *
 * - **`os-sw-config`** is the shell syncing both flags at boot. It
 *   clears in-memory speculations if prewarm turns out to be off, but
 *   does **not** delete the session cache: this is a state sync, not a
 *   user action, and the cache is what a restore reads on the next
 *   boot. Each field is applied only when it is actually a boolean, so
 *   a partial message never resets the flag it omitted.
 *
 * Anything that is not one of those two is left for the worker's other
 * handlers, which is what `null` means.
 *
 * @param data    The raw `event.data` from a message event.
 * @param current The worker's flags right now.
 * @return The update to apply, or `null` if this is not a flag message.
 */
export function applyFlagMessage(
	data: unknown,
	current: SwFlags,
): SwFlagUpdate | null {
	if ( ! data || typeof data !== 'object' ) {
		return null;
	}
	const message = data as {
		type?: unknown;
		enabled?: unknown;
		adminAssetCache?: unknown;
		windowPrewarm?: unknown;
	};

	if ( message.type === 'os-sw-set-prewarm' ) {
		const windowPrewarm = message.enabled === true;
		return {
			flags: { ...current, windowPrewarm },
			clearSpeculative: ! windowPrewarm,
			dropSessionCache: ! windowPrewarm,
		};
	}

	if ( message.type === 'os-sw-config' ) {
		const flags = { ...current };
		if ( typeof message.adminAssetCache === 'boolean' ) {
			flags.adminAssetCache = message.adminAssetCache;
		}
		let clearSpeculative = false;
		if ( typeof message.windowPrewarm === 'boolean' ) {
			flags.windowPrewarm = message.windowPrewarm;
			clearSpeculative = ! flags.windowPrewarm;
		}
		return { flags, clearSpeculative, dropSessionCache: false };
	}

	return null;
}
