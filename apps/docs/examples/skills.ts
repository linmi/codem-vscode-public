import type { AppServerHost } from "@codem/app-server"

export async function runSkill(
  host: AppServerHost, cwd: string, threadId: string,
  skillName: string, text: string,
) {
  const skills = await host.listSkills(cwd, threadId)
  if (!skills.some(skill => skill.name === skillName)) {
    throw new Error("当前连接不存在此 Skill")
  }
  return host.startTurn({
    cwd, threadId, submissionId: crypto.randomUUID(),
    skillName, text,
  })
}
// Skill 使用结构化输入；当前不能同时携带附件。
