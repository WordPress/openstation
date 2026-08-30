/**
 * The workspace picker, as a control in the overview top bar.
 *
 * Overview is already the Spaces surface: it names every desk, renames
 * them, closes them, and adds new ones. A picker belongs there and
 * nowhere else — the desk itself is the user's, and a shell affordance
 * parked on it is one more thing floating over their windows.
 *
 * ## Who owns what
 *
 * This module owns the control: the options, the grouping, and what a
 * pick means to the workspace model. `overview.ts` owns navigation —
 * switching desks and leaving overview — and passes those in as
 * handlers. Neither reaches into the other, which is what lets the
 * overview bar stay a module about tiles.
 *
 * ## The install seam
 *
 * `overview.ts` cannot construct workspace operations: it has a
 * `WindowManager` and nothing else. So the shell installs them once at
 * boot and the bar asks for a control each time it paints. Before the
 * install — and in any test that builds a bar without a shell —
 * {@link buildWorkspaceOverviewControl} returns `null` and the bar is
 * exactly what it was.
 */

import { __ } from '../i18n';
import type { Desktop } from '../types';
import type { WorkspaceDeps } from './manager';
import {
	applyWorkspaceView,
	createWorkspace,
	provisionWorkspace,
} from './manager';
import { listWorkspacePresets } from './presets';

/** Option value prefix for "make a desk from this template". */
const NEW_FROM_PRESET = 'os-new-preset:';

/** Option value for "create a blank desk and edit it". */
const NEW_BLANK = 'os-new-blank';

/** Option value for "edit the desk I am looking at". */
const EDIT_CURRENT = 'os-edit-current';

export interface WorkspaceOverviewDeps extends WorkspaceDeps {
	/** Open the workspace editor on a desktop. */
	openEditor: ( desktopId: string ) => void;
}

/** What the overview bar tells the control about its own navigation. */
export interface WorkspaceOverviewHandlers {
	/** Go to this desk and leave overview. */
	onSwitch: ( desktopId: string ) => void;
	/** A desk was just created — go to it and leave overview. */
	onCreated: ( desktopId: string ) => void;
}

let installed: WorkspaceOverviewDeps | null = null;

/**
 * Give the overview bar the workspace operations it cannot build
 * itself. Called once from the shell boot; returns a teardown so a
 * discarded shell leaves nothing behind.
 */
export function installWorkspaceOverviewControl(
	deps: WorkspaceOverviewDeps,
): () => void {
	installed = deps;
	return () => {
		installed = null;
	};
}

/**
 * Whether this desk has a workspace worth restoring TO.
 *
 * A plain Space has nothing stored, and neither does a workspace whose
 * profile says nothing beyond its name and colour — offering "Restore"
 * on either would be a button that visibly does nothing, which is
 * worse than no button. So the affordance appears exactly where it has
 * work to do: windows to reopen, a column to remount, a look to
 * repaint, or an arrangement to re-run.
 */
export function workspaceCanRestore( desktop: Desktop ): boolean {
	const profile = desktop.profile;
	if ( ! profile ) {
		return false;
	}
	return (
		profile.windows.length > 0 ||
		'free' !== profile.layout ||
		'only' === profile.widgets?.mode ||
		Object.keys( profile.appearance ?? {} ).length > 0
	);
}

/**
 * Put a desk back the way its workspace defines it.
 *
 * The counterpart to the editor's "Use the … I have now" captures: one
 * saves the desk into the workspace, this applies the workspace back
 * onto the desk. Reopens the windows it names, remounts its column,
 * repaints its look, re-runs its arrangement.
 *
 * Reopening is `force`d because the whole point is a desk the user has
 * since tidied — the once-per-workspace guard exists to stop the shell
 * reopening windows on its own, not to stop the user asking. Windows
 * still open reuse their existing instance rather than doubling, so
 * restoring a desk that is already intact just brings it to order.
 *
 * Returns whether it ran, so the caller can leave overview only on a
 * restore that happened.
 */
