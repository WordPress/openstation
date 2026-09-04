/**
 * Posts — the client view of the Posts app.
 *
 * The list body is `parts/app.ts` (shared with the Pages app); this
 * entry adds what only Posts carries: the Categories and Tags cells in
 * the table, and the two term canvases on its tabs — the Categories
 * mind map and the Tags cloud, each mounted on first activation.
 * (PixiJS itself is fetched through the shell's module registry on
 * that first mount; the canvas modules are part of this bundle.)
 *
 * @public
 */

import { createPostsApp } from './parts/app';
import { mountCategoriesMindmap } from './parts/categories-mindmap';
import { buildCategoriesCell } from './parts/cells/categories';
import { buildTagsCell } from './parts/cells/tags';
import { mountTagsCloud } from './parts/tags-cloud';

export default createPostsApp( 'desktop-mode-posts', {
	cells: { tags: buildTagsCell, categories: buildCategoriesCell },
	terms: { categories: mountCategoriesMindmap, tags: mountTagsCloud },
} );

export type {
	BulkAction,
	ListData,
	ListExtra,
	ListState,
	PostListItem,
	PostsListParams,
	PostsWindowContext,
	PostsWindowDataLoadedDetail,
	StatusSegment,
} from './parts/types';
