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

	filesUrl?: string;
	storage?: DesktopStorageConfig;
}

export interface CapturedDrop {
	files: File[];
	clientX: number;
	clientY: number;
	target: EventTarget | null;

	alreadyClaimed?: boolean;
}

let bootedOpts: Parameters< typeof mountOsFileDropManager >[ 0 ] | null = null;

export function replayCapturedDrop( drop: CapturedDrop ): void {
	if ( ! bootedOpts || drop.files.length === 0 ) {
		return;
	}

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

		relativePath: directory
			? ( file as { webkitRelativePath?: string } ).webkitRelativePath ??
				''
			: '',
	} ) );
	const { openUploadDialog } = await import( './dialog' );
	await openUploadDialog( {
		entries,

		context: { surface: 'folder', folderId: 0, x: 0, y: 0 },
		mediaUrl: config?.mediaUrl ?? '',
		restNonce: config?.restNonce ?? '',
		filesUrl: config?.filesUrl,
		storage: config?.desktopStorage,
		forceDesktop: directory,

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
