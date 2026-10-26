'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/data.js');
const A = require('../src/analytics.js');

const categories = D.parseCategories([
  { id: 101, name: 'خوراک', color: '#a43d3d' }, { id: 202, name: 'اجاره', color: '#345a91' },
  { id: 431, name: 'برداشت دسته بندی نشده' }, { id: 443, name: 'واريز دسته بندي نشده' }
]).categories;
function raw(index, overrides = {}) {
  return { transactionId: `synthetic-${index}`, transactionDateTime: '2026-10-01T10:00:00Z', creditDebit: 'DEBIT', amount: 100,
    categoryId: 101, transactionDescription: 'تراکنش ساختگی', supplementaryInfo: { counterPartyAccountNumber: 'TEST-001', supplementaryTypeName: 'حساب به حساب' }, ...overrides };
}
function rows(records, cats = categories) { return D.parseTransactions(records, cats).rows; }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('equal-period comparison is inclusive, independently totals categories, and handles zero baselines', () => {
  const input = rows([
    raw(1, { transactionDateTime: '2026-09-01T10:00:00Z', amount: 50 }),
    raw(2, { transactionDateTime: '2026-09-30T20:29:59Z', creditDebit: 'CREDIT', amount: 200, categoryId: 202 }),
    raw(3, { transactionDateTime: '2026-09-30T20:30:00Z', amount: 100 }),
    raw(4, { transactionDateTime: '2026-10-30T10:00:00Z', creditDebit: 'CREDIT', amount: 300, categoryId: 202 }),
    raw(5, { transactionDateTime: '2026-10-31T10:00:00Z', amount: 500 })
  ]);
  const report = A.comparePeriods(input, { start: '2026-10-01', end: '2026-10-30' }, { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(report.days, 30);
  assert.deepEqual([report.current.income, report.current.expense, report.current.net, report.current.count], [300, 100, 200, 2]);
  assert.deepEqual([report.previous.income, report.previous.expense, report.previous.net, report.previous.count], [200, 50, 150, 2]);
  assert.deepEqual(report.changes.expense, { value: 50, percent: 1 });
  const food = report.categories.find(category => category.id === '101');
  assert.deepEqual(food.incomeChange, { value: 0, percent: null });
  assert.equal(food.expenseChange.value, 50);
  const emptyBaseline = A.comparePeriods(input, { start: '2026-10-01', end: '2026-10-30' }, { start: '2026-08-01', end: '2026-08-30' });
  assert.equal(emptyBaseline.changes.expense.percent, null);
  assert.equal(emptyBaseline.previous.count, 0);
});

test('comparison rejects invalid, overlapping, reversed and unequal date ranges', () => {
  const a = { start: '2026-10-01', end: '2026-10-30' };
  assert.throws(() => A.comparePeriods([], a, { start: '2026-09-01', end: '2026-09-29' }), /برابر/);
  assert.throws(() => A.comparePeriods([], a, a), /هم‌پوشانی/);
  assert.throws(() => A.comparePeriods([], { start: '2026-10-30', end: '2026-10-01' }, a), /تاریخ/);
  assert.throws(() => A.comparePeriods([], { start: '2026-02-30', end: '2026-03-30' }, a), /تاریخ/);
  assert.throws(() => A.shiftDay('9999-12-31', 1), /محدوده/);
  assert.throws(() => A.shiftDay('0100-01-01', -1), /محدوده/);
  assert.throws(() => A.shiftDay('2026-01-01', Number.MAX_SAFE_INTEGER), /محدوده/);
});

test('counterparties preserve typed identifiers and leading zeros, never merge names across identifiers', () => {
  const input = rows([
    raw(1, { amount: 100, supplementaryInfo: { counterPartyAccountNumber: '۰۰۰۱۲۳', counterPartyFullName: 'نام مشترک' } }),
    raw(2, { amount: 200, creditDebit: 'CREDIT', supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyFullName: 'نام مشترک' } }),
    raw(3, { supplementaryInfo: { counterPartyAccountNumber: '000456', counterPartyFullName: 'نام مشترک' } }),
    raw(4, { supplementaryInfo: { counterPartyCardNumber: '000123', counterPartyFullName: 'نام مشترک' } }),
    raw(5, { supplementaryInfo: { counterPartyFullName: 'نام مشترک' } }),
    raw(6, { supplementaryInfo: { cardNumber: 'self-card-must-not-be-counterparty' } }),
    raw(7, { supplementaryInfo: { counterPartyAccountNumber: '۰۰۰۰' } }),
    raw(8, { supplementaryInfo: { counterPartyCardNumber: '****1234' } })
  ]);
  const report = A.counterparties(input);
  assert.equal(report.groups.length, 4);
  assert.equal(report.unknownCount, 3);
  assert.equal(report.unknownAmount, 300);
  const group = report.groups.find(item => item.key === 'account:000123');
  assert.deepEqual([group.count, group.expense, group.income, group.net], [2, 100, 200, 100]);
  assert.equal(group.label, 'نام مشترک');
  assert.equal(report.groups.find(item => item.kind === 'name').confidence, 'name');
});

test('merchant terminals with different providers remain separate and names normalize only in name-only groups', () => {
  const input = rows([
    raw(1, { supplementaryInfo: { terminalCode: 'T100', pspCode: 1, merchantName: 'فروشگاه' } }),
    raw(2, { supplementaryInfo: { terminalCode: 'T100', pspCode: 2, merchantName: 'فروشگاه' } }),
    raw(3, { supplementaryInfo: { counterPartyFullName: 'علي كريمي' } }),
    raw(4, { supplementaryInfo: { counterPartyFullName: 'علی کریمی' } })
  ]);
  const report = A.counterparties(input);
  assert.equal(report.groups.length, 3);
  assert.equal(report.groups.filter(item => item.kind === 'merchant').length, 2);
  assert.equal(report.groups.find(item => item.kind === 'name').count, 2);
});

test('account numbers are namespaced by bank code or normalized bank name without guessing missing banks', () => {
  const input = rows([
    raw(1, { supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyBankCode: 17, counterPartyBankName: 'نام بانک' } }),
    raw(2, { supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyBankCode: 17, counterPartyBankName: 'تغییر نام همان بانک' } }),
    raw(3, { supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyBankCode: 18, counterPartyBankName: 'نام بانک' } }),
    raw(4, { supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyBankName: 'بانك ملي' } }),
    raw(5, { supplementaryInfo: { counterPartyAccountNumber: '000123', counterPartyBankName: 'بانک ملی' } }),
    raw(6, { supplementaryInfo: { counterPartyAccountNumber: '000123' } })
  ]);
  const report = A.counterparties(input);
  assert.equal(report.groups.length, 4);
  assert.equal(report.groups.find(group => group.bankCode === '17').count, 2);
  assert.equal(report.groups.find(group => group.bankCode === '18').count, 1);
  assert.equal(report.groups.find(group => group.bankName === 'بانك ملي').count, 2);
  assert.equal(report.groups.find(group => group.key === 'account:000123').count, 1);
});

