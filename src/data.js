/* BAAM Viewer data engine. All monetary calculations use integer rials. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BaamData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIME_ZONE = 'Asia/Tehran';
  const DAY_MS = 86400000;
  const UNKNOWN_CATEGORY = '__uncategorized__';
  const gregorian = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const persian = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const persianUTC = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const monthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const issuesLimit = 100;

  function toAsciiDigits(value) {
    return String(value ?? '').replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));
  }

  function toPersianDigits(value) {
    return String(value ?? '').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  }

  function normalizeSearch(value) {
    return toAsciiDigits(value).normalize('NFKC').toLowerCase()
      .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function text(value, fallback = '') {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : fallback;
  }

  function parts(formatter, timestamp) {
    return Object.fromEntries(formatter.formatToParts(timestamp)
      .filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }

  function dayKey(timestamp) {
    const p = parts(gregorian, timestamp);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function parseISODate(value) {
    const s = toAsciiDigits(value).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!match) throw new Error('تاریخ میلادی باید به شکل YYYY-MM-DD باشد.');
    const [, y, m, d] = match.map(Number);
    const stamp = Date.UTC(y, m - 1, d, 12);
    const check = new Date(stamp);
    if (y < 100 || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      throw new Error('تاریخ معتبر نیست.');
    }
    return s;
  }

  function isoToJalali(value) {
    const iso = parseISODate(value);
    const p = parts(persianUTC, new Date(`${iso}T12:00:00Z`));
    return `${p.year.padStart(4, '0')}/${p.month}/${p.day}`;
  }

  // Search the Intl Persian calendar rather than maintaining a second leap-year
  // algorithm. The returned Gregorian date is round-trip validated, including Esfand 30.
  function jalaliToISO(value) {
    const input = toAsciiDigits(value).trim();
    if (!input) return '';
    const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(input);
    if (!match) throw new Error('تاریخ شمسی را به شکل ۱۴۰۵/۰۸/۰۱ وارد کنید.');
    const [year, month, day] = match.slice(1).map(Number);
    if (year < 1 || year > 3177 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error('تاریخ شمسی معتبر نیست.');
    }
    const target = year * 10000 + month * 100 + day;
    let low = Math.floor(Date.UTC(year + 620, 0, 1) / DAY_MS);
    let high = Math.floor(Date.UTC(year + 623, 0, 1) / DAY_MS);
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const p = parts(persianUTC, mid * DAY_MS + DAY_MS / 2);
      const actual = Number(p.year) * 10000 + Number(p.month) * 100 + Number(p.day);
      if (actual === target) return new Date(mid * DAY_MS + DAY_MS / 2).toISOString().slice(0, 10);
      if (actual < target) low = mid + 1;
      else high = mid - 1;
    }
    throw new Error('این روز در تقویم شمسی وجود ندارد.');
  }

  function parseTimestamp(value) {
    const input = toAsciiDigits(value).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/i.exec(input);
    if (!match) throw new Error('زمان تراکنش معتبر نیست.');
    const [, y, m, d, h, min, sec, fraction, zone] = match;
    parseISODate(`${y}-${m}-${d}`);
    if (+h > 23 || +min > 59 || +sec > 59) throw new Error('ساعت تراکنش معتبر نیست.');
    if (zone) {
      if (zone !== 'Z' && zone !== 'z') {
        const offset = zone.replace(':', '');
        if (+offset.slice(1, 3) > 23 || +offset.slice(3, 5) > 59) throw new Error('منطقه زمانی معتبر نیست.');
      }
      const stamp = Date.parse(`${y}-${m}-${d}T${h}:${min}:${sec}${fraction || ''}${zone}`);
      if (!Number.isFinite(stamp)) throw new Error('زمان تراکنش معتبر نیست.');
      return stamp;
    }
    // BAAM realDateTime can be a local wall-clock value. Interpret it explicitly
    // in Tehran, independent of the machine timezone (including historic DST).
    const wall = Date.UTC(+y, +m - 1, +d, +h, +min, +sec, fraction ? Number(fraction) * 1000 : 0);
    let stamp = wall;
    for (let i = 0; i < 3; i++) {
      const p = parts(gregorian, stamp);
      const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      stamp += wall - represented - (fraction ? Number(fraction) * 1000 : 0);
    }
    const p = parts(gregorian, stamp);
    if (+p.year !== +y || +p.month !== +m || +p.day !== +d || +p.hour !== +h || +p.minute !== +min || +p.second !== +sec) {
      throw new Error('ساعت محلی تراکنش در منطقه زمانی تهران معتبر نیست.');
    }
    return stamp;
  }

  function parseAmount(value, options = {}) {
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error('مبلغ معتبر نیست.');
    let normalized = toAsciiDigits(value).trim();
    // Grouping separators are permitted only in correctly grouped whole amounts.
    if (/[,٬]/.test(normalized)) {
      if (!/^-?\d{1,3}(?:[,٬]\d{3})+$/.test(normalized)) throw new Error('جداکننده مبلغ معتبر نیست.');
      normalized = normalized.replace(/[,٬]/g, '');
    }
    if (!/^-?\d+$/.test(normalized)) throw new Error('مبلغ باید عدد صحیح ریال باشد.');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount)) throw new Error('مبلغ از محدوده محاسبه دقیق خارج است.');
    if (!options.signed && amount < 0) throw new Error('مبلغ تراکنش نباید منفی باشد.');
    if (options.positive && amount === 0) throw new Error('مبلغ تراکنش باید بیشتر از صفر باشد.');
    return amount;
  }

  function safeAdd(a, b) {
    const result = a + b;
    if (!Number.isSafeInteger(result)) throw new Error('مجموع مبالغ از محدوده محاسبه دقیق خارج است؛ بازه کوچک‌تری انتخاب کنید.');
    return result;
  }

  function parseJSON(input) {
    if (typeof input !== 'string') return input;
    try { return JSON.parse(input.replace(/^\uFEFF/, '')); }
    catch { throw new Error('ساختار JSON فایل معتبر نیست.'); }
  }

  function extractArray(input, type) {
    const data = parseJSON(input);
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') throw new Error('ساختار فایل پشتیبانی نمی‌شود.');
    const keys = type === 'transactions' ? ['transactions', 'content', 'items'] : ['categories', 'content', 'items'];
    const candidates = [data, data.resultSet?.innerResponse, data.resultSet, data.data, data.result];
    for (const item of candidates) {
      if (Array.isArray(item)) return item;
      if (item && typeof item === 'object') {
        for (const key of keys) if (Array.isArray(item[key])) return item[key];
      }
    }
    throw new Error(type === 'transactions' ? 'فهرست تراکنش‌ها در فایل پیدا نشد.' : 'فهرست دسته‌بندی‌ها در فایل پیدا نشد.');
  }

  function diagnostics(inputCount) {
    return { inputCount, acceptedCount: 0, invalidCount: 0, duplicateCount: 0, conflictCount: 0, warningCount: 0, issues: [] };
  }

  function issue(report, index, reason) {
    if (report.issues.length < issuesLimit) report.issues.push({ index: index + 1, reason });
  }

  function parseCategories(input) {
    const items = extractArray(input, 'categories');
    const report = diagnostics(items.length);
    const byId = new Map();
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || !text(item.id) || !text(item.name)) {
        report.invalidCount++;
        issue(report, index, 'دسته‌بندی باید شناسه و نام داشته باشد.');
        return;
      }
      const id = text(item.id);
      if (byId.has(id)) { report.duplicateCount++; return; }
      byId.set(id, { id, name: text(item.name), color: /^#[\da-f]{6}$/i.test(text(item.color)) ? text(item.color) : '#73879b' });
    });
    const categories = [...byId.values()];
    report.acceptedCount = categories.length;
    return { categories, diagnostics: report };
  }

  function categoryMap(categories) {
    return new Map((Array.isArray(categories) ? categories : categories?.categories || []).map(c => [String(c.id), c]));
  }

  function withCategory(row, categoryById) {
    const category = categoryById.get(row.categoryId);
    return {
      ...row,
      category: category?.name || text(row.raw?.categoryName) || (row.categoryId === UNKNOWN_CATEGORY ? 'بدون دسته‌بندی' : `دسته ${row.categoryId}`),
      color: category?.color || '#73879b'
    };
  }

  function applyCategories(rows, categories) {
    const byId = categoryMap(categories);
    return rows.map(row => withCategory(row, byId));
  }

  function transactionIdentity(raw) {
    if ((typeof raw.transactionId === 'number' && Number.isSafeInteger(raw.transactionId)) ||
        (typeof raw.transactionId === 'string' && raw.transactionId.trim())) return `id:${text(raw.transactionId)}`;
    // BAAM can reuse origKey across distinct transaction IDs. It is only a fallback.
    if (typeof raw.origKey === 'string' && raw.origKey.trim()) return `orig:${raw.origKey.trim()}`;
    return null;
  }

  function parseTransactions(input, categories = []) {
    const items = extractArray(input, 'transactions');
    const report = diagnostics(items.length);
    const byCategory = categoryMap(categories);
    const identities = new Map();
    const rows = [];
    items.forEach((raw, index) => {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ردیف تراکنش معتبر نیست.');
        const direction = text(raw.creditDebit).toUpperCase();
        if (direction !== 'CREDIT' && direction !== 'DEBIT') throw new Error('نوع واریز یا برداشت مشخص نیست.');
        const amount = parseAmount(raw.amount, { positive: true });
        const timestamp = parseTimestamp(raw.transactionDateTime || raw.realDateTime || raw.channelDateTime);
        let balance = null;
        if (raw.balance !== null && raw.balance !== undefined && raw.balance !== '') {
          try { balance = parseAmount(raw.balance, { signed: true }); }
          catch { report.warningCount++; issue(report, index, 'مانده نامعتبر بود؛ تراکنش بدون مانده پذیرفته شد.'); }
        }
        const identity = transactionIdentity(raw);
        const fingerprint = JSON.stringify([timestamp, direction, amount, balance, text(raw.transactionTraceNumber)]);
        const previous = identity ? identities.get(identity) : null;
        if (previous?.has(fingerprint)) { report.duplicateCount++; return; }
        if (previous?.size) {
          report.conflictCount++;
          issue(report, index, 'شناسه تکراری با اطلاعات مالی متفاوت؛ هر دو ردیف برای بررسی حفظ شدند.');
        }
        if (identity) identities.set(identity, new Set([...(previous || []), fingerprint]));
        const p = parts(persian, timestamp);
        const gp = parts(gregorian, timestamp);
        const extra = raw.supplementaryInfo && typeof raw.supplementaryInfo === 'object' ? raw.supplementaryInfo : {};
        const row = {
          id: `tx-${index}`, sourceIndex: index, timestamp,
          day: `${gp.year}-${gp.month}-${gp.day}`,
          dateLabel: toPersianDigits(`${p.year}/${p.month}/${p.day}`),
          month: `${p.year.padStart(4, '0')}-${p.month}`,
          monthLabel: `${monthNames[Number(p.month) - 1]} ${toPersianDigits(p.year)}`,
          timeLabel: toPersianDigits(`${gp.hour}:${gp.minute}:${gp.second}`),
          direction, amount, signedAmount: direction === 'CREDIT' ? amount : -amount, balance,
          categoryId: raw.categoryId === null || raw.categoryId === undefined || raw.categoryId === '' ? UNKNOWN_CATEGORY : String(raw.categoryId),
          method: text(extra.supplementaryTypeName) || text(extra.supplementaryTransactionType) || text(raw.transactionDescription) || 'نامشخص',
          description: text(raw.transactionDescription) || 'بدون شرح',
          trace: text(raw.transactionTraceNumber) || text(extra.referenceNumber),
          counterparty: text(extra.counterPartyFullName) || text(extra.merchantName) || text(extra.counterPartyAccountNumber) || text(extra.counterPartyCardNumber) || text(extra.counterPartyIban),
          comment: text(raw.comment), raw
        };
        rows.push(withCategory(row, byCategory));
      } catch (error) {
        report.invalidCount++;
        issue(report, index, error.message);
      }
    });
    // A stable tie preserves source order. Same-second balances remain observations,
    // not a claim that an opening/closing balance has been reconciled.
    rows.sort((a, b) => a.timestamp - b.timestamp || a.sourceIndex - b.sourceIndex);
    report.acceptedCount = rows.length;
    return { rows, diagnostics: report };
  }

  function filterTransactions(rows, filters = {}) {
    const query = normalizeSearch(filters.search);
    const tokens = query.split(' ').filter(Boolean);
    const start = filters.startDate ? parseISODate(filters.startDate) : '';
    const end = filters.endDate ? parseISODate(filters.endDate) : '';
    if (start && end && start > end) throw new Error('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    const hasMin = filters.minAmount !== '' && filters.minAmount !== null && filters.minAmount !== undefined;
    const hasMax = filters.maxAmount !== '' && filters.maxAmount !== null && filters.maxAmount !== undefined;
    const min = hasMin ? parseAmount(filters.minAmount) : null;
    const max = hasMax ? parseAmount(filters.maxAmount) : null;
    if (min !== null && max !== null && min > max) throw new Error('کمترین مبلغ باید از بیشترین مبلغ کمتر باشد.');
    return rows.filter(row => {
      if (filters.direction && filters.direction !== 'all' && row.direction !== filters.direction) return false;
      if (filters.categoryId && filters.categoryId !== 'all' && row.categoryId !== String(filters.categoryId)) return false;
      if (filters.method && filters.method !== 'all' && row.method !== filters.method) return false;
      if (start && row.day < start || end && row.day > end) return false;
      if (min !== null && row.amount < min || max !== null && row.amount > max) return false;
      if (!tokens.length) return true;
      const extra = row.raw.supplementaryInfo || {};
      const haystack = normalizeSearch([row.description, row.category, row.method, row.trace, row.counterparty, row.comment,
        row.dateLabel, row.day, row.amount, row.raw.transactionId, row.raw.additionalData1, row.raw.additionalData2,
        ...Object.values(extra).filter(v => typeof v === 'string' || typeof v === 'number')].join(' '));
      return tokens.every(token => haystack.includes(token));
    });
  }

  function emptyBucket(key, label, extra = {}) {
    return { key, label, income: 0, expense: 0, net: 0, count: 0, incomeCount: 0, expenseCount: 0,
      balance: null, balanceAt: null, balanceAmbiguous: false, ...extra };
  }

  function accumulate(bucket, row) {
    const field = row.direction === 'CREDIT' ? 'income' : 'expense';
    bucket[field] = safeAdd(bucket[field], row.amount);
    bucket[`${field}Count`]++;
    bucket.net = safeAdd(bucket.income, -bucket.expense);
    bucket.count++;
    if (row.balance !== null) {
      bucket.balanceAmbiguous = bucket.balanceAt === row.timestamp
        ? bucket.balanceAmbiguous || bucket.balance !== row.balance : false;
      bucket.balance = row.balance;
      bucket.balanceAt = row.timestamp;
    }
  }

  function summarize(inputRows) {
    const rows = [...inputRows].sort((a, b) => a.timestamp - b.timestamp || a.sourceIndex - b.sourceIndex);
    const summary = { ...emptyBucket('all', 'همه تراکنش‌ها'), turnover: 0, firstDate: rows[0]?.day || null,
      lastDate: rows.at(-1)?.day || null, activeDays: 0, calendarDays: 0, averageExpense: 0,
      averageIncome: 0, averageDailyExpense: 0, maxExpense: null, maxIncome: null,
      firstBalance: null, lastBalance: null, firstBalanceAt: null, lastBalanceAt: null,
      firstBalanceAmbiguous: false, lastBalanceAmbiguous: false,
      daily: [], monthly: [], categories: [], methods: [] };
    const daily = new Map(), monthly = new Map(), categories = new Map(), methods = new Map();
    for (const row of rows) {
      accumulate(summary, row);
      summary.turnover = safeAdd(summary.turnover, row.amount);
      if (row.direction === 'DEBIT' && (!summary.maxExpense || row.amount > summary.maxExpense.amount)) summary.maxExpense = row;
      if (row.direction === 'CREDIT' && (!summary.maxIncome || row.amount > summary.maxIncome.amount)) summary.maxIncome = row;
      if (row.balance !== null) {
        if (summary.firstBalance === null) { summary.firstBalance = row.balance; summary.firstBalanceAt = row.timestamp; }
        else if (summary.firstBalanceAt === row.timestamp && summary.firstBalance !== row.balance) summary.firstBalanceAmbiguous = true;
        summary.lastBalanceAmbiguous = summary.lastBalanceAt === row.timestamp
          ? summary.lastBalanceAmbiguous || summary.lastBalance !== row.balance : false;
        summary.lastBalance = row.balance;
        summary.lastBalanceAt = row.timestamp;
      }
      if (!daily.has(row.day)) daily.set(row.day, emptyBucket(row.day, row.dateLabel));
      if (!monthly.has(row.month)) monthly.set(row.month, emptyBucket(row.month, row.monthLabel));
      if (!categories.has(row.categoryId)) categories.set(row.categoryId, emptyBucket(row.categoryId, row.category,
        { id: row.categoryId, name: row.category, color: row.color }));
      if (!methods.has(row.method)) methods.set(row.method, emptyBucket(row.method, row.method, { name: row.method }));
      accumulate(daily.get(row.day), row);
      accumulate(monthly.get(row.month), row);
      accumulate(categories.get(row.categoryId), row);
      accumulate(methods.get(row.method), row);
    }
    summary.activeDays = daily.size;
    summary.calendarDays = rows.length ? Math.round((Date.parse(`${summary.lastDate}T12:00:00Z`) - Date.parse(`${summary.firstDate}T12:00:00Z`)) / DAY_MS) + 1 : 0;
    summary.averageExpense = summary.expenseCount ? summary.expense / summary.expenseCount : 0;
    summary.averageIncome = summary.incomeCount ? summary.income / summary.incomeCount : 0;
    summary.averageDailyExpense = summary.calendarDays ? summary.expense / summary.calendarDays : 0;
    // Insert zero-flow days so an ordinary category-axis chart has truthful spacing.
    // Missing balances remain null; no account balance is inferred from filtered flows.
    if (summary.calendarDays > 36600) throw new Error('بازه زمانی برای گزارش روزانه بیش از صد سال است؛ بازه کوچک‌تری انتخاب کنید.');
    if (rows.length) {
      const start = Date.parse(`${summary.firstDate}T12:00:00Z`);
      for (let i = 0; i < summary.calendarDays; i++) {
        const key = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
        if (!daily.has(key)) daily.set(key, emptyBucket(key, toPersianDigits(isoToJalali(key))));
      }
      let [year, month] = rows[0].month.split('-').map(Number);
      const endMonth = rows.at(-1).month;
      while (true) {
        const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
        if (!monthly.has(key)) monthly.set(key, emptyBucket(key, `${monthNames[month - 1]} ${toPersianDigits(year)}`));
        if (key >= endMonth) break;
        if (++month > 12) { month = 1; year++; }
      }
    }
    summary.daily = [...daily.values()].sort((a, b) => a.key.localeCompare(b.key));
    summary.monthly = [...monthly.values()].sort((a, b) => a.key.localeCompare(b.key));
    summary.categories = [...categories.values()].sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
    summary.methods = [...methods.values()].sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
    return summary;
  }

  return Object.freeze({ TIME_ZONE, UNKNOWN_CATEGORY, toAsciiDigits, toPersianDigits, normalizeSearch,
    dayKey, parseISODate, isoToJalali, jalaliToISO, parseTimestamp, parseAmount, safeAdd,
    parseCategories, parseTransactions, applyCategories, filterTransactions, summarize });
});
