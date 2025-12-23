// BAAM Viewer Main Script
"use strict";

/**
 * BAAM Viewer Main Script (Refactored)
 * Modular, maintainable, and professional JavaScript
 */
(() => {
  // --- Chart Defaults ---
  if (window.Chart) {
    Chart.defaults.font.family = "Vazir, sans-serif";
    Chart.defaults.font.size = 14;
  }

  /**
   * Get last month's date in YYYY-MM-DD format
   * @returns {string}
   */
  /**
   * Returns the date of the same day last month in YYYY-MM-DD format
   * @returns {string}
   */
  const getLastMonthDate = () => {
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);
    return lastMonth.toISOString().slice(0, 10);
  };

  /**
   * Show alert message (auto-dismiss)
   * @param {string} message
   * @param {number} [timeout=5000]
   */
  /**
   * Display an alert message that auto-dismisses
   * @param {string} message
   * @param {number} [timeout=5000]
   */
  const showAlert = (message, timeout = 5000) => {
    let alertContainer = document.getElementById("alert_container");
    if (!alertContainer) {
      alertContainer = document.createElement("div");
      alertContainer.id = "alert_container";
      alertContainer.setAttribute("role", "alert");
      alertContainer.setAttribute("aria-live", "assertive");
      alertContainer.className = "alert alert-error fixed top-4 left-1 z-50";
      alertContainer.setAttribute("dir", "rtl");
      document.body.appendChild(alertContainer);
    }
    alertContainer.textContent = message;
    setTimeout(() => {
      if (alertContainer) alertContainer.remove();
    }, timeout);
  };

  /**
   * Detect if a hex color is light
   * @param {string} color
   * @returns {boolean}
   */
  /**
   * Determines if a hex color is light
   * @param {string} color
   * @returns {boolean}
   */
  const isColorLight = (color = "#777777") => {
    let r, g, b;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(color)) {
      if (color.length === 4) {
        r = parseInt(color[1] + color[1], 16);
        g = parseInt(color[2] + color[2], 16);
        b = parseInt(color[3] + color[3], 16);
      } else {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
      }
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      return luminance > 128;
    }
    return false;
  };

  // --- Initialization ---
  // Set last month date in all relevant elements
  // Set last month date in all elements with .last_month_date_url
  document.querySelectorAll(".last_month_date_url").forEach((el) => {
    el.textContent = getLastMonthDate();
  });

  // --- Bank Account Input Handling ---
  const bankAccountInput = document.getElementById("bank_account_input");
  const bankAccountData = document.getElementById("bank_account_data");
  const accountNumberRegex = /^0\d{12}$/;
  if (bankAccountInput && bankAccountData) {
    bankAccountInput.addEventListener("input", ({ target }) => {
      const accountNumber = target.value.trim();
      bankAccountData.textContent = accountNumber || "BANK_ACCOUNT";
      const isValid = accountNumberRegex.test(accountNumber);
      target.classList.toggle("text-red-500", !isValid);
      target.classList.toggle("border-red-500", !isValid);
    });
  }

  // --- Category File Upload Handling ---
  const allCategories = [];
  const categoriesFileInput = document.getElementById("categoriesFile");
  if (categoriesFileInput) {
    categoriesFileInput.addEventListener("change", ({ target }) => {
      const files = Array.from(target.files);
      if (!files.length) return;
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const categoriesData = JSON.parse(e.target.result);
            processCategoriesData(categoriesData);
          } catch (error) {
            showAlert(`خطا در خواندن فایل بام: ${error.message}`);
          }
        };
        reader.onerror = () => showAlert("خواندن فایل با خطا مواجه شد.");
        reader.readAsText(file, "UTF-8");
      });
    });
  }

  // -- baamFile Upload Handling ---
  const allTransactions = {
    startDate: null,
    endDate: null,
    income: 0,
    expense: 0,
    overallAmount: 0,
    totalCount: 0,
    incomeCount: 0,
    expenseCount: 0,
    transactions: [],
    daily_summaries: {},
    categories: [],
    types: [],
  };

  const baamFileInput = document.getElementById("baamFile");
  if (baamFileInput) {
    baamFileInput.addEventListener("change", ({ target }) => {
      const files = Array.from(target.files);
      if (!files.length) return;
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const baamData = JSON.parse(e.target.result);
            processBaamData(baamData);
          } catch (error) {
            showAlert(`خطا در خواندن فایل بام: ${error.message}`);
          }
        };
        reader.onerror = () => showAlert("خواندن فایل با خطا مواجه شد.");
        reader.readAsText(file, "UTF-8");
      });
    });
  }

  /**
   * Add a transaction to its category summary
   * @param {object} data
   */
  function addToCategory(data) {
    if (!data) return;
    let category_id = data.categoryId || 0;
    // Validate category_id in allCategories
    let categoryExistsData = allCategories.find(
      (cat) => cat.id === category_id
    );
    if (!categoryExistsData) {
      category_id = 0; // assign to "No Category"
      categoryExistsData = allCategories.find((cat) => cat.id === 0);
    }
    // Check if category already exists in allTransactions.categories by id
    let categoryIndex = allTransactions.categories.findIndex(
      (cat) => cat.id === category_id
    );
    if (categoryIndex === -1) {
      // Not found, add new
      let current_category_data = {
        id: categoryExistsData.id,
        name: categoryExistsData.name,
        color: categoryExistsData.color,
        textColorClass: categoryExistsData.textColorClass,
        income: 0,
        incomeCount: 0,
        expense: 0,
        expenseCount: 0,
        totalAmount: 0,
        transactionCount: 0,
      };
      allTransactions.categories.push(current_category_data);
      categoryIndex = allTransactions.categories.length - 1;
    }
    if (data.creditDebit === "CREDIT") {
      allTransactions.categories[categoryIndex].income += data.amount;
      allTransactions.categories[categoryIndex].incomeCount += 1;
    } else if (data.creditDebit === "DEBIT") {
      if (category_id === 0) {
        // Optionally log: console.log("Transaction with no category:", data);
      }
      allTransactions.categories[categoryIndex].expense += data.amount;
      allTransactions.categories[categoryIndex].expenseCount += 1;
    }
    allTransactions.categories[categoryIndex].totalAmount += data.amount;
    allTransactions.categories[categoryIndex].transactionCount += 1;
  }

  /**
   * Add a transaction to its type summary
   * @param {object} data
   */
  function addToTypes(data) {
    if (!data) return;
    let type_name = data.transactionDescription || "نامشخص";
    let typeIndex = allTransactions.types.findIndex(
      (type) => type.name === type_name
    );
    if (typeIndex === -1) {
      allTransactions.types.push({
        name: type_name,
        income: 0,
        incomeCount: 0,
        expense: 0,
        expenseCount: 0,
        totalAmount: 0,
        transactionCount: 0,
      });
      typeIndex = allTransactions.types.length - 1;
    }
    if (data.creditDebit === "CREDIT") {
      allTransactions.types[typeIndex].income += data.amount;
      allTransactions.types[typeIndex].incomeCount += 1;
    } else if (data.creditDebit === "DEBIT") {
      allTransactions.types[typeIndex].expense += data.amount;
      allTransactions.types[typeIndex].expenseCount += 1;
    }
    allTransactions.types[typeIndex].totalAmount += data.amount;
    allTransactions.types[typeIndex].transactionCount += 1;
  }

  // --- Process and Render Transactions ---
  function processBaamData(baamData) {
    if (
      !Array.isArray(baamData) ||
      !baamData.length ||
      !baamData[0].hasOwnProperty("transactionId")
    ) {
      showAlert("فایل نامعتبر بام انتخاب شده است.");
      return;
    }

    // sort all by transactionDateTime
    baamData.sort((a, b) => {
      return new Date(a.transactionDateTime) - new Date(b.transactionDateTime);
    });

    const transactions_result = document.getElementById("transactions_result");
    if (transactions_result) {
      transactions_result.classList.remove("hidden");
    }

    allTransactions.startDate = new JDate(
      new Date(baamData[0].transactionDateTime)
    ).format("dddd DD MMMM YYYY");
    allTransactions.endDate = new JDate(
      new Date(baamData[baamData.length - 1].transactionDateTime)
    ).format("dddd DD MMMM YYYY");
    allTransactions.totalCount = baamData.length;

    baamData.forEach((tx) => {
      let txDate = new JDate(new Date(tx.transactionDateTime)).format(
        "YYYY-MM-DD"
      );

      if (!allTransactions.daily_summaries[txDate]) {
        allTransactions.daily_summaries[txDate] = {
          income: 0,
          expense: 0,
          balance: 0,
        };
      }

      if (tx.creditDebit === "CREDIT") {
        allTransactions.income += tx.amount;
        allTransactions.incomeCount += 1;
        allTransactions.daily_summaries[txDate].income += tx.amount;
      } else if (tx.creditDebit === "DEBIT") {
        allTransactions.expense += tx.amount;
        allTransactions.expenseCount += 1;
        allTransactions.daily_summaries[txDate].expense += tx.amount;
      }

      addToCategory(tx);
      addToTypes(tx);

      allTransactions.daily_summaries[txDate].balance = tx.balance;
      allTransactions.overallAmount += tx.amount;
      allTransactions.transactions.push(tx);
    });

    console.log("All Transactions Processed:", allTransactions);

    setDataTextContent("start_date_display", allTransactions.startDate);
    setDataTextContent("end_date_display", allTransactions.endDate);

    const chart_amounts = document.getElementById("chart_amounts");
    if (chart_amounts) {
      let ctx = chart_amounts.getContext("2d");
      if (!ctx) {
        showAlert("خطا: امکان دریافت context از canvas وجود ندارد.");
        return;
      }
      const amounts_chart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["دریافتی", "پرداختی", "مجموع"],
          datasets: [
            {
              label: "مبالغ (ریال)",
              data: [
                allTransactions.income,
                allTransactions.expense,
                allTransactions.overallAmount,
              ],
              backgroundColor: [
                "rgba(75, 192, 192, 0.7)",
                "rgba(255, 99, 132, 0.7)",
                "rgba(54, 162, 235, 0.7)",
              ],
              borderColor: [
                "rgba(75, 192, 192, 1)",
                "rgba(255, 99, 132, 1)",
                "rgba(54, 162, 235, 1)",
              ],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "top",
            },
            title: {
              display: true,
              text: "نمودار مبالغ تراکنش‌ها",
            },
          },
        },
      });
    }

    const chart_counts = document.getElementById("chart_counts");
    if (chart_counts) {
      let ctx = chart_counts.getContext("2d");
      const counts_chart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["تعداد دریافتی", "تعداد پرداختی", "کل تراکنش‌ها"],
          datasets: [
            {
              label: "تعداد تراکنش‌ها",
              data: [
                allTransactions.incomeCount,
                allTransactions.expenseCount,
                allTransactions.totalCount,
              ],
              backgroundColor: [
                "rgba(75, 192, 192, 0.7)",
                "rgba(255, 99, 132, 0.7)",
                "rgba(54, 162, 235, 0.7)",
              ],
              borderColor: [
                "rgba(75, 192, 192, 1)",
                "rgba(255, 99, 132, 1)",
                "rgba(54, 162, 235, 1)",
              ],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "top",
            },
            title: {
              display: true,
              text: "نمودار تعداد تراکنش‌ها",
            },
          },
        },
      });

      const chart_category_income = document.getElementById("category_income");
      const chart_category_expense =
        document.getElementById("category_expense");
      if (chart_category_income && chart_category_expense) {
        let ctxIncome = chart_category_income.getContext("2d");
        let ctxExpense = chart_category_expense.getContext("2d");

        // Only show categories with nonzero income/expense for each chart
        const incomeCats = allTransactions.categories.filter(
          (cat) => cat.income > 0
        );
        const expenseCats = allTransactions.categories.filter(
          (cat) => cat.expense > 0
        );

        const categoryIncomeData = {
          labels: incomeCats.map((cat) => {
            const total = incomeCats.reduce((sum, c) => sum + c.income, 0);
            const percent = total ? Math.round((cat.income / total) * 100) : 0;
            return `${cat.name} (${percent}%)`;
          }),
          datasets: [
            {
              label: "دریافتی بر اساس دسته‌بندی (تومان)",
              data: incomeCats.map((cat) => Math.round(cat.income / 10)),
              backgroundColor: incomeCats.map((cat) => cat.color),
            },
          ],
        };
        const categoryExpenseData = {
          labels: expenseCats.map((cat) => {
            const total = expenseCats.reduce((sum, c) => sum + c.expense, 0);
            const percent = total ? Math.round((cat.expense / total) * 100) : 0;
            return `${cat.name} (${percent}%)`;
          }),
          datasets: [
            {
              label: "پرداختی بر اساس دسته‌بندی (تومان)",
              data: expenseCats.map((cat) => Math.round(cat.expense / 10)),
              backgroundColor: expenseCats.map((cat) => cat.color),
            },
          ],
        };

        const categoryIncomeChart = new Chart(ctxIncome, {
          type: "doughnut",
          data: categoryIncomeData,
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: "top",
              },
              title: {
                display: true,
                text: "دریافتی بر اساس دسته‌بندی",
              },
            },
          },
        });

        const categoryExpenseChart = new Chart(ctxExpense, {
          type: "doughnut",
          data: categoryExpenseData,
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: "top",
              },
              title: {
                display: true,
                text: "پرداختی بر اساس دسته‌بندی",
              },
            },
          },
        });
      }
    }

    const chart_types_income = document.getElementById("types_income");
    const chart_types_expense = document.getElementById("types_expense");
    if (chart_types_income && chart_types_expense) {
      let ctxIncome = chart_types_income.getContext("2d");
      let ctxExpense = chart_types_expense.getContext("2d");
      // Only show types with nonzero income/expense for each chart
      const incomeTypes = allTransactions.types.filter(
        (type) => type.income > 0
      );
      const expenseTypes = allTransactions.types.filter(
        (type) => type.expense > 0
      );

      const typesIncomeData = {
        labels: incomeTypes.map((type) => {
          const total = incomeTypes.reduce((sum, t) => sum + t.income, 0);
          const percent = total ? Math.round((type.income / total) * 100) : 0;
          return `${type.name} (${percent}%)`;
        }),
        datasets: [
          {
            label: "دریافتی بر اساس نوع تراکنش (تومان)",
            data: incomeTypes.map((type) => Math.round(type.income / 10)),
          },
        ],
      };
      const typesExpenseData = {
        labels: expenseTypes.map((type) => {
          const total = expenseTypes.reduce((sum, t) => sum + t.expense, 0);
          const percent = total ? Math.round((type.expense / total) * 100) : 0;
          return `${type.name} (${percent}%)`;
        }),
        datasets: [
          {
            label: "پرداختی بر اساس نوع تراکنش (تومان)",
            data: expenseTypes.map((type) => Math.round(type.expense / 10)),
          },
        ],
      };

      const typesIncomeChart = new Chart(ctxIncome, {
        type: "doughnut",
        data: typesIncomeData,
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "top",
            },
            title: {
              display: true,
              text: "دریافتی بر اساس نوع تراکنش",
            },
          },
        },
      });

      const typesExpenseChart = new Chart(ctxExpense, {
        type: "doughnut",
        data: typesExpenseData,
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "top",
            },
            title: {
              display: true,
              text: "پرداختی بر اساس نوع تراکنش",
            },
          },
        },
      });
    }

    const chart_daily_amounts = document.getElementById("chart_daily_amounts");
    if (chart_daily_amounts) {
      let ctx = chart_daily_amounts.getContext("2d");
      const dailyLabels = Object.keys(allTransactions.daily_summaries).sort();
      const dailyIncomeData = dailyLabels.map((date) =>
        Math.round(allTransactions.daily_summaries[date].income / 10)
      );
      const dailyExpenseData = dailyLabels.map((date) =>
        Math.round(allTransactions.daily_summaries[date].expense / 10)
      );
      const dailyBalanceData = dailyLabels.map((date) =>
        Math.round(allTransactions.daily_summaries[date].balance / 10)
      );

      const dailyAmountsChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: dailyLabels,
          datasets: [
            {
              label: "دریافتی روزانه (تومان)",
              data: dailyIncomeData,
              borderColor: "rgba(75, 192, 192, 1)",
              backgroundColor: "rgba(75, 192, 192, 0.2)",
              fill: true,
              tension: 0.1,
            },
            {
              label: "پرداختی روزانه (تومان)",
              data: dailyExpenseData,
              borderColor: "rgba(255, 99, 132, 1)",
              backgroundColor: "rgba(255, 99, 132, 0.2)",
              fill: true,
              tension: 0.1,
            },
            {
              label: "مانده روزانه (تومان)",
              data: dailyBalanceData,
              borderColor: "rgba(54, 162, 235, 1)",
              backgroundColor: "rgba(54, 162, 235, 0.2)",
              fill: true,
              tension: 0.1,
            },
          ],
        },
        options: {
          responsive: true,
          interaction: {
            mode: "index",
            intersect: false,
          },
          plugins: {
            legend: {
              position: "top",
            },
            title: {
              display: true,
              text: "نمودار مبالغ روزانه تراکنش‌ها",
            },
          },
        },
      });
    }

    const load_files = document.getElementById("load_files");
    if (load_files) {
      load_files.classList.add("hidden");
    }
  }

  /**
   * Set text content for an element by ID
   * @param {string} id
   * @param {string} value
   */
  /**
   * Set text content for an element by ID
   * @param {string} id
   * @param {string} value
   */
  function setDataTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  // --- Process and Render Categories ---
  /**
   * Process and render categories data
   * @param {object} categoriesData
   */
  /**
   * Process and render categories data
   * @param {object} categoriesData
   */
  function processCategoriesData(categoriesData) {
    if (
      !categoriesData?.resultSet?.innerResponse ||
      !Array.isArray(categoriesData.resultSet.innerResponse)
    ) {
      showAlert("فایل نامعتبر بام انتخاب شده است.");
      return;
    }
    const categoriesResult = document.getElementById("categories_result");
    if (categoriesResult) categoriesResult.classList.remove("hidden");
    const categoriesContainer = document.getElementById(
      "categories_data_container"
    );
    if (!categoriesContainer) return;
    categoriesContainer.innerHTML = "";
    allCategories.length = 0;
    const seenIds = new Set();
    const fragment = document.createDocumentFragment();
    allCategories.push({ id: 0, name: "بدون دسته‌بندی", color: "#777777" });
    categoriesData.resultSet.innerResponse.forEach((item) => {
      if (item.id && seenIds.has(item.id)) return;
      if (item.id) seenIds.add(item.id);
      let { color: badgeColor = "#777777", name: badgeName = "بدون نام" } =
        item;
      if (!badgeColor) badgeColor = "#777777";
      const textColorClass = isColorLight(badgeColor)
        ? "text-black"
        : "text-white";
      item.textColorClass = textColorClass;
      allCategories.push(item);
      const categoryDiv = document.createElement("div");
      categoryDiv.className = `badge badge-xs m-1 ${textColorClass}`;
      categoryDiv.tabIndex = 0;
      categoryDiv.setAttribute("aria-label", badgeName);
      categoryDiv.style.backgroundColor = badgeColor;
      categoryDiv.textContent = badgeName;
      categoryDiv.title = `دسته: ${badgeName}`;
      categoryDiv.setAttribute("data-badge-name", badgeName);
      fragment.appendChild(categoryDiv);
    });
    categoriesContainer.appendChild(fragment);
    // Event delegation for badge clicks
    categoriesContainer.addEventListener("click", (e) => {
      const badge = e.target.closest(".badge");
      if (badge && badge.hasAttribute("data-badge-name")) {
        showAlert(`دسته: ${badge.getAttribute("data-badge-name")}`);
      }
    });
    const categoriesFileSelect = document.getElementById(
      "categoriesFileSelect"
    );
    const baamFileSelect = document.getElementById("baamFileSelect");
    if (categoriesFileSelect && baamFileSelect) {
      categoriesFileSelect.classList.add("hidden");
      baamFileSelect.classList.remove("hidden");
      baamFileSelect.classList.add("flex");
    }
  }
})();
