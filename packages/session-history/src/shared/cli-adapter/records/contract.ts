import contract from "./session-record-contract-v13.json" with {
  type: 'json',
}

type RecordClassification = 'metadata' | 'stream' | 'todo' | 'turn'

interface ContractRecord {
  readonly variant: string
  readonly type: string
  readonly classification: RecordClassification
}

const records = contract.records as readonly ContractRecord[]

export const CODEM_CORE_SESSION_RECORD_CONTRACT_VERSION = contract.coreVersion
export const CODEM_CORE_SESSION_RECORD_TYPES = Object.freeze(
  records.map((record) => record.type),
)
export const TRANSCRIPT_METADATA_RECORD_TYPES = recordTypes('metadata')
export const STREAM_RECORD_TYPES = recordTypes('stream')
export const TODO_RECORD_TYPES = recordTypes('todo')
export const TURN_RECORD_TYPES = recordTypes('turn')

function recordTypes(classification: RecordClassification): ReadonlySet<string> {
  return new Set(
    records
      .filter((record) => record.classification === classification)
      .map((record) => record.type),
  )
}
