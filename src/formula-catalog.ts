/** The functions by category, with syntax lines for the picker and the typing hint. */
import { LIBRARY } from './formula-lib';

const list = (s: string) => s.split(/\s+/).filter(Boolean);

export const FUNCTION_CATEGORIES: [string, string[]][] = [
  ['Math & trig', list('SUM SUMIF SUMIFS SUMPRODUCT SUMSQ PRODUCT SUBTOTAL AGGREGATE ABS SIGN SQRT SQRTPI EXP LN LOG LOG10 POWER MOD QUOTIENT INT TRUNC ROUND ROUNDUP ROUNDDOWN MROUND CEILING CEILING.MATH CEILING.PRECISE ISO.CEILING FLOOR FLOOR.MATH FLOOR.PRECISE EVEN ODD FACT FACTDOUBLE COMBIN COMBINA PERMUT PERMUTATIONA GCD LCM MULTINOMIAL PI RADIANS DEGREES SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH ASINH ACOSH ATANH COT ACOT COTH ACOTH SEC CSC SECH CSCH RAND RANDBETWEEN ROMAN ARABIC BASE DECIMAL SERIESSUM SUMX2MY2 SUMX2PY2 SUMXMY2 MMULT MDETERM MINVERSE MUNIT')],
  ['Statistical', list('COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS MAXIFS MINIFS MIN MAX MINA MAXA MEDIAN MODE MODE.SNGL MODE.MULT LARGE SMALL RANK RANK.EQ RANK.AVG PERCENTILE PERCENTILE.INC PERCENTILE.EXC QUARTILE QUARTILE.INC QUARTILE.EXC PERCENTRANK PERCENTRANK.INC PERCENTRANK.EXC STDEV STDEV.S STDEVA STDEVP STDEV.P STDEVPA VAR VAR.S VARA VARP VAR.P VARPA AVEDEV DEVSQ GEOMEAN HARMEAN TRIMMEAN SKEW SKEW.P KURT CORREL PEARSON RSQ SLOPE INTERCEPT STEYX COVAR COVARIANCE.P COVARIANCE.S FORECAST FORECAST.LINEAR TREND GROWTH LINEST FREQUENCY PROB STANDARDIZE FISHER FISHERINV GAUSS PHI CONFIDENCE CONFIDENCE.NORM CONFIDENCE.T Z.TEST')],
  ['Distributions', list('NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NORMDIST NORMINV NORMSDIST NORMSINV LOGNORM.DIST LOGNORM.INV LOGNORMDIST LOGINV BINOM.DIST BINOM.INV BINOMDIST CRITBINOM NEGBINOM.DIST POISSON.DIST POISSON EXPON.DIST EXPONDIST WEIBULL.DIST WEIBULL GAMMA GAMMALN GAMMALN.PRECISE GAMMA.DIST GAMMA.INV GAMMADIST GAMMAINV BETA.DIST BETA.INV BETADIST BETAINV CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHIDIST CHIINV T.DIST T.DIST.RT T.DIST.2T T.INV T.INV.2T TDIST TINV F.DIST F.DIST.RT F.INV F.INV.RT FDIST FINV HYPGEOM.DIST ERF ERF.PRECISE ERFC ERFC.PRECISE')],
  ['Logical', list('IF IFS IFERROR IFNA SWITCH CHOOSE AND OR XOR NOT TRUE FALSE LET')],
  ['Text', list('CONCAT CONCATENATE TEXTJOIN LEFT RIGHT MID LEN LENB FIND SEARCH REPLACE SUBSTITUTE UPPER LOWER PROPER TRIM CLEAN EXACT REPT TEXT VALUE NUMBERVALUE CHAR CODE UNICHAR UNICODE T FIXED DOLLAR TEXTBEFORE TEXTAFTER TEXTSPLIT VALUETOTEXT ARRAYTOTEXT HYPERLINK')],
  ['Date & time', list('TODAY NOW DATE TIME YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM ISOWEEKNUM DATEVALUE TIMEVALUE EDATE EOMONTH DAYS DAYS360 DATEDIF YEARFRAC NETWORKDAYS NETWORKDAYS.INTL WORKDAY WORKDAY.INTL')],
  ['Lookup & reference', list('VLOOKUP HLOOKUP XLOOKUP LOOKUP MATCH XMATCH INDEX OFFSET INDIRECT ROW COLUMN ROWS COLUMNS ADDRESS AREAS CHOOSEROWS CHOOSECOLS')],
  ['Dynamic arrays', list('FILTER SORT SORTBY UNIQUE SEQUENCE RANDARRAY TRANSPOSE TOCOL TOROW VSTACK HSTACK TAKE DROP EXPAND WRAPROWS WRAPCOLS')],
  ['Financial', list('PMT PPMT IPMT PV FV NPER RATE NPV IRR XNPV XIRR MIRR CUMIPMT CUMPRINC ISPMT FVSCHEDULE EFFECT NOMINAL PDURATION RRI SLN SYD DB DDB DOLLARDE DOLLARFR')],
  ['Information', list('ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISERROR ISERR ISNA ISEVEN ISODD ISFORMULA ISREF N NA TYPE ERROR.TYPE SHEET SHEETS')],
  ['Engineering', list('BIN2DEC BIN2HEX BIN2OCT DEC2BIN DEC2HEX DEC2OCT HEX2BIN HEX2DEC HEX2OCT OCT2BIN OCT2DEC OCT2HEX BITAND BITOR BITXOR BITLSHIFT BITRSHIFT DELTA GESTEP CONVERT')],
  ['Database', list('DSUM DAVERAGE DCOUNT DCOUNTA DMAX DMIN DPRODUCT DGET')],
];

