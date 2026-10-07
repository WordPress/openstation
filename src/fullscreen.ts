export function isFullscreen(): boolean {
	return document.fullscreenElement !== null;
}

export function toggleFullscreen(): void {
	if ( isFullscreen() ) {
		void document.exitFullscreen?.().catch( () => {} );
		return;
	}
	void document.documentElement.requestFullscreen?.().catch( () => {} );
}
