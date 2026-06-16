import { describe, expect, it } from 'vitest';
import { resolveEditorLanguage } from './editor-language';

describe('resolveEditorLanguage', () => {
  it('uses C++ highlighting for a pasted C++ buffer even when the file started as Python', () => {
    const content = [
      'private:',
      '  void dfs(vector<vector<char>>& grid, int i, int j, int m, int n) {',
      "    // boundary check, or water ('0') stops search",
      "    if (i < 0 || i >= m || j < 0 || j >= n || grid[i][j] == '0') {",
      '      return;',
      '    }',
      "    grid[i][j] = '0';",
      '  }',
      '',
    ].join('\n');

    expect(resolveEditorLanguage('python', content)).toBe('cpp');
  });

  it('does not treat Python floor division as a C++ line comment', () => {
    expect(resolveEditorLanguage('python', 'answer = total // bucket\nprint(answer)\n')).toBe('python');
  });
});
