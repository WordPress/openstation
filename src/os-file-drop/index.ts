/**
 * OS-file drop manager — public entry point.
 *
 * Mounts the drop manager and wires the dialog opener. Called
 * once from `src/desktop.ts` during shell boot.
 *
 * @since 0.30.0
 */

import { mountOsFileDropManager } from './manager';
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

export function bootOsFileDrop( args: BootArgs ): void {
	const config: DropConfig = args.config || {
		enabled: false,
		allowedMimes: [],
		maxSize: 0,
	};
	mountUploadProgressHud();
	mountMediaLibraryRefresher();
	mountOsFileDropManager( {
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
