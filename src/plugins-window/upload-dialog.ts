/**
 * Native Plugins window — .zip upload dialog.
 *
 * Opens a `<os-confirm-dialog>` styled with a custom slot
 * containing a file picker + drop zone. Submits to our
 * `wp_ajax_openstation_plugins_upload` action via `uploadPluginZip`.
 *
 * Public surface: `openUploadDialog( hostBody, prefilledFile? )`. The
 * window-level drop-zone overlay (in `browse-view.ts`) calls this with
 * the dropped file pre-applied so the user just confirms.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import {
	activateInstalledPlugin,
	refreshFrameworkMenu,
	uploadPluginZip,
	type UploadPluginResult,
} from './rest';
// `osConfirm` and `showToast` here MUST come from the main-bundle-safe
// shims (`../os-confirm`, `../toast`) — they construct the elements via
// `document.createElement()` after lazy-loading the shell-overlays
// bundle. Importing the component module directly
// (`../ui/components/os-confirm-dialog/os-confirm-dialog`) would
// inline `os-confirm-dialog`'s `defineComponent()` into the main
// bundle. That's the canary tag the shell-overlays loader uses to
// detect whether the bundle is loaded — registering it from the main
// bundle short-circuits the loader, and the OTHER components in
// shell-overlays (notably `os-window-button`, which renders the
// titlebar Minimize / Maximize / Close icons) never get defined. The
// result is visually intact-looking window controls with zero icons.
import { osConfirm } from '../os-confirm';
import { showToast } from '../toast';
import { broadcast } from '../broadcast';
import '../ui/components/os-button/os-button';

/**
 * Cross-view sync topic for the Plugins window. The Installed +
 * Browse views subscribe and re-fetch on every payload so they
 * never show a stale snapshot — see `installed-view.ts` and
 * `browse-view.ts`. The upload dialog publishes here too so a
 * fresh install / activate from the dialog is reflected on both
 * tabs without the user needing to hit Refresh.
 */
const PLUGINS_CHANGED_TOPIC = 'os.plugin.changed';
const PLUGINS_CHANGED_SOURCE = 'upload-dialog';
interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'bulk';
}

export interface UploadCallbacks {
	onUploaded?: ( result: UploadPluginResult ) => void;
	onActivated?: ( pluginFile: string ) => void;
}

/**
 * Open the upload dialog. Returns a promise that resolves with the
 * upload result on success, or `null` when the user cancels.
 */
