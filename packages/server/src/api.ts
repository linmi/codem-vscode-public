// leftover HttpApi schema is seeded locally; do not import @opencode-ai/protocol
import { makeDefaultApi } from "./protocol/api"
import { LocationMiddleware } from "./location"
import { SessionLocationMiddleware } from "./middleware/session-location"

export const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})
