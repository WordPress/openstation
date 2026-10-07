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