test('recurring detects conservative monthly patterns with transparent hypotheses', () => {
  const input = rows(['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((day, index) => raw(index, {
    transactionDateTime: `${day}T10:00:00Z`, amount: 1000 + index * 20, categoryId: 202
  })));
  const report = A.recurring(input);
  assert.equal(report.length, 1);
  assert.equal(report[0].cadence, 'ماهانه');
  assert.equal(report[0].count, 4);
  assert.equal(report[0].total, 4120);
  assert.equal(report[0].amount, 1020);
  assert.equal(report[0].amountMin, 1000);
  assert.equal(report[0].amountMax, 1060);
  assert.equal(report[0].lastDate, '2026-10-05');
  assert.match(report[0].reason, /احتمالی/);
  assert.match(report[0].reason, /برآورد/);
  assert.equal(report[0].nextDate, '2026-11-05');
});

test('recurring separates methods and amount ranges; unknown/name-only/credits and same-day repeats are not bills', () => {
  const dates = ['2026-08-05', '2026-09-05', '2026-10-05'];
  const input = [];
  for (const [index, day] of dates.entries()) {
    input.push(raw(`unknown-${index}`, { transactionDateTime: `${day}T10:00:00Z`, supplementaryInfo: {} }));
    input.push(raw(`name-${index}`, { transactionDateTime: `${day}T10:00:00Z`, supplementaryInfo: { counterPartyFullName: 'فقط نام' } }));
    input.push(raw(`credit-${index}`, { transactionDateTime: `${day}T10:00:00Z`, creditDebit: 'CREDIT' }));
    input.push(raw(`method-${index}`, { transactionDateTime: `${day}T10:00:00Z`, supplementaryInfo: { counterPartyAccountNumber: 'different-method', supplementaryTypeName: `روش ${index}` } }));
    input.push(raw(`amount-${index}`, { transactionDateTime: `${day}T10:00:00Z`, amount: [100, 111, 123][index], supplementaryInfo: { counterPartyAccountNumber: 'different-amounts' } }));
    for (let duplicate = 0; duplicate < 2; duplicate++) input.push(raw(`duplicate-${index}-${duplicate}`, { transactionDateTime: `${day}T10:0${duplicate}:00Z`, supplementaryInfo: { counterPartyAccountNumber: 'same-day' } }));
  }
  assert.deepEqual(A.recurring(rows(input)), []);
});

