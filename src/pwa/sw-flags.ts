export interface SwFlags {

	windowPrewarm: boolean;

	adminAssetCache: boolean;
}

export interface SwFlagUpdate {

	flags: SwFlags;

	clearSpeculative: boolean;

	dropSessionCache: boolean;
}

export function applyFlagMessage(
	data: unknown,
	current: SwFlags,
): SwFlagUpdate | null {
	if ( ! data || typeof data !== 'object' ) {
		return null;
	}
	const message = data as {
		type?: unknown;
		enabled?: unknown;
		adminAssetCache?: unknown;
		windowPrewarm?: unknown;
	};

	if ( message.type === 'os-sw-set-prewarm' ) {
		const windowPrewarm = message.enabled === true;
		return {
			flags: { ...current, windowPrewarm },
			clearSpeculative: ! windowPrewarm,
			dropSessionCache: ! windowPrewarm,
		};
	}

	if ( message.type === 'os-sw-config' ) {
		const flags = { ...current };
		if ( typeof message.adminAssetCache === 'boolean' ) {
			flags.adminAssetCache = message.adminAssetCache;
		}
		let clearSpeculative = false;
		if ( typeof message.windowPrewarm === 'boolean' ) {
			flags.windowPrewarm = message.windowPrewarm;
			clearSpeculative = ! flags.windowPrewarm;
		}
		return { flags, clearSpeculative, dropSessionCache: false };
	}

	return null;
}
