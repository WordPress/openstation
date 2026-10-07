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
