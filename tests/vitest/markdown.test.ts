/**
 * Unit tests for `src/markdown.ts` — the minimal shared renderer used
 * by the AI assistant overlay and the Agent chat window.
 */
import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../../src/markdown';

describe( 'renderMarkdown', () => {
	test( 'escapes HTML before interpreting tokens', () => {
		expect( renderMarkdown( '<img src=x onerror=alert(1)> & **b**' ) ).toBe(
			'<p>&lt;img src=x onerror=alert(1)&gt; &amp; <strong>b</strong></p>',
		);
	} );

	test( 'renders inline bold, italic, and code', () => {
		expect( renderMarkdown( '**b** *i* `c`' ) ).toBe(
			'<p><strong>b</strong> <em>i</em> <code>c</code></p>',
		);
	} );

	test( 'renders http links and drops unsafe schemes', () => {
		expect( renderMarkdown( '[ok](https://example.test)' ) ).toContain(
			'<a href="https://example.test"',
		);
		// eslint-disable-next-line no-script-url -- asserting the guard.
		const unsafe = renderMarkdown( '[bad](javascript:alert(1))' );
		expect( unsafe ).not.toContain( '<a' );
		expect( unsafe ).not.toContain( 'javascript' );
	} );

	test( 'renders headings clamped to h3–h6', () => {
		expect( renderMarkdown( '# Top' ) ).toBe( '<h3>Top</h3>' );
		expect( renderMarkdown( '### Deep' ) ).toBe( '<h5>Deep</h5>' );
		expect( renderMarkdown( '###### Deepest' ) ).toBe(
			'<h6>Deepest</h6>',
		);
	} );

	test( 'renders --- as a thematic break, not literal text', () => {
		expect( renderMarkdown( 'above\n\n---\n\nbelow' ) ).toBe(
			'<p>above</p><hr><p>below</p>',
		);
	} );

	test( 'handles a heading packed against bullets with no blank line', () => {
		// The shape agent answers actually use — previously the leading
		// `* ` bullets paired up as italics across lines.
		const html = renderMarkdown(
			'### 1. Detection\n* **Format:** CLASSIC\n* **Reasoning:** tags',
		);
		expect( html ).toBe(
			'<h5>1. Detection</h5>' +
				'<ul><li><strong>Format:</strong> CLASSIC</li>' +
				'<li><strong>Reasoning:</strong> tags</li></ul>',
		);
		expect( html ).not.toContain( '<em>' );
	} );

	test( 'renders ordered lists and paragraph breaks', () => {
		expect( renderMarkdown( '1. one\n2. two\n\nline a\nline b' ) ).toBe(
			'<ol><li>one</li><li>two</li></ol><p>line a<br>line b</p>',
		);
	} );

	test( 'italics never pair across lines inside a paragraph', () => {
		expect( renderMarkdown( 'a *start\nend* b' ) ).not.toContain( '<em>' );
	} );
} );
