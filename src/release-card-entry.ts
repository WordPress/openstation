/**
 * Release-card lazy bundle — entry.
 *
 * Builds to `assets/js/release-card[.min].js`. The vinyl release
 * card (art resolver, image preloader, card DOM + animation CSS) is
 * only ever shown when a core update is pending — for every boot
 * where WordPress is current, the code is dead weight. The main
 * bundle keeps `maybeShowUpdate()` (`src/update-notice.ts`), which
 * injects this bundle only after confirming there is an update to
 * announce; if the bundle fails to load, the notice degrades to the
 * plain toast it already used as the no-art fallback.
 *
 * Publishes `window.openStationReleaseCard`.
 */

import { showReleaseCard } from './release-card';
import { resolveReleaseArt, preloadImage } from './release-art';

( window as unknown as {
	openStationReleaseCard?: {
		showReleaseCard: typeof showReleaseCard;
		resolveReleaseArt: typeof resolveReleaseArt;
		preloadImage: typeof preloadImage;
	};
} ).openStationReleaseCard = {
	showReleaseCard,
	resolveReleaseArt,
	preloadImage,
};
