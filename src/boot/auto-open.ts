/**
 * Auto-open decision matrix for the shell boot flow.
 *
 * Extracted so the rules below can be exercised directly by Vitest
 * instead of through the full `init()` happy path. Keep the predicate
 * pure — no DOM, no manager, no side effects.
 *
 * The six-case truth table:
 *
 *   1. `fromPortal=false`
 *        → user navigated to a specific admin URL directly. Open it.
 *
 *   2. `fromPortal=true` + `fromPortalIntent=true`
 *        → portal redirected here BECAUSE the user followed a link
 *          to a specific admin page (admin-bar "Edit Post", a
 *          bookmark, etc.). The intent flag was added by
 *          `desktop_mode_handle_portal_request` only when the
 *          redirect resolved from `?target=…`. Open the URL — it's
 *          user intent, not a default the portal had to pick.
 *
 *   3. `fromPortal=true` + `fromPortalIntent=false` + session exists
 *        → bare `/desktop-mode/` visit. Portal landed on the
 *          session's focused window or the default. Session restore
 *          already covers it; don't double-open.
 *
 *   4. `fromPortal=true` + `fromPortalIntent=false` + session empty
 *      + default disabled
 *        → user turned the default window off. Show an empty desk.
 *
 *   5. `fromPortal=true` + `fromPortalIntent=false` + session empty
 *      + default enabled + default is a normal admin URL (not a
 *      `native:<id>` marker)
 *        → clean slate, default window set. The portal already
 *          forwarded to its URL, so opening `currentPage` populates
 *          the desktop with the user's chosen startup.
 *
 *   6. `fromPortal=true` + `fromPortalIntent=false` + session empty
 *      + default enabled + default is a `native:<id>` marker
 *        → suppress. Native markers aren't redirectable, so the
 *          portal sent the user to admin home — `currentPage` is NOT
 *          the chosen startup. `desktop.ts` opens the native window
 *          itself after the manager and native registry are wired.
 *
 * @since 0.8.4
 */

export interface AutoOpenInputs {
	fromPortal: boolean;
	fromPortalIntent?: boolean;
	hasSession: boolean;
	defaultEnabled: boolean;
	isNativeDefault: boolean;
}

/**
 * Whether the boot flow should call `openCurrentPage`.
 *
 * Inverse of the `suppressAutoOpen` expression that used to live
 * inline in `desktop.ts` — kept positive here because tests read
 * "should open" more cleanly than "should suppress."
 */
export function shouldAutoOpenCurrentPage( inputs: AutoOpenInputs ): boolean {
	const suppress =
		inputs.fromPortal &&
		! inputs.fromPortalIntent &&
		( inputs.hasSession || ! inputs.defaultEnabled || inputs.isNativeDefault );
	return ! suppress;
}
