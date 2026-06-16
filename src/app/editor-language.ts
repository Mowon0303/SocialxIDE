import { EditorLanguage } from './desktop-api';

export function resolveEditorLanguage(language: EditorLanguage, content: string): EditorLanguage {
  if (language === 'cpp') {
    return 'cpp';
  }
  return looksLikeCpp(content) ? 'cpp' : language;
}

export function looksLikeCpp(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  let score = 0;
  if (/^\s*#\s*include\b/m.test(content)) score += 4;
  if (/\busing\s+namespace\s+std\s*;/.test(content)) score += 3;
  if (/\bstd::/.test(content)) score += 3;
  if (/\btemplate\s*</.test(content)) score += 3;
  if (/\b(?:class|struct)\s+[A-Za-z_]\w*/.test(content)) score += 2;
  if (/^\s*(?:public|private|protected)\s*:/m.test(content)) score += 3;
  if (/\b(?:vector|map|set|unordered_map|unordered_set|queue|stack|priority_queue|string)\s*</.test(content)) score += 3;
  if (/\b(?:int|long|double|float|char|bool|void|auto)\s+[A-Za-z_:~]\w*(?:\s*::\s*\w+)?\s*\([^)]*\)\s*(?:const\s*)?\{/.test(content)) score += 3;
  if (/\b(?:int|long|double|float|char|bool|string|auto)\s+[A-Za-z_]\w*(?:\s*[=;,\[])/.test(content)) score += 1;
  if (/(?:^|\s)(?:cout|cin|cerr)\b|<<|>>/.test(content)) score += 2;
  if (/->|::|\bnullptr\b/.test(content)) score += 2;
  if (/^\s*}\s*;?\s*$/m.test(content)) score += 1;

  const semicolonLines = content.split('\n').filter((line) => /;\s*(?:(?:\/\/).*)?$/.test(line)).length;
  if (semicolonLines >= 2) score += 1;

  return score >= 4;
}
