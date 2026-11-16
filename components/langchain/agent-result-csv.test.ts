import { CSV_INPUT_BYTES, parseResultCsv } from './agent-result-csv';

describe('bounded result CSV parser', () => {
  it.each([
    ['', []],
    [
      'a,b\r\n1,2\r\n',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    [
      '"a,b","say ""hello"""\n"two\nlines",last',
      [
        ['a,b', 'say "hello"'],
        ['two\nlines', 'last'],
      ],
    ],
    [
      '"CR\r\nLF",x\rnext,y',
      [
        ['CR\r\nLF', 'x'],
        ['next', 'y'],
      ],
    ],
    ['"",,\n', [['', '', '']]],
    ['a,', [['a', '']]],
    ['\n\n', [[''], ['']]],
    ['\ufefffirst,last', [['first', 'last']]],
  ])('parses %j', (input, expected) => {
    expect(parseResultCsv(input as string)).toEqual({
      rows: expected,
      truncated: false,
    });
  });

  it('bounds rows without counting embedded quoted newlines as records', () => {
    const exact = Array.from({ length: 200 }, () => '"a\nb",c').join('\n');
    expect(parseResultCsv(exact).rows).toHaveLength(200);
    expect(parseResultCsv(exact).truncated).toBe(false);
    expect(parseResultCsv(`${exact}\nextra`).truncated).toBe(true);
    expect(parseResultCsv(`${exact}\nextra`).rows).toHaveLength(200);
  });

  it('bounds columns while retaining the next record', () => {
    const exact = Array.from({ length: 20 }, (_, index) => String(index)).join(
      ','
    );
    expect(parseResultCsv(exact).truncated).toBe(false);
    const parsed = parseResultCsv(`${exact},"hidden,cell"\nnext,row`);
    expect(parsed.rows[0]).toHaveLength(20);
    expect(parsed.rows[1]).toEqual(['next', 'row']);
    expect(parsed.truncated).toBe(true);
  });

  it('bounds escaped cell content and reports truncation', () => {
    expect(parseResultCsv('x'.repeat(2000)).truncated).toBe(false);
    const parsed = parseResultCsv(`"${'x'.repeat(2000)}""y",next`);
    expect(parsed.rows[0]).toEqual(['x'.repeat(2000), 'next']);
    expect(parsed.truncated).toBe(true);
  });

  it('bounds parsing input in UTF-8 bytes and preserves an upstream truncation notice', () => {
    const parsed = parseResultCsv('"' + '界'.repeat(CSV_INPUT_BYTES));
    expect(parsed.rows[0][0]).toHaveLength(2000);
    expect(parsed.truncated).toBe(true);
    expect(parseResultCsv('a,b', true).truncated).toBe(true);
  });

  it('does not evaluate or rewrite formulas and HTML', () => {
    expect(
      parseResultCsv('=1+1,+SUM(A1),@A1,-1,<script>alert(1)</script>').rows[0]
    ).toEqual(['=1+1', '+SUM(A1)', '@A1', '-1', '<script>alert(1)</script>']);
  });
});
