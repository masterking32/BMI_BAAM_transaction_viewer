'use strict';

// Synthetic end-to-end checks for the six reports. No bank samples are embedded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
function loadPlaywright() {
  for (const location of [process.env.BAAM_PLAYWRIGHT_PATH, 'playwright',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(location); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Install Playwright or set BAAM_PLAYWRIGHT_PATH to the installed package.');
}
function browserOptions(chromium) {
  const executablePath = [process.env.BAAM_BROWSER_PATH, chromium.executablePath(),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')]
    .filter(Boolean).find(candidate => fs.existsSync(candidate));
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
const numeric = text => Number(text.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
  .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/٫/g, '.')
  .replace(/−/g, '-').replace(/[^\d.+-]/g, ''));
const jsonFile = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
function jalali(isoDay) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(`${isoDay}T12:00:00Z`));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('/');
}
const total = (rows, direction) => rows.filter(row => row.creditDebit === direction).reduce((sum, row) => sum + row.amount, 0);
const categories = { resultSet: { innerResponse: [
  { id: 101, name: 'خوراک آزمایشی', color: '#289b8c', type: 1 },
  { id: 202, name: 'دستمزد آزمایشی', color: '#4479db', type: 2 },
  { id: 303, name: 'اجاره آزمایشی', color: '#9861cf', type: 1 },
  { id: 431, name: 'برداشت دسته بندی نشده', color: '', type: 1 },
] } };
const transactions = [];
function add(id, date, amount, options = {}) {
  transactions.push({
    transactionId: id, transactionDateTime: `${date}T${options.time || '10:00:00'}Z`,
    amount, balance: 80000000 - transactions.length * 5000,
    creditDebit: options.direction || 'DEBIT', categoryId: Object.hasOwn(options, 'category') ? options.category : 101,
    transactionDescription: options.description || 'تراکنش ساختگی آزمون', transactionTraceNumber: `TRACE-${transactions.length}`,
    comment: options.comment || 'این داده بانکی واقعی نیست',
    supplementaryInfo: { supplementaryTypeName: options.method || 'کارت به کارت',
      ...(options.party ? { counterPartyAccountNumber: options.party } : {}),
      ...(options.name ? { counterPartyFullName: options.name } : {}) },
  });
}
for (const [i, month] of ['07', '08', '09', '10'].entries()) add(`rent-${i}`, `2026-${month}-05`, 1000000,
  { category: 303, party: 'SYNTHETIC-RENT-001', name: 'موجر آزمایشی', method: 'حساب به حساب' });
add('rent-other-account', '2026-09-06', 700000, { category: 303, party: 'SYNTHETIC-RENT-002', name: 'موجر آزمایشی', method: 'حساب به حساب' });
for (const [i, amount] of [95000, 100000, 102000, 104000, 106000, 110000].entries()) {
  add(`food-${i}`, `2026-09-${10 + i}`, amount, { party: `SYNTHETIC-FOOD-${i}`, method: 'خرید فروشگاهی' });
}
add('food-outlier', '2026-09-16', 2000000, { party: 'SYNTHETIC-FOOD-LARGE', method: 'خرید فروشگاهی' });
add('double-one', '2026-09-17', 55000, { party: 'SYNTHETIC-DOUBLE', time: '10:00:00' });
add('double-two', '2026-09-17', 55000, { party: 'SYNTHETIC-DOUBLE', time: '10:05:00' });
add('identity-conflict', '2026-09-18', 70000, { party: 'SYNTHETIC-CONFLICT' });
add('identity-conflict', '2026-09-18', 71000, { party: 'SYNTHETIC-CONFLICT', time: '10:01:00' });
add('missing-category', '2026-09-19', 20000, { category: null });
add('bank-uncategorized', '2026-09-20', 30000, { category: 431, party: 'SYNTHETIC-UNCAT' });
add('unresolved-category', '2026-09-21', 40000, { category: 999, party: 'SYNTHETIC-UNRESOLVED' });
add('xss-counterparty', '2026-09-22', 45000, { party: 'SYNTHETIC-XSS', name: '<img src=x onerror="window.__reportInjected=true">' });
add('salary-september', '2026-09-01', 4000000, { direction: 'CREDIT', category: 202, party: 'SYNTHETIC-EMPLOYER' });
add('salary-october', '2026-10-01', 4500000, { direction: 'CREDIT', category: 202, party: 'SYNTHETIC-EMPLOYER' });
for (const [i, month] of ['08', '09', '10'].entries()) add(`unknown-party-${i}`, `2026-${month}-10`, 222000);
add('same-day-other-party', '2026-09-17', 6000, { party: 'SYNTHETIC-DAY-OTHER' });

test('advanced reports: comparisons, drilldown, category corrections and responsive offline rendering', { timeout: 120000 }, async t => {
  const { chromium } = loadPlaywright();
  const output = path.join(__dirname, 'output');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ ...browserOptions(chromium), downloadsPath: output });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [], requests = [], logs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('console', entry => { if (entry.type() === 'log') logs.push(entry.text()); });
  await context.route(/^https?:/, route => route.abort());
  t.after(() => browser.close());

  async function expectTotals(rows) {
    await page.waitForFunction(count => {
      const text = document.querySelector('#countValue')?.textContent || '';
      return Number(text.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '')) === count;
    }, rows.length);
    assert.equal(numeric(await page.locator('#incomeValue').textContent()), total(rows, 'CREDIT'));
    assert.equal(numeric(await page.locator('#expenseValue').textContent()), total(rows, 'DEBIT'));
    assert.equal(numeric(await page.locator('#netValue').textContent()), total(rows, 'CREDIT') - total(rows, 'DEBIT'));
  }
  async function imported(name) {
    await page.waitForFunction(filename => document.querySelector('#fileStatus').textContent.includes(filename), name);
  }
  async function reset() { await page.locator('#resetFilters').click(); await expectTotals(transactions); }
  async function download(selector) {
    const [item] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
    return fs.readFileSync(await item.path(), 'utf8');
  }
  async function importFixture() {
    await page.locator('#quickFiles').setInputFiles([jsonFile('analytics-transactions.json', transactions), jsonFile('analytics-categories.json', categories)]);
    await imported('analytics-transactions.json');
    await page.locator('#unitSelect').selectOption('rial');
    await expectTotals(transactions);
  }

  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await importFixture();

  async function openReport(name) {
    const section = page.locator(`#report-${name}`);
    if (!await section.evaluate(node => node.open)) await section.locator('summary').first().click();
    return section;
  }
  async function closeDetails() { if (await page.locator('#detailDialog').isVisible()) await page.keyboard.press('Escape'); }
  const subset = ids => transactions.filter(row => ids.includes(row.transactionId));
  async function expectDrilldown(expected) {
    await expectTotals(expected);
    await page.locator('#drilldownBar').waitFor({ state: 'visible' });
    const csv = await download('#exportCsv');
    for (const row of expected) assert.ok(csv.includes(row.transactionTraceNumber));
    for (const row of transactions.filter(row => !expected.includes(row))) assert.ok(!csv.includes(`"${row.transactionTraceNumber}"`));
  }
  const calendarMonth = day => jalali(day).slice(0, 7).replace('/', '-');
  const calendarCell = day => page.locator(`#calendarGrid button[data-day="${day}"]`);
  async function calendarState() {
    return page.locator('#calendarGrid button[data-day]').evaluateAll(cells => cells.map(cell => ({
      day: cell.dataset.day, level: cell.dataset.level,
      count: cell.querySelector('.calendar-count').textContent,
      income: Number(cell.querySelector('.calendar-income').dataset.amount),
      expense: Number(cell.querySelector('.calendar-expense').dataset.amount),
    })));
  }
  async function expectCalendarRows(expected) {
    const days = await calendarState();
    for (const day of days) {
      const rows = expected.filter(row => row.transactionDateTime.slice(0, 10) === day.day);
      assert.equal(numeric(day.count), rows.length, `${day.day}: transaction count`);
      assert.equal(day.income, total(rows, 'CREDIT'), `${day.day}: exact daily deposits`);
      assert.equal(day.expense, total(rows, 'DEBIT'), `${day.day}: exact daily withdrawals`);
      assert.equal(Number(day.level) > 0, rows.length > 0, `${day.day}: count heat intensity`);
    }
    return days;
  }
  async function expectSelectedRows(expected, universe = transactions) {
    await expectTotals(expected);
    assert.equal(await page.locator('#transactionsBody .row-detail').count(), expected.length);
    const tableDates = await page.locator('#transactionsBody tr:has(.row-detail)').evaluateAll(rows => rows.map(row =>
      row.firstElementChild.firstChild.textContent.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))));
    assert.deepEqual(tableDates.sort(), expected.map(row => jalali(row.transactionDateTime.slice(0, 10))).sort(), 'table must show only selected dates');
    const csv = await download('#exportCsv');
    for (const row of universe) {
      assert.equal(csv.includes(`"${row.transactionTraceNumber}"`), expected.includes(row), `${row.transactionId}: CSV selection`);
    }
  }

  await t.test('six Persian reports load with exact original totals', async () => {
    await page.locator('#advancedReports').waitFor({ state: 'visible' });
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('html').getAttribute('lang'), 'fa');
    for (const name of ['comparison', 'counterparties', 'recurring', 'calendar', 'review', 'quality']) {
      assert.equal(await page.locator(`#report-${name}`).count(), 1);
    }
    await expectTotals(transactions);
  });

  await t.test('equal-period comparison reconciles both windows and rejects misleading bounds', async () => {
    await openReport('comparison');
    const ranges = { comparisonStart: '2026-10-01', comparisonEnd: '2026-10-30', comparisonPreviousStart: '2026-09-01', comparisonPreviousEnd: '2026-09-30' };
    for (const [id, value] of Object.entries(ranges)) await page.locator(`#${id}`).fill(jalali(value));
    await page.locator('#comparePeriods').click();
    const current = transactions.filter(row => row.transactionDateTime.slice(0, 10) >= ranges.comparisonStart && row.transactionDateTime.slice(0, 10) <= ranges.comparisonEnd);
    const previous = transactions.filter(row => row.transactionDateTime.slice(0, 10) >= ranges.comparisonPreviousStart && row.transactionDateTime.slice(0, 10) <= ranges.comparisonPreviousEnd);
    const metrics = rows => ({ income: total(rows, 'CREDIT'), expense: total(rows, 'DEBIT'), net: total(rows, 'CREDIT') - total(rows, 'DEBIT'), count: rows.length });
    for (const metric of ['income', 'expense', 'net', 'count']) {
      assert.equal(numeric(await page.locator(`#comparisonMetrics [data-metric="${metric}"] [data-period="current"]`).textContent()), metrics(current)[metric]);
      assert.equal(numeric(await page.locator(`#comparisonMetrics [data-metric="${metric}"] [data-period="previous"]`).textContent()), metrics(previous)[metric]);
    }
    await page.locator('#comparisonPreviousEnd').fill(jalali('2026-09-29'));
    await page.locator('#comparePeriods').click();
    await page.locator('#comparisonError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#comparisonError').textContent(), /[\u0600-\u06ff]/);
    await page.locator('#comparisonPreviousEnd').fill(jalali('2026-09-30'));
    await page.locator('#comparePeriods').click();
    await expectTotals(transactions);
    for (const [id, value] of Object.entries({ comparisonStart: '2026-07-01', comparisonEnd: '2026-07-30', comparisonPreviousStart: '2026-06-01', comparisonPreviousEnd: '2026-06-30' })) {
      await page.locator(`#${id}`).fill(jalali(value));
    }
    await page.locator('#comparePeriods').click();
    assert.doesNotMatch(await page.locator('#comparisonMetrics').textContent(), /Infinity|NaN|∞/);
  });

  await t.test('counterparty identities remain separate despite matching names and drill into all exports', async () => {
    await openReport('counterparties');
    await page.locator('#partySearch').fill('موجر');
    assert.equal(await page.locator('#counterpartyBody button[data-party-key]').count(), 2, 'different accounts must not merge on common name');
    await page.locator('#counterpartyBody button[data-party-key="account:SYNTHETICRENT001"]').click();
    await expectDrilldown(transactions.filter(item => item.supplementaryInfo.counterPartyAccountNumber === 'SYNTHETIC-RENT-001'));
    await page.locator('#clearDrilldown').click();
    await expectTotals(transactions);
    await page.locator('#partySearch').fill('');
  });

  await t.test('recurring candidates include monthly rent but never group unidentified counterparties', async () => {
    await openReport('recurring');
    const candidates = page.locator('#recurringList button[data-recurrence-key]');
    assert.equal(await candidates.count(), 1);
    await candidates.first().click();
    await expectDrilldown(subset(['rent-0', 'rent-1', 'rent-2', 'rent-3']));
    await reset();
  });

  await t.test('calendar day selections retain every other day and filter the table and CSV', async () => {
    await openReport('calendar');
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-09-17'));
    await page.locator('#calendarMetric').selectOption('count');
    const before = await expectCalendarRows(transactions);
    await calendarCell('2026-09-17').click();
    await expectSelectedRows(subset(['double-one', 'double-two', 'same-day-other-party']));
    assert.equal(await page.locator('#startDate').inputValue(), await page.locator('#endDate').inputValue());
    assert.equal(await calendarCell('2026-09-17').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await calendarState(), before, 'selecting a day must not clear other days or rescale their heat levels');
    await calendarCell('2026-09-18').click();
    await expectSelectedRows(subset(['identity-conflict']));
    assert.equal(await calendarCell('2026-09-17').getAttribute('aria-pressed'), 'false');
    assert.equal(await calendarCell('2026-09-18').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await calendarState(), before, 'a subsequent selection must preserve the complete calendar');
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-10-05'));
    await expectCalendarRows(transactions);
    await expectTotals(subset(['identity-conflict']));
    await calendarCell('2026-10-05').click();
    await expectSelectedRows(subset(['rent-3']));
    await reset();
  });

  await t.test('calendar keeps non-date filters when dates change and when the selection has no rows', async () => {
    await page.locator('#categoryId').selectOption('101');
    await page.locator('#direction').selectOption('DEBIT');
    await page.locator('#method').selectOption('خرید فروشگاهی');
    await page.locator('#minAmount').fill('100000');
    await page.locator('#search').fill('تراکنش ساختگی');
    await page.locator('#applyFilters').click();
    const filtered = transactions.filter(row => row.categoryId === 101 && row.creditDebit === 'DEBIT'
      && row.supplementaryInfo.supplementaryTypeName === 'خرید فروشگاهی' && row.amount >= 100000);
    await expectTotals(filtered);
    await openReport('calendar');
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-09-17'));
    const before = await expectCalendarRows(filtered);
    await calendarCell('2026-09-11').click();
    await expectSelectedRows(subset(['food-1']));
    assert.deepEqual(await calendarState(), before);
    await calendarCell('2026-09-17').click();
    await expectSelectedRows([]);
    assert.deepEqual(await calendarState(), before, 'an empty selected day must not erase the rest of the month');
    await calendarCell('2026-09-16').click();
    await expectSelectedRows(subset(['food-outlier']));
    assert.deepEqual(await calendarState(), before);
    await reset();
  });

  await t.test('calendar retains a counterparty subset across days and excludes other accounts', async () => {
    await openReport('counterparties');
    await page.locator('#partySearch').fill('SYNTHETICRENT001');
    await page.locator('#counterpartyBody button[data-party-key="account:SYNTHETICRENT001"]').click();
    const partyRows = subset(['rent-0', 'rent-1', 'rent-2', 'rent-3']);
    await expectTotals(partyRows);
    await openReport('calendar');
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-09-05'));
    const before = await expectCalendarRows(partyRows);
    await calendarCell('2026-09-05').click();
    await expectSelectedRows(subset(['rent-2']));
    assert.deepEqual(await calendarState(), before);
    await calendarCell('2026-09-06').click();
    await expectSelectedRows([]);
    assert.deepEqual(await calendarState(), before, 'same-name counterparty must stay excluded even on an empty day');
    assert.equal(await page.locator('#drilldownBar').isVisible(), true);
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-10-05'));
    await expectCalendarRows(partyRows);
    await calendarCell('2026-10-05').click();
    await expectSelectedRows(subset(['rent-3']));
    await reset();
    await page.locator('#partySearch').fill('');
  });

  await t.test('daily money responds to display units and retains exact accessible amounts on small dark screens', async () => {
    const calendarTransactions = [...transactions,
      { ...transactions[0], transactionId: 'calendar-large-credit', transactionDateTime: '2026-09-17T11:00:00Z',
        amount: 1234567890123, creditDebit: 'CREDIT', categoryId: 202, transactionTraceNumber: 'SYNTHETIC-CALENDAR-CREDIT' },
      { ...transactions[0], transactionId: 'calendar-large-debit', transactionDateTime: '2026-09-18T11:00:00Z',
        amount: 987654321098, transactionTraceNumber: 'SYNTHETIC-CALENDAR-DEBIT' },
    ];
    await page.locator('#quickFiles').setInputFiles(jsonFile('calendar-synthetic-large-amounts.json', calendarTransactions));
    await imported('calendar-synthetic-large-amounts.json');
    await expectTotals(calendarTransactions);
    const section = await openReport('calendar');
    await page.locator('#calendarMonth').selectOption(calendarMonth('2026-09-17'));
    await page.locator('#calendarMetric').selectOption('count');
    const before = await expectCalendarRows(calendarTransactions);
    await calendarCell('2026-09-17').click();
    await expectSelectedRows(calendarTransactions.filter(row => row.transactionDateTime.startsWith('2026-09-17')), calendarTransactions);
    assert.deepEqual(await calendarState(), before);
    const creditText = await calendarCell('2026-09-17').locator('.calendar-income').textContent();
    const exactText = text => text.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
    for (const attribute of ['title', 'aria-label']) {
      assert.ok(exactText(await calendarCell('2026-09-17').getAttribute(attribute)).includes('1234567890123'), `full rial amount in ${attribute}`);
    }
    await section.screenshot({ path: path.join(output, 'calendar-light-desktop.png'), style: '.skip-link { visibility: hidden !important; }' });
    await page.locator('#unitSelect').selectOption('toman');
    assert.deepEqual(await calendarState(), before, 'display units must not mutate raw daily rial totals');
    assert.notEqual(await calendarCell('2026-09-17').locator('.calendar-income').textContent(), creditText);
    for (const attribute of ['title', 'aria-label']) {
      assert.ok(exactText(await calendarCell('2026-09-17').getAttribute(attribute)).includes('123456789012.3'), `full toman amount in ${attribute}`);
    }
    await page.locator('#themeToggle').click();
    await page.setViewportSize({ width: 320, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'calendar must not widen a 320px viewport');
    await section.screenshot({ path: path.join(output, 'calendar-dark-mobile-320.png'), style: '.skip-link { visibility: hidden !important; }' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#themeToggle').click();
    await importFixture();
  });

  await t.test('large, repeated and conflicting records carry separate review drilldowns', async () => {
    for (const [kind, ids] of [['large', ['food-outlier']], ['repeat', ['double-one', 'double-two']], ['conflict', ['identity-conflict']]]) {
      await openReport('review');
      await page.locator('#reviewKind').selectOption(kind);
      assert.ok(await page.locator('#reviewList button[data-review-key]').count() > 0);
      await page.locator('#reviewList button[data-review-key]').first().click();
      await expectDrilldown(subset(ids));
      await reset();
    }
    await page.locator('#reviewKind').selectOption('all');
  });

  await t.test('quality report separates uncategorized rows from unresolved dictionary IDs', async () => {
    await openReport('quality');
    await page.locator('#qualityUncategorized').click();
    await expectDrilldown(subset(['missing-category', 'bank-uncategorized']));
    await reset();
    await openReport('quality');
    await page.locator('#qualityUnresolved').click();
    await expectDrilldown(subset(['unresolved-category']));
    await reset();
  });

  await t.test('category edits can remove a row from its active filter and undo restores it', async () => {
    await page.locator('#categoryId').selectOption('__uncategorized__');
    await page.locator('#applyFilters').click();
    await expectTotals(subset(['missing-category']));
    await page.locator('#transactionsBody button').first().click();
    await page.locator('#editCategorySelect').selectOption('303');
    await page.locator('#saveCategoryEdit').click();
    await expectTotals([]);
    await page.locator('#undoCategoryEdit').click();
    await expectTotals(subset(['missing-category']));
    await closeDetails();
    await reset();
  });

  await t.test('editing, undoing and creating categories update reports without changing money', async () => {
    await openReport('quality');
    const index = transactions.findIndex(row => row.transactionId === 'missing-category');
    await page.locator(`#qualityEditRows button[data-edit-row="tx-${index}"]`).click();
    await page.locator('#editCategorySelect').selectOption('303');
    await page.locator('#saveCategoryEdit').click();
    await expectTotals(transactions);
    await closeDetails();
    const edited = JSON.parse(await download('#exportEditedJson'));
    assert.equal(String(edited.transactions.find(row => row.transactionId === 'missing-category').categoryId), '303');
    await openReport('quality');
    await page.locator('#qualityRowsScope').selectOption('all');
    await page.locator('#qualityRowSearch').fill(`TRACE-${index}`);
    await page.locator(`#qualityEditRows button[data-edit-row="tx-${index}"]`).click();
    await page.locator('#undoCategoryEdit').click();
    await page.locator('#editCategorySelect').selectOption('__create__');
    await page.locator('#newCategoryName').fill('خرید خانه آزمایشی');
    await page.locator('#newCategoryColor').fill('#cc7733');
    await page.locator('#saveCategoryEdit').click();
    await expectTotals(transactions);
    await closeDetails();
    const bundle = JSON.parse(await download('#exportEditedJson'));
    assert.equal(bundle.transactions.length, transactions.length, 'edited export must include every accepted row');
    const custom = bundle.categories.find(category => category.name === 'خرید خانه آزمایشی');
    assert.ok(custom);
    assert.equal(String(bundle.transactions.find(row => row.transactionId === 'missing-category').categoryId), String(custom.id));
    await page.locator('#quickFiles').setInputFiles(jsonFile('analytics-edited-bundle.json', bundle));
    await imported('analytics-edited-bundle.json');
    await expectTotals(transactions);
    await page.locator('#categoryId').selectOption(String(custom.id));
    await page.locator('#applyFilters').click();
    await expectTotals(subset(['missing-category']));
    await reset();
    await importFixture();
  });

  await t.test('failed replacement preserves corrections and undo-all restores original classifications', async () => {
    await openReport('quality');
    await page.locator('#qualityRowsScope').selectOption('issues');
    await page.locator('#qualityRowSearch').fill('');
    const index = transactions.findIndex(row => row.transactionId === 'missing-category');
    await page.locator(`#qualityEditRows button[data-edit-row="tx-${index}"]`).click();
    await page.locator('#editCategorySelect').selectOption('303');
    await page.locator('#saveCategoryEdit').click();
    await closeDetails();
    await page.locator('#quickFiles').setInputFiles({ name: 'invalid-replacement.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
    await page.locator('#notice').waitFor({ state: 'visible' });
    await expectTotals(transactions);
    assert.equal(numeric(await page.locator('#editsCount').textContent()), 1);
    const bundle = JSON.parse(await download('#exportEditedJson'));
    assert.equal(String(bundle.transactions.find(row => row.transactionId === 'missing-category').categoryId), '303');
    await page.locator('#undoAllCategoryEdits').click();
    assert.equal(await page.locator('#editsBar').isVisible(), false);
    await page.locator('#qualityUncategorized').click();
    await expectDrilldown(subset(['missing-category', 'bank-uncategorized']));
    await reset();
  });

  await t.test('category-only imports preserve local edits and custom definitions while refreshing labels', async () => {
    await openReport('quality');
    await page.locator('#qualityRowsScope').selectOption('issues');
    await page.locator('#qualityRowSearch').fill('');
    const unresolvedIndex = transactions.findIndex(row => row.transactionId === 'unresolved-category');
    await page.locator(`#qualityEditRows button[data-edit-row="tx-${unresolvedIndex}"]`).click();
    await page.locator('#editCategorySelect').selectOption('101');
    await page.locator('#saveCategoryEdit').click();
    await closeDetails();
    const missingIndex = transactions.findIndex(row => row.transactionId === 'missing-category');
    await page.locator(`#qualityEditRows button[data-edit-row="tx-${missingIndex}"]`).click();
    await page.locator('#editCategorySelect').selectOption('__create__');
    await page.locator('#newCategoryName').fill('دسته محلی محفوظ');
    await page.locator('#saveCategoryEdit').click();
    await closeDetails();
    const dictionary = { categories: [...categories.resultSet.innerResponse.map(item => ({ ...item,
      name: item.id === 303 ? 'اجاره بازنام‌گذاری‌شده' : item.name })), { id: 999, name: 'دسته تعریف‌شده جدید', color: '#3b8bba' }] };
    await page.locator('#quickFiles').setInputFiles(jsonFile('analytics-categories-updated.json', dictionary));
    await imported('analytics-categories-updated.json');
    await expectTotals(transactions);
    assert.equal(numeric(await page.locator('#editsCount').textContent()), 2);
    assert.equal(await page.locator('#categoryId option[value="999"]').textContent(), 'دسته تعریف‌شده جدید');
    assert.equal(await page.locator('#categoryId option[value="303"]').textContent(), 'اجاره بازنام‌گذاری‌شده');
    const bundle = JSON.parse(await download('#exportEditedJson'));
    const custom = bundle.categories.find(item => item.name === 'دسته محلی محفوظ');
    assert.ok(custom);
    assert.equal(String(bundle.transactions.find(row => row.transactionId === 'missing-category').categoryId), String(custom.id));
    assert.equal(String(bundle.transactions.find(row => row.transactionId === 'unresolved-category').categoryId), '101');
    assert.equal(bundle.categories.find(item => String(item.id) === '999').name, 'دسته تعریف‌شده جدید');
    await page.locator('#undoAllCategoryEdits').click();
    await importFixture();
  });

  await t.test('untrusted party names remain text and all reports work in light/dark on mobile', async () => {
    await openReport('counterparties');
    await page.locator('#partySearch').fill('img');
    assert.match(await page.locator('#counterpartyBody').textContent(), /<img/);
    assert.equal(await page.locator('#advancedReports img').count(), 0);
    assert.equal(await page.evaluate(() => window.__reportInjected), undefined);
    await page.locator('#partySearch').fill('');
    await page.screenshot({ path: path.join(output, 'reports-light-desktop.png'), fullPage: true });
    await page.locator('#themeToggle').click();
    await expectTotals(transactions);
    await page.screenshot({ path: path.join(output, 'reports-dark-desktop.png'), fullPage: true });
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#advancedReports').getBoundingClientRect().top + window.scrollY));
    await page.screenshot({ path: path.join(output, 'reports-overview-dark.png') });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal page overflow at ${width}px`);
      await page.screenshot({ path: path.join(output, `reports-dark-mobile-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await t.test('printing opens every report and all transaction rows then restores interactive state', async () => {
    const before = await page.locator('#advancedReports details').evaluateAll(nodes => nodes.map(node => node.open));
    const partyRowsBefore = await page.locator('#counterpartyBody tr').count();
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#transactionsBody tr').count(), transactions.length);
    assert.ok((await page.locator('#advancedReports details').evaluateAll(nodes => nodes.map(node => node.open))).every(Boolean));
    assert.ok(await page.locator('#counterpartyBody tr').count() > partyRowsBefore, 'print includes all counterparties beyond the first page');
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(output, 'reports-print.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.deepEqual(await page.locator('#advancedReports details').evaluateAll(nodes => nodes.map(node => node.open)), before);
    assert.equal(await page.locator('#counterpartyBody tr').count(), partyRowsBefore);
  });

  await t.test('clearing the page wipes advanced report contents and all category editor fields', async () => {
    await page.locator('[data-open="importDialog"]').first().click();
    await page.locator('#clearData').click();
    await page.locator('#welcome').waitFor({ state: 'visible' });
    for (const id of ['comparisonMetrics', 'comparisonCategories', 'counterpartyBody', 'recurringList', 'calendarGrid', 'reviewList', 'categoryQualitySummary', 'qualityCategoryBody', 'qualityEditRows', 'categoryEditStatus']) {
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must not retain imported data`);
    }
    for (const id of ['comparisonStart', 'comparisonEnd', 'comparisonPreviousStart', 'comparisonPreviousEnd', 'partySearch', 'qualityRowSearch', 'newCategoryName']) {
      assert.equal(await page.locator(`#${id}`).inputValue(), '', `${id} must be cleared`);
    }
    assert.equal(await page.locator('#editCategorySelect option').count(), 0);
    assert.equal(await page.locator('#calendarMonth option').count(), 0);
    await importFixture();
  });

  await t.test('offline reports never transmit or persist imported information', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    assert.deepEqual(logs, []);
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
  });
});
