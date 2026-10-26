'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../src/data.js');

function tx(overrides = {}) {
  return { transactionId: 1, transactionDateTime: '2026-10-01T12:00:00Z', creditDebit: 'DEBIT',
    amount: 100, balance: 900, transactionDescription: 'انتقال', categoryId: null, ...overrides };
}

test('CREDIT/DEBIT is authoritative even when category metadata says otherwise', () => {
  const categories = D.parseCategories({ resultSet: { innerResponse: [{ id: 2, name: 'دستمزد', type: 2, color: '#abcdef' }] } });
  const parsed = D.parseTransactions([tx({ categoryId: 2 })], categories);
  assert.equal(parsed.rows[0].category, 'دستمزد');
  assert.equal(D.summarize(parsed.rows).expense, 100);
  assert.equal(D.summarize(parsed.rows).income, 0);
});

test('known wrappers, BOM, empty arrays and category reload are supported', () => {
  const raw = { resultSet: { innerResponse: { transactions: [tx({ categoryId: '8' })] } } };
  const parsed = D.parseTransactions('\uFEFF' + JSON.stringify(raw));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].category, 'دسته 8');
  const renamed = D.applyCategories(parsed.rows, [{ id: 8, name: 'جدید', color: '#123456' }]);
  assert.equal(renamed[0].category, 'جدید');
  assert.equal(parsed.rows[0].category, 'دسته 8', 'relabeling does not mutate the previous rows');
  assert.equal(D.parseTransactions([]).rows.length, 0);
  assert.throws(() => D.parseTransactions({ error: 'no data' }), /فهرست/);
  assert.throws(() => D.parseTransactions('{'), /JSON/);
});

test('validation rejects invalid money, date and direction without exposing raw details', () => {
  const result = D.parseTransactions([
    tx({ amount: -1 }), tx({ amount: 0 }), tx({ amount: '1e3' }), tx({ amount: 1.5 }),
    tx({ amount: Number.MAX_SAFE_INTEGER + 1 }), tx({ transactionDateTime: '2026-02-30T12:00:00Z' }),
    tx({ creditDebit: 'OTHER' }), tx({ transactionDateTime: 'not-a-date' }), tx({ amount: '۱۲٬۳۴۵' })
  ]);
  assert.equal(result.diagnostics.invalidCount, 8);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, 12345);
  assert.ok(result.diagnostics.issues.every(issue => Object.keys(issue).sort().join() === 'index,reason'));
  assert.throws(() => D.parseAmount('12,34'), /جداکننده/);
  assert.throws(() => D.parseAmount(''), /عدد صحیح/);
  assert.equal(D.parseAmount('۰'), 0);
  assert.equal(D.parseAmount('-5', { signed: true }), -5);
});

test('unknown or malformed balance does not silently become zero', () => {
  const result = D.parseTransactions([tx({ balance: null }), tx({ transactionId: 2, balance: 'oops' })]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.diagnostics.warningCount, 1);
  assert.equal(result.rows[0].balance, null);
  assert.equal(D.summarize(result.rows).lastBalance, null);
});

test('dedup uses real identities, retains identity conflicts and all rows without IDs', () => {
  const result = D.parseTransactions([
    tx(), tx(), tx({ amount: 101 }), tx(),
    tx({ transactionId: null }), tx({ transactionId: null }),
    tx({ transactionId: null, origKey: 'fallback' }), tx({ transactionId: null, origKey: 'fallback' }),
    tx({ transactionId: 10, origKey: 'shared' }), tx({ transactionId: 11, origKey: 'shared' })
  ]);
  assert.equal(result.diagnostics.duplicateCount, 3);
  assert.equal(result.diagnostics.conflictCount, 1);
  assert.equal(result.rows.length, 7);
});