test('recurring identifies weekly and fortnight runs while splitting a long gap', () => {
  const input = rows([0, 7, 14, 40, 47, 54].map((offset, index) => raw(index, { transactionDateTime: `${A.shiftDay('2026-08-01', offset)}T10:00:00Z` })));
  const report = A.recurring(input);
  assert.equal(report.filter(item => item.cadence === 'هفتگی').length, 2);
  assert.equal(report.reduce((sum, item) => sum + item.count, 0), 6);
  const fortnight = rows([0, 14, 28].map((offset, index) => raw(index, { transactionDateTime: `${A.shiftDay('2026-08-01', offset)}T10:00:00Z` })));
  assert.equal(A.recurring(fortnight)[0].cadence, 'دو‌هفته‌ای');
});

test('large-payment review needs five peers in same category and method and excludes candidate from median', () => {
  const input = rows([100, 100, 100, 100, 100, 301].map((amount, index) => raw(index, {
    amount, transactionDateTime: `${A.shiftDay('2026-10-01', index)}T10:00:00Z`,
    supplementaryInfo: { counterPartyAccountNumber: `independent-${index}`, supplementaryTypeName: 'خرید' }
  })));
  const report = A.reviewTransactions(input);
  assert.equal(report.counts.large, 1);
  assert.equal(report.items[0].amount, 301);
  assert.match(report.items[0].reason, /۵/);
  assert.equal(A.reviewTransactions(input.slice(1)).counts.large, 0);
  const differentCategory = input.map(row => row.amount === 301 ? { ...row, categoryId: 'other' } : row);
  assert.equal(A.reviewTransactions(differentCategory).counts.large, 0);
  const exactlyTriple = input.map(row => row.amount === 301 ? { ...row, amount: 300 } : row);
  assert.equal(A.reviewTransactions(exactlyTriple).counts.large, 0);
});

test('repeat review uses known counterpart, direction, exact amount, distinct bank IDs and <=10minute links', () => {
  const input = rows([
    raw(1), raw(2, { transactionDateTime: '2026-10-01T10:10:00Z' }), raw(3, { transactionDateTime: '2026-10-01T10:20:00Z' }),
    raw(4, { transactionDateTime: '2026-10-01T11:00:00Z' }), raw(5, { transactionDateTime: '2026-10-01T11:10:01Z' }),
    raw(6, { creditDebit: 'CREDIT' }), raw(7, { amount: 101 }), raw(8, { supplementaryInfo: {} }), raw(9, { supplementaryInfo: {} })
  ]);
  const report = A.reviewTransactions(input);
  assert.equal(report.counts.repeat, 1);
  const repeated = report.items.find(item => item.kind === 'repeat');
  assert.equal(repeated.count, 3);
  assert.equal(repeated.amount, 300);
  assert.match(repeated.reason, /متوالی/);
  const absentIds = rows([raw(1, { transactionId: null }), raw(2, { transactionId: null })]);
  assert.equal(A.reviewTransactions(absentIds).counts.repeat, 0);
});

test('conflicting financial fingerprints are flagged but reused origKey with distinct primary IDs is not', () => {
  const input = rows([
    raw('same', { amount: 100 }), raw('same', { amount: 200 }),
    raw(3, { origKey: 'reused', amount: 123 }), raw(4, { origKey: 'reused', amount: 124 }),
    raw(5, { transactionId: null, origKey: 'fallback', amount: 201 }), raw(6, { transactionId: null, origKey: 'fallback', amount: 202 })
  ]);
  const report = A.reviewTransactions(input);
  assert.equal(report.counts.conflict, 2);
  assert.equal(report.items.find(item => item.key === 'conflict:id:synthetic-same').count, 2);
  assert.equal(report.items.find(item => item.key === 'conflict:orig:fallback').amount, 403);
  assert.ok(report.items.every(item => !/تقلب/.test(item.reason)));
});

test('calendar supplies full Jalali months, Saturday-first alignment, leap Esfand and zero-data days', () => {
  const leap = A.calendar([], '۱۴۰۳-۱۲', 'count');
  assert.equal(leap.cells.length, 30);
  assert.equal(leap.nextMonth, '1404-01');
  const regular = A.calendar([], '1404-12');
  assert.equal(regular.cells.length, 29);
  const newYear = A.calendar([], '1405-01');
  assert.equal(newYear.cells.length, 31);
  assert.equal(newYear.previousMonth, '1404-12');
  assert.equal(newYear.cells[0].day, '2026-03-21');
  assert.equal(newYear.offset, 0, '2026-03-21 is Saturday');
  assert.equal(newYear.cells.at(-1).jalaliDay, 31);
  assert.equal(newYear.total, 0);
  assert.throws(() => A.calendar([], '1405-13'), /معتبر/);
  assert.throws(() => A.calendar([], '1405-01', 'net'), /معیار/);
});

