'use strict';

// Run with: node --test tests/browser.test.cjs
// Playwright is a test-only tool; the shipped HTML has no runtime dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
function loadPlaywright() {
  const locations = [
    process.env.BAAM_PLAYWRIGHT_PATH,
    'playwright',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  ].filter(Boolean);
  for (const location of locations) {
    try { return require(location); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Install Playwright for development, or set BAAM_PLAYWRIGHT_PATH to its package directory.');
}
function browserOptions(chromium) {
  const candidates = [
    process.env.BAAM_BROWSER_PATH,
    chromium.executablePath(),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
function numericText(text) {
  return text.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/٫/g, '.').replace(/−/g, '-').replace(/[^0-9.+-]/g, '');
}
function numeric(text) { return Number(numericText(text)); }
function jsonFile(name, value) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) };
}
function jalali(isoDay) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(`${isoDay}T12:00:00Z`));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('/');
}
function tehranDay(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function total(rows, direction) {
  return rows.filter(row => row.creditDebit === direction).reduce((sum, row) => sum + row.amount, 0);
}

const categories = { resultSet: { innerResponse: [
  { id: 101, name: 'خوراک', color: '#176c56', type: 1 },
  { id: 202, name: 'دستمزد', color: '#426bd9', type: 2 },
] } };
let runningBalance = 500000;
const transactions = Array.from({ length: 42 }, (_, index) => {
  const creditDebit = index % 3 === 0 ? 'CREDIT' : 'DEBIT';
  const amount = index === 0 ? 101 : (index + 1) * 100;
  runningBalance += creditDebit === 'CREDIT' ? amount : -amount;
  return {
    transactionId: `synthetic-${index}`,
    transactionDateTime: new Date(Date.UTC(2026, 7, 28 + index, 21, 15)).toISOString(),
    amount, balance: runningBalance, creditDebit,
    categoryId: creditDebit === 'CREDIT' ? 202 : 101,
    transactionDescription: index === 1 ? '=1+1' : `خريد آزمایشی ${index}`,
    transactionTraceNumber: `TEST-${String(index).padStart(3, '0')}`,
    comment: index === 1 ? '<img src=x onerror="window.__injected=true">' : 'داده ساختگی برای آزمون',
    supplementaryInfo: {
      supplementaryTypeName: index % 2 === 0 ? 'کارت به کارت' : 'حساب به حساب',
      counterPartyAccountNumber: `00000000${String(index).padStart(5, '0')}`,
    },
  };
});

test('single-file dashboard: imports, reports, filtering, exports, privacy and responsive layout', { timeout: 120000 }, async t => {
  const { chromium } = loadPlaywright();
  const output = path.join(__dirname, 'output');
  fs.mkdirSync(output, { recursive: true });
  // Some sandboxed Windows hosts prohibit browser downloads into the shared temp
  // directory; keep the browser's test artifacts inside this writable workspace.
  const browser = await chromium.launch({ ...browserOptions(chromium), downloadsPath: output });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'log') logs.push(message.text()); });
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) network.push(request.url());
  });
  await context.route(/^https?:/i, route => route.abort());
  t.after(async () => { await browser.close(); });

  async function expectCount(count) {
    await page.waitForFunction(expected => {
      const raw = document.querySelector('#countValue')?.textContent || '';
      const normalized = raw.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[^0-9]/g, '');
      return Number(normalized) === expected;
    }, count);
  }
  async function expectTotals(rows, factor = 1) {
    await expectCount(rows.length);
    assert.equal(numeric(await page.locator('#incomeValue').textContent()), total(rows, 'CREDIT') / factor);
    assert.equal(numeric(await page.locator('#expenseValue').textContent()), total(rows, 'DEBIT') / factor);
    assert.equal(numeric(await page.locator('#netValue').textContent()), (total(rows, 'CREDIT') - total(rows, 'DEBIT')) / factor);
    const datasets = await page.evaluate(() => {
      const chart = Chart.getChart('flowChart');
      return chart?.data.datasets.map(set => set.data.reduce((sum, item) => sum + (typeof item === 'number' ? item : item.y), 0)) || [];
    });
    assert.ok(datasets.includes(total(rows, 'CREDIT') / factor), 'income chart follows the same filters and units');
    assert.ok(datasets.includes(total(rows, 'DEBIT') / factor), 'expense chart follows the same filters and units');
  }
  async function apply() { await page.locator('#applyFilters').click(); }
  async function reset() { await page.locator('#resetFilters').click(); await expectCount(transactions.length); }
  async function imported(name) {
    await page.waitForFunction(filename => document.querySelector('#fileStatus').textContent.includes(filename), name);
  }
  async function clearData() {
    await page.locator('[data-open="importDialog"]').first().click();
    await page.locator('#clearData').click();
    await page.locator('#welcome').waitFor({ state: 'visible' });
  }
  async function downloadedCsv(buttonId) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator(buttonId).click()]);
    return fs.readFileSync(await download.path(), 'utf8');
  }
  async function importSynthetic() {
    await page.locator('#quickFiles').setInputFiles([
      jsonFile('transactions-test.json', transactions), jsonFile('categories-test.json', categories),
    ]);
    await expectCount(transactions.length);
    await page.locator('#unitSelect').selectOption('rial');
    await expectTotals(transactions);
  }

  await t.test('opens from file:// with embedded font, correct language and zero network calls', async () => {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    assert.equal(await page.locator('html').getAttribute('lang'), 'fa');
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await page.locator('#welcome').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, 'welcome-desktop.png'), fullPage: true });
    assert.equal(network.length, 0);
  });

  await t.test('imports both formats in one selection and computes exact totals', async () => {
    await importSynthetic();
    await page.locator('#dashboard').waitFor({ state: 'visible' });
    const loadedCharts = await page.evaluate(() => ['flowChart', 'categoryChart', 'netChart', 'methodChart'].map(id => !!Chart.getChart(id)));
    assert.ok(loadedCharts.every(Boolean), 'all four reports have a Chart.js instance');
    const chartTotals = await page.evaluate(() => Chart.getChart('flowChart').data.datasets.map(set => set.data.reduce((sum, item) => sum + (typeof item === 'number' ? item : item.y), 0)));
    assert.ok(chartTotals.includes(total(transactions, 'CREDIT')));
    assert.ok(chartTotals.includes(total(transactions, 'DEBIT')));
    await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
  });

  await t.test('reimport replaces records and categories may be loaded afterwards', async () => {
    await page.locator('#quickFiles').setInputFiles(jsonFile('transactions-again.json', transactions));
    await imported('transactions-again.json');
    await expectTotals(transactions);
    await page.locator('#quickFiles').setInputFiles(jsonFile('categories-again.json', categories));
    await imported('categories-again.json');
    await expectTotals(transactions);
  });

  await t.test('table pagination and numeric sorting', async () => {
    await page.locator('#pageSize').selectOption('10');
    assert.equal(await page.locator('#transactionsBody tr').count(), 10);
    const firstPage = await page.locator('#transactionsBody').textContent();
    await page.locator('#nextPage').click();
    assert.notEqual(await page.locator('#transactionsBody').textContent(), firstPage);
    await page.locator('#previousPage').click();
    assert.equal(await page.locator('#transactionsBody').textContent(), firstPage);
    await page.locator('button[data-sort="amount"]').click();
    assert.ok(await page.locator('th[aria-sort]').count() > 0, 'sort state is accessible');
  });

  await t.test('direction, category and method filters update all report totals', async () => {
    await page.locator('#direction').selectOption('DEBIT'); await apply();
    await expectTotals(transactions.filter(row => row.creditDebit === 'DEBIT'));
    await reset();
    await page.locator('#categoryId').selectOption('202'); await apply();
    await expectTotals(transactions.filter(row => row.categoryId === 202));
    await reset();
    await page.locator('#method').selectOption({ label: 'کارت به کارت' }); await apply();
    await expectTotals(transactions.filter(row => row.supplementaryInfo.supplementaryTypeName === 'کارت به کارت'));
    await reset();
  });

  await t.test('Persian search, Jalali date boundaries and amount bounds', async () => {
    await page.locator('#search').fill('خرید'); await apply();
    await expectTotals(transactions.filter(row => row.transactionDescription !== '=1+1'));
    await reset();
    await page.locator('#startDate').fill(jalali('2026-09-01'));
    await page.locator('#endDate').fill(jalali('2026-09-07')); await apply();
    await expectTotals(transactions.filter(row => tehranDay(row.transactionDateTime) >= '2026-09-01' && tehranDay(row.transactionDateTime) <= '2026-09-07'));
    await reset();
    await page.locator('#minAmount').fill('۱۰۰۰');
    await page.locator('#maxAmount').fill('۲۰۰۰'); await apply();
    await expectTotals(transactions.filter(row => row.amount >= 1000 && row.amount <= 2000));
    await reset();
  });

  await t.test('unit switch keeps a fractional toman and empty filters remain stable', async () => {
    await page.locator('#unitSelect').selectOption('toman');
    await expectTotals(transactions, 10);
    await page.locator('#unitSelect').selectOption('rial');
    await page.locator('#search').fill('no-such-transaction'); await apply();
    await expectTotals([]);
    await reset();
  });

  await t.test('malformed inputs preserve valid imported data and show a localized error', async () => {
    await page.locator('#quickFiles').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await page.locator('#notice').waitFor({ state: 'visible' });
    await expectTotals(transactions);
    assert.match(await page.locator('#notice').textContent(), /[\u0600-\u06ff]/);
    await page.locator('#startDate').fill('۱۴۰۴/۱۲/۳۰'); await apply();
    await page.locator('#filterError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#filterError').textContent(), /[\u0600-\u06ff]/);
    await expectTotals(transactions);
    await reset();
  });

  await t.test('transaction detail treats untrusted descriptions as text', async () => {
    await page.locator('#search').fill('TEST-001'); await apply();
    await expectCount(1);
    await page.locator('#transactionsBody button').first().click();
    await page.locator('#detailDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#detailContent').textContent(), /<img/);
    assert.equal(await page.locator('#detailContent img').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    await page.keyboard.press('Escape');
    await reset();
  });

  await t.test('CSV contains filtered records, a UTF-8 BOM and neutralizes spreadsheet formulas', async () => {
    await page.locator('#search').fill('TEST-001'); await apply();
    const csv = await downloadedCsv('#exportCsv');
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.ok(csv.includes("'=1+1"), 'formula prefix must be neutralized');
    assert.ok(csv.includes('TEST-001'));
    assert.ok(!csv.includes('TEST-002'));
    await reset();
  });

  await t.test('print includes all filtered rows and restores pagination afterwards', async () => {
    await reset();
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#transactionsBody tr').count(), transactions.length);
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(output, 'report-print.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('#transactionsBody tr').count(), 10);
  });

  await t.test('small mobile viewports have no horizontal document overflow', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: path.join(output, `dashboard-mobile-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `at ${width}px only table container may scroll horizontally`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await t.test('categories can load before transactions and malformed categories preserve the report', async () => {
    await clearData();
    await page.locator('#quickFiles').setInputFiles(jsonFile('categories-first.json', categories));
    await imported('categories-first.json');
    assert.equal(await page.locator('#dashboard').isVisible(), false);
    await page.locator('#quickFiles').setInputFiles(jsonFile('transactions-second.json', transactions));
    await imported('transactions-second.json');
    await expectTotals(transactions);
    assert.match(await page.locator('#categoryId').textContent(), /خوراک/);
    await page.locator('#categoriesFile').setInputFiles(jsonFile('categories-malformed.json', { categories: [{ id: 1 }] }));
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('هیچ دسته‌بندی'));
    await expectTotals(transactions);
    assert.match(await page.locator('#categoryId').textContent(), /خوراک/);
  });

  await t.test('an empty transactions array is a valid empty report', async () => {
    await page.locator('#quickFiles').setInputFiles(jsonFile('transactions-empty.json', []));
    await imported('transactions-empty.json');
    await expectTotals([]);
    assert.equal(await page.locator('#dashboard').isVisible(), true);
    assert.equal(await page.locator('#emptyResults').isVisible(), true);
    await importSynthetic();
  });

  await t.test('large safe-integer amounts preserve the final rial in UI, filters and CSV', async () => {
    const large = [{ ...transactions[0], transactionId: 'large-amount-test', creditDebit: 'DEBIT', amount: 9007199254740983, balance: -9007199254740983 }];
    await page.locator('#quickFiles').setInputFiles(jsonFile('transactions-large.json', large));
    await imported('transactions-large.json');
    await expectCount(1);
    await page.locator('#minAmount').fill('9007199254740983');
    await page.locator('#unitSelect').selectOption('toman');
    assert.equal(await page.locator('#minAmount').inputValue(), '900719925474098.3');
    assert.equal(numericText(await page.locator('#expenseValue').textContent()), '900719925474098.3');
    assert.equal(numericText(await page.locator('#netValue').textContent()), '-900719925474098.3');
    await apply();
    await expectCount(1);
    const csv = await downloadedCsv('#exportCsv');
    assert.match(csv, /,900719925474098\.3,-900719925474098\.3,/);
    const summary = await downloadedCsv('#exportSummary');
    assert.match(summary, /,0,900719925474098\.3,-900719925474098\.3(?:\r\n|$)/);
    assert.ok(!summary.includes("'-900719925474098.3"), 'negative money must be a numeric CSV cell');
    await importSynthetic();
  });

  await t.test('clearing data wipes hidden DOM and cancels pending and queued imports', async () => {
    await page.evaluate(() => {
      window.__originalFileText = File.prototype.text;
      File.prototype.text = function () {
        if (this.name === 'delayed-test.json') {
          return new Promise(resolve => { window.__releaseImport = () => window.__originalFileText.call(this).then(resolve); });
        }
        return window.__originalFileText.call(this);
      };
    });
    try {
      await page.locator('#quickFiles').setInputFiles(jsonFile('delayed-test.json', transactions));
      await page.waitForFunction(() => typeof window.__releaseImport === 'function');
      await page.locator('#quickFiles').setInputFiles(jsonFile('queued-categories.json', categories));
      await clearData();
      await page.evaluate(async () => { await window.__releaseImport(); });
      // Two animation frames allow the released File.text and queued import promise
      // continuations to settle without relying on a large arbitrary timeout.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#dashboard').isVisible(), false);
      assert.equal(await page.locator('#welcome').isVisible(), true);
      for (const id of ['incomeValue', 'expenseValue', 'netValue', 'countValue', 'datasetInfo', 'reportScope', 'balanceNote', 'detailContent', 'transactionsBody']) {
        assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must not retain private data`);
      }
      assert.equal(await page.locator('#categoryId option').count(), 1);
      assert.equal(await page.locator('#method option').count(), 1);
      assert.deepEqual(await page.evaluate(() => ['flowChart', 'categoryChart', 'netChart', 'methodChart'].map(id => !!Chart.getChart(id))), [false, false, false, false]);
      assert.equal(await page.locator('#fileStatus').textContent(), '');
    } finally {
      await page.evaluate(() => { File.prototype.text = window.__originalFileText; delete window.__originalFileText; delete window.__releaseImport; });
    }
    await importSynthetic();
  });

  const sampleTx = path.join(root, 'transactions.json');
  const sampleCat = path.join(root, 'transaction-category.json');
  await t.test('optional local samples match independently computed exact aggregates', { skip: !fs.existsSync(sampleTx) || !fs.existsSync(sampleCat) }, async () => {
    const rows = JSON.parse(fs.readFileSync(sampleTx, 'utf8'));
    await page.locator('#quickFiles').setInputFiles([sampleTx, sampleCat]);
    await expectTotals(rows);
    await page.locator('#quickFiles').setInputFiles(sampleTx);
    await expectTotals(rows);
    // Restore only synthetic records before any further screenshots.
    await importSynthetic();
  });

  await t.test('no page errors or external network requests throughout the session', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    assert.deepEqual(logs, [], 'transaction data must not be logged to the developer console');
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
  });
});
