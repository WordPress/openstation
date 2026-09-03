/**
 * Pages — the client view of the Pages app.
 *
 * The Posts app's list body, composed for pages: `parts/app.ts` under
 * `apps/posts/` reads `ctx.extra.mode` and paints the hierarchical
 * column set (Parent, Template, Slug, Comments), the front-page /
 * posts-page badges and the page copy; there are no taxonomy tabs.
 * Sanctioned cross-app reuse — the two windows are one list surface
 * over two collections, and both `.os.php` entries note it.
 *
 * @public
 */

import { createPostsApp } from '../posts/parts/app';

export default createPostsApp( 'desktop-mode-pages' );
