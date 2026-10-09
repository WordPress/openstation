export function runClock( el: HTMLTimeElement ): () => void {
	let timer = 0;
	const tick = (): void => {
		const now = new Date();
		el.textContent = now.toLocaleTimeString( undefined, {
			hour: 'numeric',
			minute: '2-digit',
		} );
		el.dateTime = now.toISOString();
		el.title = now.toLocaleDateString( undefined, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		} );
		timer = window.setTimeout(
			tick,
			60000 - ( now.getSeconds() * 1000 + now.getMilliseconds() ),
		);
	};
	tick();
	return () => window.clearTimeout( timer );
}
