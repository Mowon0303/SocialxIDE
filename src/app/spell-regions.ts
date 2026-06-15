import { EditorLanguage, SpellCheckRegion } from './desktop-api';

export function extractSpellCheckRegions(content: string, language: EditorLanguage): SpellCheckRegion[] {
  if (!content.trim()) {
    return [];
  }
  if (language === 'text') {
    return [regionFromOffsets(content, 0, content.length)];
  }
  if (language === 'python') {
    return extractPythonRegions(content);
  }
  if (language === 'cpp') {
    return extractCppRegions(content);
  }
  return [];
}

function extractPythonRegions(content: string): SpellCheckRegion[] {
  const regions: SpellCheckRegion[] = [];
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === '#') {
      const end = readUntilLineEnd(content, index);
      pushRegion(regions, content, index + 1, end);
      index = end;
      continue;
    }
    if (char === '\'' || char === '"') {
      const quote = char;
      const triple = content.slice(index, index + 3) === quote.repeat(3);
      const start = index + (triple ? 3 : 1);
      const end = triple
        ? readUntilTripleQuote(content, start, quote)
        : readUntilQuote(content, start, quote);
      pushRegion(regions, content, start, end);
      index = Math.min(content.length, end + (triple ? 3 : 1));
      continue;
    }
    index += 1;
  }
  return regions;
}

function extractCppRegions(content: string): SpellCheckRegion[] {
  const regions: SpellCheckRegion[] = [];
  let index = 0;
  while (index < content.length) {
    const current = content[index];
    const next = content[index + 1];
    if (current === '/' && next === '/') {
      const start = index + 2;
      const end = readUntilLineEnd(content, start);
      pushRegion(regions, content, start, end);
      index = end;
      continue;
    }
    if (current === '/' && next === '*') {
      const start = index + 2;
      const close = content.indexOf('*/', start);
      const end = close >= 0 ? close : content.length;
      pushRegion(regions, content, start, end);
      index = close >= 0 ? close + 2 : content.length;
      continue;
    }
    if (current === '\'' || current === '"') {
      const start = index + 1;
      const end = readUntilQuote(content, start, current);
      pushRegion(regions, content, start, end);
      index = Math.min(content.length, end + 1);
      continue;
    }
    index += 1;
  }
  return regions;
}

function readUntilLineEnd(content: string, start: number): number {
  const lineEnd = content.indexOf('\n', start);
  return lineEnd >= 0 ? lineEnd : content.length;
}

function readUntilQuote(content: string, start: number, quote: string): number {
  let index = start;
  while (index < content.length) {
    if (content[index] === '\\') {
      index += 2;
      continue;
    }
    if (content[index] === quote) {
      return index;
    }
    if (content[index] === '\n') {
      return index;
    }
    index += 1;
  }
  return content.length;
}

function readUntilTripleQuote(content: string, start: number, quote: string): number {
  const end = content.indexOf(quote.repeat(3), start);
  return end >= 0 ? end : content.length;
}

function pushRegion(regions: SpellCheckRegion[], content: string, start: number, end: number): void {
  if (end <= start) {
    return;
  }
  const region = regionFromOffsets(content, start, end);
  if (region.text.trim()) {
    regions.push(region);
  }
}

function regionFromOffsets(content: string, start: number, end: number): SpellCheckRegion {
  const startPosition = positionFromOffset(content, start);
  const endPosition = positionFromOffset(content, end);
  return {
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
    text: content.slice(start, end),
  };
}

function positionFromOffset(content: string, offset: number): { line: number; column: number } {
  const prefix = content.slice(0, Math.max(0, offset));
  const lines = prefix.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}
