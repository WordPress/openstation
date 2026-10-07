import { createPostsApp } from '../posts/parts/app';
import { mountPageAtlas } from './parts/atlas';

export default createPostsApp( 'desktop-mode-pages', { atlas: mountPageAtlas } );
