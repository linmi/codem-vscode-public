import type {
  UserQuestion,
  UserQuestionAnswer,
  UserQuestionReply,
  UserQuestionRequest,
} from "./interaction-contracts.ts"

export interface AnsweredUserQuestion {
  readonly question: UserQuestion
  readonly answer: UserQuestionAnswer
}

export function userQuestionReplyIssue(
  request: UserQuestionRequest,
  reply: UserQuestionReply,
): string | null {
  if (reply.status === 'cancelled') return null
  if (reply.answers.length !== request.questions.length) {
    return `expected ${request.questions.length} answers, received ${reply.answers.length}`
  }
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index]
    const answer = reply.answers[index]
    if (!question || !answer) return `answer ${index + 1} is missing`
    if (answer.question !== question.question) {
      return [
        `answer ${index + 1} targets`,
        JSON.stringify(answer.question),
        'instead of',
        JSON.stringify(question.question),
      ].join(' ')
    }
    if (answer.selected.length === 0 && !answer.freeText?.trim()) {
      return `answer ${index + 1} is empty`
    }
  }
  return null
}

export function answeredUserQuestions(
  request: UserQuestionRequest,
  reply: Extract<UserQuestionReply, { status: 'answered' }>,
): readonly AnsweredUserQuestion[] {
  const issue = userQuestionReplyIssue(request, reply)
  if (issue) {
    throw new Error(
      `Invalid canonical question reply ${request.requestId}: ${issue}`,
    )
  }
  return request.questions.map((question, index) => {
    const answer = reply.answers[index]
    if (!answer) {
      throw new Error(
        `Invalid canonical question reply ${request.requestId}: ` +
        `answer ${index + 1} is missing`,
      )
    }
    return { question, answer }
  })
}
