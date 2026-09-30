/**
 * The pin — whether this user's desk is a shared workspace an admin
 * locked them into.
 *
 * The server holds the pin and enforces it on every session read and
 * write (`includes/workspace-shares/pin.php`): a second desk, a changed
 * profile, OpenStation switched off — none of it sticks. What the shell
 * does with this flag is stop OFFERING those things, so a pinned user
 * never meets a control that silently does nothing.
 *
 * Read from the boot config on every call rather than cached, so a
 * test (or a shell rebuilt after a release) sees the value as it is.
 */

import type { DesktopConfig } from '../types';

/** The pinned workspace, as the shell config describes it. */
export interface WorkspacePin {
	/** The workspace's name. */
	label: string;
	/** Display name of the admin who shared it; '' when they are gone. */
	author: string;
}

/** The pin, or `null` for a user who owns their desks. */
export function workspacePin(): WorkspacePin | null {
	const config = ( window as unknown as { openStationConfig?: DesktopConfig } )
		.openStationConfig;
	const pin = config?.workspacePin;
	return pin && 'object' === typeof pin ? pin : null;
}

/** Whether the user is pinned to a shared workspace. */
export function isWorkspacePinned(): boolean {
	return null !== workspacePin();
}