test('calendar day totals use normalized Tehran dates and match independently selected records', () => {
  const input = rows([
    raw(1, { transactionDateTime: '2026-03-20T20:29:59Z', amount: 99 }),
    raw(2, { transactionDateTime: '2026-03-20T20:30:00Z', amount: 100 }),
    raw(3, { transactionDateTime: '2026-03-21T15:00:00Z', amount: 200, creditDebit: 'CREDIT' })
  ]);
  const report = A.calendar(input, '1405-01', 'expense');
  assert.equal(report.cells[0].count, 2);
  assert.equal(report.cells[0].expense, 100);
  assert.equal(report.cells[0].income, 200);
  assert.equal(report.total, 100);
  assert.equal(report.max, 100);
  assert.equal(A.calendar(input, '1405-01', 'count').total, 2);
});

test('category quality distinguishes unassigned, bank defaults, unresolved dictionary and actual named categories', () => {
  const input = rows([
    raw(1, { categoryId: null }), raw(2, { categoryId: 431 }), raw(3, { categoryId: 443 }),
    raw(4, { categoryId: 999 }), raw(5, { categoryId: 998, categoryName: 'دسته از خود رکورد' }), raw(6, { categoryId: 101 }),
    raw(7, { categoryId: 997, categoryName: 'برداشت دسته‌بندی نشده' })
  ]);
  const report = A.categoryQuality(input, categories);
  assert.deepEqual([report.uncategorizedCount, report.unresolvedCount, report.categorizedCount], [4, 1, 2]);
  assert.equal(report.uncategorizedAmount, 400);
  assert.equal(report.unresolvedAmount, 100);
  assert.equal(report.amount, 700);
  assert.equal(report.coverage, 2 / 7);
  assert.equal(report.categories.find(category => category.id === '999').status, 'unresolved');
  assert.equal(A.categoryQuality(rows([raw(1, { categoryId: 101 })], []), []).unresolvedCount, 1);
});

test('mixed name availability on one category ID keeps report statuses and drilldowns consistent', () => {
  const input = rows([raw(1, { categoryId: 900, categoryName: 'دسته شناخته‌شده روی یک رکورد' }), raw(2, { categoryId: 900 })]);
  const quality = A.categoryQuality(input, []);
  assert.equal(quality.categories.length, 2);
  assert.equal(quality.categories.find(group => group.status === 'categorized').count, 1);
  assert.equal(quality.categories.find(group => group.status === 'unresolved').count, 1);
  assert.deepEqual(quality.categories.find(group => group.status === 'unresolved').rowIds, quality.unresolvedRowIds);
  const names = rows([raw(1, { transactionDateTime: '2026-10-01T10:00:00Z', supplementaryInfo: { counterPartyAccountNumber: '123', counterPartyFullName: 'نام موجود' } }),
    raw(2, { transactionDateTime: '2026-10-02T10:00:00Z', supplementaryInfo: { counterPartyAccountNumber: '123' } })]).reverse();
  assert.equal(A.counterparties(names).groups[0].label, 'نام موجود');
});

test('all report operations are pure and empty states are explicit', () => {
  const input = deepFreeze(rows([raw(1), raw(2, { creditDebit: 'CREDIT' })]));
  const before = JSON.stringify(input);
  A.comparePeriods(input, { start: '2026-10-01', end: '2026-10-30' }, { start: '2026-09-01', end: '2026-09-30' });
  A.counterparties(input); A.recurring(input); A.reviewTransactions(input); A.calendar(input, '1405-07'); A.categoryQuality(input, deepFreeze(categories));
  assert.equal(JSON.stringify(input), before);
  assert.equal(A.counterparties([]).groups.length, 0);
  assert.deepEqual(A.recurring([]), []);
  assert.equal(A.reviewTransactions([]).items.length, 0);
  assert.equal(A.categoryQuality([], []).coverage, 0);
});

test('unsafe totals throw instead of silently rounding accepted integer money', () => {
  const input = rows([raw(1, { amount: Number.MAX_SAFE_INTEGER }), raw(2, { amount: 1 })]);
  assert.throws(() => A.counterparties(input), /دقیق/);
  assert.throws(() => A.categoryQuality(input, categories), /دقیق/);
  assert.throws(() => A.calendar(input, '1405-07'), /دقیق/);
  assert.throws(() => A.comparePeriods(input, { start: '2026-10-01', end: '2026-10-30' }, { start: '2026-09-01', end: '2026-09-30' }), /دقیق/);
});
