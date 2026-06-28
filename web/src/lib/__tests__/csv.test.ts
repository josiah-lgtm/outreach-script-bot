import { describe, it, expect } from 'vitest';
import { buildCsv, type ScriptRow } from '../csv';

describe('buildCsv', () => {
  it('emits the exact header line', () => {
    const csv = buildCsv([]);
    expect(csv).toBe('framework,category,angle,label,variant,script');
  });

  it('header is the first line for non-empty input', () => {
    const row: ScriptRow = {
      framework: 'AIDA',
      category: 'cold',
      angle: 'time-saving',
      label: 'opener',
      n: 1,
      script: 'Hi there',
    };
    const lines = buildCsv([row]).split('\n');
    expect(lines[0]).toBe('framework,category,angle,label,variant,script');
  });

  it('maps the n field into the variant column (4th data field)', () => {
    const row: ScriptRow = {
      framework: 'AIDA',
      category: 'cold',
      angle: 'a',
      label: 'l',
      n: 3,
      script: 'body',
    };
    const dataLine = buildCsv([row]).split('\n')[1];
    expect(dataLine).toBe('"AIDA","cold","a","l","3","body"');
  });

  it('RFC4180-quotes a cell with embedded quotes, commas, and newlines', () => {
    const row: ScriptRow = {
      framework: 'f,1',
      category: 'c',
      angle: 'a',
      label: 'l',
      n: 1,
      script: 'line "quoted", with\nnewline',
    };
    const dataLine = buildCsv([row]).split('\n').slice(1).join('\n');
    // every field wrapped in double-quotes; internal " doubled; comma/newline
    // survive inside the wrapped field.
    expect(dataLine).toBe(
      '"f,1","c","a","l","1","line ""quoted"", with\nnewline"'
    );
  });

  it('defangs formula-injection: leading = + - @ get a leading apostrophe', () => {
    const mk = (script: string): ScriptRow => ({
      framework: 'f',
      category: 'c',
      angle: 'a',
      label: 'l',
      n: 1,
      script,
    });
    const cell = (script: string) =>
      buildCsv([mk(script)]).split('\n')[1].split(',').pop();

    expect(cell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(cell('+1')).toBe('"\'+1"');
    expect(cell('-bullet point')).toBe('"\'-bullet point"');
    expect(cell('@handle')).toBe('"\'@handle"');
    // tab and CR also trigger the defang
    expect(cell('\tindented')).toBe('"\'\tindented"');
    expect(cell('\rcarriage')).toBe('"\'\rcarriage"');
  });

  it('does NOT defang cells that do not start with a dangerous char', () => {
    const row: ScriptRow = {
      framework: 'normal',
      category: 'c',
      angle: 'a',
      label: 'l',
      n: 1,
      script: 'a = b is fine mid-string',
    };
    const dataLine = buildCsv([row]).split('\n')[1];
    expect(dataLine).toBe('"normal","c","a","l","1","a = b is fine mid-string"');
    // no leading apostrophe injected
    expect(dataLine).not.toContain("'");
  });
});
