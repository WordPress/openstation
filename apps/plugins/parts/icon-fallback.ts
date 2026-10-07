const WP_ORG_ASSET_RE =
	/^(https:\/\/ps\.w\.org\/[a-z0-9-]+\/assets\/)icon\.svg$/i;

function buildCandidates( initialUrl: string ): string[] {
	const match = initialUrl.match( WP_ORG_ASSET_RE );
	if ( ! match ) {
		return [ initialUrl ];
	}
	const base = match[ 1 ];

	return [
		initialUrl,
		base + 'icon-256x256.png',
		base + 'icon-256x256.jpg',
		base + 'icon-256x256.jpeg',
		base + 'icon-256x256.gif',
		base + 'icon-128x128.png',
		base + 'icon-128x128.jpg',
		base + 'icon-128x128.jpeg',
		base + 'icon-128x128.gif',
	];
}

export function attachIconFallback(
	img: HTMLImageElement,
	initialUrl: string,
	onExhausted: () => void,
): string {
	const candidates = buildCandidates( initialUrl );
	let index = 0;

	img.addEventListener( 'error', () => {
		index += 1;
		if ( index < candidates.length ) {
			img.src = candidates[ index ];
			return;
		}
		onExhausted();
	} );

	return candidates[ 0 ];
}
