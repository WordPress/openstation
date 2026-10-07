import type { OpenStationPublicApi } from '../../../src/desktop';

declare global {
	interface Window {
		wp?: {
			os?: OpenStationPublicApi;
			[ key: string ]: unknown;
		};
	}

	const wp: {
		os: OpenStationPublicApi;
		[ key: string ]: unknown;
	};
}

export {};