test('timestamps and day boundaries explicitly use Tehran, with host-independent local fallback', () => {
  const result = D.parseTransactions([tx({ transactionDateTime: '2026-10-01T21:00:00Z' })]);
  assert.equal(result.rows[0].day, '2026-10-02');
  assert.equal(result.rows[0].dateLabel, '۱۴۰۵/۰۷/۱۰');
  assert.equal(result.rows[0].timeLabel, '۰۰:۳۰:۰۰');
  assert.equal(D.parseTimestamp('2026-10-01T23:59:59.123'), D.parseTimestamp('2026-10-01T20:29:59.123Z'));
  assert.equal(D.parseTimestamp('2020-07-01T12:00:00'), D.parseTimestamp('2020-07-01T07:30:00Z'), 'historic DST is preserved');
  assert.throws(() => D.parseTimestamp('2026-10-01T24:00:00Z'), /ساعت/);
});

test('Jalali dates validate leap days, Persian digits and round-trip conversion', () => {
  assert.equal(D.jalaliToISO('۱۳۹۹/۱۲/۳۰'), '2021-03-20');
  assert.equal(D.jalaliToISO('۱۴۰۳/۱۲/۳۰'), '2025-03-20');
  assert.equal(D.jalaliToISO('1404/01/01'), '2025-03-21');
  assert.equal(D.jalaliToISO('1405-08-04'), '2026-10-26');
  assert.equal(D.isoToJalali('2026-10-26'), '1405/08/04');
  assert.equal(D.jalaliToISO(''), '');
  assert.throws(() => D.jalaliToISO('1400/12/30'), /وجود ندارد/);
  assert.throws(() => D.jalaliToISO('1405/07/31'), /وجود ندارد/);
  assert.throws(() => D.jalaliToISO('1405/13/01'), /معتبر/);
  assert.throws(() => D.isoToJalali('2026-02-30'), /معتبر/);
});

test('search normalizes Persian/Arabic letters, digits and multiple tokens', () => {
  const rows = D.parseTransactions([tx({ transactionDescription: 'خريد كالا', transactionTraceNumber: '۱۲۰۳', comment: 'بیمه' })]).rows;
  assert.equal(D.filterTransactions(rows, { search: 'خرید کالا 1203' }).length, 1);
  assert.equal(D.filterTransactions(rows, { search: 'خرید گم‌شده' }).length, 0);
  assert.equal(D.normalizeSearch(' كالا ١٢ ي '), 'کالا 12 ی');
});

test('all filters compose and zero upper amount is an actual bound', () => {
  const rows = D.parseTransactions([
    tx({ categoryId: 2, amount: 100 }),
    tx({ transactionId: 2, categoryId: 3, creditDebit: 'CREDIT', amount: 500 }),
    tx({ transactionId: 3, categoryId: 2, amount: 200, transactionDateTime: '2026-10-02T12:00:00Z' })
  ]).rows;
  assert.equal(D.filterTransactions(rows, { direction: 'DEBIT', categoryId: '2', method: 'انتقال', startDate: '2026-10-02', maxAmount: 200 }).length, 1);
  assert.equal(D.filterTransactions(rows, { maxAmount: 0 }).length, 0);
  assert.equal(D.filterTransactions(rows, { minAmount: 0, maxAmount: '' }).length, 3);
  assert.equal(D.filterTransactions(rows, { startDate: '2026-10-01', endDate: '2026-10-01' }).length, 2);
  assert.throws(() => D.filterTransactions(rows, { minAmount: 3, maxAmount: 2 }), /کمترین/);
  assert.throws(() => D.filterTransactions(rows, { startDate: '2026-10-02', endDate: '2026-10-01' }), /تاریخ شروع/);
});

