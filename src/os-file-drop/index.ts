/**
 * OS-file drop manager — public entry point.
 *
 * Mounts the drop manager and wires the dialog opener. Called
 * once from `src/desktop.ts` during shell boot.
 *
 * @since 0.30.0
 */

import { mountOsFileDropManager } from './manager';
import type { DropConfig, DropContext, DropFileEntry } from './types';

interface BootArgs {
	config?: DropConfig;
	mediaUrl: string;
	restNonce: string;
}

export function bootOsFileDrop( args: BootArgs ): void {
	const config: DropConfig = args.config || {
		enabled: false,
		allowedMimes: [],
		maxSize: 0,
	};
	mountOsFileDropManager( {
		config,
		mediaUrl: args.mediaUrl,
		restNonce: args.restNonce,
		openDialog: async (
			entries: DropFileEntry[],
			ctx: DropContext,
		): Promise< void > => {
			const { openUploadDialog } = await import( './dialog' );
			await openUploadDialog( {
				entries,
				context: ctx,
				mediaUrl: args.mediaUrl,
				restNonce: args.restNonce,
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
