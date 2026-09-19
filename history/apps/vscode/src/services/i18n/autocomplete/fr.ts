export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) Saisie automatique",
  "codem:autocomplete.statusBar.snoozed": "mis en pause",
  "codem:autocomplete.statusBar.warning": "$(warning) Saisie automatique",
  "codem:autocomplete.statusBar.tooltip.basic": "Saisie automatique CodeM",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Aucun modèle de saisie automatique configuré**\n\nPour activer la saisie automatique, ajoutez un profil avec l'un de ces fournisseurs pris en charge : {{providers}}.\n\n[Ouvrir les paramètres]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "{{count}} complétions effectuées entre {{startTime}} et {{endTime}}, pour un coût total de {{cost}}.",
  "codem:autocomplete.statusBar.tooltip.providerInfo":
    "Saisies automatiques fournies par {{model}} via {{provider}}.",
  "codem:autocomplete.statusBar.cost.zero": "$0.00",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "codem:autocomplete.codeAction.title": "CodeM : modifications suggérées",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "La saisie automatique CodeM est bloquée par un conflit avec GitHub Copilot. Pour résoudre ce problème, vous devez désactiver les suggestions en ligne de Copilot.",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Désactiver Copilot",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Désactiver la saisie automatique",
  "codem:autocomplete.creditsExhausted.message":
    "La saisie semi-automatique de CodeM a été mise en pause. Causes possibles : votre compte CodeM n’a plus de crédits, ou votre clé API configurée (BYOK) a atteint sa limite de quota. Ajoutez des crédits CodeM ou vérifiez la configuration de votre clé API pour reprendre la saisie semi-automatique.",
  "codem:autocomplete.creditsExhausted.addCredits": "Ajouter des crédits",
  "codem:autocomplete.authError.message":
    "La saisie semi-automatique de CodeM a été mise en pause en raison d’un problème d’authentification. Causes possibles : vous n’êtes pas connecté à CodeM, ou votre clé API (BYOK) est invalide ou manquante. Reconnectez-vous ou vérifiez les paramètres de clé API de votre fournisseur.",
}
