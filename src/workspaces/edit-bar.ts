/**
 * The bar that says "you are editing a workspace".
 *
 * Editing a workspace happens on its own desk — the desk is the editor
 * — so the one thing that must be unmistakable is that the desk in
 * front of the user is being edited, not used. A full-width bar across
 * the top of the shell says so for as long as it lasts, names the
 * workspace, and carries the two ways out: Save changes and Cancel.
 *
 * It is the first child of the shell, a flex column, so it pushes the
 * desk down rather than covering it: the work area shrinks with it and
 * a maximized or snapped window stays fully visible.
 */

import { __, sprintf } from '../i18n';

export interface WorkspaceEditBarOptions {
	/** The workspace's name. */
	label: string;
	/** Keep the desk as it is now. Return false to keep the bar up. */
	onSave: () => boolean;
	/** Leave without saving. */
	onCancel: () => void;
	/** Tools for the desk being edited — "+ Note", "+ XL note" — before Cancel. */
	actions?: Array< { label: string; onClick: () => void } >;
}

let current: ( () => void ) | null = null;

/** Whether a workspace is being edited. */
export function isEditingWorkspace(): boolean {
	return null !== current;
}

/**
 * Show the bar, replacing one already up. Returns the teardown, which
 * both buttons also run.
 */
export function showWorkspaceEditBar( opts: WorkspaceEditBarOptions ): () => void {
	current?.();
	const shell = document.getElementById( 'os-shell' );
	if ( ! shell ) {
		return () => undefined;
	}
	const bar = document.createElement( 'div' );
	bar.className = 'os-workspace-editbar';
	bar.setAttribute( 'role', 'region' );
	bar.setAttribute( 'aria-label', __( 'Editing a workspace' ) );

	const glyph = document.createElement( 'span' );
	glyph.className = 'os-workspace-editbar__glyph dashicons dashicons-edit';
	glyph.setAttribute( 'aria-hidden', 'true' );

	const text = document.createElement( 'div' );
	text.className = 'os-workspace-editbar__text';
	const title = document.createElement( 'strong' );
	title.textContent = sprintf(
		// translators: %s is the workspace name.
		__( 'Editing workspace “%s”' ),
		opts.label,
	);
	const hint = document.createElement( 'span' );
	hint.textContent = __( 'Arrange its windows, widgets and apps, then save.' );
	text.append( title, hint );

	const cancel = document.createElement( 'os-button' );
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = __( 'Cancel' );
	const save = document.createElement( 'os-button' );
	save.setAttribute( 'variant', 'primary' );
	save.textContent = __( 'Save changes' );

	const tools = ( opts.actions ?? [] ).map( ( action ) => {
		const button = document.createElement( 'os-button' );
		button.setAttribute( 'variant', 'secondary' );
		button.textContent = action.label;
		button.addEventListener( 'click', action.onClick );
		return button;
	} );
	bar.append( glyph, text, ...tools, cancel, save );
	shell.prepend( bar );
	document.body.classList.add( 'os-workspace-editing' );

	const dispose = (): void => {
		if ( current !== dispose ) {
			return;
		}
		current = null;
		bar.remove();
		document.body.classList.remove( 'os-workspace-editing' );
	};
	cancel.addEventListener( 'click', () => {
		dispose();
		opts.onCancel();
	} );
	save.addEventListener( 'click', () => {
		if ( opts.onSave() ) {
			dispose();
		}
	} );
	current = dispose;
	return dispose;
}
