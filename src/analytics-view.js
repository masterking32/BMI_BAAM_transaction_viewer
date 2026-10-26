/* Advanced reports: safe DOM rendering, Persian presentation, no persistent data. */
(() => {
  'use strict';
  const D = window.BaamData;
  const A = window.BaamAnalytics;
  const weekdays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

  function create(options) {
    const mount = options.mount;
    const number = typeof options.number === 'function' ? options.number : value => options.number.format(value);
    const money = options.money;
    const signedMoney = options.signedMoney || (value => `${value > 0 ? '+' : ''}${money(value)}`);
    const percentage = new Intl.NumberFormat('fa-IR', { style: 'percent', maximumFractionDigits: 1 });
    const compactAmount = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumSignificantDigits: 3 });
    const collator = new Intl.Collator('fa', { numeric: true });
    const ids = {};
    const view = { context: null, dataset: null, dateKey: '', comparison: null, parties: null,
      recurring: [], review: null, quality: null, calendar: null, month: '', partyPage: 1,
      recurrencePage: 1, reviewPage: 1, qualityPage: 1, scopeRows: null, printing: false };

    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    }
    function identified(tag, id, className, text) {
      const element = node(tag, className, text); element.id = id; ids[id] = element; return element;
    }
    function button(text, action, id, className = 'button compact') {
      const element = id ? identified('button', id, className, text) : node('button', className, text);
      element.type = 'button'; element.addEventListener('click', action); return element;
    }
    function select(id, entries, action) {
      const element = identified('select', id);
      entries.forEach(([value, title]) => element.add(new Option(title, value)));
      if (action) element.addEventListener('change', action);
      return element;
    }
    function labeled(title, control, className) {
      const label = node('label', className, title); label.append(control); return label;
    }
    function search(id, placeholder, action) {
      const input = identified('input', id); input.type = 'search'; input.placeholder = placeholder;
      input.addEventListener('input', action); return input;
    }
    function hint(text, id) { return id ? identified('p', id, 'analytics-hint', text) : node('p', 'analytics-hint', text); }
    function section(key, title, subtitle, open = false) {
      const detail = identified('details', `report-${key}`, 'panel analytics-section'); detail.open = open;
      const summary = node('summary', 'analytics-summary');
      const heading = node('div'); heading.append(node('h3', '', title), node('p', '', subtitle));
      const badge = identified('span', `report-${key}-count`, 'small-badge');
      summary.append(heading, badge);
      const body = identified('div', `report-${key}-body`, 'analytics-body');
      detail.append(summary, body); mount.append(detail); return body;
    }
    function table(id, columns, caption) {
      const wrapper = node('div', 'table-scroll analytics-table-scroll'); wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', caption);
      const table = node('table', 'report-table'); table.append(node('caption', 'sr-only', caption));
      const head = node('thead'), row = node('tr');
      columns.forEach(title => { const cell = node('th', '', title); cell.scope = 'col'; row.append(cell); });
      head.append(row); const body = identified('tbody', id); table.append(head, body); wrapper.append(table); return wrapper;
    }
    function emptyRow(body, width, text) {
      const row = node('tr'), cell = node('td', 'analytics-empty', text); cell.colSpan = width;
      row.append(cell); body.replaceChildren(row);
    }
    function navigation(prefix, onPrevious, onNext) {
      const footer = node('div', 'analytics-pagination no-print');
      const info = identified('span', `${prefix}PageInfo`, 'analytics-hint'); info.setAttribute('role', 'status');
      footer.append(info, button('→ قبلی', onPrevious, `${prefix}Previous`), button('بعدی ←', onNext, `${prefix}Next`));
      return footer;
    }
    function pageRows(rows, stateKey, prefix, size = 8) {
      const pages = Math.max(1, Math.ceil(rows.length / size));
      view[stateKey] = Math.min(Math.max(1, view[stateKey]), pages);
      const offset = (view[stateKey] - 1) * size;
      ids[`${prefix}PageInfo`].textContent = rows.length ? `${number(offset + 1)} تا ${number(Math.min(offset + size, rows.length))} از ${number(rows.length)}` : 'موردی پیدا نشد';
      ids[`${prefix}Previous`].disabled = view[stateKey] <= 1;
      ids[`${prefix}Next`].disabled = view[stateKey] >= pages;
      return view.printing ? rows : rows.slice(offset, offset + size);
    }
    function dateLabel(iso) { return iso ? D.toPersianDigits(D.isoToJalali(iso)) : '—'; }
    function moneyWithUnit(amount) { return `${money(amount)} ${view.context.unitLabel}`; }
    function calendarAmount(kind, amount) {
      const sign = kind === 'income' ? '+' : '−';
      const element = node('small', `calendar-amount calendar-${kind}`);
      element.dataset.amount = String(amount);
      // The day button's accessible label contains exact totals in the current unit.
      element.setAttribute('aria-hidden', 'true');
      element.append(node('bdi', 'calendar-amount-full', `${sign} ${money(amount)}`));
      const compact = node('span', 'calendar-amount-compact');
      const parts = compactAmount.formatToParts(amount / (view.context.unitLabel === 'ریال' ? 1 : 10));
      compact.append(node('bdi', '', `${sign} ${parts.filter(part => part.type !== 'compact' && part.type !== 'literal').map(part => part.value).join('')}`));
      const suffix = parts.find(part => part.type === 'compact');
      if (suffix) compact.append(node('span', 'calendar-amount-suffix', suffix.value));
      element.append(compact); return element;
    }
    function ratioText(change) {
      if (change.percent === null) return change.value === 0 ? 'بدون تغییر' : 'مبنای صفر؛ درصد قابل محاسبه نیست';
      return `${change.percent > 0 ? '+' : ''}${percentage.format(change.percent)}`;
    }
    function drilldown(rowIds, label) { options.onDrilldown({ rowIds: [...rowIds], label }); }
    function observedBounds() {
      let first = '', last = '';
      for (const row of view.context.allRows) {
        if (!first || row.day < first) first = row.day;
        if (!last || row.day > last) last = row.day;
      }
      return { first, last };
    }

    const heading = node('div', 'section-title analytics-title');
    heading.append(node('h2', '', 'گزارش‌های پیشرفته'), node('span', '', 'شش نگاه دقیق‌تر به گردش حساب'));
    mount.append(heading);
    const jump = node('nav', 'analytics-jump no-print'); jump.setAttribute('aria-label', 'بخش‌های گزارش پیشرفته');
    const names = [['comparison', 'مقایسه بازه‌ها'], ['counterparties', 'طرف حساب‌ها'], ['recurring', 'پرداخت‌های منظم'],
      ['calendar', 'تقویم تراکنش'], ['review', 'نیازمند بررسی'], ['quality', 'کیفیت دسته‌بندی']];
    names.forEach(([key, label], index) => jump.append(button(`${number(index + 1)}. ${label}`, () => {
      const target = ids[`report-${key}`]; target.open = true; target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, undefined, 'analytics-jump-button')));
    mount.append(jump, hint('گزارش‌ها از فیلترهای بالای صفحه پیروی می‌کنند. مقایسه بازه‌ها تاریخ مستقل دارد و تقویم، ماه انتخابی را کامل نشان می‌دهد؛ سایر فیلترها در هر دو اعمال می‌شوند. جست‌وجو و صفحه‌بندی داخلی فقط نمایش همان بخش را محدود می‌کند؛ خروجی گزارش شامل همه نتایج محدوده است.', 'analyticsScope'));

    const compareBody = section('comparison', 'مقایسه دو بازه زمانی', 'تغییر واریز، برداشت، تعداد و سهم دسته‌ها در دو بازه هم‌طول', true);
    const compareForm = identified('form', 'comparisonForm', 'analytics-comparison-form no-print'); compareForm.noValidate = true;
    [['comparisonStart', 'شروع بازه انتخابی'], ['comparisonEnd', 'پایان بازه انتخابی'],
      ['comparisonPreviousStart', 'شروع بازه مبنا'], ['comparisonPreviousEnd', 'پایان بازه مبنا']].forEach(([id, label]) => {
      const input = identified('input', id); input.dir = 'ltr'; input.inputMode = 'numeric'; input.placeholder = '۱۴۰۵/۰۱/۰۱';
      compareForm.append(labeled(label, input));
    });
    const compareActions = node('div', 'analytics-actions');
    const compareSubmit = identified('button', 'comparePeriods', 'button dark', 'مقایسه بازه‌ها'); compareSubmit.type = 'submit';
    compareActions.append(compareSubmit, button('بازه قبلی هم‌طول', () => {
      try {
        const start = D.jalaliToISO(ids.comparisonStart.value), end = D.jalaliToISO(ids.comparisonEnd.value);
        if (!start || !end || start > end) throw new Error('ابتدا تاریخ شروع و پایان بازه انتخابی را درست وارد کنید.');
        const length = A.daysBetween(start, end);
        ids.comparisonPreviousEnd.value = dateLabel(A.shiftDay(start, -1));
        ids.comparisonPreviousStart.value = dateLabel(A.shiftDay(start, -length));
        renderComparison();
      } catch (error) { comparisonError(error.message); }
    }, 'comparisonPreviousPeriod', 'text-button'));
    compareForm.append(compareActions); compareForm.addEventListener('submit', event => { event.preventDefault(); renderComparison(); });
    const compareError = identified('p', 'comparisonError', 'field-error'); compareError.hidden = true; compareError.setAttribute('role', 'alert');
    compareBody.append(compareForm, hint('', 'comparisonScope'), compareError, hint('', 'comparisonCoverage'), identified('div', 'comparisonMetrics', 'analytics-comparison-metrics'));
    const categoryMeasure = select('comparisonMeasure', [['expense', 'برداشت دسته‌ها'], ['income', 'واریز دسته‌ها']], renderComparison);
    compareBody.append(labeled('مقایسه دسته‌بندی', categoryMeasure, 'analytics-inline-control no-print'),
      table('comparisonCategories', ['دسته‌بندی', 'بازه مبنا', 'بازه انتخابی', 'تغییر مبلغ', 'تغییر درصد'], 'تغییر دسته‌بندی‌ها در دو بازه'));

    const partiesBody = section('counterparties', 'گزارش طرف حساب‌ها', 'مجموع ارتباط مالی با حساب، کارت، پذیرنده یا نام ثبت‌شده');
    const partiesToolbar = node('div', 'analytics-toolbar no-print');
    partiesToolbar.append(labeled('جست‌وجوی طرف حساب', search('partySearch', 'نام، حساب، کارت یا شبا…', () => { view.partyPage = 1; renderParties(); })),
      labeled('ترتیب نمایش', select('partySort', [['expense', 'بیشترین پرداخت'], ['income', 'بیشترین دریافت'], ['count', 'بیشترین تعداد'], ['lastTimestamp', 'آخرین ارتباط']], () => { view.partyPage = 1; renderParties(); })));
    partiesBody.append(hint('', 'partyCoverage'), partiesToolbar,
      table('counterpartyBody', ['طرف حساب', 'تعداد', 'واریز', 'برداشت', 'خالص', 'آخرین ارتباط', 'تراکنش‌ها'], 'مبالغ به تفکیک طرف حساب'),
      navigation('party', () => { view.partyPage--; renderParties(); }, () => { view.partyPage++; renderParties(); }),
      hint('شناسه‌های متفاوت با نام مشترک ادغام نمی‌شوند. مواردی که فقط نام دارند، به‌صورت «گروه هم‌نام» نشان داده می‌شوند.'));

    const recurringBody = section('recurring', 'پرداخت‌های تکرارشونده احتمالی', 'الگوهای منظم در برداشت‌های هم‌طرف و هم‌روش');
    recurringBody.append(hint('این موارد الگوی آماری در فایل هستند؛ تعهد مالی، اشتراک فعال یا موعد قطعی پرداخت را تأیید نمی‌کنند.'),
      identified('div', 'recurringList', 'analytics-candidates'),
      navigation('recurrence', () => { view.recurrencePage--; renderRecurring(); }, () => { view.recurrencePage++; renderRecurring(); }));

    const calendarBody = section('calendar', 'تقویم حرارتی تراکنش‌ها', 'روزهای پرتراکنش را در تقویم شمسی پیدا کنید', true);
    const calendarToolbar = node('div', 'analytics-calendar-toolbar no-print');
    calendarToolbar.append(button('→ ماه قبل', () => moveMonth(-1), 'calendarPrevious'),
      labeled('ماه شمسی', select('calendarMonth', [], () => { view.month = ids.calendarMonth.value; renderCalendar(); })),
      labeled('معیار رنگ', select('calendarMetric', [['expense', 'مبلغ برداشت'], ['income', 'مبلغ واریز'], ['count', 'تعداد تراکنش']], renderCalendar)),
      button('ماه بعد ←', () => moveMonth(1), 'calendarNext'));
    calendarBody.append(calendarToolbar, identified('h4', 'calendarTitle', 'analytics-calendar-title'), hint('', 'calendarSummary'));
    const calendarWeekdays = node('div', 'analytics-calendar-weekdays'); calendarWeekdays.setAttribute('aria-hidden', 'true');
    weekdays.forEach(day => calendarWeekdays.append(node('span', '', day)));
    const calendarGrid = identified('div', 'calendarGrid', 'analytics-calendar-grid'); calendarGrid.setAttribute('role', 'group'); calendarGrid.setAttribute('aria-label', 'روزهای تقویم شمسی');
    calendarBody.append(calendarWeekdays, calendarGrid);
    const calendarLegend = node('div', 'analytics-heat-legend'); calendarLegend.append(node('span', '', 'کمتر'));
    for (let level = 0; level <= 4; level++) { const swatch = node('i'); swatch.dataset.level = level; swatch.setAttribute('aria-hidden', 'true'); calendarLegend.append(swatch); }
    calendarLegend.append(node('span', '', 'بیشتر'));
    const amountLegend = node('div', 'calendar-amount-legend');
    amountLegend.append(node('span', 'calendar-income-key', '+ واریز'), node('span', 'calendar-expense-key', '− برداشت'), identified('span', 'calendarUnit'));
    calendarBody.append(calendarLegend, amountLegend,
      hint('تقویم مستقل از فیلتر تاریخ، کل ماه انتخابی را با رعایت سایر فیلترها نشان می‌دهد. انتخاب روز، تاریخ جدول و گزارش‌های وابسته را تغییر می‌دهد و اطلاعات روزهای دیگر تقویم حفظ می‌شود. روز بدون رکورد، نبود تراکنش در بانک را ثابت نمی‌کند.'),
      node('p', 'analytics-hint calendar-compact-hint', 'در نمایش کوچک، مبالغ خلاصه و گرد می‌شوند؛ برای دیدن ارقام دقیق، روز را انتخاب کنید یا نشانگر را روی آن نگه دارید.'));

    const reviewBody = section('review', 'تراکنش‌های نیازمند بررسی', 'مبلغ نامعمول، پرداخت مشابه نزدیک و تعارض شناسه');
    reviewBody.append(hint('این نشانه‌ها خطا یا تقلب را اثبات نمی‌کنند. دلیل هر مورد و ردیف‌های مرتبط برای بررسی شما نمایش داده می‌شود.'),
      labeled('نوع نشانه', select('reviewKind', [['all', 'همه نشانه‌ها'], ['large', 'برداشت بزرگ نسبت به الگو'], ['repeat', 'پرداخت‌های مشابه نزدیک'], ['conflict', 'شناسه با اطلاعات متفاوت']], () => { view.reviewPage = 1; renderReview(); }), 'analytics-inline-control no-print'),
      identified('div', 'reviewList', 'analytics-candidates'),
      navigation('review', () => { view.reviewPage--; renderReview(); }, () => { view.reviewPage++; renderReview(); }));

    const qualityBody = section('quality', 'کیفیت و اصلاح دسته‌بندی', 'سهم تراکنش‌های بدون دسته و دسته‌های ناشناخته را کامل کنید');
    qualityBody.append(identified('div', 'categoryQualitySummary', 'analytics-quality-metrics'));
    const qualityActions = node('div', 'analytics-actions no-print');
    qualityActions.append(button('نمایش بدون دسته‌ها', () => drilldown(view.quality.uncategorizedRowIds, 'تراکنش‌های بدون دسته‌بندی'), 'qualityUncategorized'),
      button('نمایش دسته‌های ناشناخته', () => drilldown(view.quality.unresolvedRowIds, 'دسته‌های ناشناخته'), 'qualityUnresolved'),
      button('↓ خروجی اصلاحات', () => options.onExportEdits(), 'exportCategoryEdits'));
    qualityBody.append(qualityActions, hint('', 'qualityEditsNotice'),
      table('qualityCategoryBody', ['دسته‌بندی', 'وضعیت', 'تعداد', 'مجموع مبلغ', 'واریز', 'برداشت', 'تراکنش‌ها'], 'کیفیت دسته‌بندی به تفکیک دسته'),
      hint('دسته ناشناخته یعنی شناسه دسته در فایل وجود دارد، اما نام آن در فایل دسته‌بندی یا تراکنش مشخص نیست؛ این حالت با «بدون دسته» متفاوت است.'));
    const editHeading = node('div', 'analytics-subheading'); editHeading.append(node('h4', '', 'اصلاح دسته تراکنش‌ها'), node('p', '', 'تغییرات محلی است؛ برای نگهداری، خروجی اصلاحات بگیرید.'));
    const editToolbar = node('div', 'analytics-toolbar no-print');
    editToolbar.append(labeled('جست‌وجوی تراکنش', search('qualityRowSearch', 'شرح، پیگیری یا طرف حساب…', () => { view.qualityPage = 1; renderQualityRows(); })),
      labeled('نمایش ردیف‌ها', select('qualityRowsScope', [['issues', 'بدون دسته و ناشناخته'], ['all', 'همه تراکنش‌های محدوده']], () => { view.qualityPage = 1; renderQualityRows(); })));
    qualityBody.append(editHeading, editToolbar,
      table('qualityEditRows', ['تاریخ', 'شرح', 'دسته فعلی', 'مبلغ', 'اصلاح'], 'تراکنش‌های قابل اصلاح دسته‌بندی'),
      navigation('quality', () => { view.qualityPage--; renderQualityRows(); }, () => { view.qualityPage++; renderQualityRows(); }));

    function comparisonError(message) {
      view.comparison = null; ids.comparisonError.hidden = false;
      ids['report-comparison-count'].textContent = 'نیازمند اصلاح تاریخ';
      ids.comparisonError.textContent = `${message} تا اصلاح تاریخ‌ها مقایسه نمایش داده نمی‌شود.`;
      ids.comparisonMetrics.replaceChildren(); ids.comparisonCategories.replaceChildren(); ids.comparisonCoverage.textContent = '';
    }
    function setDefaultRanges() {
      const bounds = observedBounds();
      if (!bounds.last) {
        ['comparisonStart', 'comparisonEnd', 'comparisonPreviousStart', 'comparisonPreviousEnd'].forEach(id => { ids[id].value = ''; });
        return;
      }
      const filters = view.context.filters || {};
      const end = filters.endDate || bounds.last;
      let start = filters.startDate || A.shiftDay(end, -29);
      if (!filters.startDate && start < bounds.first && bounds.first <= end) start = bounds.first;
      if (start > end) start = end;
      const length = A.daysBetween(start, end);
      ids.comparisonStart.value = dateLabel(start); ids.comparisonEnd.value = dateLabel(end);
      ids.comparisonPreviousEnd.value = dateLabel(A.shiftDay(start, -1));
      ids.comparisonPreviousStart.value = dateLabel(A.shiftDay(start, -length));
    }
    function renderComparison() {
      if (!view.context) return;
      const comparisonScope = 'این بخش تاریخ مستقل دارد؛ جست‌وجو، نوع، دسته، روش، مبلغ و انتخاب جزئیات همچنان اعمال می‌شوند.';
      ids.comparisonScope.textContent = view.context.drilldownLabel ? `${comparisonScope} انتخاب جزئیات: ${view.context.drilldownLabel}` : comparisonScope;
      if (!view.context.allRows.length) {
        view.comparison = null; ids.comparisonMetrics.replaceChildren();
        emptyRow(ids.comparisonCategories, 5, 'برای مقایسه، ابتدا تراکنش وارد کنید.');
        ids.comparisonError.hidden = true; ids.comparisonCoverage.textContent = ''; ids['report-comparison-count'].textContent = 'بدون داده'; return;
      }
      try {
        const current = { start: D.jalaliToISO(ids.comparisonStart.value), end: D.jalaliToISO(ids.comparisonEnd.value) };
        const previous = { start: D.jalaliToISO(ids.comparisonPreviousStart.value), end: D.jalaliToISO(ids.comparisonPreviousEnd.value) };
        if (!current.start || !current.end || !previous.start || !previous.end) throw new Error('هر چهار تاریخ شمسی را وارد کنید.');
        const result = A.comparePeriods(view.context.baselineRows, current, previous); view.comparison = result;
        ids.comparisonError.hidden = true; ids['report-comparison-count'].textContent = `دو بازه ${number(result.days)} روزه`;
        const bounds = observedBounds();
        const outside = current.start < bounds.first || current.end > bounds.last || previous.start < bounds.first || previous.end > bounds.last;
        ids.comparisonCoverage.textContent = `بازه انتخابی: ${dateLabel(current.start)} تا ${dateLabel(current.end)} · مبنا: ${dateLabel(previous.start)} تا ${dateLabel(previous.end)}${outside ? ' · بخشی از بازه‌ها خارج از اولین تا آخرین تاریخ فایل است؛ صفر یا کاهش مبلغ ممکن است ناشی از پوشش ناقص داده باشد.' : ' · پوشش زمانی فایل، کامل بودن صورت‌حساب را تضمین نمی‌کند.'}`;
        ids.comparisonCoverage.classList.toggle('analytics-caution', outside);
        ids.comparisonMetrics.replaceChildren(...[['income', 'واریز'], ['expense', 'برداشت'], ['net', 'خالص گردش'], ['count', 'تعداد تراکنش']].map(([key, label]) => {
          const card = node('article', 'analytics-metric'); card.dataset.metric = key;
          const currentValue = node('strong', '', key === 'count' ? number(result.current[key]) : moneyWithUnit(result.current[key])); currentValue.dataset.period = 'current';
          const previousValue = node('span', 'analytics-hint', `مبنا: ${key === 'count' ? number(result.previous[key]) : moneyWithUnit(result.previous[key])}`); previousValue.dataset.period = 'previous';
          const delta = node('span', 'analytics-change', `تغییر: ${key === 'count' ? `${result.changes[key].value > 0 ? '+' : ''}${number(result.changes[key].value)}` : signedMoney(result.changes[key].value) + ' ' + view.context.unitLabel}`); delta.dataset.period = 'delta';
          const percent = node('span', 'analytics-hint', ratioText(result.changes[key])); percent.dataset.period = 'percent';
          card.append(node('p', '', label), currentValue, previousValue, delta, percent); return card;
        }));
        const measure = ids.comparisonMeasure.value;
        const groups = [...result.categories].sort((a, b) => Math.abs(b[`${measure}Change`].value) - Math.abs(a[`${measure}Change`].value));
        const rows = groups.map(group => {
          const row = node('tr'), name = node('td'); name.append(options.categoryChip(group));
          row.append(name, node('td', 'money', money(group.previous[measure])), node('td', 'money', money(group.current[measure])),
            node('td', 'money', signedMoney(group[`${measure}Change`].value)), node('td', '', ratioText(group[`${measure}Change`]))); return row;
        });
        if (rows.length) ids.comparisonCategories.replaceChildren(...rows); else emptyRow(ids.comparisonCategories, 5, 'در این دو بازه، تراکنشی با فیلترهای فعلی وجود ندارد.');
      } catch (error) { comparisonError(error.message); }
    }
    function renderParties() {
      if (!view.parties) return;
      const query = D.normalizeSearch(ids.partySearch.value), sort = ids.partySort.value;
      const groups = view.parties.groups.filter(group => !query || D.normalizeSearch(`${group.label} ${group.identifier} ${group.bankName || ''} ${group.bankCode || ''}`).includes(query))
        .sort((a, b) => b[sort] - a[sort] || collator.compare(a.label, b.label));
      const kindNames = { account: 'حساب', card: 'کارت', iban: 'شبا', merchant: 'پذیرنده', name: 'گروه هم‌نام' };
      ids['report-counterparties-count'].textContent = `${number(view.parties.groups.length)} طرف حساب`;
      ids.partyCoverage.textContent = `${number(view.parties.knownCount)} تراکنش دارای اطلاعات طرف حساب · ${number(view.parties.unknownCount)} تراکنش بدون اطلاعات قابل گروه‌بندی، به مبلغ ${moneyWithUnit(view.parties.unknownAmount)}`;
      const rows = pageRows(groups, 'partyPage', 'party').map(group => {
        const row = node('tr'), party = node('td', 'analytics-party-cell');
        party.title = group.label;
        party.append(node('strong', '', group.label));
        if (group.identifier && group.identifier !== group.label) { const identifier = node('bdi', 'cell-secondary', group.identifier); identifier.dir = 'ltr'; party.append(identifier); }
        if (group.bankName || group.bankCode) party.append(node('span', 'cell-secondary', group.bankName || `کد بانک: ${group.bankCode}`));
        party.append(node('span', 'cell-secondary', group.confidence === 'name' ? 'گروه هم‌نام؛ هویت قطعی نیست' : kindNames[group.kind] || 'شناسه ثبت‌شده'));
        const action = node('td'), show = button('مشاهده', () => drilldown(group.rowIds, `طرف حساب: ${group.label}`), undefined, 'row-detail no-print');
        show.dataset.partyKey = group.key; action.append(show);
        row.append(party, node('td', '', number(group.count)), node('td', 'money credit', money(group.income)), node('td', 'money debit', money(group.expense)),
          node('td', 'money', signedMoney(group.net)), node('td', '', dateLabel(group.lastDate)), action); return row;
      });
      if (rows.length) ids.counterpartyBody.replaceChildren(...rows); else emptyRow(ids.counterpartyBody, 7, 'طرف حساب قابل نمایش در محدوده فعلی پیدا نشد.');
    }
    function candidateCard(title, reason, facts, action, dataName, key) {
      const card = node('article', 'analytics-candidate'), heading = node('div', 'analytics-candidate-heading');
      const show = button('مشاهده تراکنش‌ها', action, undefined, 'button compact no-print'); show.dataset[dataName] = key;
      heading.append(node('h4', '', title), show); card.append(heading, node('p', 'analytics-reason', reason));
      const factList = node('dl', 'analytics-facts');
      facts.forEach(([label, value]) => { const fact = node('div'); fact.append(node('dt', '', label), node('dd', '', value)); factList.append(fact); });
      card.append(factList); return card;
    }
    function renderRecurring() {
      ids['report-recurring-count'].textContent = `${number(view.recurring.length)} الگوی احتمالی`;
      const candidates = pageRows(view.recurring, 'recurrencePage', 'recurrence');
      ids.recurringList.replaceChildren(...(candidates.length ? candidates.map(group => candidateCard(group.label, group.reason,
        [['تعداد مشاهده', number(group.count)], ['مبلغ معمول', moneyWithUnit(group.amount)], ['مجموع برداشت', moneyWithUnit(group.total)],
          ['آخرین مشاهده', dateLabel(group.lastDate)], ['مشاهده بعدی احتمالی', dateLabel(group.nextDate)], ['روش', group.method]],
        () => drilldown(group.rowIds, `الگوی تکرار احتمالی: ${group.label}`), 'recurrenceKey', group.key))
        : [node('p', 'analytics-empty', 'الگوی کافی برای پیشنهاد پرداخت تکرارشونده پیدا نشد؛ نبود الگو، نبود تعهد مالی را نشان نمی‌دهد.')]));
    }
    function monthOptions() {
      const months = new Map(view.context.allRows.map(row => [row.month, row.monthLabel]));
      if (view.calendar && !months.has(view.month)) months.set(view.month, view.calendar.title);
      ids.calendarMonth.replaceChildren();
      [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([value, label]) => ids.calendarMonth.add(new Option(label, value)));
      ids.calendarMonth.value = view.month;
    }
    function moveMonth(direction) {
      if (!view.calendar) return;
      view.month = direction < 0 ? view.calendar.previousMonth : view.calendar.nextMonth; renderCalendar();
    }
    function renderCalendar() {
      if (!view.context) return;
      if (!view.month) {
        view.calendar = null; ids.calendarGrid.replaceChildren(); ids.calendarMonth.replaceChildren(); ids.calendarTitle.textContent = 'تقویم تراکنش‌ها';
        ids.calendarSummary.textContent = 'برای نمایش تقویم، ابتدا تراکنش وارد کنید.';
        ids.calendarPrevious.disabled = true; ids.calendarNext.disabled = true; ids['report-calendar-count'].textContent = 'بدون داده'; return;
      }
      try {
        // Keep the month intact when a day narrows the global date range.
        // baselineRows still includes search, category, amount and drilldown filters.
        const metric = ids.calendarMetric.value, result = A.calendar(view.context.baselineRows, view.month, metric); view.calendar = result;
        monthOptions(); ids.calendarTitle.textContent = result.title;
        const metricLabel = metric === 'count' ? 'تعداد تراکنش' : metric === 'income' ? 'مجموع واریز' : 'مجموع برداشت';
        ids.calendarSummary.textContent = `${metricLabel} کل ماه با فیلترهای فعلی: ${metric === 'count' ? number(result.total) : moneyWithUnit(result.total)}`;
        ids.calendarUnit.textContent = `مبالغ به ${view.context.unitLabel}`;
        ids['report-calendar-count'].textContent = result.title;
        const observed = observedBounds(), firstMonth = observed.first ? D.isoToJalali(observed.first).slice(0, 7).replace('/', '-') : '';
        const lastMonth = observed.last ? D.isoToJalali(observed.last).slice(0, 7).replace('/', '-') : '';
        ids.calendarPrevious.disabled = !!firstMonth && view.month <= firstMonth;
        ids.calendarNext.disabled = !!lastMonth && view.month >= lastMonth;
        const cells = Array.from({ length: result.offset }, () => { const space = node('span', 'analytics-calendar-spacer'); space.setAttribute('aria-hidden', 'true'); return space; });
        for (const day of result.cells) {
          const cell = button('', () => options.onDay(day.day), undefined, 'analytics-day'); cell.dataset.day = day.day;
          cell.dataset.level = String(day.value > 0 && result.max > 0 ? Math.min(4, Math.ceil(day.value / result.max * 4)) : 0);
          const selected = view.context.filters.startDate === day.day && view.context.filters.endDate === day.day;
          cell.setAttribute('aria-pressed', String(selected));
          cell.title = `${day.dateLabel} · ${number(day.count)} تراکنش · واریز: ${moneyWithUnit(day.income)} · برداشت: ${moneyWithUnit(day.expense)}`;
          cell.setAttribute('aria-label', `${cell.title}؛ نمایش تراکنش‌های این روز`);
          cell.append(node('strong', '', number(day.jalaliDay)), calendarAmount('income', day.income), calendarAmount('expense', day.expense),
            node('small', 'calendar-count', day.count ? `${number(day.count)} تراکنش` : 'بدون رکورد'));
          if (day.day < observed.first || day.day > observed.last) cell.classList.add('outside-observation');
          cells.push(cell);
        }
        ids.calendarGrid.replaceChildren(...cells);
      } catch (error) {
        view.calendar = null;
        ids.calendarGrid.replaceChildren(node('p', 'analytics-empty', error.message));
        ids.calendarTitle.textContent = 'تقویم قابل نمایش نیست';
        ids.calendarSummary.textContent = 'ماه انتخاب‌شده خارج از محدوده تقویم پشتیبانی‌شده است.';
        ids['report-calendar-count'].textContent = 'ماه نامعتبر';
        ids.calendarPrevious.disabled = true; ids.calendarNext.disabled = true;
        monthOptions();
      }
    }
    function renderReview() {
      if (!view.review) return;
      const kind = ids.reviewKind.value;
      const items = view.review.items.filter(item => kind === 'all' || item.kind === kind);
      ids['report-review-count'].textContent = `${number(view.review.items.length)} نشانه`;
      const cards = pageRows(items, 'reviewPage', 'review').map(item => candidateCard(item.title, item.reason,
        [['ردیف‌های مرتبط', number(item.count)], ['مبلغ مورد بررسی', moneyWithUnit(item.amount)]],
        () => drilldown(item.rowIds, item.title), 'reviewKey', item.key));
      ids.reviewList.replaceChildren(...(cards.length ? cards : [node('p', 'analytics-empty', 'با معیارهای فعلی، موردی برای بررسی پیدا نشد. این نتیجه تأیید صحت همه تراکنش‌ها نیست.')]));
    }
    function renderQuality() {
      const quality = view.quality;
      if (!quality) return;
      const statusLabels = { categorized: 'دسته مشخص', uncategorized: 'بدون دسته', unresolved: 'نام دسته نامشخص' };
      ids['report-quality-count'].textContent = `${number(quality.uncategorizedCount + quality.unresolvedCount)} نیازمند تکمیل`;
      const summaries = [['پوشش دسته‌بندی', percentage.format(quality.coverage), `${number(quality.categorizedCount)} از ${number(quality.count)} تراکنش`],
        ['بدون دسته‌بندی', number(quality.uncategorizedCount), moneyWithUnit(quality.uncategorizedAmount)],
        ['دسته ناشناخته', number(quality.unresolvedCount), moneyWithUnit(quality.unresolvedAmount)]];
      ids.categoryQualitySummary.replaceChildren(...summaries.map(([label, value, detail]) => {
        const card = node('article', 'analytics-metric'); card.append(node('p', '', label), node('strong', '', value), node('span', 'analytics-hint', detail)); return card;
      }));
      ids.qualityUncategorized.disabled = !quality.uncategorizedCount; ids.qualityUnresolved.disabled = !quality.unresolvedCount;
      ids.exportCategoryEdits.disabled = !view.context.editedCount;
      ids.qualityEditsNotice.textContent = `${number(view.context.editedCount || 0)} اصلاح محلی در کل فایل · خروجی اصلاحات شامل همه تغییرات فایل است، مستقل از فیلترهای گزارش.`;
      const rows = quality.categories.map(group => {
        const row = node('tr'), name = node('td'); name.append(options.categoryChip(group));
        const action = node('td'); action.append(button('مشاهده', () => drilldown(group.rowIds, `دسته: ${group.name}`), undefined, 'row-detail no-print'));
        row.append(name, node('td', '', statusLabels[group.status]), node('td', '', number(group.count)), node('td', 'money', money(group.amount)),
          node('td', 'money credit', money(group.income)), node('td', 'money debit', money(group.expense)), action); return row;
      });
      if (rows.length) ids.qualityCategoryBody.replaceChildren(...rows); else emptyRow(ids.qualityCategoryBody, 7, 'تراکنشی در محدوده فعلی وجود ندارد.');
      renderQualityRows();
    }
    function renderQualityRows() {
      if (!view.context || !view.quality) return;
      const scope = ids.qualityRowsScope.value, query = D.normalizeSearch(ids.qualityRowSearch.value);
      const issues = new Set([...view.quality.uncategorizedRowIds, ...view.quality.unresolvedRowIds]);
      const rows = view.context.rows.filter(row => (scope === 'all' || issues.has(row.id)) && (!query || D.normalizeSearch(`${row.description} ${row.trace} ${row.counterparty} ${row.category}`).includes(query)))
        .sort((a, b) => b.timestamp - a.timestamp);
      const shown = pageRows(rows, 'qualityPage', 'quality', 10).map(row => {
        const tr = node('tr'), category = node('td'); category.append(options.categoryChip(row));
        const action = node('td'), edit = button('اصلاح دسته', () => options.onEditCategory(row.id), undefined, 'row-detail no-print'); edit.dataset.editRow = row.id; action.append(edit);
        tr.append(node('td', '', row.dateLabel), node('td', 'analytics-description', row.description), category, node('td', 'money', money(row.amount)), action); return tr;
      });
      if (shown.length) ids.qualityEditRows.replaceChildren(...shown); else emptyRow(ids.qualityEditRows, 5, scope === 'issues' ? 'ردیف نیازمند تکمیل پیدا نشد؛ برای تغییر دسته‌های موجود، «همه تراکنش‌های محدوده» را انتخاب کنید.' : 'تراکنشی با این جست‌وجو پیدا نشد.');
    }
    function render(context) {
      const previousContext = view.context;
      view.context = context; view.printing = !!context.printing;
      const dataset = context.datasetKey ?? context.allRows;
      const dateKey = `${context.filters.startDate || ''}|${context.filters.endDate || ''}`;
      const newDataset = dataset !== view.dataset;
      if (newDataset || dateKey !== view.dateKey) {
        setDefaultRanges();
        const bounds = observedBounds(), selected = context.filters.endDate || context.filters.startDate || bounds.last;
        view.month = selected ? D.isoToJalali(selected).slice(0, 7).replace('/', '-') : '';
      }
      if (newDataset) {
        ids.partySearch.value = ''; ids.partySort.value = 'expense'; ids.qualityRowSearch.value = ''; ids.qualityRowsScope.value = 'issues'; ids.reviewKind.value = 'all';
      }
      if (newDataset || previousContext?.rows !== context.rows) view.partyPage = view.recurrencePage = view.reviewPage = view.qualityPage = 1;
      view.dataset = dataset; view.dateKey = dateKey;
      view.parties = A.counterparties(context.rows); view.recurring = A.recurring(context.rows);
      view.review = A.reviewTransactions(context.rows); view.quality = A.categoryQuality(context.rows, context.categories);
      renderComparison(); renderParties(); renderRecurring(); renderCalendar(); renderReview(); renderQuality();
    }
    function csvMoney(value) {
      const divisor = view.context.unitLabel === 'ریال' ? 1n : 10n;
      const raw = BigInt(value), absolute = raw < 0n ? -raw : raw;
      return { numeric: `${raw < 0n ? '-' : ''}${absolute / divisor}${absolute % divisor ? '.' + absolute % divisor : ''}` };
    }
    function exportRows() {
      if (!view.context) return [];
      const rows = [['گزارش‌های پیشرفته', `واحد ${view.context.unitLabel}`]];
      const compare = view.comparison;
      if (compare) {
        rows.push(['مقایسه دو بازه', 'عنوان', 'از', 'تا', 'تعداد', 'واریز', 'برداشت', 'خالص']);
        for (const [name, result] of [['انتخابی', compare.current], ['مبنا', compare.previous]]) rows.push(['مقایسه', name, dateLabel(result.range.start), dateLabel(result.range.end), result.count, csvMoney(result.income), csvMoney(result.expense), csvMoney(result.net)]);
        rows.push(['تغییر دسته‌ها', 'دسته', 'واریز مبنا', 'واریز انتخابی', 'برداشت مبنا', 'برداشت انتخابی', 'تغییر برداشت']);
        compare.categories.forEach(group => rows.push(['دسته در مقایسه', group.name, csvMoney(group.previous.income), csvMoney(group.current.income), csvMoney(group.previous.expense), csvMoney(group.current.expense), csvMoney(group.expenseChange.value)]));
      }
      rows.push(['طرف حساب', 'نام', 'شناسه', 'بانک', 'اطمینان هویت', 'تعداد', 'واریز', 'برداشت', 'خالص', 'آخرین ارتباط']);
      view.parties.groups.forEach(group => rows.push(['طرف حساب', group.label, group.identifier, group.bankName || group.bankCode || '', group.confidence === 'name' ? 'هم‌نام؛ نامطمئن' : 'شناسه ثبت‌شده', group.count, csvMoney(group.income), csvMoney(group.expense), csvMoney(group.net), dateLabel(group.lastDate)]));
      rows.push(['اطلاعات طرف حساب موجود نیست', view.parties.unknownCount, csvMoney(view.parties.unknownAmount)]);
      rows.push(['تکرار احتمالی', 'طرف حساب', 'روش', 'تعداد', 'مبلغ معمول', 'مجموع', 'آخرین مشاهده', 'بعدی احتمالی', 'دلیل']);
      view.recurring.forEach(group => rows.push(['تکرار احتمالی', group.label, group.method, group.count, csvMoney(group.amount), csvMoney(group.total), dateLabel(group.lastDate), dateLabel(group.nextDate), group.reason]));
      rows.push(['نیازمند بررسی', 'نشانه', 'تعداد ردیف', 'مبلغ', 'دلیل']);
      view.review.items.forEach(item => rows.push(['نیازمند بررسی', item.title, item.count, csvMoney(item.amount), item.reason]));
      rows.push(['کیفیت دسته', 'دسته', 'وضعیت', 'تعداد', 'مجموع مبلغ']);
      const statuses = { categorized: 'دسته مشخص', uncategorized: 'بدون دسته', unresolved: 'نام دسته نامشخص' };
      view.quality.categories.forEach(group => rows.push(['کیفیت دسته', group.name, statuses[group.status], group.count, csvMoney(group.amount)]));
      if (view.calendar) {
        rows.push(['تقویم شمسی؛ کل ماه با سایر فیلترها', view.calendar.title, 'تعداد', 'واریز', 'برداشت']);
        view.calendar.cells.forEach(day => rows.push(['تقویم', day.dateLabel, day.count, csvMoney(day.income), csvMoney(day.expense)]));
      }
      return rows;
    }
    function clear() {
      view.context = null; view.dataset = null; view.dateKey = ''; view.comparison = null; view.parties = null;
      view.recurring = []; view.review = null; view.quality = null; view.calendar = null; view.month = ''; view.scopeRows = null;
      view.partyPage = view.recurrencePage = view.reviewPage = view.qualityPage = 1;
      ['comparisonMetrics', 'comparisonCategories', 'counterpartyBody', 'recurringList', 'calendarGrid', 'reviewList', 'categoryQualitySummary', 'qualityCategoryBody', 'qualityEditRows'].forEach(id => ids[id].replaceChildren());
      ['comparisonScope', 'comparisonCoverage', 'comparisonError', 'partyCoverage', 'calendarTitle', 'calendarSummary', 'qualityEditsNotice', 'partyPageInfo', 'recurrencePageInfo', 'reviewPageInfo', 'qualityPageInfo'].forEach(id => { ids[id].textContent = ''; });
      names.forEach(([key]) => { ids[`report-${key}-count`].textContent = ''; });
      ['comparisonStart', 'comparisonEnd', 'comparisonPreviousStart', 'comparisonPreviousEnd', 'partySearch', 'qualityRowSearch'].forEach(id => { ids[id].value = ''; });
      ids.calendarMonth.replaceChildren(); ids.comparisonError.hidden = true;
    }
    return Object.freeze({ render, clear, exportRows });
  }
  window.BaamReports = Object.freeze({ create });
})();
