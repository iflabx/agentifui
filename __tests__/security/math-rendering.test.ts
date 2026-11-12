/** @jest-environment node */
import { spawnSync } from 'node:child_process';

type MathRenderingEvidence = {
  version: string;
  pluginVersion: string;
  parserVersion: string;
  inline: string;
  display: string;
  matrix: string;
  link: string;
  inheritedOptions: string;
  pollutedPrototype: string;
  pluginPollutedPrototype: string;
  rawHtml: string;
};

describe('real Markdown and KaTeX compatibility and trust defaults', () => {
  let evidence: MathRenderingEvidence;
  beforeAll(() => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        String.raw`
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import ReactMarkdown from 'react-markdown';
      import remarkMath from 'remark-math';
      import rehypeKatex from 'rehype-katex';
      import katex from 'katex';
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const pluginRequire = createRequire(require.resolve('rehype-katex'));
      const mathRequire = createRequire(require.resolve('remark-math'));
      const parserRequire = createRequire(mathRequire.resolve('micromark-extension-math'));
      const render = text => renderToStaticMarkup(React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], children: text,
      }));
      const unsafe = '\\href{javascript:alert(1)}{click}';
      const evidence = {
        version: katex.version,
        pluginVersion: pluginRequire('katex').version,
        parserVersion: parserRequire('katex').version,
        inline: render('$E=mc^2$'),
        display: render('$$\n\\frac{a}{b}\n$$'),
        matrix: render('$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\n$$'),
        link: render('$' + unsafe + '$'),
        inheritedOptions: katex.renderToString(unsafe, Object.create({ trust: true })),
        rawHtml: render('<img src=x onerror=alert(1)>'),
      };
      Object.prototype.trust = true;
      try {
        evidence.pollutedPrototype = katex.renderToString(unsafe);
        evidence.pluginPollutedPrototype = render('$' + unsafe + '$');
      } finally { delete Object.prototype.trust; }
      console.log(JSON.stringify(evidence));
    `,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20000 }
    );
    if (result.status !== 0)
      throw new Error(result.stderr || String(result.error));
    evidence = JSON.parse(result.stdout);
  });

  it('loads one patched KaTeX version for both CSS/runtime and the rehype plugin', () => {
    expect(evidence.version).toBe('0.18.10');
    expect(evidence.pluginVersion).toBe(evidence.version);
    expect(evidence.parserVersion).toBe(evidence.version);
  });
  it.each(['inline', 'display', 'matrix'] as const)(
    'renders real %s math without the error fallback',
    field => {
      expect(evidence[field]).toContain('class="katex');
      expect(evidence[field]).toContain('<math');
      expect(evidence[field]).not.toContain('katex-error');
    }
  );
  it.each([
    'link',
    'inheritedOptions',
    'pollutedPrototype',
    'pluginPollutedPrototype',
  ] as const)('does not allow inherited trust or unsafe links in %s', field => {
    expect(evidence[field]).not.toMatch(/<(?:a|img)\b/i);
    expect(evidence[field]).not.toMatch(/(?:href|src)="javascript:/i);
  });
  it('keeps raw Markdown HTML inert', () => {
    expect(evidence.rawHtml).not.toMatch(/<img\b/i);
  });
});
