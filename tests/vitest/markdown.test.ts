/**
 * Unit tests for `src/markdown.ts` — the minimal shared renderer used
 * by the AI assistant overlay, the Agent chat window and pinned notes.
 */
import { describe, expect, test } from 'vitest';
import { renderMarkdown, setTaskChecked } from '../../src/markdown';

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

	test( 'an underscore in a URL and an asterisk in code stay literal', () => {
		expect( renderMarkdown( 'see https://example.test/_a_/b, `**x**`' ) ).toBe(
			'<p>see <a href="https://example.test/_a_/b" target="_blank" rel="noopener noreferrer">https://example.test/_a_/b</a>, <code>**x**</code></p>',
		);
		expect( renderMarkdown( '[`run`](https://example.test)' ) ).toBe(
			'<p><a href="https://example.test" target="_blank" rel="noopener noreferrer"><code>run</code></a></p>',
		);
	} );

	test( 'renders fenced code verbatim, quotes and strikethrough', () => {
		expect( renderMarkdown( '```\n<b> *x*\n```\n> said ~~it~~' ) ).toBe(
			'<pre><code>&lt;b&gt; *x*</code></pre><blockquote><p>said <del>it</del></p></blockquote>',
		);
	} );

	test( 'task items are literal unless asked for, then carry their source line', () => {
		const md = 'To do\n- [ ] milk\n- [x] **eggs**';
		expect( renderMarkdown( md ) ).toContain( '<li>[ ] milk</li>' );
		expect( renderMarkdown( '-[] a\n- [] b\n-[x] c', { tasks: {} } ) ).toBe(
			'<ul>' +
				'<li class="os-md-task"><os-checkbox value="0"><span>a</span></os-checkbox></li>' +
				'<li class="os-md-task"><os-checkbox value="1"><span>b</span></os-checkbox></li>' +
				'<li class="os-md-task"><os-checkbox value="2" checked><span>c</span></os-checkbox></li>' +
				'</ul>',
		);
		// A bullet still needs its space before anything but a box.
		expect( renderMarkdown( '-not a list' ) ).toBe( '<p>-not a list</p>' );
		expect( renderMarkdown( md, { tasks: { disabled: true } } ) ).toBe(
			'<p>To do</p><ul>' +
				'<li class="os-md-task"><os-checkbox value="1" disabled><span>milk</span></os-checkbox></li>' +
				'<li class="os-md-task"><os-checkbox value="2" checked disabled><span><strong>eggs</strong></span></os-checkbox></li>' +
				'</ul>',
		);
	} );

	test( 'setTaskChecked rewrites only that line, and refuses a line that is not a task', () => {
		const md = 'To do\r\n- [ ] milk\r\n  1. [X] eggs';
		expect( setTaskChecked( md, 1, true ) ).toBe( 'To do\r\n- [x] milk\r\n  1. [X] eggs' );
		expect( setTaskChecked( md, 2, false ) ).toBe( 'To do\r\n- [ ] milk\r\n  1. [ ] eggs' );
		expect( setTaskChecked( md, 0, true ) ).toBeNull();
		// The forms people type: no space in the box, none after the dash.
		expect( setTaskChecked( '-[] milk\n- [] eggs', 0, true ) ).toBe( '-[x] milk\n- [] eggs' );
		expect( setTaskChecked( '-[x] milk', 0, false ) ).toBe( '-[ ] milk' );
		expect( setTaskChecked( md, 9, true ) ).toBeNull();
	} );
} );
