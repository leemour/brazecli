import * as v from "valibot"
import { namesAUser, primaryIdentifierCount } from "../identity.js"
import { isZoneless } from "../zone.js"

/**
 * Handwritten request schemas, keyed by `Operation.id`. An operation appears here **only** if it
 * is also marked `validation: "strict"` in `overrides.ts`, and the merge fails loudly if the two
 * disagree — a strict operation with no schema is this feature silently doing nothing.
 *
 * Kept apart from `overrides.ts` because an override is data merged into an `Operation` and a
 * schema is code: it cannot be written into `generated.ts` or compared by `catalog:check`.
 *
 * **Every schema here cites the Braze page it was read from, and encodes nothing that page does
 * not state.** A wrong strict schema refuses a request Braze would have accepted, and the caller
 * has no way to overrule it except `braze api`. Where a page leaves a rule ambiguous, the
 * operation stays `generated` and this file says why — a smaller strict set that is right beats a
 * fuller one that guesses.
 *
 * One rule is ours, not Braze's: an event or purchase `time` must carry its zone (see `zoned`).
 *
 * What is deliberately NOT here, and why:
 *
 * - `messages.send.create` — the identifier rules interact with audience, segment and recipient
 *   objects in ways the docs state across several pages. Ambiguous, so it stays `generated`.
 * - `campaigns.trigger.send.create` — same shape of problem: `recipients` overlaps `audience` and
 *   the "at least one" rule is not stated in one place.
 */
export const schemas: Readonly<Record<string, v.GenericSchema>> = {
  /**
   * https://www.braze.com/docs/api/endpoints/user_data/post_user_track
   *
   * "Each `/users/track` request can contain up to 75 total objects combined across `attributes`,
   * `events`, and `purchases`." The per-array 75 is Braze's own legacy limit (`BUG-8`).
   */
  "users.track.create": v.pipe(
    v.object({
      attributes: v.optional(v.array(v.looseObject({}))),
      events: v.optional(v.array(v.looseObject({}))),
      purchases: v.optional(v.array(v.looseObject({}))),
    }),
    v.check(
      (body) => total(body) > 0,
      "a users track request must carry at least one of attributes, events or purchases",
    ),
    v.check(
      (body) => total(body) <= 75,
      "Braze accepts at most 75 objects per request, counted across attributes, events and purchases together",
    ),
    v.check(
      (body) =>
        [...(body.events ?? []), ...(body.purchases ?? [])].every(
          (item) => typeof item.time !== "string" || !isZoneless(item.time),
        ),
      "an event or purchase time has no zone — end it with Z or an offset such as +02:00, since Braze does not document which zone it would assume",
    ),
  ),

  /**
   * https://www.braze.com/docs/api/endpoints/user_data/post_user_delete
   *
   * "Only one of `external_ids`, `user_aliases`, `braze_ids`, `email_addresses`, or
   * `phone_numbers` can be included in a single request", and "up to 50" of whichever it is.
   */
  "users.delete.create": v.pipe(
    v.object({
      external_ids: v.optional(v.array(v.string())),
      user_aliases: v.optional(v.array(v.looseObject({}))),
      braze_ids: v.optional(v.array(v.string())),
      email_addresses: v.optional(v.array(v.string())),
      phone_numbers: v.optional(v.array(v.string())),
    }),
    v.check(
      (body) => present(body).length === 1,
      "a users delete request carries exactly one of external_ids, user_aliases, braze_ids, email_addresses or phone_numbers — Braze refuses a request with two",
    ),
    v.check(
      (body) => Object.values(body).every((list) => !Array.isArray(list) || list.length <= 50),
      "Braze accepts at most 50 identifiers per delete request",
    ),
  ),
}

/**
 * Handwritten schemas for **one record of a batch**, keyed by operation and then by the `batch`
 * field it belongs in.
 *
 * Why these exist when `schemas` above already checks the body: in a bulk run one malformed record
 * among 75 fails the whole request, and the other 74 were fine (`NEED-31`). Checking each record on
 * its own turns that into one `invalid` audit row and 74 that still go.
 *
 * **The same bar as the body schemas** — every rule below is a sentence on a Braze page, quoted
 * where it is short enough, and an ambiguous page means no rule rather than a guessed one. A wrong
 * refusal here is worse than a wrong refusal of a body: it drops one record out of two million,
 * silently enough that nobody reads the audit line saying so until much later.
 *
 * A field that is not a key of the operation's `batch` needs no schema — `checkRecord` refuses it
 * from the catalog alone.
 */
