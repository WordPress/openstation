/**
 * The "edit this profile" door — the one contract every surface
 * routes through to put a person in front of the user: WP Explorer's
 * user pane and tiles, the Users app's rows, the agents roster, and
 * any plugin that wants the same door.
 *
 * The User Edit window is an App Framework app (`apps/user-edit/`)
 * and a singleton: it opens on the person carried in its open-time
 * params (`{ userId }`), and a live window asked to open on someone
 * else retargets through the framework's `reopen` lifecycle — the
 * shell writes the new params onto the window, the runtime dispatches
 * `reopen`, the app re-mounts on the new id. Params ride the session,
 * so a reload brings the window back on the same person.
 *
 * Deliberately a leaf module (no imports) so a bundle can take the
 * contract without dragging a window bundle in.
 *
 * @public
 */

/** The frozen id of the User Edit window (see AGENTS.md). */
export const USER_EDIT_WINDOW_ID = 'desktop-mode-user-edit';

interface DesktopFacade {
	openWindow?: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean | undefined;
	relations?: {
		set?: (
			windowId: string,
			ref: { type: string; id: number | string; label?: string } | null,
		) => void;
	};
}

/**
 * Open (or retarget) the User Edit window on one person.
 *
 * Opens the singleton with `{ userId }` as an open-time param and
 * announces the `user` identity to the relations engine, matching
 * what the chromeless bridge announces for `user-edit.php`, so both
 * paths join one window group.
 *
 * @param userId        The person.
 * @param opts          Options.
 * @param opts.source   Source tag for the open call.
 * @param opts.fallback Runs when the native window isn't registered
 *                      (the feature is off, or the user lacks the
 *                      capability) — the caller supplies its own
 *                      classic-admin door, since only it knows how to
 *                      build one.
 * @return true when the native window took it.
 */
export function openUserEditWindow(
	userId: number,
	opts: { source?: string; fallback?: () => void } = {},
): boolean {
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return false;
	}
	const desktop = ( window as unknown as { wp?: { os?: DesktopFacade } } ).wp?.os;
	const opened = desktop?.openWindow?.( USER_EDIT_WINDOW_ID, {
		source: opts.source ?? 'my-wordpress/user-tile',
		params: { userId },
	} );

	if ( opened ) {
		// The profile window is a singleton that retargets, so nothing
		// else can tell the relations engine its identity changed.
		desktop?.relations?.set?.( USER_EDIT_WINDOW_ID, {
			type: 'user',
			id: userId,
		} );
		return true;
	}

	opts.fallback?.();
	return false;
}