export function openUploadDialog(
	host: HTMLElement,
	prefilled: File | null,
	callbacks: UploadCallbacks = {},
): Promise< UploadPluginResult | null > {
	return new Promise( ( resolve ) => {
		const overlay = document.createElement( 'div' );
		overlay.className = 'os-plugins__upload-overlay';

		const card = document.createElement( 'div' );
		card.className = 'os-plugins__upload-card';
		card.setAttribute( 'role', 'dialog' );
		card.setAttribute( 'aria-modal', 'true' );
		card.setAttribute(
			'aria-label',
			__( 'Upload a plugin .zip', 'desktop-mode' ),
		);

		const heading = document.createElement( 'h2' );
		heading.className = 'os-plugins__upload-heading';
		heading.textContent = __( 'Upload a plugin', 'desktop-mode' );
		const lede = document.createElement( 'p' );
		lede.className = 'os-plugins__upload-lede';
		lede.textContent = __(
			'Pick a .zip file from your computer, or drop one onto the area below.',
			'desktop-mode',
		);

		const dropZone = document.createElement( 'div' );
		dropZone.className = 'os-plugins__upload-dropzone';
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
			'dashicons dashicons-upload os-plugins__upload-icon';
		dropIcon.setAttribute( 'aria-hidden', 'true' );
		const dropHint = document.createElement( 'p' );
		dropHint.className = 'os-plugins__upload-hint';
		dropHint.textContent = __(
			'Drop your .zip here or click to browse',
			'desktop-mode',
		);
		const fileLabel = document.createElement( 'p' );
		fileLabel.className = 'os-plugins__upload-filename';
		fileLabel.hidden = true;

		dropZone.append( dropIcon, dropHint, fileLabel );

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.zip,application/zip,application/x-zip-compressed';
		input.style.display = 'none';
		dropZone.appendChild( input );

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
		host.appendChild( overlay );

		// The modal overlay swallows stray drag/drop events so a
		// .zip dropped on the dimmed area (outside the dropzone)
		// can't bubble through to the Plugins window body — that
		// would open a duplicate upload dialog — or to the
		// shell-wide OS-file-drop manager.
		const swallowDrag = ( ev: DragEvent ): void => {
			ev.preventDefault();
			ev.stopPropagation();
		};
		overlay.addEventListener( 'dragenter', swallowDrag );
		overlay.addEventListener( 'dragover', swallowDrag );
		overlay.addEventListener( 'drop', swallowDrag );

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
		// Drag/drop events are stopped at the dropzone so they
		// don't bubble to the Plugins window body handler (which
		// would open a second upload dialog) or to the shell-wide
		// OS-file-drop manager (which would route the .zip to the
		// Media Library).
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

		const close = ( result: UploadPluginResult | null ): void => {
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

		async function runUpload( overwrite = false ): Promise< void > {
			if ( ! pickedFile ) {
				return;
			}
			uploading = true;
			submitBtn.setAttribute( 'busy', '' );
			submitBtn.setAttribute( 'disabled', '' );
			cancelBtn.setAttribute( 'disabled', '' );
			showStatus(
				overwrite
					? __( 'Replacing existing plugin…', 'desktop-mode' )
					: __( 'Uploading and installing…', 'desktop-mode' ),
				'info',
			);
			try {
				const result = await uploadPluginZip( pickedFile, { overwrite } );
				if ( callbacks.onUploaded ) {
					callbacks.onUploaded( result );
				}
				// Tell every other view (Installed tab, anything else
				// listening) that the plugin set just changed — they
				// re-fetch and re-render, so the new row appears
				// without the user needing to hit Refresh.
				broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
					source: PLUGINS_CHANGED_SOURCE,
					plugin: result.plugin_file,
					action: 'install',
				} );
				// Hidden-iframe menu refresh keeps the dock/taskbar in
				// sync if the new plugin registered an admin menu (the
				// activate path also triggers one; firing here too is
				// idempotent and lets the user see new tiles even if
				// they Close without activating).
				void refreshFrameworkMenu();
				showSuccessPanel( result );
			} catch ( err ) {
				const errStatus = ( err as Error & { status?: number } ).status;
				const errCode = ( err as Error & { code?: string } ).code;
				if (
					! overwrite &&
					( errStatus === 409 || errCode === 'folder_exists' )
				) {
					// Server refused because the destination folder
					// exists. Ask the user, then retry with overwrite.
					uploading = false;
					submitBtn.removeAttribute( 'busy' );
					submitBtn.removeAttribute( 'disabled' );
					cancelBtn.removeAttribute( 'disabled' );
					showStatus(
						__(
							'A plugin with the same folder name is already installed.',
							'desktop-mode',
						),
						'info',
					);
					const ok = await osConfirm( {
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

		/**
		 * Replace the picker + Install/Cancel footer with a post-install
		 * action panel — plugin name + version, an Activate button, and
		 * a Close button. Mirrors WP Core's classic
		 * `update.php?action=upload-plugin` "Plugin installed
		 * successfully → Activate Plugin" UX, scoped to this dialog so
		 * no window navigation is required.
		 */
		function showSuccessPanel( result: UploadPluginResult ): void {
			// The upload itself is settled; clear the in-flight guard so
			// the new Activate / Close buttons aren't immediately
			// short-circuited by it.
			uploading = false;
			// Tear down the picker so it can't be re-fired and the
			// success state is unambiguous.
			dropZone.remove();
			input.remove();
			actions.remove();
			status.hidden = true;

			const successHeading = document.createElement( 'h3' );
			successHeading.className = 'os-plugins__upload-success-heading';
			successHeading.textContent = __(
				'Plugin installed successfully.',
				'desktop-mode',
			);

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
				if ( uploading ) {
					return;
				}
				close( result );
			} );

			activateBtn.addEventListener( 'click', () => {
				if ( uploading ) {
					return;
				}
				void runActivate();
			} );

			async function runActivate(): Promise< void > {
				uploading = true;
				activateBtn.setAttribute( 'busy', '' );
				activateBtn.setAttribute( 'disabled', '' );
				closeBtn.setAttribute( 'disabled', '' );
				try {
					// `/wp/v2/plugins/{plugin}` keys off the
					// extensionless plugin slug. The upload handler
					// returns the full `foo/foo.php`; strip the `.php`
					// to match Core's REST shape.
					const pluginFile = result.plugin_file.endsWith( '.php' )
						? result.plugin_file.slice( 0, -4 )
						: result.plugin_file;
					const updated = await activateInstalledPlugin( {
						plugin: pluginFile,
						status: 'inactive',
					} as Parameters< typeof activateInstalledPlugin >[ 0 ] );
					if ( callbacks.onActivated ) {
						callbacks.onActivated( result.plugin_file );
					}
					void refreshFrameworkMenu();
					// Notify both tabs so the row flips to "Active" and
					// any cached state on either side refetches.
					broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
						source: PLUGINS_CHANGED_SOURCE,
						plugin: updated.plugin,
						action: 'activate',
					} );
					// Toast is best-effort, in case the user has
					// dragged the dialog out of view; the in-dialog
					// "activated" panel below is the primary signal.
					showToast( {
						message: sprintf(
							/* translators: %s: plugin name */
							__( '%s activated.', 'desktop-mode' ),
							name,
						),
					} );
					// Swap the post-install panel for an explicit
					// activated state. Lets the user read confirmation
					// and dismiss on their own schedule — matching the
					// post-install panel's interaction model.
					uploading = false;
					successHeading.textContent = __(
						'Plugin activated.',
						'desktop-mode',
					);
					activateBtn.remove();
					closeBtn.removeAttribute( 'disabled' );
					closeBtn.setAttribute( 'variant', 'primary' );
					closeBtn.textContent = __( 'Done', 'desktop-mode' );
					closeBtn.focus?.();
				} catch ( err ) {
					uploading = false;
					activateBtn.removeAttribute( 'busy' );
					activateBtn.removeAttribute( 'disabled' );
					closeBtn.removeAttribute( 'disabled' );
					const message =
						err instanceof Error ? err.message : String( err );
					status.hidden = false;
					status.dataset.tone = 'error';
					status.textContent = sprintf(
						/* translators: %s: error message from the activate handler */
						__( 'Activate failed: %s', 'desktop-mode' ),
						message,
					);
					card.appendChild( status );
				}
			}

			// Move keyboard focus to the primary action so the user
			// can confirm with Enter.
			window.setTimeout( () => activateBtn.focus?.(), 16 );
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