/** Syntax lines for the functions people use most; the others get a line made from their argument counts. */
const SIGNATURES: Record<string, string> = {
  SUM: 'SUM(number1, [number2], …)', AVERAGE: 'AVERAGE(number1, [number2], …)', COUNT: 'COUNT(value1, [value2], …)', COUNTA: 'COUNTA(value1, [value2], …)', MAX: 'MAX(number1, [number2], …)', MIN: 'MIN(number1, [number2], …)',
  IF: 'IF(logical_test, value_if_true, [value_if_false])', IFS: 'IFS(test1, value1, [test2, value2], …)', IFERROR: 'IFERROR(value, value_if_error)', IFNA: 'IFNA(value, value_if_na)', SWITCH: 'SWITCH(expression, value1, result1, …, [default])',
  AND: 'AND(logical1, [logical2], …)', OR: 'OR(logical1, [logical2], …)', NOT: 'NOT(logical)', LET: 'LET(name1, value1, …, calculation)', CHOOSE: 'CHOOSE(index, value1, [value2], …)',
  ROUND: 'ROUND(number, num_digits)', ROUNDUP: 'ROUNDUP(number, num_digits)', ROUNDDOWN: 'ROUNDDOWN(number, num_digits)', MOD: 'MOD(number, divisor)', POWER: 'POWER(number, power)', ABS: 'ABS(number)', SQRT: 'SQRT(number)', INT: 'INT(number)',
  SUMIF: 'SUMIF(range, criteria, [sum_range])', SUMIFS: 'SUMIFS(sum_range, criteria_range1, criteria1, …)', COUNTIF: 'COUNTIF(range, criteria)', COUNTIFS: 'COUNTIFS(criteria_range1, criteria1, …)', AVERAGEIF: 'AVERAGEIF(range, criteria, [average_range])', AVERAGEIFS: 'AVERAGEIFS(average_range, criteria_range1, criteria1, …)',
  SUMPRODUCT: 'SUMPRODUCT(array1, [array2], …)', MEDIAN: 'MEDIAN(number1, [number2], …)', LARGE: 'LARGE(array, k)', SMALL: 'SMALL(array, k)', RANK: 'RANK(number, ref, [order])', STDEV: 'STDEV(number1, [number2], …)',
  VLOOKUP: 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])', HLOOKUP: 'HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])', XLOOKUP: 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])',
  MATCH: 'MATCH(lookup_value, lookup_array, [match_type])', XMATCH: 'XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])', INDEX: 'INDEX(array, row_num, [column_num])', OFFSET: 'OFFSET(reference, rows, cols, [height], [width])', INDIRECT: 'INDIRECT(ref_text)', LOOKUP: 'LOOKUP(lookup_value, lookup_vector, [result_vector])',
  FILTER: 'FILTER(array, include, [if_empty])', SORT: 'SORT(array, [sort_index], [sort_order], [by_col])', SORTBY: 'SORTBY(array, by_array1, [sort_order1], …)', UNIQUE: 'UNIQUE(array, [by_col], [exactly_once])', SEQUENCE: 'SEQUENCE(rows, [columns], [start], [step])', TRANSPOSE: 'TRANSPOSE(array)',
  LEFT: 'LEFT(text, [num_chars])', RIGHT: 'RIGHT(text, [num_chars])', MID: 'MID(text, start_num, num_chars)', LEN: 'LEN(text)', FIND: 'FIND(find_text, within_text, [start_num])', SEARCH: 'SEARCH(find_text, within_text, [start_num])',
  SUBSTITUTE: 'SUBSTITUTE(text, old_text, new_text, [instance_num])', REPLACE: 'REPLACE(old_text, start_num, num_chars, new_text)', TEXT: 'TEXT(value, format_text)', TEXTJOIN: 'TEXTJOIN(delimiter, ignore_empty, text1, [text2], …)', CONCAT: 'CONCAT(text1, [text2], …)', TRIM: 'TRIM(text)', UPPER: 'UPPER(text)', LOWER: 'LOWER(text)', PROPER: 'PROPER(text)', VALUE: 'VALUE(text)', REPT: 'REPT(text, number_times)',
  TODAY: 'TODAY()', NOW: 'NOW()', DATE: 'DATE(year, month, day)', TIME: 'TIME(hour, minute, second)', YEAR: 'YEAR(serial_number)', MONTH: 'MONTH(serial_number)', DAY: 'DAY(serial_number)', WEEKDAY: 'WEEKDAY(serial_number, [return_type])', EDATE: 'EDATE(start_date, months)', EOMONTH: 'EOMONTH(start_date, months)',
  DATEDIF: 'DATEDIF(start_date, end_date, unit)', NETWORKDAYS: 'NETWORKDAYS(start_date, end_date, [holidays])', WORKDAY: 'WORKDAY(start_date, days, [holidays])', DAYS: 'DAYS(end_date, start_date)', YEARFRAC: 'YEARFRAC(start_date, end_date, [basis])',
  PMT: 'PMT(rate, nper, pv, [fv], [type])', PV: 'PV(rate, nper, pmt, [fv], [type])', FV: 'FV(rate, nper, pmt, [pv], [type])', NPER: 'NPER(rate, pmt, pv, [fv], [type])', RATE: 'RATE(nper, pmt, pv, [fv], [type], [guess])', NPV: 'NPV(rate, value1, [value2], …)', IRR: 'IRR(values, [guess])', XIRR: 'XIRR(values, dates, [guess])', IPMT: 'IPMT(rate, per, nper, pv, [fv], [type])', PPMT: 'PPMT(rate, per, nper, pv, [fv], [type])',
  ISBLANK: 'ISBLANK(value)', ISNUMBER: 'ISNUMBER(value)', ISTEXT: 'ISTEXT(value)', ISERROR: 'ISERROR(value)', PERCENTILE: 'PERCENTILE(array, k)', QUARTILE: 'QUARTILE(array, quart)', CORREL: 'CORREL(array1, array2)', SLOPE: 'SLOPE(known_ys, known_xs)', INTERCEPT: 'INTERCEPT(known_ys, known_xs)', FORECAST: 'FORECAST(x, known_ys, known_xs)',
  'NORM.DIST': 'NORM.DIST(x, mean, standard_dev, cumulative)', 'NORM.S.DIST': 'NORM.S.DIST(z, cumulative)', 'NORM.INV': 'NORM.INV(probability, mean, standard_dev)', MAXIFS: 'MAXIFS(max_range, criteria_range1, criteria1, …)', MINIFS: 'MINIFS(min_range, criteria_range1, criteria1, …)',
};

