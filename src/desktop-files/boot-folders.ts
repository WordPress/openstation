import { setFolders } from './store';
import type { RestFolderShape } from './rest';

interface BootFoldersConfig {
	filesBootFolders?: RestFolderShape[];
}

export function seedBootFolders(): boolean {
	const config = ( window as unknown as {
		openStationConfig?: BootFoldersConfig;
	} ).openStationConfig;
	const rows = config?.filesBootFolders;
	if ( ! config || ! Array.isArray( rows ) ) {
		return false;
	}
	delete config.filesBootFolders;
	setFolders( rows );
	return true;
}
