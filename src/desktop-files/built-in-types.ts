import { registerType } from './registry';

export const FOLDER_FILE_ICON = 'dashicons-portfolio';

export function registerBuiltInFileTypes(): void {
	registerType( { type: 'shortcut', label: 'Plugin shortcut', sort: 1 } );
	registerType( { type: 'folder', label: 'Folder', sort: 5 } );
	registerType( { type: 'post', label: 'Post', sort: 10 } );
	registerType( { type: 'attachment', label: 'Media', sort: 20 } );
	registerType( { type: 'upload', label: 'Uploaded file', sort: 25 } );
	registerType( { type: 'user', label: 'User', sort: 30 } );
	registerType( { type: 'term', label: 'Taxonomy term', sort: 40 } );
	registerType( { type: 'comment', label: 'Comment', sort: 50 } );
	registerType( { type: 'bookmark', label: 'Bookmark', sort: 60 } );
	registerType( { type: 'link', label: 'Web link', sort: 70 } );
	registerType( { type: 'embed', label: 'Embedded web window', sort: 80 } );
}
