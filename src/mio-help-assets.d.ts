/** Vite bundles explicitly imported help text; no runtime filesystem access. */
declare module '*.md?raw' {
	const markdown: string;
	export default markdown;
}
