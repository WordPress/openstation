/**
 * OS-file drop manager — public entry point.
 *
 * Mounts the drop manager and wires the dialog opener. Called
 * once from `src/desktop.ts` during shell boot.
 */

import {
	classifyDropTarget,
	handleFiles,
	mountOsFileDropManager,
} from './manager';
import { mountUploadProgressHud } from './progress-hud';
import { mountMediaLibraryRefresher } from './library-refresher';
import type {
	DesktopStorageConfig,
	DropConfig,
	DropContext,
	DropFileEntry,
} from './types';

interface BootArgs {
	config?: DropConfig;
	mediaUrl: string;
	restNonce: string;
	/** Files REST base — enables the desktop-storage destination. */
	filesUrl?: string;
	storage?: DesktopStorageConfig;
}

/**
 * A drop the boot SENTINEL caught before this bundle had loaded.
 *
 * The sentinel (`./sentinel.ts`, compiled into the shell) starts
 * loading this bundle on the first dragenter that carries files; a
 * fast drop can still land first. `DataTransfer` is only readable
 * during the event, so the sentinel captures the `File` objects (and
 * the drop point + target, for context classification) synchronously
 * and hands them here once the bundle is up. Directory structure is
 * not recoverable on this path — a replayed folder drop flattens to
 * its files, which beats losing the drop.
 */
export interface CapturedDrop {
	files: File[];
	clientX: number;
	clientY: number;
	target: EventTarget | null;
	/**
	 * Whether a closer handler had already called `preventDefault()`
	 * on the original drop — read before the sentinel's own
	 * `preventDefault()`, which would otherwise mask it.
	 *
	 * The mounted manager refuses to double-handle a claimed drop (the
	 * Plugins `.zip` dropzone is the live case). The replay path has to
	 * honour the same rule, or a file that another surface already took
	 * responsibility for gets processed a second time through the
	 * Media Library pipeline.
	 */
	alreadyClaimed?: boolean;
}

/** Boot opts, kept for the replay path below. */
let bootedOpts: Parameters< typeof mountOsFileDropManager >[ 0 ] | null = null;

export function replayCapturedDrop( drop: CapturedDrop ): void {
	if ( ! bootedOpts || drop.files.length === 0 ) {
		return;
	}
	// The replay reaches `handleFiles()` directly, so it has to apply
	// the guards the mounted manager would have applied to a live drop.
	// Skipping them meant this path was strictly more permissive than
	// the steady state, during exactly the window — the first OS-file
	// drag of a session, before the lazy bundle booted — where the user
	// has no way to tell which path they are on.
	//
	// A drop another handler already claimed must not be handled again
	// (`mountOsFileDropManager` returns early on `defaultPrevented`),
	// and a user without `upload_files` gets a silent no-op rather than
	// a dialog and a "not an allowed file type" toast (the manager
	// mounts a no-op for them instead).
	if ( drop.alreadyClaimed ) {
		return;
	}
	if ( ! bootedOpts.config.enabled ) {
		return;
	}
	const ctx = classifyDropTarget( drop );
	void handleFiles( drop.files, ctx, bootedOpts );
}

export function bootOsFileDrop( args: BootArgs ): void {
	const config: DropConfig = args.config || {
		enabled: false,
		allowedMimes: [],
		maxSize: 0,
	};
	mountUploadProgressHud();
	mountMediaLibraryRefresher();
	const mountOpts: Parameters< typeof mountOsFileDropManager >[ 0 ] = {
		config,
		mediaUrl: args.mediaUrl,
		restNonce: args.restNonce,
		filesUrl: args.filesUrl,
		storage: args.storage,
		openDialog: async (
			entries: DropFileEntry[],
			ctx: DropContext,
			extra?: { forceDesktop?: boolean; emptyDirs?: string[] },
		): Promise< void > => {
			const { openUploadDialog } = await import( './dialog' );
			await openUploadDialog( {
				entries,
				context: ctx,
				mediaUrl: args.mediaUrl,
				restNonce: args.restNonce,
				filesUrl: args.filesUrl,
				storage: args.storage,
				forceDesktop: extra?.forceDesktop,
				emptyDirs: extra?.emptyDirs,
				mediaMaxBytes: config.maxSize,
			} );
		},
	};
	mountOsFileDropManager( mountOpts );
	bootedOpts = mountOpts;
}

/**
 * Route files chosen through a PICKER (the desktop menu's "Upload
 * files…" / "Upload folder…") into the same policy check + upload
 * dialog a drag-drop takes. Lived in
 * `desktop-files/upload-menu-items.ts` until the file-drop machinery
 * moved to its own bundle; the menu items now load this bundle on
 * click and call through `window.openStationFileDrop`.
 */
export async function routePickedFiles(
	files: File[],
	directory: boolean,
): Promise< void > {
	const config = (
		window as unknown as {
			openStationConfig?: {
				dropConfig?: DropConfig;
				mediaUrl?: string;
				restNonce?: string;
				filesUrl?: string;
				desktopStorage?: DesktopStorageConfig;
			};
		}
	).openStationConfig;
	const dropConfig = config?.dropConfig ?? {
		enabled: false,
		allowedMimes: [],
		maxSize: 0,
	};
	const { partitionByPolicy, defaultFields } = await import( './manager' );
	const { accepted, rejected } = partitionByPolicy( files, dropConfig );
	if ( rejected.length > 0 ) {
		const { showToast } = await import( '../toast' );
		showToast( {
			message:
				rejected.length === 1
					? rejected[ 0 ].message
					: `${ rejected.length } files can't be uploaded.`,
		} );
	}
	if ( accepted.length === 0 ) {
		return;
	}
	const entries = accepted.map( ( { file, mime } ) => ( {
		file,
		mime,
		fields: defaultFields( file, mime ),
		// `webkitRelativePath` is populated by directory picks (and
		// ONLY by them — drag-drops leave it empty).
		relativePath: directory
			? ( file as { webkitRelativePath?: string } ).webkitRelativePath ??
				''
			: '',
	} ) );
	const { openUploadDialog } = await import( './dialog' );
	await openUploadDialog( {
		entries,
		// Root-targeted picker: desktop destination default, server
		// picks free grid slots (no coords on non-wallpaper surfaces).
		context: { surface: 'folder', folderId: 0, x: 0, y: 0 },
		mediaUrl: config?.mediaUrl ?? '',
		restNonce: config?.restNonce ?? '',
		filesUrl: config?.filesUrl,
		storage: config?.desktopStorage,
		forceDesktop: directory,
		// These pickers live in the desktop's own menu — their whole
		// point is desktop storage, media-kind files included.
		preferDesktop: true,
		mediaMaxBytes: dropConfig.maxSize,
	} );
}

export { FILE_DROP_HOOKS } from './hooks';
export type {
	DropContext,
	DropFileEntry,
	DropDialogFields,
	DropRejection,
	DropUploadResult,
} from './types';