/** The functions with a hand-written syntax line are the ones people use most; the suggestions list them first. */
export const isCommon = (name: string): boolean => Object.prototype.hasOwnProperty.call(SIGNATURES, name);

const CATEGORY_OF = new Map<string, string>();
for (const [cat, names] of FUNCTION_CATEGORIES) for (const n of names) CATEGORY_OF.set(n, cat);

/** Every function the engine knows, sorted. */
export const functionNames = (): string[] => [...Object.keys(LIBRARY), 'LET'].sort();
export const categoryOf = (name: string): string => CATEGORY_OF.get(name.toUpperCase()) ?? 'Other';

/** `SUM(number1, [number2], …)`, or one made from the argument counts. */
export function signature(name: string): string {
  const k = name.toUpperCase();
  if (SIGNATURES[k]) return SIGNATURES[k];
  const f = Object.prototype.hasOwnProperty.call(LIBRARY, k) ? LIBRARY[k] : undefined;
  if (!f) return `${k}()`;
  const parts: string[] = [];
  const shown = Math.min(f.max, Math.max(f.min, 1) + (f.max > f.min ? 1 : 0), 8);
  for (let i = 0; i < shown; i++) parts.push(i < f.min ? `arg${i + 1}` : `[arg${i + 1}]`);
  if (f.max > shown) parts.push('…');
  return `${k}(${parts.join(', ')})`;
}
