// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests for DocsLayout.astro setupDocsFeatures script.
 *
 * The script has 3 features:
 * 1. Copy code buttons — wraps <pre> in .code-block-wrapper, adds copy button
 * 2. Active TOC scroll spy — highlights current heading's TOC link on scroll
 * 3. Feedback buttons — replaces itself with thank-you text on click
 */

const LAYOUT_SRC = readFileSync(
  join(__dirname, '../../layouts/DocsLayout.astro'),
  'utf-8'
);

function extractSetupDocsFeatures(): string {
  const match = LAYOUT_SRC.match(
    /const setupDocsFeatures\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};\s*setupDocsFeatures\(\);/
  );
  if (!match) throw new Error('Could not extract setupDocsFeatures from DocsLayout.astro');
  return match[1].trim();
}

function injectScript(body: string): void {
  const script = document.createElement('script');
  script.textContent = `(() => { ${body} })();`;
  document.body.appendChild(script);
}

describe('DocsLayout.astro setupDocsFeatures', () => {
  beforeEach(() => {
    // Mock innerText (not available in jsdom)
    Object.defineProperty(Element.prototype, 'innerText', {
      get() { return this.textContent; },
      configurable: true,
    });
  });

  describe('source structure', () => {
    it('has setupDocsFeatures function', () => {
      expect(LAYOUT_SRC).toContain('setupDocsFeatures');
    });

    it('calls setupDocsFeatures on load', () => {
      expect(LAYOUT_SRC).toContain('setupDocsFeatures();');
    });

    it('re-runs on astro:page-load', () => {
      expect(LAYOUT_SRC).toContain("astro:page-load");
    });

    it('queries .docs-content pre for copy code', () => {
      expect(LAYOUT_SRC).toContain(".docs-content pre");
    });

    it('checks parentElement for code-block-wrapper (idempotent)', () => {
      expect(LAYOUT_SRC).toContain('code-block-wrapper');
    });

    it('creates copy button with aria-label', () => {
      expect(LAYOUT_SRC).toContain('Copy code to clipboard');
    });

    it('uses navigator.clipboard.writeText', () => {
      expect(LAYOUT_SRC).toContain('navigator.clipboard.writeText');
    });

    it('queries h2 and h3 for TOC scroll spy', () => {
      expect(LAYOUT_SRC).toContain('.docs-content h2, .docs-content h3');
    });

    it('queries [data-toc-link] for TOC links', () => {
      expect(LAYOUT_SRC).toContain('[data-toc-link]');
    });

    it('listens to scroll event', () => {
      expect(LAYOUT_SRC).toContain("addEventListener('scroll'");
    });

    it('uses passive scroll listener', () => {
      expect(LAYOUT_SRC).toContain('passive: true');
    });

    it('queries data-doc-feedback-wrap', () => {
      expect(LAYOUT_SRC).toContain('[data-doc-feedback-wrap]');
    });

    it('queries data-doc-feedback-yes and data-doc-feedback-no', () => {
      expect(LAYOUT_SRC).toContain('[data-doc-feedback-yes]');
      expect(LAYOUT_SRC).toContain('[data-doc-feedback-no]');
    });

    it('has i18n for Indonesian feedback', () => {
      expect(LAYOUT_SRC).toContain('Terima kasih');
    });
  });

  describe('next step and feedback copy', () => {
    const enJson = JSON.parse(
      readFileSync(join(__dirname, '../../i18n/en.json'), 'utf-8'),
    );
    const idJson = JSON.parse(
      readFileSync(join(__dirname, '../../i18n/id.json'), 'utf-8'),
    );

    it('offers the locale download and pricing pages at the end of every article', () => {
      // The docs are the site's most search-aligned content; before this block
      // 30 of 36 articles linked to no commercial page at all in the body.
      expect(LAYOUT_SRC).toContain("getRelativeLocaleUrl(locale, 'download')");
      expect(LAYOUT_SRC).toContain("getRelativeLocaleUrl(locale, 'pricing')");
      expect(LAYOUT_SRC).toContain("t(locale, 'docs.nextStep.download')");
      expect(LAYOUT_SRC).toContain("t(locale, 'docs.nextStep.pricing')");
      // Rendered inside <article>, so it belongs to the document body rather
      // than to the chrome around it.
      const article = LAYOUT_SRC.slice(LAYOUT_SRC.indexOf('<article'), LAYOUT_SRC.indexOf('</article>'));
      expect(article).toContain('docs.nextStep.download');
    });

    it('keeps the feedback widget copy in the dictionaries, not inline ternaries', () => {
      for (const key of ['question', 'hint', 'yes', 'no']) {
        expect(LAYOUT_SRC, `${key} key`).toContain(`t(locale, 'docs.feedback.${key}')`);
      }
      expect(LAYOUT_SRC).not.toContain("locale === 'id' ?");
    });

    it('defines every new key in both locales, in each language', () => {
      const keys = [
        'nextStep.title',
        'nextStep.body',
        'nextStep.download',
        'nextStep.pricing',
        'feedback.question',
        'feedback.hint',
        'feedback.yes',
        'feedback.no',
      ];
      for (const key of keys) {
        const [group, name] = key.split('.');
        expect(enJson.docs[group][name], `en docs.${key}`).toBeTruthy();
        expect(idJson.docs[group][name], `id docs.${key}`).toBeTruthy();
      }
      expect(idJson.docs.nextStep.download).not.toBe(enJson.docs.nextStep.download);
      expect(idJson.docs.nextStep.pricing).not.toBe(enJson.docs.nextStep.pricing);
      expect(idJson.docs.feedback.question).not.toBe(enJson.docs.feedback.question);
      // The feedback labels keep the strings the widget shipped with — moving
      // them into the dictionary was the change, not the wording.
      expect(enJson.docs.feedback.question).toBe('Was this page helpful?');
      expect(idJson.docs.feedback.question).toBe('Apakah halaman ini bermanfaat?');
    });
  });

  describe('copy code buttons', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      document.documentElement.lang = 'en';
    });

    it('wraps pre in code-block-wrapper', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'console.log("hello")';
      pre.appendChild(code);
      content.appendChild(pre);
      document.body.appendChild(content);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      expect(pre.parentElement?.className).toBe('code-block-wrapper');
    });

    it('adds copy button with "Copy" text', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';
      const pre = document.createElement('pre');
      content.appendChild(pre);
      document.body.appendChild(content);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      const btn = content.querySelector('.copy-code-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe('Copy');
      expect(btn.type).toBe('button');
      expect(btn.getAttribute('aria-label')).toBe('Copy code to clipboard');
    });

    it('does NOT double-wrap an already wrapped pre', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      const pre = document.createElement('pre');
      wrapper.appendChild(pre);
      content.appendChild(wrapper);
      document.body.appendChild(content);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      expect(content.querySelectorAll('.code-block-wrapper').length).toBe(1);
    });

    it('copies code content to clipboard on click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const content = document.createElement('div');
      content.className = 'docs-content';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'fn main() {}';
      pre.appendChild(code);
      content.appendChild(pre);
      document.body.appendChild(content);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      const btn = content.querySelector('.copy-code-btn') as HTMLButtonElement;
      await btn.click();

      expect(writeText).toHaveBeenCalledTimes(1);
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toContain('fn main()');
    });

    it('shows "✓ Copied" after successful copy', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const content = document.createElement('div');
      content.className = 'docs-content';
      const pre = document.createElement('pre');
      content.appendChild(pre);
      document.body.appendChild(content);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      const btn = content.querySelector('.copy-code-btn') as HTMLButtonElement;
      await btn.click();

      // Allow microtasks to flush
      await vi.advanceTimersByTimeAsync(0);

      expect(btn.textContent).toBe('✓ Copied');
      expect(btn.classList.contains('text-green-500')).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
      expect(btn.textContent).toBe('Copy');
      expect(btn.classList.contains('text-green-500')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('TOC scroll spy', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      document.documentElement.lang = 'en';
    });

    it('highlights the current TOC link based on scroll position', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';

      const h2 = document.createElement('h2');
      h2.id = 'section-one';
      h2.style.position = 'absolute';
      h2.style.top = '50px';
      content.appendChild(h2);

      const toc = document.createElement('a');
      toc.setAttribute('data-toc-link', '');
      toc.setAttribute('href', '#section-one');

      document.body.appendChild(content);
      document.body.appendChild(toc);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(toc.classList.contains('text-link')).toBe(true);
      expect(toc.classList.contains('font-medium')).toBe(true);
      expect(toc.classList.contains('text-muted')).toBe(false);
    });

    it('removes highlight from non-active TOC links', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';

      const h1 = document.createElement('h2');
      h1.id = 'first';
      h1.style.position = 'absolute';
      h1.style.top = '10px';
      content.appendChild(h1);

      const h2 = document.createElement('h2');
      h2.id = 'second';
      h2.style.position = 'absolute';
      h2.style.top = '200px';
      content.appendChild(h2);

      const toc1 = document.createElement('a');
      toc1.setAttribute('data-toc-link', '');
      toc1.setAttribute('href', '#first');

      const toc2 = document.createElement('a');
      toc2.setAttribute('data-toc-link', '');
      toc2.setAttribute('href', '#second');

      document.body.appendChild(content);
      document.body.appendChild(toc1);
      document.body.appendChild(toc2);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      Object.defineProperty(window, 'scrollY', { value: 250, writable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(toc1.classList.contains('text-muted')).toBe(true);
      expect(toc2.classList.contains('text-link')).toBe(true);
    });

    it('registers scroll listener (verified by scroll behavior)', () => {
      const content = document.createElement('div');
      content.className = 'docs-content';
      const h2 = document.createElement('h2');
      h2.id = 'test-heading';
      h2.style.position = 'absolute';
      h2.style.top = '0px';
      content.appendChild(h2);
      const toc = document.createElement('a');
      toc.setAttribute('data-toc-link', '');
      toc.setAttribute('href', '#test-heading');
      document.body.appendChild(content);
      document.body.appendChild(toc);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      // Verify scroll listener works by scrolling and checking class changes
      expect(toc.classList.contains('text-muted')).toBe(false);

      Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
      window.dispatchEvent(new Event('scroll'));

      expect(toc.classList.contains('text-link')).toBe(true);
      expect(toc.classList.contains('font-medium')).toBe(true);
    });
  });

  describe('feedback buttons', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      document.documentElement.lang = 'en';
    });

    it('shows English thank-you on Yes click', () => {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-doc-feedback-wrap', '');
      const btnYes = document.createElement('button');
      btnYes.setAttribute('data-doc-feedback-yes', '');
      const btnNo = document.createElement('button');
      btnNo.setAttribute('data-doc-feedback-no', '');
      wrap.appendChild(btnYes);
      wrap.appendChild(btnNo);
      document.body.appendChild(wrap);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      btnYes.click();

      expect(wrap.innerHTML).toContain('Thanks for your feedback!');
      expect(wrap.querySelector('span')?.classList.contains('text-green-500')).toBe(true);
    });

    it('shows English improvement message on No click', () => {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-doc-feedback-wrap', '');
      const btnYes = document.createElement('button');
      btnYes.setAttribute('data-doc-feedback-yes', '');
      const btnNo = document.createElement('button');
      btnNo.setAttribute('data-doc-feedback-no', '');
      wrap.appendChild(btnYes);
      wrap.appendChild(btnNo);
      document.body.appendChild(wrap);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      btnNo.click();

      expect(wrap.innerHTML).toContain('Thanks, we will improve it!');
    });

    it('shows Indonesian thank-you on Yes click', () => {
      document.documentElement.lang = 'id';
      const wrap = document.createElement('div');
      wrap.setAttribute('data-doc-feedback-wrap', '');
      const btnYes = document.createElement('button');
      btnYes.setAttribute('data-doc-feedback-yes', '');
      const btnNo = document.createElement('button');
      btnNo.setAttribute('data-doc-feedback-no', '');
      wrap.appendChild(btnYes);
      wrap.appendChild(btnNo);
      document.body.appendChild(wrap);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      btnYes.click();

      expect(wrap.innerHTML).toContain('Terima kasih atas masukannya!');
    });

    it('shows Indonesian improvement message on No click', () => {
      document.documentElement.lang = 'id';
      const wrap = document.createElement('div');
      wrap.setAttribute('data-doc-feedback-wrap', '');
      const btnYes = document.createElement('button');
      btnYes.setAttribute('data-doc-feedback-yes', '');
      const btnNo = document.createElement('button');
      btnNo.setAttribute('data-doc-feedback-no', '');
      wrap.appendChild(btnYes);
      wrap.appendChild(btnNo);
      document.body.appendChild(wrap);

      const script = extractSetupDocsFeatures();
      injectScript(script);

      btnNo.click();

      expect(wrap.innerHTML).toContain('Terima kasih, kami akan terus menyempurnakannya.');
    });

    it('does nothing if feedback elements are missing', () => {
      document.body.innerHTML = '<div>No feedback here</div>';
      const script = extractSetupDocsFeatures();
      expect(() => injectScript(script)).not.toThrow();
    });
  });
});
