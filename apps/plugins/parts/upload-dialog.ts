/**
 * Plugins app — the .zip upload dialog.
 *
 * Part of the `desktop-mode-plugins` client view. A modal card with a
 * file picker + drop zone that submits to `wp_ajax_openstation_plugins_upload`,
 * asks before replacing an existing folder (the server's 409), and
 * swaps to a post-install panel with an Activate button — the classic
 * `update.php?action=upload-plugin` flow, scoped to this window. The
 * window-level drop overlay opens it with the dropped file pre-applied.
 * Everything it listens to lives on its own overlay, so closing the
 * window takes the dialog and its listeners with it.
 *
 * @public
 */

import { __, formatBytes, sprintf } from '@openstation/app';
import { setBusy } from './actions';
import { activatePlugin } from './mutations';
import type { InstalledPlugin, PluginsHost, UploadPluginResult } from './types';

/**
 * Open the dialog. Resolves with the upload result on success, or
 * `null` when the user cancels.
 */
export function openUploadDialog(
	host: PluginsHost,
	prefilled: File | null,
): Promise< UploadPluginResult | null > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'os-plugins__upload-overlay';
		const card = document.createElement( 'div' );
		card.className = 'os-plugins__upload-card';
		card.setAttribute( 'role', 'dialog' );
		card.setAttribute( 'aria-modal', 'true' );
		card.setAttribute( 'aria-label', __( 'Upload a plugin .zip', 'desktop-mode' ) );

		const heading = document.createElement( 'h2' );
		heading.className = 'os-plugins__upload-heading';
		heading.textContent = __( 'Upload a plugin', 'desktop-mode' );
		const lede = document.createElement( 'p' );
		lede.className = 'os-plugins__upload-lede';
		lede.textContent = __( 'Pick a .zip file from your computer, or drop one onto the area below.', 'desktop-mode' );

		const dropZone = document.createElement( 'div' );
		dropZone.className = 'os-plugins__upload-dropzone';
		dropZone.tabIndex = 0;
		dropZone.setAttribute( 'role', 'button' );
		dropZone.setAttribute( 'aria-label', __( 'Drop a .zip plugin file here, or click to choose a file.', 'desktop-mode' ) );
		const dropIcon = document.createElement( 'span' );
		dropIcon.className = 'dashicons dashicons-upload os-plugins__upload-icon';
		dropIcon.setAttribute( 'aria-hidden', 'true' );
		const dropHint = document.createElement( 'p' );
		dropHint.className = 'os-plugins__upload-hint';
		dropHint.textContent = __( 'Drop your .zip here or click to browse', 'desktop-mode' );
		const fileLabel = document.createElement( 'p' );
		fileLabel.className = 'os-plugins__upload-filename';
		fileLabel.hidden = true;
		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.zip,application/zip,application/x-zip-compressed';
		input.style.display = 'none';
		dropZone.append( dropIcon, dropHint, fileLabel, input );

		const status = document.createElement( 'p' );
		status.className = 'os-plugins__upload-status';
		status.hidden = true;

		const actions = document.createElement( 'div' );
		actions.className = 'os-plugins__upload-actions';
		const cancelBtn = document.createElement( 'os-button' );
		cancelBtn.setAttribute( 'variant', 'ghost' );
		cancelBtn.textContent = __( 'Cancel', 'desktop-mode' );
		const submitBtn = document.createElement( 'os-button' );
		submitBtn.setAttribute( 'variant', 'primary' );
		submitBtn.textContent = __( 'Install', 'desktop-mode' );
		submitBtn.setAttribute( 'disabled', '' );
		actions.append( cancelBtn, submitBtn );

		card.append( heading, lede, dropZone, status, actions );
		overlay.appendChild( card );
		host.root.appendChild( overlay );

		// The overlay swallows stray drag/drop so a .zip dropped on the
		// dimmed area can't reach the window body (a second dialog) or
		// the shell-wide OS-file-drop manager (the Media Library).
		const swallowDrag = ( ev: DragEvent ): void => {
			ev.preventDefault();
			ev.stopPropagation();
		};
		overlay.addEventListener( 'dragenter', swallowDrag );
		overlay.addEventListener( 'dragover', swallowDrag );
		overlay.addEventListener( 'drop', swallowDrag );

		let pickedFile: File | null = null;
		let uploading = false;

		const showStatus = ( message: string, tone: 'info' | 'success' | 'error' ): void => {
			status.hidden = false;
			status.dataset.tone = tone;
			status.textContent = message;
		};

		const setFile = ( file: File | null ): void => {
			pickedFile = file;
			dropZone.classList.toggle( 'has-file', !! file );
			fileLabel.hidden = ! file;
			if ( file ) {
				fileLabel.textContent = sprintf(
					/* translators: 1: file name, 2: file size */
					__( '%1$s · %2$s', 'desktop-mode' ),
					file.name,
					formatBytes( file.size ),
				);
				submitBtn.removeAttribute( 'disabled' );
			} else {
				submitBtn.setAttribute( 'disabled', '' );
			}
		};

		dropZone.addEventListener( 'click', ( ev ) => {
			if ( ( ev.target as HTMLElement )?.tagName !== 'INPUT' ) {
				input.click();
			}
		} );
		dropZone.addEventListener( 'keydown', ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Enter' || ev.key === ' ' ) {
				ev.preventDefault();
				input.click();
			}
		} );
		dropZone.addEventListener( 'dragover', ( ev ) => {
			ev.preventDefault();
			ev.stopPropagation();
			dropZone.classList.add( 'is-hovered' );
		} );
		dropZone.addEventListener( 'dragleave', ( ev ) => {
			ev.stopPropagation();
			dropZone.classList.remove( 'is-hovered' );
		} );
		dropZone.addEventListener( 'drop', ( ev: DragEvent ) => {
			ev.preventDefault();
			ev.stopPropagation();
			dropZone.classList.remove( 'is-hovered' );
			const file = ev.dataTransfer?.files?.[ 0 ];
			if ( file && isZip( file ) ) {
				setFile( file );
			} else if ( file ) {
				showStatus( __( 'Only .zip files are accepted.', 'desktop-mode' ), 'error' );
			}
		} );
		input.addEventListener( 'change', () => {
			const file = input.files?.[ 0 ];
			if ( file && isZip( file ) ) {
				setFile( file );
			}
		} );

		const close = ( result: UploadPluginResult | null ): void => {
			overlay.remove();
			resolve( result );
		};
		// Escape closes — heard on the overlay, where focus lives, so the
		// listener goes with the dialog rather than outliving the window.
		overlay.addEventListener( 'keydown', ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Escape' && ! uploading ) {
				close( null );
			}
		} );
		cancelBtn.addEventListener( 'click', () => {
			if ( ! uploading ) {
				close( null );
			}
		} );
		submitBtn.addEventListener( 'click', () => {
			if ( pickedFile && ! uploading ) {
				void runUpload();
			}
		} );
		overlay.addEventListener( 'click', ( ev ) => {
			if ( ev.target === overlay && ! uploading ) {
				close( null );
			}
		} );

		if ( prefilled && isZip( prefilled ) ) {
			setFile( prefilled );
		}

		let restoreBusy: ( () => void ) | null = null;
		const setUploading = ( busy: boolean ): void => {
			uploading = busy;
			if ( busy ) {
				restoreBusy = setBusy( submitBtn );
				cancelBtn.setAttribute( 'disabled', '' );
			} else {
				restoreBusy?.();
				restoreBusy = null;
				cancelBtn.removeAttribute( 'disabled' );
			}
		};

		async function runUpload( overwrite = false ): Promise< void > {
			if ( ! pickedFile ) {
				return;
			}
			setUploading( true );
			showStatus(
				overwrite
					? __( 'Replacing existing plugin…', 'desktop-mode' )
					: __( 'Uploading and installing…', 'desktop-mode' ),
				'info',
			);
			try {
				const result = await host.rest.uploadPluginZip( pickedFile, { overwrite } );
				// The server did not see this install — re-read the list so
				// the Installed tab shows the new row without a Refresh, and
				// keep the dock in sync in case the plugin registers a menu.
				void host.refresh();
				host.broadcastChange( { plugin: result.plugin_file, action: 'install' } );
				host.refreshMenu();
				showSuccessPanel( result );
			} catch ( err ) {
				const errStatus = ( err as Error & { status?: number } ).status;
				const errCode = ( err as Error & { code?: string } ).code;
				setUploading( false );
				if ( ! overwrite && ( errStatus === 409 || errCode === 'folder_exists' ) ) {
					showStatus( __( 'A plugin with the same folder name is already installed.', 'desktop-mode' ), 'info' );
					const ok = await host.confirm( {
						title: __( 'Replace existing plugin?', 'desktop-mode' ),
						message: __(
							'A plugin with the same folder name is already installed. Replacing it overwrites the installed files. Any local edits to the plugin will be lost. The plugin will keep its activation state.',
							'desktop-mode',
						),
						confirmLabel: __( 'Replace', 'desktop-mode' ),
						cancelLabel: __( 'Cancel', 'desktop-mode' ),
						danger: true,
					} );
					if ( ok ) {
						await runUpload( true );
					}
					return;
				}
				showStatus(
					sprintf(
						/* translators: %s: error message from the upload handler */
						__( 'Upload failed: %s', 'desktop-mode' ),
						err instanceof Error ? err.message : String( err ),
					),
					'error',
				);
			}
		}

		/**
		 * Swap the picker for a post-install panel: name + version, an
		 * Activate button, a Close button.
		 */
		function showSuccessPanel( result: UploadPluginResult ): void {
			uploading = false;
			dropZone.remove();
			actions.remove();
			status.hidden = true;

			const successHeading = document.createElement( 'h3' );
			successHeading.className = 'os-plugins__upload-success-heading';
			successHeading.textContent = __( 'Plugin installed successfully.', 'desktop-mode' );
			const detail = document.createElement( 'p' );
			detail.className = 'os-plugins__upload-success-detail';
			const name = result.plugin_name || result.plugin_file;
			detail.textContent = result.plugin_version
				? sprintf(
					/* translators: 1: plugin name 2: plugin version */
					__( '%1$s %2$s', 'desktop-mode' ),
					name,
					result.plugin_version,
				)
				: name;
			const successActions = document.createElement( 'div' );
			successActions.className = 'os-plugins__upload-actions';
			const closeBtn = document.createElement( 'os-button' );
			closeBtn.setAttribute( 'variant', 'ghost' );
			closeBtn.textContent = __( 'Close', 'desktop-mode' );
			const activateBtn = document.createElement( 'os-button' );
			activateBtn.setAttribute( 'variant', 'primary' );
			activateBtn.textContent = __( 'Activate Plugin', 'desktop-mode' );
			successActions.append( closeBtn, activateBtn );
			card.append( successHeading, detail, successActions );

			closeBtn.addEventListener( 'click', () => {
				if ( ! uploading ) {
					close( result );
				}
			} );
			activateBtn.addEventListener( 'click', () => {
				if ( uploading ) {
					return;
				}
				uploading = true;
				const restore = setBusy( activateBtn );
				closeBtn.setAttribute( 'disabled', '' );
				// The app action keys off the extensionless path, as Core's
				// REST controller spells it; the upload handler returned
				// the full `foo/foo.php`.
				const pluginFile = result.plugin_file.endsWith( '.php' )
					? result.plugin_file.slice( 0, -4 )
					: result.plugin_file;
				void activatePlugin( host, {
					plugin: pluginFile,
					status: 'inactive',
					name,
				} as InstalledPlugin ).then( ( ok ) => {
					uploading = false;
					closeBtn.removeAttribute( 'disabled' );
					if ( ! ok ) {
						restore();
						return;
					}
					// Read confirmation and dismiss on your own schedule —
					// the post-install panel's own interaction model.
					successHeading.textContent = __( 'Plugin activated.', 'desktop-mode' );
					activateBtn.remove();
					closeBtn.setAttribute( 'variant', 'primary' );
					closeBtn.textContent = __( 'Done', 'desktop-mode' );
					closeBtn.focus?.();
				} );
			} );
			window.setTimeout( () => activateBtn.focus?.(), 16 );
		}

		// Keyboard users can immediately Enter to open the file picker.
		window.setTimeout( () => dropZone.focus(), 16 );
	} );
}

function isZip( file: File ): boolean {
	if ( file.size <= 0 ) {
		return false;
	}
	if ( file.name.toLowerCase().endsWith( '.zip' ) ) {
		return true;
	}
	return file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}
