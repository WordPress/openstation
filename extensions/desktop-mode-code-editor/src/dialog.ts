export interface ConfirmDialogArgs {

	title: string;

	body: string;

	confirmLabel?: string;

	cancelLabel?: string;

	danger?: boolean;
}

export function showConfirm( args: ConfirmDialogArgs ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'osc-conflict-overlay';

		const dialog = document.createElement( 'div' );
		dialog.className = 'osc-conflict-dialog';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'osc-confirm-title' );

		const title = document.createElement( 'h2' );
		title.id = 'osc-confirm-title';
		title.className = 'osc-conflict-dialog__title';
		title.textContent = args.title;

		const body = document.createElement( 'p' );
		body.className = 'osc-conflict-dialog__body';
		body.textContent = args.body;

		const actions = document.createElement( 'div' );
		actions.className = 'osc-conflict-dialog__actions';

		const finish = ( ok: boolean ): void => {
			document.removeEventListener( 'keydown', onKey );
			overlay.remove();
			resolve( ok );
		};

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className =
			'osc-conflict-dialog__btn osc-conflict-dialog__btn--quiet';
		cancel.textContent = args.cancelLabel ?? 'Cancel';
		cancel.addEventListener( 'click', () => finish( false ) );

		const confirm = document.createElement( 'button' );
		confirm.type = 'button';
		confirm.className = 'osc-conflict-dialog__btn';
		if ( args.danger ) {
			confirm.classList.add( 'osc-conflict-dialog__btn--danger' );
		}
		confirm.textContent = args.confirmLabel ?? 'Confirm';
		confirm.addEventListener( 'click', () => finish( true ) );

		actions.append( cancel, confirm );
		dialog.append( title, body, actions );
		overlay.append( dialog );

		const onKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				finish( false );
			} else if ( e.key === 'Enter' ) {
				e.preventDefault();
				finish( true );
			}
		};

		overlay.addEventListener( 'click', ( e ) => {
			if ( e.target === overlay ) {
				finish( false );
			}
		} );
		document.addEventListener( 'keydown', onKey );

		document.body.append( overlay );

		cancel.focus();
	} );
}