test('summaries sort time, preserve observed balances and insert zero-flow calendar gaps', () => {
  const rows = D.parseTransactions([
    tx({ transactionId: 2, transactionDateTime: '2026-10-03T12:00:00Z', amount: 200, balance: 900 }),
    tx({ transactionId: 1, transactionDateTime: '2026-10-01T12:00:00Z', creditDebit: 'CREDIT', amount: 1000, balance: 1100 })
  ]).rows;
  const summary = D.summarize(rows);
  assert.equal(summary.income, 1000);
  assert.equal(summary.expense, 200);
  assert.equal(summary.net, 800);
  assert.equal(summary.turnover, 1200);
  assert.equal(summary.firstBalance, 1100, 'post-transaction observed balance is not opening balance');
  assert.equal(summary.lastBalance, 900);
  assert.equal(summary.activeDays, 2);
  assert.equal(summary.calendarDays, 3);
  assert.deepEqual(summary.daily.map(d => d.key), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(summary.daily[1].expense, 0);
  assert.equal(summary.daily[1].balance, null);
  assert.equal(summary.averageDailyExpense, 200 / 3);
  assert.equal(summary.categories.reduce((s, c) => s + c.expense, 0), summary.expense);
});

test('empty summaries are explicit and unsafe sums fail instead of losing integer precision', () => {
  const empty = D.summarize([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.net, 0);
  assert.equal(empty.lastBalance, null);
  assert.equal(empty.firstDate, null);
  assert.deepEqual(empty.daily, []);
  const rows = D.parseTransactions([tx({ amount: Number.MAX_SAFE_INTEGER }), tx({ transactionId: 2, amount: 1 })]).rows;
  assert.equal(rows.length, 2);
  assert.throws(() => D.summarize(rows), /محدوده محاسبه دقیق/);
});

test('conflicting balances at the same timestamp are explicitly ambiguous', () => {
  const rows = D.parseTransactions([
    tx({ transactionId: 1, balance: 1000 }),
    tx({ transactionId: 2, balance: 900 }),
    tx({ transactionId: 3, balance: 1000 })
  ]).rows;
  const tied = D.summarize(rows);
  assert.equal(tied.firstBalanceAmbiguous, true);
  assert.equal(tied.lastBalanceAmbiguous, true, 'a later matching balance does not erase a conflict');
  assert.equal(tied.daily[0].balanceAmbiguous, true);
  assert.equal(tied.monthly[0].balanceAmbiguous, true);

  const later = D.parseTransactions([tx({ transactionId: 4, balance: 700, transactionDateTime: '2026-10-01T13:00:00Z' })]).rows;
  const resolved = D.summarize([...rows, ...later]);
  assert.equal(resolved.firstBalanceAmbiguous, true);
  assert.equal(resolved.lastBalanceAmbiguous, false, 'a later observed balance resolves the final timestamp');
  assert.equal(resolved.lastBalance, 700);
  assert.equal(resolved.daily[0].balanceAmbiguous, false);

  const identical = D.summarize(D.parseTransactions([tx({ transactionId: 5 }), tx({ transactionId: 6 })]).rows);
  assert.equal(identical.lastBalanceAmbiguous, false);
  assert.equal(D.summarize([]).lastBalanceAmbiguous, false);
});

test('sample-file reconciliation independently matches exact integer totals without copying private fixtures', t => {
  const sample = path.join(__dirname, '..', 'transactions.json');
  const categoryFile = path.join(__dirname, '..', 'transaction-category.json');
  if (!fs.existsSync(sample)) { t.skip('Local private sample not present'); return; }
  const source = JSON.parse(fs.readFileSync(sample, 'utf8'));
  const categories = fs.existsSync(categoryFile) ? D.parseCategories(fs.readFileSync(categoryFile, 'utf8')).categories : [];
  const parsed = D.parseTransactions(source, categories);
  const summary = D.summarize(parsed.rows);
  const expectedCredit = source.filter(t => t.creditDebit === 'CREDIT').reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const expectedDebit = source.filter(t => t.creditDebit === 'DEBIT').reduce((sum, t) => sum + BigInt(t.amount), 0n);
  assert.equal(parsed.diagnostics.invalidCount, 0);
  assert.equal(parsed.diagnostics.duplicateCount, 0);
  assert.equal(parsed.diagnostics.conflictCount, 0);
  assert.equal(summary.count, source.length);
  assert.equal(BigInt(summary.income), expectedCredit);
  assert.equal(BigInt(summary.expense), expectedDebit);
  assert.equal(BigInt(summary.net), expectedCredit - expectedDebit);
  assert.equal(summary.incomeCount + summary.expenseCount, source.length);
  assert.equal(summary.daily.reduce((sum, bucket) => sum + bucket.income, 0), summary.income);
  assert.equal(summary.monthly.reduce((sum, bucket) => sum + bucket.expense, 0), summary.expense);
  assert.equal(summary.methods.reduce((sum, bucket) => sum + bucket.count, 0), summary.count);
});
