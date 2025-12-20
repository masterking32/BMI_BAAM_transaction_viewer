// BAAM Viewer Main Script
(function () {
  // --- Utility Functions ---

  // Get last month's date in YYYY-MM-DD format
  const getLastMonthDate = () => {
    const today = new Date();
    const lastMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      today.getDate()
    );
    const year = lastMonth.getFullYear();
    const month = String(lastMonth.getMonth() + 1).padStart(2, "0");
    const day = String(lastMonth.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Show alert message (auto-dismiss)
  const showAlert = (message) => {
    let alertContainer = document.getElementById("alert_container");
    if (!alertContainer) {
      alertContainer = document.createElement("div");
      alertContainer.id = "alert_container";
      alertContainer.setAttribute("role", "alert");
      alertContainer.setAttribute("aria-live", "assertive");
      alertContainer.classList.add(
        "alert",
        "alert-error",
        "fixed",
        "top-4",
        "left-1",
        "z-50"
      );
      alertContainer.setAttribute("dir", "rtl");
      document.body.appendChild(alertContainer);
    }
    alertContainer.textContent = message;
    setTimeout(() => {
      if (alertContainer) {
        alertContainer.remove();
      }
    }, 5000);
  };

  // Detect if a hex color is light
  const isColorLight = (color) => {
    if (!color) color = "#777777";
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
  const lastMonthDate = getLastMonthDate();
  document.querySelectorAll(".last_month_date_url").forEach((el) => {
    el.textContent = lastMonthDate;
  });

  // --- Bank Account Input Handling ---
  const bankAccountInput = document.getElementById("bank_account_input");
  const bankAccountData = document.getElementById("bank_account_data");
  const getTransactionsUrl = document.getElementById("get_transactions_url");
  const accountNumberRegex = /^0\d{12}$/;

  if (bankAccountInput && bankAccountData && getTransactionsUrl) {
    bankAccountInput.addEventListener("input", (event) => {
      const accountNumber = event.target.value.trim();
      bankAccountData.textContent = accountNumber || "BANK_ACCOUNT";
      if (!accountNumberRegex.test(accountNumber)) {
        bankAccountInput.classList.add("text-red-500", "border-red-500");
        getTransactionsUrl.removeAttribute("href");
        getTransactionsUrl.removeAttribute("target");
      } else {
        bankAccountInput.classList.remove("text-red-500", "border-red-500");
        const url = `https://baam.bmi.ir/api/account-statement/v1/transactions?accountNumber=${accountNumber}&sort=false&pageNumber=1&pageSize=9999999&date_gt=${lastMonthDate}T20%3A30%3A00.000Z&sortType=DESC`;
        getTransactionsUrl.href = url;
        getTransactionsUrl.setAttribute("target", "_blank");
      }
    });
  }

  // --- Category File Upload Handling ---
  const allCategories = [];
  const categoriesFileInput = document.getElementById("categoriesFile");
  if (categoriesFileInput) {
    categoriesFileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files);
      if (!files.length) return;
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const content = e.target.result;
            const categoriesData = JSON.parse(content);
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

  // --- Process and Render Categories ---
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
      categoryDiv.classList.add("badge", "badge-xs", "m-1", textColorClass);
      categoryDiv.setAttribute("tabindex", "0");
      categoryDiv.setAttribute("aria-label", badgeName);
      categoryDiv.style.backgroundColor = badgeColor;
      categoryDiv.textContent = badgeName;
      // Tooltip on hover
      categoryDiv.title = `دسته: ${badgeName}`;
      // Add a data attribute for event delegation
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