export const recordSchemas: Readonly<Record<string, Readonly<Record<string, v.GenericSchema>>>> = {
  "users.track.create": {
    /**
     * https://www.braze.com/docs/api/objects_filters/user_attributes_object
     *
     * "One of `external_id` or `user_alias` or `braze_id` or `email` or `phone` is required".
     * Nothing else is: every profile field and every custom attribute is optional, so the schema
     * says nothing about them.
     *
     * The exception is Braze's own: with `push_token_import` set to `true` "you can import the
     * legacy tokens for anonymous users without providing `external_id`". We do not check that such
     * a record carries a push token — the page requires one but names the field only in examples.
     */
    attributes: v.pipe(
      v.looseObject({}),
      v.check(
        (record) => record.push_token_import === true || namesAUser(record),
        "an attributes record names no user — Braze needs one of external_id, user_alias, braze_id, email or phone",
      ),
      onePrimary("an attributes"),
    ),

    /**
     * https://www.braze.com/docs/api/objects_filters/event_object
     *
     * `"name" : (required, string)` and `"time" : (required, datetime as string in ISO 8601 …)`,
     * plus the identifier rule. The date format itself is not checked: the page allows two shapes
     * and Braze is better placed than a regular expression to judge a date.
     */
    events: v.intersect([
      namesOneUser("an event"),
      v.looseObject({
        name: v.string("an event record needs a name — Braze documents it as required"),
        time: v.pipe(
          v.string("an event record needs a time — Braze documents it as a required ISO 8601 string"),
          zoned("an event"),
        ),
      }),
    ]),

    /**
     * https://www.braze.com/docs/api/objects_filters/purchase_object
     *
     * `product_id`, `currency` and `time` are `(required, string)`; `price` is `(required, float)`.
     * `currency` is documented as an ISO 4217 code and not checked against the list — a currency we
     * have not heard of is Braze's to refuse, not ours.
     */
    purchases: v.intersect([
      namesOneUser("a purchase"),
      v.looseObject({
        product_id: v.string("a purchase record needs a product_id — Braze documents it as required"),
        currency: v.string("a purchase record needs a currency — Braze documents it as a required ISO 4217 code"),
        price: v.number("a purchase record needs a price — Braze documents it as a required number"),
        time: v.pipe(
          v.string("a purchase record needs a time — Braze documents it as a required ISO 8601 string"),
          zoned("a purchase"),
        ),
      }),
    ]),
  },
}

/**
 * Not a Braze rule but ours: a time is exchanged in UTC or with its offset. The event and purchase
 * pages (above) do not say which zone a `time` without one is read in, so a file exported from
 * another system's local clock would be shifted by an unknown amount, and Braze keeps the event.
 * Refused rather than read in this computer's zone: the file's zone is not this computer's to know.
 */
function zoned(what: string) {
  return v.check(
    (time: string) => !isZoneless(time),
    `${what} time has no zone — end it with Z or an offset such as +02:00, since Braze does not document which zone it would assume`,
  )
}

/**
 * Braze's identifier rule on its own, so that a record's required fields can be declared as an
 * ordinary object schema beside it — the two are checked together by `v.intersect`, and neither has
 * to know about the other.
 */
function namesOneUser(what: string) {
  return v.pipe(v.looseObject({}), identified(what), onePrimary(what))
}

function identified(what: string) {
  return v.check(
    (record: Record<string, unknown>) => namesAUser(record),
    `${what} record names no user — Braze needs one of external_id, user_alias, braze_id, email or phone`,
  )
}

/**
 * Braze: "Only one primary identifier is allowed per request object—including more than one causes
 * that object to be rejected." Catching it here matters more than it looks: Braze rejects the
 * object inside a 2xx, and an error we cannot tie back to one of the 75 makes the whole batch
 * `unknown` (`RISK-3`). One record refused here is one audit row instead of 75 uncertain ones.
 */
function onePrimary(what: string) {
  return v.check(
    (record: Record<string, unknown>) => primaryIdentifierCount(record) <= 1,
    `${what} record carries more than one of external_id, user_alias and braze_id — Braze rejects an object with two`,
  )
}

const total = (body: Record<string, unknown>): number =>
  ["attributes", "events", "purchases"].reduce((sum, field) => {
    const list = body[field]
    return sum + (Array.isArray(list) ? list.length : 0)
  }, 0)

const present = (body: Record<string, unknown>): string[] =>
  Object.entries(body)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([field]) => field)
