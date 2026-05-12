/**
 * Native Plugins window — .zip upload dialog.
 *
 * Opens a `<wpd-confirm-dialog>` styled with a custom slot
 * containing a file picker + drop zone. Submits to our
 * `wp_ajax_desktop_mode_plugins_upload` action via `uploadPluginZip`.
 *
 * Public surface: `openUploadDialog( hostBody, prefilledFile? )`. The
 * window-level drop-zone overlay (in `browse-view.ts`) calls this with
 * the dropped file pre-applied so the user just confirms.
 *
 * @public
 * @since 0.9.0
 */

import { __, sprintf } from '../i18n';
import { refreshFrameworkMenu, uploadPluginZip } from './rest';
import '../ui/components/wpd-button/wpd-button';

interface UploadResult {
	plugin_file: string;
	status: 'inactive';
	messages: string[];
}

export interface UploadCallbacks {
	onUploaded?: ( result: UploadResult ) => void;
}

/**
 * Open the upload dialog. Returns a promise that resolves with the
 * upload result on success, or `null` when the user cancels.
 */
export function openUploadDialog(
	host: HTMLElement,
	prefilled: File | null,
	callbacks: UploadCallbacks = {},
): Promise< UploadResult | null > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'desktop-mode-plugins__upload-overlay';

		const card = document.createElement( 'div' );
		card.className = 'desktop-mode-plugins__upload-card';
		card.setAttribute( 'role', 'dialog' );
		card.setAttribute( 'aria-modal', 'true' );
		card.setAttribute(
			'aria-label',
			__( 'Upload a plugin .zip', 'desktop-mode' ),
		);

		const heading = document.createElement( 'h2' );
		heading.className = 'desktop-mode-plugins__upload-heading';
		heading.textContent = __( 'Upload a plugin', 'desktop-mode' );
		const lede = document.createElement( 'p' );
		lede.className = 'desktop-mode-plugins__upload-lede';
		lede.textContent = __(
			'Pick a .zip file from your computer, or drop one onto the area below.',
			'desktop-mode',
		);

		const dropZone = document.createElement( 'div' );
		dropZone.className = 'desktop-mode-plugins__upload-dropzone';
		dropZone.tabIndex = 0;
		dropZone.setAttribute( 'role', 'button' );
		dropZone.setAttribute(
			'aria-label',
			__(
				'Drop a .zip plugin file here, or click to choose a file.',
				'desktop-mode',
			),
		);

		const dropIcon = document.createElement( 'span' );
		dropIcon.className =
			'dashicons dashicons-upload desktop-mode-plugins__upload-icon';
		dropIcon.setAttribute( 'aria-hidden', 'true' );
		const dropHint = document.createElement( 'p' );
		dropHint.className = 'desktop-mode-plugins__upload-hint';
		dropHint.textContent = __(
			'Drop your .zip here or click to browse',
			'desktop-mode',
		);
		const fileLabel = document.createElement( 'p' );
		fileLabel.className = 'desktop-mode-plugins__upload-filename';
		fileLabel.hidden = true;

		dropZone.append( dropIcon, dropHint, fileLabel );

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.zip,application/zip,application/x-zip-compressed';
		input.style.display = 'none';
		dropZone.appendChild( input );

		const status = document.createElement( 'p' );
		status.className = 'desktop-mode-plugins__upload-status';
		status.hidden = true;

		const actions = document.createElement( 'div' );
		actions.className = 'desktop-mode-plugins__upload-actions';
		const cancelBtn = document.createElement( 'wpd-button' );
		cancelBtn.setAttribute( 'variant', 'ghost' );
		cancelBtn.textContent = __( 'Cancel', 'desktop-mode' );
		const submitBtn = document.createElement( 'wpd-button' );
		submitBtn.setAttribute( 'variant', 'primary' );
		submitBtn.textContent = __( 'Install', 'desktop-mode' );
		submitBtn.setAttribute( 'disabled', '' );
		actions.append( cancelBtn, submitBtn );

		card.append( heading, lede, dropZone, status, actions );
		overlay.appendChild( card );
		host.appendChild( overlay );

		// ─── State ──────────────────────────────────────────────────
		let pickedFile: File | null = null;
		let uploading = false;

		const setFile = ( file: File | null ): void => {
			pickedFile = file;
			if ( file ) {
				dropZone.classList.add( 'has-file' );
				fileLabel.hidden = false;
				fileLabel.textContent = sprintf(
					/* translators: 1: file name, 2: file size in KB */
					__( '%1$s · %2$s KB', 'desktop-mode' ),
					file.name,
					Math.round( file.size / 1024 ).toString(),
				);
				submitBtn.removeAttribute( 'disabled' );
			} else {
				dropZone.classList.remove( 'has-file' );
				fileLabel.hidden = true;
				submitBtn.setAttribute( 'disabled', '' );
			}
		};

		// ─── Wire up ────────────────────────────────────────────────
		dropZone.addEventListener( 'click', ( ev ) => {
			if ( ( ev.target as HTMLElement )?.tagName === 'INPUT' ) {
				return;
			}
			input.click();
		} );
		dropZone.addEventListener( 'keydown', ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Enter' || ev.key === ' ' ) {
				ev.preventDefault();
				input.click();
			}
		} );
		dropZone.addEventListener( 'dragover', ( ev ) => {
			ev.preventDefault();
			dropZone.classList.add( 'is-hovered' );
		} );
		dropZone.addEventListener( 'dragleave', () => {
			dropZone.classList.remove( 'is-hovered' );
		} );
		dropZone.addEventListener( 'drop', ( ev: DragEvent ) => {
			ev.preventDefault();
			dropZone.classList.remove( 'is-hovered' );
			const file = ev.dataTransfer?.files?.[ 0 ];
			if ( file && isZip( file ) ) {
				setFile( file );
			} else if ( file ) {
				showStatus(
					__( 'Only .zip files are accepted.', 'desktop-mode' ),
					'error',
				);
			}
		} );
		input.addEventListener( 'change', () => {
			const file = input.files?.[ 0 ];
			if ( file && isZip( file ) ) {
				setFile( file );
			}
		} );

		const close = ( result: UploadResult | null ): void => {
			document.removeEventListener( 'keydown', onKey );
			overlay.remove();
			resolve( result );
		};
		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' && ! uploading ) {
				close( null );
			}
		};
		document.addEventListener( 'keydown', onKey );

		cancelBtn.addEventListener( 'click', () => {
			if ( uploading ) {
				return;
			}
			close( null );
		} );

		submitBtn.addEventListener( 'click', () => {
			if ( ! pickedFile || uploading ) {
				return;
			}
			void runUpload();
		} );

		overlay.addEventListener( 'click', ( ev ) => {
			if ( ev.target === overlay && ! uploading ) {
				close( null );
			}
		} );

		// Pre-populate the file slot when the caller passed one (drop
		// onto the window body bypasses the picker).
		if ( prefilled && isZip( prefilled ) ) {
			setFile( prefilled );
		}

		async function runUpload(): Promise< void > {
			if ( ! pickedFile ) {
				return;
			}
			uploading = true;
			submitBtn.setAttribute( 'busy', '' );
			submitBtn.setAttribute( 'disabled', '' );
			cancelBtn.setAttribute( 'disabled', '' );
			showStatus(
				__( 'Uploading and installing…', 'desktop-mode' ),
				'info',
			);
			try {
				const result = await uploadPluginZip( pickedFile );
				if ( callbacks.onUploaded ) {
					callbacks.onUploaded( result );
				}
				// Background — the upload UX shows its own success state
				// and closes itself shortly after; the hidden-iframe menu
				// refresh is for dock/taskbar sync and doesn't need to
				// gate that handoff.
				void refreshFrameworkMenu();
				showStatus(
					sprintf(
						/* translators: %s: plugin file (e.g. akismet/akismet.php) */
						__( 'Installed %s. Activate it from the Installed tab.', 'desktop-mode' ),
						result.plugin_file,
					),
					'success',
				);
				// Brief celebratory pause so the user reads the success
				// message; then close. Skipped during tests where the
				// jsdom timer doesn't realistically run.
				window.setTimeout( () => close( result ), 1200 );
			} catch ( err ) {
				uploading = false;
				submitBtn.removeAttribute( 'busy' );
				submitBtn.removeAttribute( 'disabled' );
				cancelBtn.removeAttribute( 'disabled' );
				const message =
					err instanceof Error ? err.message : String( err );
				showStatus(
					sprintf(
						/* translators: %s: error message from the upload handler */
						__( 'Upload failed: %s', 'desktop-mode' ),
						message,
					),
					'error',
				);
			}
		}

		function showStatus(
			message: string,
			tone: 'info' | 'success' | 'error',
		): void {
			status.hidden = false;
			status.dataset.tone = tone;
			status.textContent = message;
		}

		// Focus the dropzone so keyboard users can immediately Enter
		// to open the file picker.
		window.setTimeout( () => dropZone.focus(), 16 );
	} );
}

function isZip( file: File ): boolean {
	if ( file.size <= 0 ) {
		return false;
	}
	const name = file.name.toLowerCase();
	if ( name.endsWith( '.zip' ) ) {
		return true;
	}
	return file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}
