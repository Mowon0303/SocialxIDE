import { describe, expect, it } from 'vitest';
import { applyTextEdits, groupTextEditsByPath, positionToOffset } from './language-edits';
import { LanguageTextEdit } from './desktop-api';

const edit = (
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  newText: string,
): LanguageTextEdit => ({ path: 'main.cpp', startLine, startColumn, endLine, endColumn, newText });

describe('positionToOffset', () => {
  it('maps 1-based line/column to an absolute offset', () => {
    const text = 'one\ntwo\nthree';
    expect(positionToOffset(text, 1, 1)).toBe(0);
    expect(positionToOffset(text, 2, 1)).toBe(4);
    expect(positionToOffset(text, 2, 3)).toBe(6);
    expect(positionToOffset(text, 3, 6)).toBe(13);
  });

  it('clamps a column past the end of a line to the line end without crossing the newline', () => {
    const text = 'ab\ncd';
    expect(positionToOffset(text, 1, 99)).toBe(2);
    expect(positionToOffset(text, 2, 99)).toBe(5);
  });

  it('clamps a line past the end of the document to the document length', () => {
    const text = 'ab\ncd';
    expect(positionToOffset(text, 9, 1)).toBe(text.length);
  });
});

describe('applyTextEdits', () => {
  it('returns the original text when there are no edits', () => {
    expect(applyTextEdits('unchanged', [])).toBe('unchanged');
  });

  it('inserts a zero-width edit at a 1-based column', () => {
    const text = 'int main(){return 0;}';
    const result = applyTextEdits(text, [edit(1, 11, 1, 11, ' ')]);
    expect(result).toBe('int main() {return 0;}');
  });

  it('applies multiple replacements without offset drift', () => {
    const text = 'a=1;b=2;';
    const result = applyTextEdits(text, [
      edit(1, 2, 1, 3, ' = '),
      edit(1, 6, 1, 7, ' = '),
    ]);
    // replace the '=' at column 2 and the '=' at column 6
    expect(result).toBe('a = 1;b = 2;');
  });

  it('reformats an unindented multi-line block via full-range replacement', () => {
    const messy = 'int main(){\nreturn 0;\n}';
    const tidy = 'int main() {\n  return 0;\n}\n';
    const result = applyTextEdits(messy, [edit(1, 1, 3, 2, tidy)]);
    expect(result).toBe(tidy);
  });

  it('is order-independent for the edit array', () => {
    const text = 'xx--yy';
    const forward = applyTextEdits(text, [edit(1, 1, 1, 3, 'AA'), edit(1, 5, 1, 7, 'BB')]);
    const reversed = applyTextEdits(text, [edit(1, 5, 1, 7, 'BB'), edit(1, 1, 1, 3, 'AA')]);
    expect(forward).toBe('AA--BB');
    expect(reversed).toBe('AA--BB');
  });
});

describe('groupTextEditsByPath', () => {
  const at = (path: string, startColumn: number): LanguageTextEdit => ({
    path,
    startLine: 1,
    startColumn,
    endLine: 1,
    endColumn: startColumn,
    newText: 'x',
  });

  it('groups edits by their target path, preserving order', () => {
    const grouped = groupTextEditsByPath([at('a.py', 1), at('b.py', 1), at('a.py', 5)]);
    expect([...grouped.keys()]).toEqual(['a.py', 'b.py']);
    expect(grouped.get('a.py')?.map((e) => e.startColumn)).toEqual([1, 5]);
    expect(grouped.get('b.py')?.length).toBe(1);
  });

  it('ignores edits without a path and handles an empty list', () => {
    expect(groupTextEditsByPath([]).size).toBe(0);
    const grouped = groupTextEditsByPath([{ ...at('', 1) }, at('a.py', 1)]);
    expect([...grouped.keys()]).toEqual(['a.py']);
  });
});
