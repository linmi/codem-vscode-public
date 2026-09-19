import type {
  UserQuestionReply,
  UserQuestionRequest,
} from "../../session/index.ts"
import { userQuestionReplyIssue } from "../../session/index.ts"
import { sessionFileError } from "./jsonl.ts"
import {
  nullableString,
  requireBoolean,
  requireNonEmptyString,
  requireRecord,
  requireString,
} from "./fields.ts"

export function parsePersistedQuestionRequest(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): UserQuestionRequest {
  const requestId = requireNonEmptyString(
    record.request_id,
    path,
    lineNumber,
    'request_id',
  )
  if (!Array.isArray(record.questions) || record.questions.length === 0) {
    throw sessionFileError(path, lineNumber, 'questions must be a non-empty array')
  }
  return {
    requestId,
    questions: record.questions.map((value, questionIndex) => {
      const question = requireRecord(
        value,
        path,
        lineNumber,
        `questions[${questionIndex}]`,
      )
      const options = Array.isArray(question.options) ? question.options : []
      return {
        id: nullableString(question.id, path, lineNumber, 'question.id') ??
          `question-${questionIndex + 1}`,
        header: requireString(question.header, path, lineNumber, 'question.header'),
        question: requireNonEmptyString(
          question.question,
          path,
          lineNumber,
          'question.question',
        ),
        allowsMultipleSelection: requireBoolean(
          question.multiSelect ?? question.multi_select,
          path,
          lineNumber,
          'question.multiSelect',
        ),
        options: options.map((optionValue, optionIndex) => {
          const option = requireRecord(
            optionValue,
            path,
            lineNumber,
            `question.options[${optionIndex}]`,
          )
          return {
            label: requireString(option.label, path, lineNumber, 'option.label'),
            description: requireString(
              option.description,
              path,
              lineNumber,
              'option.description',
            ),
            preview: nullableString(option.preview, path, lineNumber, 'option.preview'),
          }
        }),
      }
    }),
  }
}

export function parsePersistedQuestionReply(
  value: unknown,
  path: string,
  lineNumber: number,
): UserQuestionReply {
  const reply = requireRecord(value, path, lineNumber, 'reply')
  if (reply.status === 'cancelled') return { status: 'cancelled' }
  if (reply.status !== 'answered' || !Array.isArray(reply.answers)) {
    throw sessionFileError(path, lineNumber, 'reply must be answered or cancelled')
  }
  return {
    status: 'answered',
    answers: reply.answers.map((answerValue, answerIndex) => {
      const answer = requireRecord(
        answerValue,
        path,
        lineNumber,
        `reply.answers[${answerIndex}]`,
      )
      if (
        !Array.isArray(answer.selected) ||
        answer.selected.some((item) => typeof item !== 'string')
      ) {
        throw sessionFileError(path, lineNumber, 'reply answer selected must be strings')
      }
      return {
        question: requireNonEmptyString(
          answer.question,
          path,
          lineNumber,
          'reply.answer.question',
        ),
        selected: answer.selected as string[],
        freeText: nullableString(
          answer.freeText ?? answer.free_text,
          path,
          lineNumber,
          'reply.answer.freeText',
        ),
      }
    }),
  }
}

export function questionActivityText(request: UserQuestionRequest): string {
  const first = request.questions[0]
  return request.questions.length === 1
    ? `等待回答：${first?.question ?? '用户问题'}`
    : `等待回答 ${request.questions.length} 个问题`
}

export function validatePersistedQuestionReply(
  request: UserQuestionRequest,
  reply: UserQuestionReply,
  path: string,
  lineNumber: number,
): void {
  const issue = userQuestionReplyIssue(request, reply)
  if (issue) {
    throw sessionFileError(
      path,
      lineNumber,
      `invalid question reply: ${issue}`,
    )
  }
}