export function restoreWorkspace( desktopId: string ): boolean {
	const deps = installed;
	if ( ! deps ) {
		return false;
	}
	// Switch first: every step below acts on the active desk, and
	// restoring one the user is not standing on would repaint the desk
	// in front of them with another workspace's look.
	deps.manager.switchDesktop( desktopId );
	applyWorkspaceView( deps, desktopId );
	provisionWorkspace( deps, desktopId, { force: true } );
	return true;
}

/**
 * A disabled `<os-option>` used as a group heading.
 *
 * `<os-select>` skips disabled rows in keyboard navigation and refuses
 * to commit them, so a disabled row is a heading for free — no second
 * element type, and no way for a user to land on one.
 */
function heading( label: string ): HTMLElement {
	const opt = document.createElement( 'os-option' );
	opt.setAttribute( 'value', `heading:${ label }` );
	opt.setAttribute( 'disabled', '' );
	opt.textContent = label;
	return opt;
}

function option( value: string, label: string ): HTMLElement {
	const opt = document.createElement( 'os-option' );
	opt.setAttribute( 'value', value );
	opt.textContent = label;
	return opt;
}

/**
 * Build the picker for the overview top bar.
 *
 * Returns `null` when no shell has installed the operations — the bar
 * then paints its tiles and the `+` exactly as it did before
 * workspaces existed.
 *
 * @param desktops Desks in bar order.
 * @param activeId The desk currently active.
 * @param handlers What a pick means for navigation.
 */
export function buildWorkspaceOverviewControl(
	desktops: readonly Desktop[],
	activeId: string,
	handlers: WorkspaceOverviewHandlers,
): HTMLElement | null {
	const deps = installed;
	if ( ! deps ) {
		return null;
	}

	const root = document.createElement( 'div' );
	root.className = 'os-overview-top-bar__workspace';

	const select = document.createElement( 'os-select' );
	select.className = 'os-overview-top-bar__workspace-select';
	// `plain` drops the field chrome: the bar already draws a surface,
	// and a bordered field inside it reads as a control in a control.
	select.setAttribute( 'plain', '' );
	select.setAttribute( 'aria-label', __( 'Workspace' ) );

	select.appendChild( heading( __( 'Workspaces' ) ) );
	for ( const d of desktops ) {
		select.appendChild( option( d.id, d.label ) );
	}

	select.appendChild( heading( __( 'New from template' ) ) );
	for ( const preset of listWorkspacePresets() ) {
		select.appendChild(
			option( `${ NEW_FROM_PRESET }${ preset.id }`, preset.label ),
		);
	}

	select.appendChild( heading( __( 'Manage' ) ) );
	select.appendChild( option( NEW_BLANK, __( 'New workspace…' ) ) );
	select.appendChild( option( EDIT_CURRENT, __( 'Edit this workspace…' ) ) );

	// Set AFTER the options exist: the component falls back to the
	// first entry for a value it cannot find, and on an empty list that
	// fallback is a heading.
	select.setAttribute( 'value', activeId );

	select.addEventListener( 'os-pick', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail?.value;
		if ( ! value ) {
			return;
		}
		if ( value === NEW_BLANK ) {
			// Created without activating, then handed to the bar: the
			// bar decides whether landing on a new desk means leaving
			// overview, not this module.
			const created = createWorkspace( deps, { activate: false } );
			deps.openEditor( created.id );
			handlers.onCreated( created.id );
			return;
		}
		if ( value === EDIT_CURRENT ) {
			deps.openEditor( activeId );
			return;
		}
		if ( value.startsWith( NEW_FROM_PRESET ) ) {
			const created = createWorkspace( deps, {
				preset: value.slice( NEW_FROM_PRESET.length ),
				activate: false,
			} );
			handlers.onCreated( created.id );
			return;
		}
		handlers.onSwitch( value );
	} );

	root.appendChild( select );
	return root;
}
