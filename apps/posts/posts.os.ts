/**
 * Posts — the client view of the Posts app.
 *
 * The list body is `parts/app.ts` (shared with the Pages app); this
 * entry adds the two term canvases the Posts window carries on its
 * tabs — the Categories mind map and the Tags cloud, each mounted on
 * first activation and loaded lazily so a cold open never pays for
 * PixiJS.
 *
 * @public
 */

import { createPostsApp } from './parts/app';

export default createPostsApp( 'desktop-mode-posts', {
	terms: {
		categories: ( host, env ) => import( './parts/categories-mindmap' ).then( ( m ) => m.mountCategoriesMindmap( host, env ) ),
		tags: ( host, env ) => import( './parts/tags-cloud' ).then( ( m ) => m.mountTagsCloud( host, env ) ),
	},
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
