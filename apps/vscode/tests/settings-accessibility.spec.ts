import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:codem-vscode;vscodeTheme:dark-modern"
const NAMES = [
  "Models",
  "Agent Behaviour",
  "Auto-Approve",
  "Web Tools",
  "Checkpoints",
  "Display",
  "Autocomplete",
  "Notifications",
  "Context",
  "Commit Message",
  "Experimental",
  "Language",
  "About CodeM",
]

function story(page: Page) {
  return page.goto(`/iframe.html?id=settings--settings-panel&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
}

test.describe("settings tab accessibility", () => {
  test("exposes named tabs and selected state in the compact sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await story(page)

    const tabs = page.getByRole("tab")
    await expect(tabs).toHaveCount(NAMES.length)
    await expect(page.getByRole("tab", { name: "Sandboxing" })).toHaveCount(0)
    for (const name of NAMES) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible()
    }

    const models = page.getByRole("tab", { name: "Models" })
    const behaviour = page.getByRole("tab", { name: "Agent Behaviour" })
    await expect(models).toHaveAttribute("aria-selected", "true")
    await expect(behaviour).toHaveAttribute("aria-selected", "false")
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible()

    await models.focus()
    await page.keyboard.press("ArrowDown")
    await expect(behaviour).toBeFocused()
    await expect(behaviour).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Agent Behaviour" })).toBeVisible()

    await page.keyboard.press("ArrowUp")
    await expect(models).toBeFocused()
    await expect(models).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible()
  })
})
