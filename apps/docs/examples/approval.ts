import type {
  AppServerHost, AppServerInteraction,
} from "@codem/app-server"

export async function submitPermission(
  host: AppServerHost,
  interaction: Extract<AppServerInteraction, { kind: "permission" }>,
  selectedOptionId: string,
) {
  // selectedOptionId 必须来自用户对当前请求的明确选择。
  if (!interaction.options.some(option => option.id === selectedOptionId)) {
    throw new Error("审批选项已失效")
  }
  await host.respondToInteraction(interaction.requestId, {
    kind: "permission", optionId: selectedOptionId,
  })
}
// Host 继续校验请求归属；过期结果不得作用于新轮次。
