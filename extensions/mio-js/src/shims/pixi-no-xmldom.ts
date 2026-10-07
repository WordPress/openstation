export class DOMParser {
	public parseFromString(): never {
		throw new Error(
			'[mio-js] @xmldom/xmldom was trimmed from this bundle — it is ' +
				"reachable only from PixiJS's Web Worker environment " +
				'adapter, and this library runs in a document. See ' +
				'PIXI_UNUSED in vite.config.js.',
		);
	}
}
