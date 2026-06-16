import { LanguageTextEdit } from './desktop-api';

/**
 * Convert a 1-based (line, column) position into an absolute offset in `text`.
 * Columns count UTF-16 code units within the line and are clamped to the end of
 * the line's content (the newline is never crossed by an in-line column).
 */
export function positionToOffset(text: string, line: number, column: number): number {
  const targetLine = Math.max(1, Math.floor(line));
  const targetColumn = Math.max(1, Math.floor(column));
  let offset = 0;
  let currentLine = 1;
  while (currentLine < targetLine) {
    const next = text.indexOf('\n', offset);
    if (next === -1) {
      return text.length;
    }
    offset = next + 1;
    currentLine += 1;
  }
  const lineEnd = text.indexOf('\n', offset);
  const hardEnd = lineEnd === -1 ? text.length : lineEnd;
  return Math.min(offset + (targetColumn - 1), hardEnd);
}

/**
 * Apply a set of LSP-style text edits (1-based positions) to a document string.
 * Edits are resolved to absolute offsets and applied from the end of the
 * document backwards so earlier offsets remain valid. Non-overlapping edits are
 * assumed, as guaranteed by the language server.
 */
export function applyTextEdits(text: string, edits: readonly LanguageTextEdit[]): string {
  if (!edits || edits.length === 0) {
    return text;
  }
  const resolved = edits.map((edit) => {
    const a = positionToOffset(text, edit.startLine, edit.startColumn);
    const b = positionToOffset(text, edit.endLine, edit.endColumn);
    return {
      start: Math.min(a, b),
      end: Math.max(a, b),
      newText: edit.newText ?? '',
    };
  });
  resolved.sort((left, right) => right.start - left.start || right.end - left.end);
  let result = text;
  for (const edit of resolved) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

/**
 * Group a workspace edit's text edits by their target path, preserving order.
 * Used to apply a multi-file rename / code action one file at a time.
 */
export function groupTextEditsByPath(
  edits: readonly LanguageTextEdit[],
): Map<string, LanguageTextEdit[]> {
  const byPath = new Map<string, LanguageTextEdit[]>();
  for (const edit of edits ?? []) {
    if (!edit || !edit.path) {
      continue;
    }
    const existing = byPath.get(edit.path);
    if (existing) {
      existing.push(edit);
    } else {
      byPath.set(edit.path, [edit]);
    }
  }
  return byPath;
}
