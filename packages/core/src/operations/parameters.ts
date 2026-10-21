/**
 * What each query parameter means, keyed by the name Braze uses.
 *
 * Keyed by name and not by operation because `page` means the same thing in `campaigns list` and
 * in `segments list`: 134 parameter slots across the catalog are only 43 distinct names, so one
 * table describes every flag on all 95 commands, and there is one place to correct when Braze
 * changes its mind. Per-operation text would be 134 lines that drift apart the first time one is
 * edited (`UX-5`).
 *
 * The collection cannot supply these — it carries no structured query entries at all, which is
 * why every flag read `query parameter` until this existed. So each line is handwritten, and the
 * ones marked below came from Braze's own endpoint documentation rather than from the parameter's
 * name.
 *
 * **Numbers that differ per endpoint are not stated as a single value.** `length` is capped at 100
 * on campaign analytics and at 14 on Canvas analytics; `limit` defaults to 100 everywhere but is
 * capped at 500 for email lists and 1000 for Content Blocks. A description naming one of those as
 * *the* limit would be wrong on the other endpoint, which is worse than staying general.
 */
export const parameterDescriptions: Readonly<Record<string, string>> = {
  // Analytics series. Verified against Braze's campaign, custom-event and Canvas analytics pages.
  length:
    "how many units before ending_at the series covers — days, or hours where the endpoint takes --unit. " +
    "The cap differs by endpoint: 100 for most, 14 for Canvas",
  ending_at:
    "when the series ends, ISO-8601. Without a zone it is read in --timezone and sent as UTC; a date alone means " +
    "the end of that local day. Defaults to the time of the request",
  starting_at:
    "when the series begins, ISO-8601. Without a zone it is read in --timezone and sent as UTC; a date alone means " +
    "the start of that local day. An alternative to --length, not a companion to it",
  unit: "time between data points: day or hour. Defaults to day",
  app_id: "app API identifier, to limit the analytics to one app",
  segment_id: "segment API identifier, to limit the analytics to one analytics-enabled segment",
  event: "name of the custom event to return analytics for",
  campaign_id: "campaign API identifier",
  canvas_id: "Canvas API identifier",
  card_id: "news feed card API identifier",
  send_id: "send API identifier, set when the message was sent",
  include_variant_breakdown: "also return per-variant statistics. Defaults to false",
  include_step_breakdown: "also return per-step statistics. Defaults to false",
  include_deleted_step_data: "also return statistics for steps that have been deleted. Defaults to false",
  product: "product name to report on",

  // Listing and paging. Verified against Braze's campaign-list and email-list pages.
  page: "which page to return, counting from 0. A page holds up to 100",
  limit:
    "how many results to return. Defaults to 100; the cap differs by endpoint — 500 for email lists, 1000 for Content Blocks",
  offset: "how many results to skip before returning the rest",
  include_archived: "include archived items. Defaults to false",
  sort_direction: "desc for newest first, asc for oldest first. Defaults to oldest first",
  "last_edit.time[gt]":
    "only items edited after this time, ISO-8601. Without a zone it is read in --timezone and sent as UTC; " +
    "a date alone means the start of that local day",
  modified_after:
    "only items updated at or after this time, ISO-8601. Without a zone it is read in --timezone and sent as UTC; " +
    "a date alone means the start of that local day",
  modified_before:
    "only items updated at or before this time, ISO-8601. Without a zone it is read in --timezone and sent as UTC; " +
    "a date alone means the end of that local day",
  start_date:
    "first day of the range, as YYYY-MM-DD — a UTC day: Braze reads it as midnight UTC. Must be earlier than --end-date",
  end_date: "last day of the range, as YYYY-MM-DD — a UTC day: Braze reads it as midnight UTC",
  end_time:
    "end of the time range, ISO-8601. A time without a zone is read in --timezone and sent as UTC; " +
    "a date alone is a UTC day: Braze reads it as midnight UTC",

  // Identifying a person.
  email: "an email address. Where it is a filter, Braze answers for that address and ignores the date range",
  external_id: "your own identifier for the user, the one you send in users track",
  phone_numbers: "a phone number in E.164 form, such as 12345678901",

  // Templates and Content Blocks.
  email_template_id: "email template API identifier",
  template_name: "name of the email template",
  subject: "subject line of the email",
  body: "HTML body of the email",
  plaintext_body: "plain-text version of the body, for clients that will not render HTML",
  preheader: "preview text an inbox shows after the subject line",
  tags: "tags to attach. They must already exist in Braze",
  should_inline_css: "write the CSS into the markup itself rather than leaving it in a stylesheet",
  content_block_id: "Content Block API identifier",
  include_inclusion_data: "also return which campaigns and Canvases use this Content Block",

  // The remainder, one endpoint each.
  preference_center_api_id: "preference centre API identifier",
  subscription_group_id: "subscription group API identifier",
  filter: 'a SCIM filter expression, such as userName eq "someone@example.com"',
  reason: "why the number was marked invalid, such as provider_error",
}

/**
 * How a zone-less value of each time parameter is read. `time` says whether a wall-clock time is
 * converted to UTC; `date` says what a date alone means.
 *
 * The datetime parameters are documented as ISO-8601 with no zone stated, so a zone-less value is
 * read in whatever zone Braze assumes. Sending UTC removes the guess:
 * https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics (ending_at),
 * https://www.braze.com/docs/api/endpoints/export/canvas/get_canvas_analytics (starting_at),
 * https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaigns (last_edit.time[gt]),
 * https://www.braze.com/docs/api/endpoints/templates/email_templates/get_list_email_templates (modified_*).
 *
 * `utc-day` is the provider exception: Braze takes only a date and documents it as "treated as
 * midnight in UTC time by the API", so the date goes unchanged and the answer names it a UTC day:
 * https://www.braze.com/docs/api/endpoints/email/get_list_hard_bounces,
 * https://www.braze.com/docs/api/endpoints/sms/get_query_invalid_numbers,
 * https://www.braze.com/docs/api/endpoints/messaging/schedule_messages/get_messages_scheduled (end_time).
 */
export const timeParameters: Readonly<Record<string, { time: boolean; date: "start" | "end" | "utc-day" }>> = {
  starting_at: { time: true, date: "start" },
  ending_at: { time: true, date: "end" },
  "last_edit.time[gt]": { time: true, date: "start" },
  modified_after: { time: true, date: "start" },
  modified_before: { time: true, date: "end" },
  end_time: { time: true, date: "utc-day" },
  start_date: { time: false, date: "utc-day" },
  end_date: { time: false, date: "utc-day" },
}
