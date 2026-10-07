export type ConflictChoice = 'reload' | 'overwrite' | 'cancel';

export interface ConflictDialogArgs {
	path: string;
	serverMtime: number;
	serverSize: number;
}

export function showConflictDialog(
	args: ConflictDialogArgs,
): Promise< ConflictChoice > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'osc-conflict-overlay';

		const dialog = document.createElement( 'div' );
		dialog.className = 'osc-conflict-dialog';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'osc-conflict-title' );

		const title = document.createElement( 'h2' );
		title.id = 'osc-conflict-title';
		title.className = 'osc-conflict-dialog__title';
		title.textContent = 'File changed on disk';

		const body = document.createElement( 'p' );
		body.className = 'osc-conflict-dialog__body';
		body.textContent = `Someone else (or another tab) modified ${ args.path } since you opened it. Choose how to resolve:`;

		const meta = document.createElement( 'p' );
		meta.className = 'osc-conflict-dialog__meta';
		meta.textContent = `Server version: ${ args.serverSize } bytes · ${ new Date(
			args.serverMtime * 1000,
		).toLocaleString() }`;

		const actions = document.createElement( 'div' );
		actions.className = 'osc-conflict-dialog__actions';

		const finish = ( choice: ConflictChoice ): void => {
			document.removeEventListener( 'keydown', onKey );
			overlay.remove();
			resolve( choice );
		};

		const reload = document.createElement( 'button' );
		reload.type = 'button';
		reload.className = 'osc-conflict-dialog__btn';
		reload.textContent = 'Reload from disk';
		reload.title = 'Discard your edits and load the server version.';
		reload.addEventListener( 'click', () => finish( 'reload' ) );

		const overwrite = document.createElement( 'button' );
		overwrite.type = 'button';
		overwrite.className =
			'osc-conflict-dialog__btn osc-conflict-dialog__btn--danger';
		overwrite.textContent = 'Overwrite anyway';
		overwrite.title = 'Save your edits, replacing the server version.';
		overwrite.addEventListener( 'click', () => finish( 'overwrite' ) );

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className =
			'osc-conflict-dialog__btn osc-conflict-dialog__btn--quiet';
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

		overlay.addEventListener( 'click', ( e ) => {
			if ( e.target === overlay ) {
				finish( 'cancel' );
			}
		} );
		document.addEventListener( 'keydown', onKey );

		document.body.append( overlay );

		cancel.focus();
	} );
}
