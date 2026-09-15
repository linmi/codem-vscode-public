// English runtime translations for autocomplete (codem:autocomplete.* namespace)
// Source: src/i18n/locales/en/codem.json → "autocomplete" section

export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) Autocomplete",
  "codem:autocomplete.statusBar.snoozed": "snoozed",
  "codem:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "codem:autocomplete.statusBar.tooltip.basic": "CodeM Autocomplete",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No autocomplete model configured**\n\nTo enable autocomplete, add a profile with one of these supported providers: {{providers}}.\n\n[Open Settings]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
  "codem:autocomplete.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
  "codem:autocomplete.statusBar.cost.zero": "$0.00",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "codem:autocomplete.codeAction.title": "CodeM: Suggested Edits",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "The CodeM Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
  "codem:autocomplete.creditsExhausted.message":
    "CodeM Autocomplete has been paused. Possible causes: your CodeM account has no remaining credits, or your configured API key (BYOK) has reached its quota limit. Add CodeM credits or check your API key configuration to resume autocomplete.",
  "codem:autocomplete.creditsExhausted.addCredits": "Add Credits",
  "codem:autocomplete.authError.message":
    "CodeM Autocomplete has been paused due to an authentication issue. Possible causes: you are not signed in to CodeM, or your API key (BYOK) is invalid or missing. Please sign in again or check your provider API key settings.",
}
