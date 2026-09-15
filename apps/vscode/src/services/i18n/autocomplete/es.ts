export const dict = {
  "codem:autocomplete.statusBar.enabled": "$(codem-logo) Autocompletado",
  "codem:autocomplete.statusBar.snoozed": "pospuesto",
  "codem:autocomplete.statusBar.warning": "$(warning) Autocompletado",
  "codem:autocomplete.statusBar.tooltip.basic": "Autocompletado de CodeM",
  "codem:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No hay ningún modelo de autocompletado configurado**\n\nPara habilitar el autocompletado, añade un perfil con uno de estos proveedores compatibles: {{providers}}.\n\n[Abrir configuración]({{command}})",
  "codem:autocomplete.statusBar.tooltip.completionSummary":
    "Se realizaron {{count}} completados entre {{startTime}} y {{endTime}}, con un coste total de {{cost}}.",
  "codem:autocomplete.statusBar.tooltip.providerInfo":
    "Autocompletados proporcionados por {{model}} mediante {{provider}}.",
  "codem:autocomplete.statusBar.cost.zero": "$0.00",
  "codem:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "codem:autocomplete.codeAction.title": "CodeM: Ediciones sugeridas",
  "codem:autocomplete.incompatibilityExtensionPopup.message":
    "El autocompletado de CodeM está bloqueado por un conflicto con GitHub Copilot. Para solucionarlo, debes deshabilitar las sugerencias en línea de Copilot.",
  "codem:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Deshabilitar Copilot",
  "codem:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Deshabilitar autocompletado",
  "codem:autocomplete.creditsExhausted.message":
    "El autocompletado de CodeM se ha pausado. Posibles causas: tu cuenta de CodeM no tiene créditos restantes, o tu clave de API configurada (BYOK) alcanzó su límite de cuota. Agrega créditos de CodeM o revisa la configuración de tu clave de API para reanudar el autocompletado.",
  "codem:autocomplete.creditsExhausted.addCredits": "Añadir créditos",
  "codem:autocomplete.authError.message":
    "El autocompletado de CodeM se ha pausado por un problema de autenticación. Posibles causas: no has iniciado sesión en CodeM, o tu clave de API (BYOK) no es válida o falta. Vuelve a iniciar sesión o revisa la configuración de la clave de API de tu proveedor.",
}
