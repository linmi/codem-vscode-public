import { describe, expect, it } from "bun:test"
import { normalizeUrls } from "../../webview-ui/src/utils/normalize-urls"

describe("normalizeUrls", () => {
  it("punycodes Unicode hostnames used in permission commands", () => {
    expect(normalizeUrls("curl https://аpitest.com/status")).toBe("curl https://xn--pitest-2nf.com/status")
  })

  it("leaves ASCII URLs and trailing punctuation in place", () => {
    expect(normalizeUrls("see https://example.com.")).toBe("see https://example.com.")
  })
})
