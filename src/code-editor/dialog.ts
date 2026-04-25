/**
 * Code Editor — small reusable dialog helpers.
 *
 * One overlay primitive shared by every modal the editor needs.
 * Currently used for the unsaved-tab close confirm; the larger
 * three-choice conflict-resolution dialog (`conflict-dialog.ts`)
 * intentionally rolls its own to keep its more bespoke layout
 * uncoupled from this confirm shape.
 *
 * The dialogs render into `<body>` so they float above the desktop
 * shell. We can't use native `<dialog>`'s modal mode — the desktop
 * intercepts focus on its own windows and the native overlay
 * conflicts with that.
 *
 * @since 0.18.0
 */

export interface ConfirmDialogArgs {
	/** Bold first line. */
	title: string;
	/** Plain-text body explaining what the choice does. */
	body: string;
	/** Label on the affirmative button. Default: `'Confirm'`. */
	confirmLabel?: string;
	/** Label on the negative button. Default: `'Cancel'`. */
	cancelLabel?: string;
	/**
	 * Render the confirm button with the destructive (red) wash.
	 * Use for "discard" / "delete" / "overwrite" actions.
	 */
	danger?: boolean;
}

/**
 * Show a confirm modal. Resolves with `true` if the user confirmed,
 * `false` if cancelled (button, click-outside, or Escape).
 */
export function showConfirm( args: ConfirmDialogArgs ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'wpdc-conflict-overlay';

		const dialog = document.createElement( 'div' );
		dialog.className = 'wpdc-conflict-dialog';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'wpdc-confirm-title' );

		const title = document.createElement( 'h2' );
		title.id = 'wpdc-confirm-title';
		title.className = 'wpdc-conflict-dialog__title';
		title.textContent = args.title;

		const body = document.createElement( 'p' );
		body.className = 'wpdc-conflict-dialog__body';
		body.textContent = args.body;

		const actions = document.createElement( 'div' );
		actions.className = 'wpdc-conflict-dialog__actions';

		const finish = ( ok: boolean ): void => {
			document.removeEventListener( 'keydown', onKey );
			overlay.remove();
			resolve( ok );
		};

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className =
			'wpdc-conflict-dialog__btn wpdc-conflict-dialog__btn--quiet';
		cancel.textContent = args.cancelLabel ?? 'Cancel';
		cancel.addEventListener( 'click', () => finish( false ) );

		const confirm = document.createElement( 'button' );
		confirm.type = 'button';
		confirm.className = 'wpdc-conflict-dialog__btn';
		if ( args.danger ) {
			confirm.classList.add( 'wpdc-conflict-dialog__btn--danger' );
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
		// Default focus on the safe option.
		cancel.focus();
	} );
}
