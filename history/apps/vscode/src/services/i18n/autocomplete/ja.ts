export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) オートコンプリート",
  "codem:autocomplete.statusBar.snoozed": "一時停止中",
  "codem:autocomplete.statusBar.warning": "$(warning) オートコンプリート",
  "codem:autocomplete.statusBar.tooltip.basic": "CodeM オートコンプリート",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**オートコンプリートモデルが設定されていません**\n\nオートコンプリートを有効にするには、次の対応プロバイダーのいずれかを含むプロファイルを追加してください: {{providers}}。\n\n[設定を開く]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "{{startTime}} から {{endTime}} までに {{count}} 件の補完を実行し、合計コストは {{cost}} でした。",
  "codem:autocomplete.statusBar.tooltip.providerInfo":
    "オートコンプリートは {{provider}} 経由の {{model}} によって提供されています。",
  "codem:autocomplete.statusBar.cost.zero": "$0.00",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "codem:autocomplete.codeAction.title": "CodeM: 提案された編集",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "CodeM オートコンプリートは GitHub Copilot との競合によりブロックされています。修正するには、Copilot のインライン提案を無効にする必要があります。",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Copilot を無効化",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "オートコンプリートを無効化",
  "codem:autocomplete.creditsExhausted.message":
    "CodeM オートコンプリートは一時停止されました。考えられる原因: CodeM アカウントに残りクレジットがない、または設定済みの API キー (BYOK) がクォータ上限に達しています。オートコンプリートを再開するには、CodeM クレジットを追加するか API キー設定を確認してください。",
  "codem:autocomplete.creditsExhausted.addCredits": "クレジットを追加",
  "codem:autocomplete.authError.message":
    "CodeM オートコンプリートは認証の問題により一時停止されました。考えられる原因: CodeM にサインインしていない、または API キー (BYOK) が無効または不足しています。再度サインインするか、プロバイダーの API キー設定を確認してください。",
}
