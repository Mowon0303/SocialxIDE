import { describe, expect, it } from 'vitest';
import { extractSpellCheckRegions } from './spell-regions';

describe('extractSpellCheckRegions', () => {
  it('checks all markdown-like text buffers', () => {
    const regions = extractSpellCheckRegions('recieve this note\n', 'text');
    expect(regions).toEqual([{
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 1,
      text: 'recieve this note\n',
    }]);
  });

  it('checks Python comments and strings without checking identifiers', () => {
    const regions = extractSpellCheckRegions([
      'recieve_value = 1',
      '# recieve comment',
      'message = "recieve string"',
    ].join('\n'), 'python');

    expect(regions.map((region) => region.text.trim())).toEqual([
      'recieve comment',
      'recieve string',
    ]);
    expect(regions.some((region) => region.text.includes('recieve_value'))).toBe(false);
  });

  it('checks C++ comments and strings without checking identifiers', () => {
    const regions = extractSpellCheckRegions([
      'int recieve_value = 1;',
      '// recieve comment',
      'auto message = "recieve string";',
      '/* recieve block */',
    ].join('\n'), 'cpp');

    expect(regions.map((region) => region.text.trim())).toEqual([
      'recieve comment',
      'recieve string',
      'recieve block',
    ]);
    expect(regions.some((region) => region.text.includes('recieve_value'))).toBe(false);
  });
});
