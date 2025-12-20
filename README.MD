
# (فارسی) نمایش بهتر تراکنش های بام.

این پروژه به شما این امکان را میدهد تا تراکنش های بانکی خود در بانک ملی ایران را به صورت زیباتر و قابل فهم تر مشاهده کنید، بام نام سیستم بانکداری الکترونیکی بانک ملی ایران است.


# (English) Better Viewing of BAAM Transactions.
This project allows you to view your banking transactions from Bank Melli Iran in a more beautiful and understandable way. BAAM is the name of the electronic banking system of Bank Melli Iran.

# روش استفاده / How to Use

## سلب مسئولیت
⚠️ این پروژه به صورت غیررسمی توسعه یافته است و هیچ ارتباطی با بانک ملی ایران ندارد. استفاده از این پروژه به عهده خود کاربر است و نویسنده هیچ مسئولیتی در قبال مشکلات احتمالی نخواهد داشت. ⚠️

## دریافت اطلاعات تراکنش ها
برای دریافت اطلاعات جهت نمایش و پردازش آن ها باید مراحل زیر را دنبال کنید.

- ابتدا باید بانکداری الکترونیک خود یعنی بام را در بانک فعال کنید.
- سپس در مرورگر خود مثلا گوگل کروم وارد حساب کاربری خود در بام شوید.

حالا باید دو نوع اطلاعات را استخراج کنید:
1. دسته بندی تراکنش های خود:
- به آدرس زیر مراجعه کنید و محتویات آن را به نام `transaction-category.json` ذخیره کنید.
```
https://baam.bmi.ir/api/v1/pfm/transaction-category
```
2. لیست تراکنش های خود:
- به آدرس زیر مراجعه کنید و محتویات آن را به نام `transactions.json` ذخیره کنید.
```
https://baam.bmi.ir/api/account-statement/v1/transactions?accountNumber={ACCOUNT_NUMBER}&sort=false&pageNumber=1&pageSize=9999999&date_gt=2025-10-01T20%3A30%3A00.000Z&sortType=DESC
```
- توجه داشته باشید که باید `{ACCOUNT_NUMBER}` را با شماره حساب خود جایگزین کنید.
- مثلا اگر شماره حساب شما `037000000001` باشد، آدرس به صورت زیر خواهد بود:
```
https://baam.bmi.ir/api/account-statement/v1/transactions?accountNumber=037000000001&sort=false&pageNumber=1&pageSize=9999999&date_gt=2025-10-01T20%3A30%3A00.000Z&sortType=DESC
```
- همچنین مقدار `date_gt` در حال حاضر به صورت پیش فرض بر روی `2025-10-01T20:30:00.000Z` تنظیم شده است. شما میتوانید این مقدار را به دلخواه خود تغییر دهید تا تراکنش های بعد از تاریخ مورد نظر خود را دریافت کنید.

## نمایش تراکنش ها
- فایل `index.html` را در مرورگر خود باز کنید.
- در صفحه باز شده، فایل های `transaction-category.json` و `transactions.json` را بارگذاری کنید.
- اکنون میتوانید تراکنش های خود را به صورت زیباتر و قابل فهم تر مشاهده کنید.

# License
This project is licensed under the MIT License. See the LICENSE file for details.

# Contributing
Contributions are welcome! Please feel free to submit issues and pull requests.

# Developer
Developed by [MasterkinG32](https://github.com/masterking32)

