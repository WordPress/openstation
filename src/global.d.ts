import type { OpenStationPublicApi } from './desktop';
import type { WpHooks } from './hooks';

declare global {

	interface WpGlobal {
		os?: OpenStationPublicApi;
		hooks?: WpHooks;
	}

	interface Window {
		wp?: WpGlobal;
	}
}

export {};
