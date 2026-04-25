/**
 * Code Editor — save-conflict dialog.
 *
 * Tiny single-purpose modal: shown when a save returns 409 because
 * the file changed on disk since the editor opened it. Offers three
 * choices:
 *
 *   - **Reload from disk** — replace the local buffer with whatever
 *     the server now has. Editor's edits are lost (caller stashes
 *     them first if it wants to recover).
 *   - **Overwrite anyway** — re-save with `mtime = serverMtime` so
 *     the optimistic-concurrency check passes on retry.
 *   - **Cancel** — leave the buffer dirty, do nothing.
 *
 * Phase 4 will add a real diff view here. v1 stays text-only — most
 * conflicts are "two tabs of the same editor"; offering reload /
 * overwrite covers them without the diff complexity.
 *
 * @since 0.18.0
 */

export type ConflictChoice = 'reload' | 'overwrite' | 'cancel';

export interface ConflictDialogArgs {
	path: string;
	serverMtime: number;
	serverSize: number;
}

/**
 * Show the modal. Resolves with the user's choice.
 *
 * The dialog is rendered into `<body>` so it floats above the
 * desktop window. We can't use `<dialog>`'s native modal mode here
 * because the desktop shell intercepts focus on its own windows —
 * a manual overlay + click-outside-to-cancel is more predictable.
 */
export function showConflictDialog(
	args: ConflictDialogArgs,
): Promise< ConflictChoice > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'wpdc-conflict-overlay';

		const dialog = document.createElement( 'div' );
		dialog.className = 'wpdc-conflict-dialog';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'wpdc-conflict-title' );

		const title = document.createElement( 'h2' );
		title.id = 'wpdc-conflict-title';
		title.className = 'wpdc-conflict-dialog__title';
		title.textContent = 'File changed on disk';

		const body = document.createElement( 'p' );
		body.className = 'wpdc-conflict-dialog__body';
		body.textContent = `Someone else (or another tab) modified ${ args.path } since you opened it. Choose how to resolve:`;

		const meta = document.createElement( 'p' );
		meta.className = 'wpdc-conflict-dialog__meta';
		meta.textContent = `Server version: ${ args.serverSize } bytes · ${ new Date(
			args.serverMtime * 1000,
		).toLocaleString() }`;

		const actions = document.createElement( 'div' );
		actions.className = 'wpdc-conflict-dialog__actions';

		const finish = ( choice: ConflictChoice ): void => {
			document.removeEventListener( 'keydown', onKey );
			overlay.remove();
			resolve( choice );
		};

		const reload = document.createElement( 'button' );
		reload.type = 'button';
		reload.className = 'wpdc-conflict-dialog__btn';
		reload.textContent = 'Reload from disk';
		reload.title = 'Discard your edits and load the server version.';
		reload.addEventListener( 'click', () => finish( 'reload' ) );

		const overwrite = document.createElement( 'button' );
		overwrite.type = 'button';
		overwrite.className =
			'wpdc-conflict-dialog__btn wpdc-conflict-dialog__btn--danger';
		overwrite.textContent = 'Overwrite anyway';
		overwrite.title = 'Save your edits, replacing the server version.';
		overwrite.addEventListener( 'click', () => finish( 'overwrite' ) );

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className =
			'wpdc-conflict-dialog__btn wpdc-conflict-dialog__btn--quiet';
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', () => finish( 'cancel' ) );

		actions.append( cancel, reload, overwrite );
		dialog.append( title, body, meta, actions );
		overlay.append( dialog );

		const onKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				finish( 'cancel' );
			}
		};

		// Click-on-overlay-but-outside-dialog cancels.
		overlay.addEventListener( 'click', ( e ) => {
			if ( e.target === overlay ) {
				finish( 'cancel' );
			}
		} );
		document.addEventListener( 'keydown', onKey );

		document.body.append( overlay );
		// Default focus on the safe option.
		cancel.focus();
	} );
}
