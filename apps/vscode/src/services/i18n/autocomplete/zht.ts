export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) 自動完成",
  "codem:autocomplete.statusBar.snoozed": "已暫停",
  "codem:autocomplete.statusBar.warning": "$(warning) 自動完成",
  "codem:autocomplete.statusBar.tooltip.basic": "CodeM 自動完成",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**尚未設定自動完成模型**\n\n若要啟用自動完成，請新增包含下列其中一個支援提供者的設定檔：{{providers}}。\n\n[開啟設定]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "在 {{startTime}} 到 {{endTime}} 之間執行了 {{count}} 次完成，總成本為 {{cost}}。",
  "codem:autocomplete.statusBar.tooltip.providerInfo": "自動完成由 {{provider}} 透過 {{model}} 提供。",
  "codem:autocomplete.statusBar.cost.zero": "$0.00",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "codem:autocomplete.codeAction.title": "CodeM：建議的編輯",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "CodeM 自動完成因與 GitHub Copilot 衝突而被封鎖。若要修正此問題，必須停用 Copilot 的內嵌建議。",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "停用 Copilot",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "停用自動完成",
  "codem:autocomplete.creditsExhausted.message":
    "CodeM 自動完成已暫停。可能原因：你的 CodeM 帳戶沒有剩餘額度，或你設定的 API 金鑰（BYOK）已達到配額限制。請新增 CodeM 額度或檢查 API 金鑰設定以恢復自動完成。",
  "codem:autocomplete.creditsExhausted.addCredits": "新增額度",
  "codem:autocomplete.authError.message":
    "CodeM 自動完成因驗證問題已暫停。可能原因：你尚未登入 CodeM，或你的 API 金鑰（BYOK）無效或遺失。請重新登入或檢查提供者 API 金鑰設定。",
}
