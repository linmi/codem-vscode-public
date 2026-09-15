// English runtime translations for autocomplete (codem:autocomplete.* namespace)
// Source: src/i18n/locales/en/codem.json → "autocomplete" section

export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) تکمیل خودکار",
  "codem:autocomplete.statusBar.snoozed": "به تعویق افتاده",
  "codem:autocomplete.statusBar.warning": "$(warning) تکمیل خودکار",
  "codem:autocomplete.statusBar.tooltip.basic": "تکمیل خودکار CodeM",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**هیچ مدل تکمیل خودکاری پیکربندی نشده است**\n\nبرای فعال‌سازی تکمیل خودکار، یک پروفایل با یکی از ارائه‌دهندگان پشتیبانی‌شده زیر اضافه کنید: {{providers}}.\n\n[باز کردن تنظیمات]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "{{count}} تکمیل بین {{startTime}} و {{endTime}} انجام شد، با هزینه کل {{cost}}.",
  "codem:autocomplete.statusBar.tooltip.providerInfo":
    "تکمیل خودکار توسط {{model}} از طریق {{provider}} ارائه می‌شود.",
  "codem:autocomplete.statusBar.cost.zero": "۰.۰۰$",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<۰.۰۱$",
  "codem:autocomplete.codeAction.title": "CodeM: ویرایش‌های پیشنهادی",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "تکمیل خودکار CodeM به دلیل تعارض با GitHub Copilot مسدود شده است. برای رفع این مشکل، باید پیشنهادات درون‌خطی Copilot را غیرفعال کنید.",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "غیرفعال کردن Copilot",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "غیرفعال کردن تکمیل خودکار",
  "codem:autocomplete.creditsExhausted.message":
    "تکمیل خودکار CodeM متوقف شده است. دلایل احتمالی: حساب CodeM شما اعتبار کافی ندارد، یا کلید API پیکربندی‌شده (BYOK) به سقف مجاز خود رسیده است. برای از سرگیری تکمیل خودکار، اعتبار CodeM اضافه کنید یا تنظیمات کلید API خود را بررسی کنید.",
  "codem:autocomplete.creditsExhausted.addCredits": "افزودن اعتبار",
  "codem:autocomplete.authError.message":
    "تکمیل خودکار CodeM به دلیل مشکل احراز هویت متوقف شده است. دلایل احتمالی: وارد CodeM نشده‌اید، یا کلید API (BYOK) شما نامعتبر یا وارد نشده است. لطفاً دوباره وارد شوید یا تنظیمات کلید API ارائه‌دهنده خود را بررسی کنید.",
}
