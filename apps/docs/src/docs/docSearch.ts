import { pages } from "./content.ts"
import { apiEntries, eventReference } from "./apiReference.ts"

export function searchDocs(query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return pages.filter(page => {
    const text = [page.title, page.english, page.description, ...(page.methods ?? []),
      ...page.sections.flatMap(section => [section.title, section.body, section.code ?? "", ...(section.items ?? [])]),
      ...apiEntries.filter(entry => page.id === "api" || entry.page === page.id).map(entry => `${entry.name} ${entry.purpose}`),
      ...(page.id === "events" ? Object.entries(eventReference).flatMap(([name, details]) => [name, ...details]) : []),
    ].join(" ").toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}
