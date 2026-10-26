/* Pure reporting functions. Input rows are normalized by BaamData and never mutated. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.BaamAnalytics = factory(root.BaamData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const DAY = 86400000;
  const monthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const number = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
  const safeText = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

  function dayStamp(day) { return Date.parse(`${D.parseISODate(day)}T12:00:00Z`); }
  function shiftDay(day, offset) {
    if (!Number.isSafeInteger(offset)) throw new Error('فاصله روزها معتبر نیست.');
    const shifted = new Date(dayStamp(day) + offset * DAY);
    if (!Number.isFinite(shifted.getTime()) || shifted.getUTCFullYear() < 100 || shifted.getUTCFullYear() > 9999) {
      throw new Error('تاریخ محاسبه‌شده خارج از محدوده پشتیبانی است.');
    }
    return shifted.toISOString().slice(0, 10);
  }
  function daysBetween(start, end) {
    const days = Math.round((dayStamp(end) - dayStamp(start)) / DAY) + 1;
    if (days < 1) throw new Error('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    return days;
  }
  function emptyTotals() { return { count: 0, income: 0, expense: 0, net: 0, rowIds: [] }; }
  function addRow(totals, row) {
    const direction = row.direction === 'CREDIT' ? 'income' : 'expense';
    totals[direction] = D.safeAdd(totals[direction], row.amount);
    totals.net = D.safeAdd(totals.income, -totals.expense);
    totals.count++;
    totals.rowIds.push(row.id);
  }
  function change(current, previous) {
    return { value: D.safeAdd(current, -previous), percent: previous === 0 ? null : (current - previous) / Math.abs(previous) };
  }

  function comparePeriods(rows, currentRange, previousRange) {
    const current = { ...emptyTotals(), range: { start: D.parseISODate(currentRange.start), end: D.parseISODate(currentRange.end) } };
    const previous = { ...emptyTotals(), range: { start: D.parseISODate(previousRange.start), end: D.parseISODate(previousRange.end) } };
    const days = daysBetween(current.range.start, current.range.end);
    if (days !== daysBetween(previous.range.start, previous.range.end)) throw new Error('دو بازه مقایسه باید تعداد روز برابر داشته باشند.');
    if (current.range.start <= previous.range.end && previous.range.start <= current.range.end) throw new Error('دو بازه مقایسه نباید هم‌پوشانی داشته باشند.');
    const byCategory = new Map();
    for (const row of rows) {
      const period = row.day >= current.range.start && row.day <= current.range.end ? 'current'
        : row.day >= previous.range.start && row.day <= previous.range.end ? 'previous' : null;
      if (!period) continue;
      addRow(period === 'current' ? current : previous, row);
      if (!byCategory.has(row.categoryId)) byCategory.set(row.categoryId, {
        id: row.categoryId, name: row.category, color: row.color, current: emptyTotals(), previous: emptyTotals()
      });
      addRow(byCategory.get(row.categoryId)[period], row);
    }
    const changes = Object.fromEntries(['income', 'expense', 'net', 'count'].map(key => [key, change(current[key], previous[key])]));
    const categories = [...byCategory.values()].map(group => ({ ...group,
      incomeChange: change(group.current.income, group.previous.income), expenseChange: change(group.current.expense, group.previous.expense)
    })).sort((a, b) => b.current.expense - a.current.expense || b.current.income - a.current.income || a.name.localeCompare(b.name, 'fa'));
    return { current, previous, days, changes, categories };
  }

  function meaningful(value) {
    const candidate = safeText(value);
    return candidate && !/^(?:null|undefined|unknown|نامشخص|-|0+)$/i.test(candidate) ? candidate : '';
  }
  function identifier(value) {
    const normalized = D.toAsciiDigits(meaningful(value)).replace(/[\s\u200c\u200e\u200f-]/g, '').toUpperCase();
    return /^0+$/.test(normalized) || /[*•●]|X{2,}/.test(normalized) ? '' : normalized;
  }
  function partyIdentity(row) {
    const extra = row.raw?.supplementaryInfo || {};
    const personName = meaningful(extra.counterPartyFullName);
    const merchantName = meaningful(extra.merchantName);
    const candidates = [
      ['account', extra.counterPartyAccountNumber], ['card', extra.counterPartyCardNumber], ['iban', extra.counterPartyIban]
    ];
    for (const [kind, value] of candidates) {
      const code = identifier(value);
      if (code) {
        const bankCode = kind === 'account' ? identifier(extra.counterPartyBankCode) : '';
        const bankName = kind === 'account' ? meaningful(extra.counterPartyBankName) : '';
        const bankKey = bankCode ? `code:${bankCode}` : bankName ? `name:${D.normalizeSearch(bankName)}` : '';
        return { key: bankKey ? `account:${JSON.stringify([bankKey, code])}` : `${kind}:${code}`,
          label: personName || merchantName || code, identifier: code, kind, confidence: 'identifier', bankCode, bankName };
      }
    }
    // Terminal numbers can be reused by different acquiring/payment networks.
    const merchant = identifier(extra.merchantCode), terminal = identifier(extra.terminalCode);
    const provider = identifier(extra.pspCode) || D.normalizeSearch(extra.pspName);
    if (merchant || terminal) {
      const code = merchant || terminal;
      return { key: `merchant:${provider}:${merchant ? 'merchant' : 'terminal'}:${code}`,
        label: merchantName || personName || `پذیرنده ${code}`, identifier: code, kind: 'merchant', confidence: 'identifier' };
    }
    const name = personName || merchantName;
    if (name) return { key: `name:${D.normalizeSearch(name)}`, label: name, identifier: '', kind: 'name', confidence: 'name' };
    return null;
  }
  function counterparties(rows) {
    const byParty = new Map();
    let unknownCount = 0, unknownAmount = 0;
    for (const row of rows) {
      const identity = partyIdentity(row);
      if (!identity) { unknownCount++; unknownAmount = D.safeAdd(unknownAmount, row.amount); continue; }
      if (!byParty.has(identity.key)) byParty.set(identity.key, { ...emptyTotals(), ...identity, lastTimestamp: null, lastDate: null });
      const group = byParty.get(identity.key);
      addRow(group, row);
      if (identity.label !== identity.identifier && (group.label === group.identifier || group.lastTimestamp === null || row.timestamp >= group.lastTimestamp)) group.label = identity.label;
      if (group.lastTimestamp === null || row.timestamp > group.lastTimestamp) {
        group.lastTimestamp = row.timestamp; group.lastDate = row.day;
      }
    }
    const groups = [...byParty.values()].sort((a, b) => b.expense - a.expense || b.income - a.income || b.count - a.count || a.key.localeCompare(b.key));
    return { groups, unknownCount, unknownAmount, knownCount: rows.length - unknownCount };
  }

  const cadences = [
    { name: 'هفتگی', min: 5, max: 9 },
    { name: 'دو‌هفته‌ای', min: 12, max: 16 },
    { name: 'ماهانه', min: 25, max: 35 }
  ];
  function lowerMedian(sortedValues) { return sortedValues[Math.floor((sortedValues.length - 1) / 2)]; }
  function recurring(rows) {
    const candidates = new Map();
    for (const row of rows) {
      if (row.direction !== 'DEBIT') continue;
      const party = partyIdentity(row);
      // A common name alone does not establish that these are the same recipient.
      if (!party || party.confidence !== 'identifier') continue;
      const key = JSON.stringify([party.key, row.method]);
      if (!candidates.has(key)) candidates.set(key, { party, method: row.method, rows: [] });
      candidates.get(key).rows.push(row);
    }
    const result = [];
    for (const { party, method, rows: groupRows } of candidates.values()) {
      const amountSorted = [...groupRows].sort((a, b) => a.amount - b.amount || a.timestamp - b.timestamp);
      const clusters = [];
      for (const row of amountSorted) {
        const cluster = clusters.at(-1);
        if (!cluster || BigInt(row.amount) * 100n > BigInt(cluster[0].amount) * 110n) clusters.push([row]);
        else cluster.push(row);
      }
      for (const cluster of clusters) {
        if (cluster.length < 3) continue;
        const chronological = [...cluster].sort((a, b) => a.timestamp - b.timestamp || a.sourceIndex - b.sourceIndex);
        const dayCounts = new Map();
        chronological.forEach(row => dayCounts.set(row.day, (dayCounts.get(row.day) || 0) + 1));
        for (const cadence of cadences) {
          let run = [];
          const finishRun = () => {
            if (run.length < 3) return;
            const amounts = run.map(row => row.amount).sort((a, b) => a - b);
            const intervals = run.slice(1).map((row, index) => daysBetween(run[index].day, row.day) - 1).sort((a, b) => a - b);
            const intervalDays = lowerMedian(intervals);
            const lastDate = run.at(-1).day;
            result.push({ key: `recurring:${party.key}:${method}:${run[0].id}`, label: party.label, partyKey: party.key, method,
              rowIds: run.map(row => row.id), count: run.length, amount: lowerMedian(amounts), amountMin: amounts[0], amountMax: amounts.at(-1),
              total: run.reduce((sum, row) => D.safeAdd(sum, row.amount), 0), intervalDays, cadence: cadence.name, lastDate,
              nextDate: shiftDay(lastDate, intervalDays),
              reason: `${number.format(run.length)} برداشت از یک طرف حساب و روش یکسان، با اختلاف مبلغ حداکثر ۱۰٪ و فاصله ${number.format(cadence.min)} تا ${number.format(cadence.max)} روز؛ الگوی ${cadence.name} احتمالی. تاریخ بعدی صرفاً برآورد الگو است.` });
          };
          for (const row of chronological) {
            // Multiple same-day payments are too ambiguous to call a recurring bill.
            if (dayCounts.get(row.day) > 1) { finishRun(); run = []; continue; }
            const gap = run.length ? daysBetween(run.at(-1).day, row.day) - 1 : null;
            if (gap !== null && (gap < cadence.min || gap > cadence.max)) { finishRun(); run = []; }
            run.push(row);
          }
          finishRun();
        }
      }
    }
    return result.sort((a, b) => b.total - a.total || b.count - a.count || a.key.localeCompare(b.key));
  }

  function stableTransactionIdentity(row) {
    const raw = row.raw || {};
    if ((typeof raw.transactionId === 'number' && Number.isSafeInteger(raw.transactionId)) ||
        (typeof raw.transactionId === 'string' && raw.transactionId.trim())) return `id:${safeText(raw.transactionId)}`;
    return meaningful(raw.origKey) ? `orig:${meaningful(raw.origKey)}` : null;
  }
  function reviewTransactions(rows) {
    const byBaseline = new Map(), byPayment = new Map(), byIdentity = new Map();
    for (const row of rows) {
      if (row.direction === 'DEBIT') {
        const key = JSON.stringify([row.categoryId, row.method]);
        if (!byBaseline.has(key)) byBaseline.set(key, []);
        byBaseline.get(key).push(row);
      }
      const party = partyIdentity(row), identity = stableTransactionIdentity(row);
      if (party?.confidence === 'identifier') {
        const key = JSON.stringify([party.key, row.direction, row.amount]);
        if (!byPayment.has(key)) byPayment.set(key, { party, rows: [] });
        byPayment.get(key).rows.push(row);
      }
      if (identity) {
        if (!byIdentity.has(identity)) byIdentity.set(identity, []);
        byIdentity.get(identity).push(row);
      }
    }
    const items = [];
    for (const group of byBaseline.values()) {
      if (group.length < 6) continue;
      const sorted = [...group].sort((a, b) => a.amount - b.amount || a.timestamp - b.timestamp);
      const countWithout = sorted.length - 1;
      for (let index = 0; index < sorted.length; index++) {
        const row = sorted[index];
        // Median of peers after excluding this exact row; use doubled BigInts so
        // half-rial medians and thresholds near MAX_SAFE_INTEGER remain exact.
        const peerAt = position => sorted[position >= index ? position + 1 : position].amount;
        const lower = Math.floor((countWithout - 1) / 2), upper = Math.floor(countWithout / 2);
        const medianTwice = BigInt(peerAt(lower)) + BigInt(peerAt(upper));
        if (BigInt(row.amount) * 2n <= 3n * medianTwice) continue;
        items.push({ key: `large:${row.id}`, kind: 'large', title: 'برداشت بزرگ‌تر از الگوی هم‌گروه', rowIds: [row.id], amount: row.amount, count: 1,
          reason: `مبلغ بیش از ۳ برابر میانه ${number.format(countWithout)} برداشت دیگر با دسته و روش یکسان است. این تفاوت به‌تنهایی نشانه خطا نیست.` });
      }
    }
    for (const { party, rows: group } of byPayment.values()) {
      const chronological = [...group].sort((a, b) => a.timestamp - b.timestamp || a.sourceIndex - b.sourceIndex);
      let windowRows = [], windowIdentities = new Set();
      const finishWindow = () => {
        if (windowRows.length < 2) return;
        items.push({ key: `repeat:${windowRows[0].id}`, kind: 'repeat', title: 'پرداخت یا دریافت مشابه در فاصله کوتاه',
          rowIds: windowRows.map(row => row.id), amount: windowRows.reduce((sum, row) => D.safeAdd(sum, row.amount), 0), count: windowRows.length,
          reason: `${number.format(windowRows.length)} تراکنش با طرف حساب «${party.label}»، جهت و مبلغ یکسان، با فاصله ثبت‌های متوالی حداکثر ۱۰ دقیقه وجود دارد. ممکن است پرداخت‌های مستقل باشند.` });
      };
      for (const row of chronological) {
        if (windowRows.length && row.timestamp - windowRows.at(-1).timestamp > 10 * 60000) {
          finishWindow(); windowRows = []; windowIdentities = new Set();
        }
        const identity = stableTransactionIdentity(row);
        // Conflicting records with one bank identity belong in the conflict report,
        // not an assertion that two separate payments were made.
        if (!identity || windowIdentities.has(identity)) continue;
        windowIdentities.add(identity);
        windowRows.push(row);
      }
      finishWindow();
    }
    for (const [identity, group] of byIdentity) {
      if (group.length < 2) continue;
      const fingerprints = new Set(group.map(row => JSON.stringify([row.timestamp, row.direction, row.amount, row.balance, row.trace])));
      if (fingerprints.size < 2) continue;
      items.push({ key: `conflict:${identity}`, kind: 'conflict', title: 'شناسه مشترک با اطلاعات متفاوت', rowIds: group.map(row => row.id),
        amount: group.reduce((sum, row) => D.safeAdd(sum, row.amount), 0), count: group.length,
        reason: 'چند رکورد با شناسه بانکی یکسان ولی زمان، مبلغ، جهت، مانده یا پیگیری متفاوت وجود دارد؛ همه برای بررسی حفظ شده‌اند.' });
    }
    const counts = { large: 0, repeat: 0, conflict: 0 };
    const rowIds = new Set();
    items.forEach(item => { counts[item.kind]++; item.rowIds.forEach(id => rowIds.add(id)); });
    const order = { conflict: 0, repeat: 1, large: 2 };
    items.sort((a, b) => order[a.kind] - order[b.kind] || b.amount - a.amount || a.key.localeCompare(b.key));
    return { items, counts, rowIds: [...rowIds] };
  }

  function monthKey(year, month) { return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`; }
  function calendar(rows, selectedMonth, metric = 'expense') {
    const normalized = D.toAsciiDigits(selectedMonth);
    if (!/^\d{4}-\d{2}$/.test(normalized)) throw new Error('ماه شمسی معتبر نیست.');
    const [year, month] = normalized.split('-').map(Number);
    if (month < 1 || month > 12 || year < 1 || year > 3176) throw new Error('ماه شمسی معتبر نیست.');
    if (!['expense', 'income', 'count'].includes(metric)) throw new Error('معیار تقویم معتبر نیست.');
    const previousMonth = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
    const nextMonth = month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
    const start = D.jalaliToISO(`${year}/${month}/1`);
    const nextStart = D.jalaliToISO(nextMonth.replace('-', '/') + '/1');
    const end = shiftDay(nextStart, -1), count = daysBetween(start, end);
    const byDay = new Map();
    for (const row of rows) {
      if (row.day < start || row.day > end) continue;
      if (!byDay.has(row.day)) byDay.set(row.day, emptyTotals());
      addRow(byDay.get(row.day), row);
    }
    const cells = Array.from({ length: count }, (_, index) => {
      const day = shiftDay(start, index), totals = byDay.get(day) || emptyTotals();
      return { day, jalaliDay: index + 1, dateLabel: D.toPersianDigits(D.isoToJalali(day)), weekday: (new Date(dayStamp(day)).getUTCDay() + 1) % 7,
        count: totals.count, income: totals.income, expense: totals.expense, value: totals[metric], rowIds: totals.rowIds };
    });
    return { month: normalized, title: `${monthNames[month - 1]} ${D.toPersianDigits(year)}`, previousMonth, nextMonth, start, end,
      offset: cells[0].weekday, cells, metric, max: Math.max(0, ...cells.map(cell => cell.value)), total: cells.reduce((sum, cell) => D.safeAdd(sum, cell.value), 0) };
  }

  function categoryQuality(rows, categories = []) {
    const definitions = Array.isArray(categories) ? categories : categories.categories || [];
    const known = new Map(definitions.map(category => [String(category.id), category]));
    const groups = new Map();
    const result = { count: rows.length, amount: 0, uncategorizedCount: 0, uncategorizedAmount: 0, uncategorizedRowIds: [],
      unresolvedCount: 0, unresolvedAmount: 0, unresolvedRowIds: [], categorizedCount: 0, categories: [], coverage: 0 };
    for (const row of rows) {
      const normalized = D.normalizeSearch(row.category).replace(/\s/g, '');
      const uncategorized = row.categoryId === D.UNKNOWN_CATEGORY || ['431', '443'].includes(String(row.categoryId)) ||
        /(?:بدوندستهبندی|دستهبندینشده)/.test(normalized);
      const hasName = meaningful(row.raw?.categoryName);
      const status = uncategorized ? 'uncategorized' : known.has(String(row.categoryId)) || hasName ? 'categorized' : 'unresolved';
      // The same unresolved ID can have a name on only some records. Keep those
      // statuses separate so each report row/drilldown describes all its records.
      const groupKey = `${status}:${row.categoryId}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, id: row.categoryId, name: row.category, color: row.color,
        status, count: 0, amount: 0, income: 0, expense: 0, rowIds: [] });
      const group = groups.get(groupKey);
      group.count++; group.amount = D.safeAdd(group.amount, row.amount); group.rowIds.push(row.id);
      const direction = row.direction === 'CREDIT' ? 'income' : 'expense';
      group[direction] = D.safeAdd(group[direction], row.amount);
      result.amount = D.safeAdd(result.amount, row.amount);
      if (status === 'categorized') result.categorizedCount++;
      else {
        result[`${status}Count`]++;
        result[`${status}Amount`] = D.safeAdd(result[`${status}Amount`], row.amount);
        result[`${status}RowIds`].push(row.id);
      }
    }
    result.categories = [...groups.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || String(a.id).localeCompare(String(b.id)));
    result.coverage = rows.length ? result.categorizedCount / rows.length : 0;
    return result;
  }

  return Object.freeze({ shiftDay, daysBetween, comparePeriods, partyIdentity, counterparties, recurring, reviewTransactions, calendar, categoryQuality });
});
