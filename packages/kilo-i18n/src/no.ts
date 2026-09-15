export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "For mer bruksstatistikk, bruk ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Anbefalt",
  "settings.providers.note.kilo": "Tilgang til 500+ AI-modeller",
  "settings.providers.note.opencode": "Utvalgte modeller, inkludert Claude, GPT, Gemini og mer",
  "settings.providers.note.anthropic": "Direkte tilgang til Claude-modeller, inkludert Pro og Max",
  "settings.providers.note.deepseek": "DeepSeek-modeller for resonnering og kodeoppgaver",
  "settings.providers.note.copilot": "Claude-modeller for kodeassistanse",
  "settings.providers.note.openai": "GPT- og Codex-modeller med API-nøkkel eller ChatGPT-innlogging",
  "settings.providers.note.google": "Gemini-modeller for raske, strukturerte svar",
  "settings.providers.note.openrouter": "Tilgang til alle støttede modeller fra én leverandør",
  "settings.providers.note.vercel": "Samlet tilgang til AI-modeller med smart ruting",

  // Reasoning block label
  "ui.reasoning.label": "Resonnement",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementer",
  "plan.followup.question": "Klar til å implementere?",
  "plan.followup.answer.newSession": "Start ny økt",
  "plan.followup.answer.newSession.description": "Implementer i en ny økt med ren kontekst",
  "plan.followup.answer.continue": "Fortsett her",
  "plan.followup.answer.continue.description": "Implementer planen i denne økten",
  "plan.followup.answer.keepRefining": "Fortsett å finpusse",
  "plan.followup.answer.keepRefining.description": "Fortsett planleggingen uten å implementere ennå",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot er tregt",
  "snapshot.slowRepo.question":
    "Det tar lang tid å initialisere snapshot-systemet, sannsynligvis på grunn av størrelsen på depotet.\n\nVil du deaktivere snapshots for dette depotet?",
  "snapshot.slowRepo.answer.continue": "Fortsett med snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Vent til snapshotet er ferdig. Påfølgende runder er raske når det første snapshotet er bygget.",
  "snapshot.slowRepo.answer.disable": "Deaktiver for dette prosjektet",
  "snapshot.slowRepo.answer.disable.description":
    "Slå av Kilos snapshots for dette prosjektet. Du mister angre/gjør om for Kilo-endringer, men git fortsetter å spore alt.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Åpne i diff-visning",
  "ui.messagePart.openInEditor": "Åpne i editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dette var nyttig",
  "ui.message.feedback.notHelpful": "Dette var ikke nyttig",
  "ui.message.feedback.clearRating": "Fjern vurdering",
}
