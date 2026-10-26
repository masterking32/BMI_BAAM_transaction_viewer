/* UI controller. Imported data never leaves this document or enters persistent storage. */
(() => {
  'use strict';
  const D = window.BaamData;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1, style: 'percent' });
  const compact = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });
  const collator = new Intl.Collator('fa', { numeric: true });
  const palette = ['#4776e5', '#33a7a0', '#a18ad2', '#e6b365', '#de7e8a', '#a0adc2'];
  const state = { rows: [], categories: [], filtered: [], summary: null, allSummary: null,
    loaded: false, transactionName: '', categoryName: '', diagnostics: null, categoryDiagnostics: null,
    filters: {}, unit: 'toman', sort: 'timestamp', ascending: false, page: 1, pageSize: 25,
    charts: {}, printing: false };
  let importQueue = Promise.resolve();
  let importEpoch = 0;
  const downloadUrls = new Set();
  let searchTimer;
  const unit = () => state.unit === 'rial' ? 'ریال' : 'تومان';
  const divisor = () => state.unit === 'rial' ? 1 : 10;
  // Preserve the final rial even near Number.MAX_SAFE_INTEGER. Plot coordinates
  // may use floating point; displayed/exported money uses integer decimal digits.
  function decimalMoney(amount) {
    if (!Number.isSafeInteger(amount)) return String(amount / divisor());
    const value = BigInt(amount), negative = value < 0n, absolute = negative ? -value : value;
    const factor = BigInt(divisor()), remainder = absolute % factor;
    return `${negative ? '-' : ''}${absolute / factor}${remainder ? '.' + remainder : ''}`;
  }
  function money(amount) {
    if (amount == null) return '—';
    if (!Number.isSafeInteger(amount)) return number.format(amount / divisor());
    const [integer, fraction] = decimalMoney(amount).split('.');
    const absolute = integer.replace('-', '');
    return `${amount < 0 ? '−' : ''}${number.format(BigInt(absolute))}${fraction ? '٫' + D.toPersianDigits(fraction) : ''}`;
  }
  const csvMoney = amount => amount == null ? '' : { numeric: decimalMoney(amount) };
  const signedMoney = amount => `${amount > 0 ? '+' : ''}${money(amount)}`;
  const formatDay = day => day ? D.toPersianDigits(D.isoToJalali(day)) : '—';
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }
  function notice(message, success = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('success', success);
    $('notice').hidden = !message;
  }
  function setOptions(id, entries, label) {
    const select = $(id), previous = select.value;
    select.replaceChildren(new Option(label, ''));
    entries.forEach(([value, name]) => select.add(new Option(name, value)));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
  function populateOptions() {
    const cats = [...new Map(state.rows.map(row => [row.categoryId, row.category])).entries()];
    setOptions('categoryId', cats.sort((a, b) => collator.compare(a[1], b[1])), 'همه دسته‌ها');
    const methods = [...new Set(state.rows.map(row => row.method))].sort(collator.compare);
    setOptions('method', methods.map(name => [name, name]), 'همه روش‌ها');
  }
  function filterAmount(value) {
    if (!value.trim()) return null;
    const input = D.toAsciiDigits(value).trim().replace(/٫/g, '.');
    if (state.unit === 'rial') return D.parseAmount(input);
    const match = /^(\d+|\d{1,3}(?:[,٬]\d{3})+)(?:\.(\d))?$/.exec(input);
    if (!match) throw new Error('مبلغ تومان باید مثبت و حداکثر دارای یک رقم اعشار باشد.');
    const amount = BigInt(D.parseAmount(match[1])) * 10n + BigInt(match[2] || 0);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('مبلغ از محدوده محاسبه دقیق خارج است.');
    return Number(amount);
  }
  function readFilters() {
    return { search: $('search').value.trim(), direction: $('direction').value,
      categoryId: $('categoryId').value, method: $('method').value,
      startDate: D.jalaliToISO($('startDate').value), endDate: D.jalaliToISO($('endDate').value),
      minAmount: filterAmount($('minAmount').value), maxAmount: filterAmount($('maxAmount').value) };
  }
  function applyFilters() {
    clearTimeout(searchTimer);
    if (!state.loaded) return;
    try {
      const filters = readFilters();
      const filtered = D.filterTransactions(state.rows, filters);
      const summary = D.summarize(filtered);
      state.filters = filters; state.filtered = filtered; state.summary = summary; state.page = 1;
      $('filterError').hidden = true;
      notice('');
      render();
    } catch (error) {
      $('filterError').textContent = `${error.message} گزارش قبلی حفظ شده است.`;
      $('filterError').hidden = false;
      notice($('filterError').textContent);
    }
  }
  function resetFilters(renderAfter = true) {
    clearTimeout(searchTimer);
    $('filterForm').reset();
    state.filters = {}; state.page = 1;
    $('filterError').hidden = true;
    if (renderAfter) applyFilters();
  }
  function inspectFile(text, name, explicitKind) {
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('ساختار JSON فایل معتبر نیست.'); }
    const candidates = [parsed, parsed?.resultSet?.innerResponse, parsed?.resultSet, parsed?.data, parsed?.result];
    let items = [];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) { items = candidate; break; }
      if (candidate && typeof candidate === 'object') {
        const nested = ['transactions', 'categories', 'content', 'items'].map(key => candidate[key]).find(Array.isArray);
        if (nested) { items = nested; break; }
      }
    }
    const first = items.find(item => item && typeof item === 'object');
    const kind = explicitKind || (first && ('creditDebit' in first || 'amount' in first) ? 'transactions'
      : first && 'id' in first && 'name' in first ? 'categories'
        : /categor/i.test(name) ? 'categories' : 'transactions');
    return { kind, parsed, name };
  }
  async function importFiles(fileList, explicitKind, epoch) {
    if (epoch !== importEpoch) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length > 2) { notice('حداکثر یک فایل تراکنش و یک فایل دسته‌بندی را هم‌زمان انتخاب کنید.'); return; }
    $('fileStatus').textContent = 'در حال خواندن فایل…';
    document.body.setAttribute('aria-busy', 'true');
    try {
      const loaded = await Promise.all(files.map(async file => {
        if (file.size > 25 * 1024 * 1024) throw new Error('اندازه هر فایل باید کمتر از ۲۵ مگابایت باشد.');
        return inspectFile(await file.text(), file.name, explicitKind);
      }));
      if (epoch !== importEpoch) return;
      if (new Set(loaded.map(file => file.kind)).size !== loaded.length) {
        throw new Error('در هر نوبت فقط یک فایل از هر نوع را انتخاب کنید.');
      }
      const categoryFile = loaded.find(file => file.kind === 'categories');
      const transactionFile = loaded.find(file => file.kind === 'transactions');
      const categories = categoryFile ? D.parseCategories(categoryFile.parsed) : null;
      if (categories && categories.diagnostics.inputCount && !categories.categories.length) {
        throw new Error('هیچ دسته‌بندی معتبری در فایل پیدا نشد.');
      }
      const nextCategories = categories?.categories || state.categories;
      const transactions = transactionFile ? D.parseTransactions(transactionFile.parsed, nextCategories) : null;
      if (transactions && transactions.diagnostics.inputCount && !transactions.rows.length) {
        throw new Error('هیچ تراکنش معتبری در فایل پیدا نشد. ساختار، مبلغ، تاریخ و نوع تراکنش را بررسی کنید.');
      }
      const nextRows = transactions?.rows || D.applyCategories(state.rows, nextCategories);
      // Calculate before committing state, so malformed/unsafe replacements cannot destroy a valid report.
      const nextAllSummary = D.summarize(nextRows);
      state.categories = nextCategories; state.rows = nextRows; state.allSummary = nextAllSummary;
      if (categoryFile) { state.categoryName = categoryFile.name; state.categoryDiagnostics = categories.diagnostics; }
      if (transactionFile) {
        state.loaded = true; state.transactionName = transactionFile.name; state.diagnostics = transactions.diagnostics;
        resetFilters(false);
        $('groupBy').value = nextAllSummary.calendarDays > 180 ? 'monthly' : 'daily';
      }
      populateOptions();
      if (state.loaded) {
        state.filters.categoryId = $('categoryId').value;
        state.filters.method = $('method').value;
        state.filtered = D.filterTransactions(state.rows, state.filters);
        state.summary = D.summarize(state.filtered);
        render();
      }
      const messages = loaded.map(file => `«${file.name}» خوانده شد.`);
      for (const diagnostic of [transactions?.diagnostics, categories?.diagnostics].filter(Boolean)) {
        if (diagnostic.invalidCount) messages.push(`${number.format(diagnostic.invalidCount)} ردیف نامعتبر کنار گذاشته شد.`);
        if (diagnostic.duplicateCount) messages.push(`${number.format(diagnostic.duplicateCount)} ردیف تکراری کنار گذاشته شد.`);
        if (diagnostic.conflictCount) messages.push(`${number.format(diagnostic.conflictCount)} شناسه با اطلاعات متفاوت حفظ شد؛ نیازمند بررسی است.`);
        if (diagnostic.warningCount) messages.push(`${number.format(diagnostic.warningCount)} مانده نامعتبر بود؛ تراکنش بدون مانده حفظ شد.`);
        if (diagnostic.issues.length) messages.push(...diagnostic.issues.slice(0, 3).map(issue => `ردیف ${number.format(issue.index)}: ${issue.reason}`));
      }
      const hasWarnings = [transactions?.diagnostics, categories?.diagnostics].some(d => d && (d.invalidCount || d.duplicateCount || d.conflictCount || d.warningCount));
      $('fileStatus').textContent = messages.join(' ');
      notice(messages.join('\n'), !hasWarnings);
      $('welcome').hidden = state.loaded; $('dashboard').hidden = !state.loaded;
    } catch (error) {
      if (epoch !== importEpoch) return;
      $('fileStatus').textContent = error.message;
      notice(`${error.message} اطلاعات قبلی تغییر نکرده است.`);
    } finally { if (epoch === importEpoch) document.body.removeAttribute('aria-busy'); }
  }
  function queueImport(files, kind) {
    const capturedFiles = Array.from(files);
    const epoch = importEpoch;
    importQueue = importQueue.then(() => importFiles(capturedFiles, kind, epoch));
  }
  function filterDescription() {
    const f = state.filters;
    const descriptions = [];
    if (f.search) descriptions.push(`جست‌وجو: ${f.search}`);
    if (f.direction) descriptions.push(f.direction === 'CREDIT' ? 'فقط واریز' : 'فقط برداشت');
    if (f.categoryId) descriptions.push(`دسته: ${state.rows.find(row => row.categoryId === f.categoryId)?.category || f.categoryId}`);
    if (f.method) descriptions.push(`روش: ${f.method}`);
    if (f.startDate) descriptions.push(`از ${formatDay(f.startDate)}`);
    if (f.endDate) descriptions.push(`تا ${formatDay(f.endDate)}`);
    if (f.minAmount != null) descriptions.push(`حداقل ${money(f.minAmount)} ${unit()}`);
    if (f.maxAmount != null) descriptions.push(`حداکثر ${money(f.maxAmount)} ${unit()}`);
    return descriptions;
  }
  function render() {
    $('welcome').hidden = state.loaded; $('dashboard').hidden = !state.loaded;
    document.querySelectorAll('.unit-label').forEach(node => { node.textContent = unit(); });
    if (!state.loaded) return;
    const s = state.summary, all = state.allSummary;
    $('datasetInfo').textContent = `${number.format(all.count)} تراکنش در فایل · ${formatDay(all.firstDate)} تا ${formatDay(all.lastDate)} · ساعت تهران`;
    const importNodes = [el('span', '', state.transactionName || 'فایل تراکنش‌ها'),
      el('span', '', state.categoryName ? `${number.format(state.categories.length)} دسته‌بندی` : 'بدون فایل دسته‌بندی')];
    const d = state.diagnostics;
    if (d && (d.invalidCount || d.duplicateCount || d.conflictCount || d.warningCount)) {
      importNodes.push(el('span', '', `کیفیت فایل: ${number.format(d.invalidCount)} نامعتبر، ${number.format(d.duplicateCount)} تکراری، ${number.format(d.conflictCount)} تعارض، ${number.format(d.warningCount)} هشدار مانده`));
    }
    $('importInfo').replaceChildren(...importNodes);
    const applied = filterDescription();
    $('filterStatus').textContent = applied.length ? `${number.format(applied.length)} فیلتر فعال` : 'همه تراکنش‌ها';
    $('reportScope').textContent = `${number.format(s.count)} از ${number.format(all.count)} تراکنش · واحد: ${unit()}${applied.length ? ' · ' + applied.join(' · ') : ' · بدون فیلتر'}`;
    $('incomeValue').textContent = money(s.income); $('expenseValue').textContent = money(s.expense);
    $('netValue').textContent = signedMoney(s.net); $('netValue').classList.toggle('negative', s.net < 0);
    $('countValue').textContent = number.format(s.count);
    $('incomeCount').textContent = `${number.format(s.incomeCount)} واریز`;
    $('expenseCount').textContent = `${number.format(s.expenseCount)} برداشت`;
    $('activeDays').textContent = `${number.format(s.activeDays)} روز فعال`;
    $('emptyResults').hidden = s.count > 0;
    $('tableCount').textContent = number.format(s.count);
    const lastBalance = all.lastBalanceAmbiguous ? 'مانده انتهای فایل به دلیل ثبت‌های هم‌زمان با مانده‌های متفاوت قابل تعیین نیست.'
      : all.lastBalance == null ? 'مانده‌ای در فایل ثبت نشده است.'
        : `آخرین مانده موجود در کل فایل: ${money(all.lastBalance)} ${unit()} در ${formatDay(D.dayKey(all.lastBalanceAt))}.`;
    $('balanceNote').textContent = `مانده ثبت‌شده، مقدار گزارش‌شده بانک پس از هر تراکنش است. ${lastBalance} این اطلاعات مستقل از فیلترهاست و کامل بودن صورت‌حساب یا موجودی فعلی را تأیید نمی‌کند.`;
    renderCharts(); renderInsights(); renderReports(); renderTable();
  }
  const chartBase = () => ({ responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', rtl: true, textDirection: 'rtl', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 18, color: '#7b8aa0', font: { size: 10 } } },
      tooltip: { rtl: true, textDirection: 'rtl', backgroundColor: '#263b59', padding: 12,
        titleFont: { family: 'Vazirmatn' }, bodyFont: { family: 'Vazirmatn', size: 11 },
        callbacks: { label: context => `${context.dataset.label}: ${money(context.dataset.rialValues[context.dataIndex])} ${unit()}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: '#8c99ad', maxRotation: 0, maxTicksLimit: 8, font: { size: 9 } }, border: { display: false } },
      y: { beginAtZero: true, grid: { color: '#f0f3f8' }, border: { display: false }, ticks: { color: '#8c99ad', maxTicksLimit: 5, font: { size: 9 }, callback: value => compact.format(value) } } } });
  function chart(id, config) {
    state.charts[id]?.destroy();
    state.charts[id] = new Chart($(id), config);
  }
  function reducedGroups(groups, field, limit) {
    const sorted = groups.filter(group => group[field] > 0).sort((a, b) => b[field] - a[field]);
    if (sorted.length <= limit) return sorted;
    const rest = sorted.slice(limit - 1);
    return [...sorted.slice(0, limit - 1), { key: '__other__', name: 'سایر دسته‌ها', label: 'سایر دسته‌ها',
      [field]: rest.reduce((sum, row) => D.safeAdd(sum, row[field]), 0) }];
  }
  function renderCharts() {
    const s = state.summary, factor = divisor();
    const monthly = $('groupBy').value === 'monthly' || s.daily.length > 730;
    const series = monthly ? s.monthly : s.daily;
    $('flowNote').textContent = `واحد محور: ${unit()} · ${monthly ? 'ماه‌های تقویم شمسی' : 'روزهای تقویم شمسی؛ روز بدون رکورد با مقدار صفر'}${$('groupBy').value === 'daily' && monthly ? ' · بازه بیش از ۷۳۰ روز به‌صورت ماهانه نمایش داده می‌شود.' : ''}`;
    const flow = chartBase();
    chart('flowChart', { type: 'bar', data: { labels: series.map(row => row.label), datasets: [
      { label: 'واریز', data: series.map(row => row.income / factor), rialValues: series.map(row => row.income), backgroundColor: '#339f96', borderRadius: 3, maxBarThickness: 22 },
      { label: 'برداشت', data: series.map(row => row.expense / factor), rialValues: series.map(row => row.expense), backgroundColor: '#7293eb', borderRadius: 3, maxBarThickness: 22 }
    ] }, options: flow });
    const metric = $('categoryMetric').value;
    const cats = reducedGroups(s.categories, metric, 6);
    const total = s[metric];
    $('categoryTotal').textContent = money(total);
    chart('categoryChart', { type: 'doughnut', data: { labels: cats.map(row => row.name), datasets: [{
      label: metric === 'expense' ? 'برداشت' : 'واریز', data: cats.map(row => row[metric] / factor),
      backgroundColor: palette.slice(0, cats.length), borderColor: '#fff', borderWidth: 4, hoverOffset: 3
    }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '78%',
      plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl', callbacks: {
        label: context => `${context.label}: ${money(cats[context.dataIndex][metric])} ${unit()} (${percent.format(total ? cats[context.dataIndex][metric] / total : 0)})`
      } } } } });
    const legends = cats.map((row, i) => {
      const item = el('div', 'legend-row'), dot = el('i'); dot.style.backgroundColor = palette[i];
      const name = el('button', '', row.name); name.type = 'button'; name.title = row.name;
      if (row.id != null) name.addEventListener('click', () => { $('categoryId').value = row.id; applyFilters(); });
      else { name.disabled = true; name.style.opacity = '1'; }
      item.append(dot, name, el('span', 'legend-value', money(row[metric])), el('span', 'legend-percent', percent.format(total ? row[metric] / total : 0)));
      return item;
    });
    $('categoryLegend').replaceChildren(...(legends.length ? legends : [el('p', 'chart-note', 'تراکنشی برای این نوع موجود نیست.')]));
    let cumulative = 0;
    const cumulativeRials = [0, ...series.map(row => { cumulative = D.safeAdd(cumulative, row.net); return cumulative; })];
    const netOptions = chartBase(); netOptions.plugins.legend.display = false;
    chart('netChart', { type: 'line', data: { labels: ['شروع', ...series.map(row => row.label)], datasets: [{
      label: 'خالص تجمعی', data: cumulativeRials.map(amount => amount / factor), rialValues: cumulativeRials,
      borderColor: '#4b77dc', backgroundColor: '#4b77dc10', fill: true, pointRadius: series.length < 15 ? 2 : 0,
      pointHitRadius: 10, borderWidth: 2, tension: 0
    }] }, options: netOptions });
    const methods = s.methods.slice(0, 5).map(row => ({ ...row }));
    if (s.methods.length > 5) methods.push(s.methods.slice(5).reduce((sum, row) => ({ name: 'سایر روش‌ها',
      income: D.safeAdd(sum.income, row.income), expense: D.safeAdd(sum.expense, row.expense) }), { income: 0, expense: 0 }));
    const methodOptions = chartBase(); methodOptions.indexAxis = 'y';
    methodOptions.scales.x = { ...methodOptions.scales.y, stacked: true };
    methodOptions.scales.y = { grid: { display: false }, border: { display: false }, ticks: { font: { size: 9 }, color: '#7d8ca3' }, stacked: true };
    chart('methodChart', { type: 'bar', data: { labels: methods.map(row => row.name.length > 24 ? row.name.slice(0, 22) + '…' : row.name), datasets: [
      { label: 'واریز', data: methods.map(row => row.income / factor), rialValues: methods.map(row => row.income), backgroundColor: '#33a398', maxBarThickness: 15, borderRadius: 3 },
      { label: 'برداشت', data: methods.map(row => row.expense / factor), rialValues: methods.map(row => row.expense), backgroundColor: '#7393e7', maxBarThickness: 15, borderRadius: 3 }
    ] }, options: methodOptions });
    $('methodNote').textContent = `${number.format(s.methods.length)} روش در محدوده گزارش · واحد: ${unit()}`;
  }
  function renderInsights() {
    const s = state.summary;
    const items = [
      ['بزرگ‌ترین برداشت', s.maxExpense ? money(s.maxExpense.amount) + ' ' + unit() : '—', s.maxExpense ? `${s.maxExpense.dateLabel} · ${s.maxExpense.category}` : 'برداشتی ثبت نشده است'],
      ['بزرگ‌ترین واریز', s.maxIncome ? money(s.maxIncome.amount) + ' ' + unit() : '—', s.maxIncome ? `${s.maxIncome.dateLabel} · ${s.maxIncome.category}` : 'واریزی ثبت نشده است'],
      ['میانگین هر برداشت', money(s.averageExpense) + ' ' + unit(), `بر پایه ${number.format(s.expenseCount)} برداشت · نمایش میانگین تا یک رقم اعشار`]
    ];
    $('insights').replaceChildren(...items.map(([title, value, detail]) => {
      const node = el('article', 'insight-card'); node.append(el('p', '', title), el('strong', '', value), el('small', '', detail)); return node;
    }));
  }
  function renderReportRows(id, groups) {
    const nodes = groups.map(group => {
      const tr = el('tr');
      tr.append(el('td', '', group.label || group.name), el('td', '', number.format(group.count)),
        el('td', 'money credit', money(group.income)), el('td', 'money debit', money(group.expense)), el('td', 'money', signedMoney(group.net)));
      return tr;
    });
    if (!nodes.length) { const row = el('tr'), cell = el('td', '', 'داده‌ای برای نمایش وجود ندارد.'); cell.colSpan = 5; row.append(cell); nodes.push(row); }
    $(id).replaceChildren(...nodes);
  }
  function renderReports() {
    const s = state.summary;
    renderReportRows('periodBody', s.monthly);
    renderReportRows('categoryReportBody', s.categories);
    renderReportRows('methodReportBody', s.methods);
    $('periodReportNote').textContent = `جمع بر اساس ماه شمسی · همه مبالغ به ${unit()}`;
  }
  function sortedRows() {
    const key = state.sort, direction = state.ascending ? 1 : -1;
    return [...state.filtered].sort((a, b) => {
      if (a[key] == null || b[key] == null) return a[key] == null ? b[key] == null ? 0 : 1 : -1;
      const value = typeof a[key] === 'number' ? a[key] - b[key] : collator.compare(a[key], b[key]);
      return value * direction || a.sourceIndex - b.sourceIndex;
    });
  }
  function renderTable() {
    const rows = sortedRows(), pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = state.printing ? 0 : (state.page - 1) * state.pageSize;
    const shown = state.printing ? rows : rows.slice(start, start + state.pageSize);
    const nodes = shown.map(row => {
      const tr = el('tr'), date = el('td', '', row.dateLabel); date.append(el('span', 'cell-secondary', row.timeLabel));
      const description = el('td', 'description-cell', row.description); description.title = row.description;
      description.append(el('span', 'cell-secondary', row.method));
      const category = el('td'); category.append(el('span', 'category-chip', row.category)); category.title = row.category;
      const direction = el('td'), isCredit = row.direction === 'CREDIT';
      direction.append(el('span', `direction-chip ${isCredit ? 'credit' : 'debit'}`, isCredit ? '↙ واریز' : '↗ برداشت'));
      const details = el('td'), button = el('button', 'row-detail', 'جزئیات'); button.type = 'button';
      button.setAttribute('aria-label', `جزئیات تراکنش ${row.dateLabel} ${row.timeLabel}`);
      button.addEventListener('click', () => openDetails(row)); details.append(button);
      tr.append(date, description, category, direction, el('td', `money ${isCredit ? 'credit' : 'debit'}`, money(row.amount)), el('td', 'money', money(row.balance)), details);
      return tr;
    });
    if (!nodes.length) { const tr = el('tr'), td = el('td', '', 'تراکنشی برای نمایش وجود ندارد.'); td.colSpan = 7; td.style.textAlign = 'center'; tr.append(td); nodes.push(tr); }
    $('transactionsBody').replaceChildren(...nodes);
    $('pageInfo').textContent = rows.length ? `${number.format(start + 1)} تا ${number.format(start + shown.length)} از ${number.format(rows.length)} تراکنش · مبالغ به ${unit()}` : '۰ تراکنش';
    $('pageNumber').textContent = `${number.format(state.page)} / ${number.format(pages)}`;
    $('previousPage').disabled = state.page <= 1; $('nextPage').disabled = state.page >= pages;
    document.querySelectorAll('button[data-sort]').forEach(button => {
      const active = button.dataset.sort === state.sort;
      if (active) button.parentElement.setAttribute('aria-sort', state.ascending ? 'ascending' : 'descending');
      else button.parentElement.removeAttribute('aria-sort');
      button.querySelector('span').textContent = active ? state.ascending ? '↑' : '↓' : '↕';
    });
  }
  function openDetails(row) {
    const raw = row.raw, supplementary = raw.supplementaryInfo || {};
    const pairs = [['تاریخ و ساعت تهران', `${row.dateLabel} · ${row.timeLabel}`], ['نوع تراکنش', row.direction === 'CREDIT' ? 'واریز' : 'برداشت'],
      ['مبلغ', `${money(row.amount)} ${unit()}`], ['مانده ثبت‌شده', row.balance == null ? 'ثبت نشده' : `${money(row.balance)} ${unit()}`],
      ['دسته‌بندی', row.category], ['روش', row.method], ['شرح', row.description], ['شماره پیگیری', row.trace],
      ['شناسه تراکنش', raw.transactionId], ['طرف حساب', row.counterparty], ['شماره حساب طرف مقابل', supplementary.counterPartyAccountNumber],
      ['شماره کارت طرف مقابل', supplementary.counterPartyCardNumber], ['شبا', supplementary.counterPartyIban], ['بابت', supplementary.purposeDescription],
      ['شعبه', raw.branchName || raw.branchCode], ['توضیحات تکمیلی', raw.additionalData1], ['توضیحات تکمیلی دوم', raw.additionalData2], ['یادداشت', row.comment]];
    $('detailContent').replaceChildren(...pairs.filter(([, value]) => value != null && value !== '').map(([label, value]) => {
      const item = el('div', label === 'یادداشت' || label.startsWith('توضیحات') ? 'wide' : '');
      item.append(el('dt', '', label), el('dd', '', value)); return item;
    }));
    $('detailDialog').showModal();
  }
  function csvCell(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (value && typeof value === 'object' && /^-?\d+(\.\d+)?$/.test(value.numeric)) return value.numeric;
    let text = String(value ?? '');
    if (/^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function downloadCSV(name, rows) {
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    downloadUrls.add(url);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 10000);
  }
  function exportTransactions() {
    const rows = [[`تاریخ شمسی (تهران)`, 'ساعت تهران', 'تاریخ میلادی (تهران)', 'نوع', 'شرح', 'دسته‌بندی', 'روش', `مبلغ (${unit()})`, `مانده ثبت‌شده (${unit()})`, 'شماره پیگیری', 'طرف حساب', 'یادداشت', 'شناسه تراکنش']];
    for (const row of sortedRows()) rows.push([row.dateLabel, row.timeLabel, row.day, row.direction === 'CREDIT' ? 'واریز' : 'برداشت',
      row.description, row.category, row.method, csvMoney(row.amount), csvMoney(row.balance), row.trace, row.counterparty, row.comment, String(row.raw.transactionId ?? '')]);
    downloadCSV(`baam-transactions-${state.unit}.csv`, rows);
  }
  function exportSummary() {
    const s = state.summary;
    const rows = [['محدوده گزارش', ...filterDescription()], ['واحد', unit()], ['نوع گزارش', 'عنوان', 'تعداد', `واریز (${unit()})`, `برداشت (${unit()})`, `خالص (${unit()})`]];
    for (const [type, groups] of [['کل', [{ ...s, label: 'کل محدوده انتخاب‌شده' }]], ['روزانه', s.daily], ['ماهانه', s.monthly], ['دسته‌بندی', s.categories], ['روش', s.methods]]) {
      for (const group of groups) rows.push([type, group.label || group.name, group.count, csvMoney(group.income), csvMoney(group.expense), csvMoney(group.net)]);
    }
    downloadCSV(`baam-report-${state.unit}.csv`, rows);
  }
  let detailsBeforePrint = [];
  function beforePrint() {
    if (!state.loaded || state.printing) return;
    state.printing = true;
    detailsBeforePrint = [...document.querySelectorAll('details')].map(node => [node, node.open]);
    detailsBeforePrint.forEach(([node]) => { node.open = true; });
    renderTable(); Object.values(state.charts).forEach(instance => instance.resize());
  }
  function afterPrint() {
    if (!state.printing) return;
    state.printing = false;
    detailsBeforePrint.forEach(([node, open]) => { node.open = open; });
    renderTable(); Object.values(state.charts).forEach(instance => instance.resize());
  }
  Chart.defaults.font.family = 'Vazirmatn, Tahoma, sans-serif';
  Chart.defaults.color = '#8090a8';
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => $(button.dataset.open).showModal()));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('.nav-link[href]').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(node => node.classList.remove('active')); link.classList.add('active');
  }));
  for (const [id, kind] of [['quickFiles', undefined], ['transactionsFile', 'transactions'], ['categoriesFile', 'categories']]) {
    $(id).addEventListener('change', event => { queueImport(event.target.files, kind); event.target.value = ''; });
  }
  for (const event of ['dragenter', 'dragover']) $('dropZone').addEventListener(event, e => { e.preventDefault(); $('dropZone').classList.add('dragging'); });
  for (const event of ['dragleave', 'drop']) $('dropZone').addEventListener(event, e => { e.preventDefault(); $('dropZone').classList.remove('dragging'); });
  $('dropZone').addEventListener('drop', e => queueImport(e.dataTransfer.files));
  $('filterForm').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 300); });
  $('resetFilters').addEventListener('click', () => resetFilters());
  $('unitSelect').addEventListener('change', () => {
    try {
      const bounds = ['minAmount', 'maxAmount'].map(id => [id, filterAmount($(id).value)]);
      state.unit = $('unitSelect').value;
      bounds.forEach(([id, amount]) => { $(id).value = amount == null ? '' : decimalMoney(amount); });
      render();
    } catch (error) { $('unitSelect').value = state.unit; notice(error.message); }
  });
  $('groupBy').addEventListener('change', renderCharts); $('categoryMetric').addEventListener('change', renderCharts);
  $('pageSize').addEventListener('change', () => { state.pageSize = Number(D.toAsciiDigits($('pageSize').value)); state.page = 1; renderTable(); });
  $('nextPage').addEventListener('click', () => { state.page++; renderTable(); });
  $('previousPage').addEventListener('click', () => { state.page--; renderTable(); });
  document.querySelectorAll('button[data-sort]').forEach(button => button.addEventListener('click', () => {
    state.ascending = state.sort === button.dataset.sort ? !state.ascending : true;
    state.sort = button.dataset.sort; state.page = 1; renderTable();
  }));
  $('exportCsv').addEventListener('click', exportTransactions); $('exportSummary').addEventListener('click', exportSummary);
  $('printReport').addEventListener('click', () => { beforePrint(); window.print(); afterPrint(); });
  window.addEventListener('beforeprint', beforePrint); window.addEventListener('afterprint', afterPrint);
  $('clearData').addEventListener('click', () => {
    importEpoch++;
    document.body.removeAttribute('aria-busy');
    downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls.clear();
    Object.values(state.charts).forEach(instance => instance.destroy()); state.charts = {};
    state.rows = []; state.categories = []; state.filtered = []; state.summary = null; state.allSummary = null;
    state.loaded = false; state.transactionName = ''; state.categoryName = ''; state.diagnostics = null; state.categoryDiagnostics = null;
    resetFilters(false); $('detailContent').replaceChildren(); $('importInfo').replaceChildren();
    ['transactionsBody', 'periodBody', 'categoryReportBody', 'methodReportBody', 'insights', 'categoryLegend', 'datasetInfo', 'reportScope',
      'incomeValue', 'expenseValue', 'netValue', 'countValue', 'incomeCount', 'expenseCount', 'activeDays', 'categoryTotal',
      'tableCount', 'pageInfo', 'pageNumber', 'balanceNote', 'flowNote', 'methodNote', 'filterError'].forEach(id => $(id).replaceChildren());
    populateOptions();
    $('fileStatus').textContent = ''; $('importDialog').close(); render(); notice('اطلاعات از حافظه این صفحه پاک شد.', true);
  });
  document.fonts.ready.then(() => { Object.values(state.charts).forEach(instance => instance.update('none')); });
})();
