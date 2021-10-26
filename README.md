# Mist Anonymization Layer

AWS-hosted anonymization layer for Mist 'Zone' webhook. Incoming events are anonymized by reducing device-identifiable fields to a single hashed identifier. Identifiers are hashed with a rotating seed, regenerated once daily.

See the below breakdown for further implementation details:

## Lambda Functions

### `proxy.ts`

The proxy lambda processes incoming events and publishes them, post anonymization, to an SNS topic for distribution. Incoming events are processed as follows:

1. The `body` and `signature` are parsed out of the incoming request. `body` is assumed to be a JSON string, and `signature` an HMAC256 hash of the `body`.
2. The `signature` is checked against a locally generated `expectedSignature`. The valeus are compared using `crypto.timingSafeEqual` to mitigate the effectiveness of timing attacks.
3. The `body` is parsed and cast to a `ZoneEvent`. We assume that this type will match, as the valid signature suggests it was indeed sent by Mist.
4. Each `event` in `zoneEvent` is processed.
    * An identifier is extracted from the event. We default to `mac`, and pull `id` instead if `mac` is undefined (this should only happen for `sdk` type events).
    * The zone seed is loaded from the function environment using included event `zone_id` (keys are identified using the following convention: `MIST_<zone_id>_ROTATING_KEY`, note that `zone_id` is made UPPERCASE and stripped of hyphens).
    * We compute an SHA256 hash of `identifier` keyed by the zone seed, and store this as `hash`.
    * A reconstructed `AnonymizedEvent` is returned with each field set explicitly (no destructuring). `id` is set to the `hash` we computed in the previous step, and `mac`, `asset_id`, `name`, and the original `id` values are omitted.
5. All processed events are published to SNS using the v3 AWS Node SDK. We console log publishing errors, but do not reattempt (this should rarely happen, and we don't care enough about dropped events to warrant retrying).
6. The function returns status code `200` upon completion, and sends a message with the portion of messages successfully processed and relayed to SNS.

### `rotator.py`

The rotator lambda is responsible for daily rotation of all environment variables in the proxy lambda's function configuration that match the `MIST_<zone_id>_ROTATING_KEY` pattern. Each rotation is handled as follows:

1. The proxy lambda configuration is retrieved using the vs AWS Node SDK.
2. All environment variables following the above pattern are retrieved.
3. New key values are computed using `uuid.v4`.
4. The proxy lambda configuration is updated with the new values.
5. The new values are double checked against the update response to verify success.

If no environment variables are found in the proxy function configuration, or the rotator fails to update them, an error will be logged (rotator errors are high severity, and should have associated alerts).

## Infrastructure

This package includes cdk infrastructure definitions for deployment to AWS.

`infra/bin/lib/anonymizationStack.ts` defines the following AWS entities:
- [SNS Topic] `topic`
  - this topic allows distribution of anonymized events to several subscribers (subscribers are manually entered, no public access by default).
- [IAM Role] `proxy-role`
  - this role is assumed by the proxy lambda, it has basic lambda execution privileges and `sns:Publish` on `topic`.
- [LAMBDA Function] `proxy`
  - this function runs `proxy.ts`, and is configured by default with all environment variables contained in the local `.env` file (this should contain some initialization values for all required rotating seeds, and a `MIST_SECRET`).
- [APIGATEWAY Api] `api`
  - this api gateway exposes an HTTP endpoint for the proxy lambda (provided to Mist).
- [IAM Role] `rotator-role`
  - this role is assumed by the rotator lambda, it has basic lambda execution privileges and both `lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionConfiguration` on `proxy`.
- [LAMBDA Function] `rotator`
  - this function runs `rotator.ts`.
- [EVENT Rule] `daily-rotation`
  - this is a cron set to run `rotator` once daily at 9 AM UTC (4/5 AM ET).
