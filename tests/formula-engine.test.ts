import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/grid-formulas';

/** One sheet from rows of text; `v('=...')` evaluates a formula placed in the first free cell. */
function sheet(rows: string[][] = []) {
  const grid = rows.map((r) => [...r]);
  const cols = 12; const nr = 60;
  const raw = (c: number, r: number) => (c >= cols || r >= nr ? undefined : grid[r]?.[c] ?? '');
  return {
    v(f: string) {
      const g = grid.map((r) => [...r]);
      g[40] = g[40] ?? []; g[40][0] = f;
      const ev = createEvaluator((c, r) => (c >= cols || r >= nr ? undefined : g[r]?.[c] ?? ''), [cols, nr], { scan: (visit) => { g.forEach((row, r) => row?.forEach((x, c) => { if (x?.startsWith('=')) visit(c, r, x); })); } });
      return ev.value(0, 40);
    },
    raw,
  };
}
const data = [['10', '20', '30', 'a'], ['5', '15', '25', 'b'], ['1', '2', '3', 'a']];
const s = sheet(data);
const t = (f: string, want: unknown) => expect(s.v(f), f).toEqual(want);
const close = (f: string, want: number, d = 6) => expect(s.v(f) as number, f).toBeCloseTo(want, d);

describe('formula engine', () => {
  it('operators, booleans and errors', () => {
    t('=2^3^2', 64); t('=-2^2', 4); t('=1+2*3&"x"', '7x'); t('=1<2', true); t('="a"="A"', true); t('=1/0', '#DIV/0!'); t('=NOPE()', '#NAME?');
    t('=IFERROR(1/0,"z")', 'z'); t('=ISNA(NA())', true); t('=TRUE+1', 2); t('=5%', 0.05); t('=1E3+1', 1001);
  });
  it('math', () => {
    t('=ROUND(2.675,2)', 2.68); t('=ROUND(-2.5,0)', -3); t('=MOD(-1,3)', 2); t('=CEILING(2.1,0.5)', 2.5); t('=FLOOR(2.9,0.5)', 2.5); t('=GCD(12,18)', 6); t('=LCM(4,6)', 12);
    t('=FACT(5)', 120); t('=COMBIN(5,2)', 10); t('=ROMAN(1994)', 'MCMXCIV'); t('=ARABIC("MCMXCIV")', 1994); t('=BASE(255,16)', 'FF'); t('=SUMPRODUCT(A1:A3,B1:B3)', 10 * 20 + 5 * 15 + 2);
    t('=SUMPRODUCT((A1:A3>2)*(B1:B3))', 35); t('=SUM(A1:C3)', 111); t('=TRUNC(-2.7)', -2); t('=EVEN(3)', 4); t('=ODD(2)', 3);
    close('=LOG(8,2)', 3); close('=ATAN2(1,1)', Math.PI / 4);
  });
  it('statistics', () => {
    t('=AVERAGE(A1:C1)', 20); t('=MEDIAN(A1:C3)', 10); t('=COUNTIF(D1:D3,"a")', 2); t('=SUMIF(D1:D3,"a",A1:A3)', 11); t('=COUNTIFS(D1:D3,"a",A1:A3,">5")', 1); t('=AVERAGEIF(D1:D3,"a",A1:A3)', 5.5);
    t('=MAXIFS(A1:A3,D1:D3,"a")', 10); t('=LARGE(A1:C3,2)', 25); t('=RANK(20,A1:C1)', 2); t('=PERCENTILE(A1:C1,0.5)', 20); t('=QUARTILE(A1:C1,1)', 15);
    close('=STDEV(A1:C1)', 10); close('=NORM.S.DIST(1.96,TRUE)', 0.9750021, 5); close('=NORM.S.INV(0.975)', 1.959964, 5); close('=T.DIST.2T(2.228,10)', 0.05, 3); close('=CHISQ.DIST.RT(3.841,1)', 0.05, 3);
    close('=BINOM.DIST(3,10,0.5,FALSE)', 0.1171875); close('=POISSON.DIST(2,3,TRUE)', 0.4231901, 5); close('=CORREL(A1:A3,B1:B3)', 0.9, 0);
  });
  it('text', () => {
    t('=LEFT("hello",2)&RIGHT("hello",2)', 'helo'); t('=MID("hello",2,3)', 'ell'); t('=FIND("l","hello")', 3); t('=SEARCH("L?","hello")', 3); t('=SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c');
    t('=PROPER("hello wORLD")', 'Hello World'); t('=TEXTJOIN(",",TRUE,A1:C1)', '10,20,30'); t('=TRIM("  a   b ")', 'a b'); t('=REPT("ab",3)', 'ababab');
    t('=TEXT(1234.567,"#,##0.00")', '1,234.57'); t('=TEXT(0.256,"0%")', '26%'); t('=TEXT(5,"000")', '005'); t('=TEXT(DATE(2024,3,5),"yyyy-mm-dd")', '2024-03-05'); t('=TEXT(DATE(2024,3,5),"dddd, mmmm d")', 'Tuesday, March 5');
    t('=TEXT(0.5,"hh:mm AM/PM")', '12:00 PM'); t('=TEXT(1234,"0.0E+00")', '1.2E+03'); t('=TEXT(-5,"0;(0)")', '(5)'); t('=VALUE("1,000")', 1000); t('=TEXTBEFORE("a-b-c","-")', 'a'); t('=TEXTAFTER("a-b-c","-",2)', 'c');
    t('=LEN("héllo")', 5); t('=EXACT("a","A")', false); t('=CHAR(65)', 'A'); t('=NUMBERVALUE("1.234,5",",",".")', 1234.5); t('=DOLLAR(-1234.5)', '($1,234.50)'); t('=FIXED(1234.567,1)', '1,234.6');
  });
  it('logic and info', () => {
    t('=IFS(1>2,"a",2>1,"b")', 'b'); t('=SWITCH(2,1,"a",2,"b","z")', 'b'); t('=CHOOSE(2,"x","y","z")', 'y'); t('=AND(TRUE,1,A1:A3)', true); t('=OR(FALSE,0)', false); t('=XOR(TRUE,TRUE)', false);
    t('=IF(A1:A3>4,"hi","lo")', 'hi'); t('=ISNUMBER(A1)', true); t('=ISTEXT(D1)', true); t('=ISBLANK(F1)', true); t('=ISERROR(1/0)', true); t('=TYPE(D1)', 2); t('=IFNA(MATCH("zz",D1:D3,0),"none")', 'none');
    t('=LET(x,2,y,3,x*y)', 6); t('=ISFORMULA(A1)', false); t('=N(TRUE)', 1);
  });
  it('lookup', () => {
    t('=VLOOKUP(5,A1:D3,3,FALSE)', 25); t('=VLOOKUP("b",D1:D3,1,0)', 'b'); t('=HLOOKUP(20,A1:C3,2,FALSE)', 15); t('=INDEX(A1:C3,2,3)', 25); t('=MATCH(25,C1:C3,0)', 2); t('=MATCH(7,A1:A3,-1)', 1);
    t('=XLOOKUP("b",D1:D3,A1:A3)', 5); t('=XLOOKUP("q",D1:D3,A1:A3,"nf")', 'nf'); t('=XMATCH("a",D1:D3,0,-1)', 3); t('=INDEX(A1:A3,MATCH(MAX(A1:A3),A1:A3,0))', 10); t('=SUM(OFFSET(A1,0,0,2,2))', 50);
    t('=SUM(INDIRECT("A1:A3"))', 16); t('=ROW(B7)', 7); t('=COLUMN(C1)', 3); t('=ROWS(A1:B5)', 5); t('=ADDRESS(3,2)', '$B$3'); t('=LOOKUP(2,A3:C3)', 2);
  });
  it('dates', () => {
    t('=DATE(2024,2,29)', 45351); t('=YEAR(45351)', 2024); t('=MONTH("2024-03-05")', 3); t('=EDATE(DATE(2024,1,31),1)', 45351); t('=EOMONTH(DATE(2024,1,15),1)', 45351); t('=DAYS(DATE(2024,3,1),DATE(2024,2,1))', 29);
    t('=DATEDIF(DATE(2020,1,15),DATE(2024,3,1),"Y")', 4); t('=DATEDIF(DATE(2020,1,15),DATE(2024,3,1),"YM")', 1); t('=WEEKDAY(DATE(2024,3,5))', 3); t('=NETWORKDAYS(DATE(2024,3,1),DATE(2024,3,15))', 11); t('=WORKDAY(DATE(2024,3,1),5)', 45359);
    t('=ISOWEEKNUM(DATE(2024,1,1))', 1); t('=WEEKNUM(DATE(2024,3,5))', 10); t('=HOUR(0.75)', 18); t('=TIME(6,0,0)', 0.25); close('=YEARFRAC(DATE(2024,1,1),DATE(2024,7,1),0)', 0.5); t('=DAY(DATE(2024,1,31)+1)', 1);
  });
  it('finance', () => {
    close('=PMT(0.05/12,360,200000)', -1073.64, 2); close('=FV(0.06/12,10,-200,-500)', 2571.2, 1); close('=PV(0.08/12,240,-500)', 59777.15, 1); close('=NPER(0.01,-100,1000)', 10.59, 2);
    close('=RATE(48,-200,8000)', 0.0077, 3); close('=NPV(0.1,100,100,100)', 248.69, 2); close('=IRR({-100,60,60})', 0.130662, 5); t('=IRR(A1:C1)', '#NUM!'); close('=SLN(1000,100,9)', 100); close('=EFFECT(0.1,12)', 0.104713, 5); close('=IPMT(0.1/12,1,36,8000)', -66.67, 2); close('=PPMT(0.1/12,1,36,8000)', -191.47, 2);
  });
  it('arrays that spill', () => {
    const g = [['3', 'b'], ['1', 'a'], ['2', 'c']];
    g[0][3] = '=SORT(A1:A3)'; g[0][5] = '=SEQUENCE(2,2)'; g[0][8] = '=UNIQUE(B1:B3)'; g[5] = ['=SUM(D1:D3)'];
    const ev = createEvaluator((c, r) => (c >= 12 || r >= 30 ? undefined : g[r]?.[c] ?? ''), [12, 30], { scan: (visit) => g.forEach((row, r) => row.forEach((x, c) => x?.startsWith('=') && visit(c, r, x))) });
    expect([ev.value(3, 0), ev.spilled(3, 1), ev.spilled(3, 2)]).toEqual([1, 2, 3]);
    expect([ev.value(5, 0), ev.spilled(6, 0), ev.spilled(5, 1), ev.spilled(6, 1)]).toEqual([1, 2, 3, 4]);
    expect(ev.value(0, 5)).toBe(6);
    expect(ev.spilled(8, 2)).toBe('c');
  });
  it('another sheet', () => {
    const other = createEvaluator((c, r) => (c === 0 && r === 0 ? '42' : ''), [5, 5], { name: 'Data' });
    const ev = createEvaluator((c, r) => (c === 0 && r === 0 ? "=Data!A1+1" : c === 1 && r === 0 ? "='my sheet'!A1" : ''), [5, 5], { name: 'Main', sheets: (n) => (n.toLowerCase() === 'data' ? other.sheet : undefined) });
    expect(ev.value(0, 0)).toBe(43);
    expect(ev.value(1, 0)).toBe('#REF!');
  });
});

describe('editor tables keep their rules', () => {
  it('compares to 1 and 0 and goes right to left', async () => {
    const { evaluateGrid } = await import('../src/grid-formulas');
    expect(evaluateGrid([['=1<2', '=2^3^2', '=AND(1,0)']])[0]).toEqual([1, 512, 0]);
  });
});
