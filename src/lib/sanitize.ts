/**
 * Safely sanitizes Tafsir HTML content by stripping scripts, iframes,
 * object/embed tags, dangerous attributes, and non-whitelisted tags.
 */
export function sanitizeTafsirHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // 1. Remove dangerous elements entirely
    const dangerous = doc.querySelectorAll(
      'script, iframe, frame, object, embed, applet, style, link, meta, form, input, button, select, textarea'
    );
    dangerous.forEach((el) => el.remove());

    const ALLOWED_TAGS = new Set([
      'P',
      'SPAN',
      'BR',
      'STRONG',
      'B',
      'EM',
      'I',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'UL',
      'OL',
      'LI',
      'BLOCKQUOTE',
    ]);

    const sanitizeNode = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tagName = el.tagName.toUpperCase();

        if (!ALLOWED_TAGS.has(tagName)) {
          // Replace tag with its children
          const parent = el.parentNode;
          if (parent) {
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
          }
          return;
        }

        // Clean attributes: remove any on*, javascript:, src, href, style
        const attrNames = Array.from(el.attributes).map((a) => a.name);
        for (const attr of attrNames) {
          const lower = attr.toLowerCase();
          if (
            lower.startsWith('on') ||
            lower === 'src' ||
            lower === 'href' ||
            lower === 'action' ||
            lower === 'style'
          ) {
            el.removeAttribute(attr);
          }
        }

        // Recurse on remaining child nodes
        const children = Array.from(el.childNodes);
        for (const child of children) {
          sanitizeNode(child);
        }
      }
    };

    const rootChildren = Array.from(doc.body.childNodes);
    for (const child of rootChildren) {
      sanitizeNode(child);
    }

    return doc.body.innerHTML;
  } catch {
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  }
}
