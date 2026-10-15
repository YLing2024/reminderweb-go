import { ensureLunar } from '../lib/lunar';

/**
 * vitest 全局测试准备：农历模块改为按需加载后，依赖农历的同步函数
 * 需要先确保模块就绪，否则 `lj()` 会抛错。
 */
await ensureLunar();

/**
 * 测试环境（Node）没有 `DOMParser`。这里注入一个最小 XML DOM 实现，
 * 让 WebDAV 的 PROPFIND 解析在单测里走与浏览器一致的 `new DOMParser()` 调用路径。
 * 生产代码在浏览器使用原生 DOMParser，此实现只存在于测试引导，不会进入构建产物。
 */
interface MiniNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly localName: string;
  readonly textContent: string;
}

class MiniText implements MiniNode {
  readonly nodeType = 3;
  readonly nodeName = '#text';
  readonly localName = '#text';
  readonly textContent: string;

  constructor(text: string) {
    this.textContent = text;
  }
}

class MiniElement implements MiniNode {
  readonly nodeType = 1;
  readonly nodeName: string;
  readonly localName: string;
  private readonly attributes = new Map<string, string>();
  private readonly nodes: Array<MiniElement | MiniText> = [];

  constructor(nodeName: string, attributes: Record<string, string>) {
    this.nodeName = nodeName;
    const separator = nodeName.indexOf(':');
    this.localName = separator >= 0 ? nodeName.slice(separator + 1) : nodeName;
    for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value);
  }

  append(node: MiniElement | MiniText): void {
    this.nodes.push(node);
  }

  get children(): MiniElement[] {
    return this.nodes.filter((node): node is MiniElement => node instanceof MiniElement);
  }

  get textContent(): string {
    return this.nodes.map((node) => node.textContent).join('');
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getElementsByTagName(name: string): MiniElement[] {
    const result: MiniElement[] = [];
    const matches = (element: MiniElement) =>
      name === '*' ||
      element.localName.toLowerCase() === name.toLowerCase() ||
      element.nodeName.toLowerCase() === name.toLowerCase();
    const walk = (element: MiniElement) => {
      for (const child of element.children) {
        if (matches(child)) result.push(child);
        walk(child);
      }
    };
    walk(this);
    return result;
  }
}

class MiniDocument {
  readonly nodeType = 9;
  documentElement: MiniElement | null = null;

  getElementsByTagName(name: string): MiniElement[] {
    const root = this.documentElement;
    if (root === null) return [];
    const result: MiniElement[] = [];
    const matches =
      name === '*' ||
      root.localName.toLowerCase() === name.toLowerCase() ||
      root.nodeName.toLowerCase() === name.toLowerCase();
    if (matches) result.push(root);
    result.push(...root.getElementsByTagName(name));
    return result;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1];
    if (key === undefined) continue;
    attributes[key] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseXml(source: string): MiniDocument {
  const doc = new MiniDocument();
  const stack: MiniElement[] = [];
  const appendText = (text: string) => {
    if (stack.length === 0 || text === '') return;
    stack[stack.length - 1]!.append(new MiniText(decodeEntities(text)));
  };

  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) {
      appendText(source.slice(index));
      break;
    }
    if (open > index) appendText(source.slice(index, open));

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      appendText(source.slice(open + 9, end < 0 ? source.length : end));
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!', open)) {
      const end = source.indexOf('>', open);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    const close = source.indexOf('>', open);
    if (close < 0) break;
    const inner = source.slice(open + 1, close).trim();
    index = close + 1;

    if (inner.startsWith('/')) {
      stack.pop();
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const separatorMatch = /\s/.exec(body);
    const separator = separatorMatch === null ? -1 : separatorMatch.index;
    const name = separator < 0 ? body : body.slice(0, separator);
    if (name === '') continue;
    const attributeText = separator < 0 ? '' : body.slice(separator + 1);
    const element = new MiniElement(name, parseAttributes(attributeText));
    if (stack.length === 0) doc.documentElement = element;
    else stack[stack.length - 1]!.append(element);
    if (!selfClosing) stack.push(element);
  }
  return doc;
}

class MiniDOMParser {
  parseFromString(source: string): MiniDocument {
    return parseXml(source);
  }
}

const globalScope = globalThis as { DOMParser?: unknown };
if (typeof globalScope.DOMParser === 'undefined') {
  globalScope.DOMParser = MiniDOMParser;
}
