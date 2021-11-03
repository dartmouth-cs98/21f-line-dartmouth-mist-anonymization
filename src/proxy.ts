import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2
} from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import * as crypto from 'crypto';

type ZoneEvent = {
  /** topic subscribed to */
  topic: 'zone';
  /** list of events */
  events: [{
    /** site id */
    site_id: string;
    /** map id */
    map_id: string;
    /** zone id */
    zone_id: string;
    /** enter / exit */
    trigger: 'enter' | 'exit';
    /** int timestamp of the event, epoch */
    timestamp: number;

    type: 'sdk' | 'wifi' | 'asset';
    /** uuid of SDK-client */
    id?: string;
    /** name of the client */
    name?: string;
    /** mac address of wifi client or asset */
    mac?: string;
    /** string uuid of named asset */
    asset_id?: string;
  }];
}

type AnonymizedEvent = {
  site_id: string;
  map_id: string;
  zone_id: string;
  trigger: 'enter' | 'exit';
  timestamp: number;
  type: 'sdk' | 'wifi' | 'asset';
  id: string;
}

const signaturesEqual = (a: string, b: string) => {
  // create buffers
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  // compare length (fine for this not to be timing safe,
  // as signatures are always 256 bits).
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  // timing safe compare
  if (!crypto.timingSafeEqual(aBuffer, bBuffer)) {
    return false;
  }

  return true;
}

export const main = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // * parse event
  const { body } = event;
  // mist lowercases this field
  const signature = event.headers['x-mist-signature-v2'];

  // return if missing body or signature
  if (!body || !signature) {
    console.log('The request signature and/or body is missing.');
    return {
      body: JSON.stringify({
        message: 'The request signature and/or body is missing.'
      }),
      statusCode: 400
    };
  }

  // * verify signature
  // generate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.MIST_SECRET!)
    .update(body)
    .digest('hex');

  // return if signature does not match
  if (!signaturesEqual(signature, expectedSignature)) {
    console.log('The request signature is invalid.');
    return {
      body: JSON.stringify({
        message: 'The request signature is invalid.'
      }),
      statusCode: 500
    };
  }

  // * parse body
  const zoneEvent: ZoneEvent = JSON.parse(body);

  // * process event
  // hash mac addresses to anonymize
  const processedEvents = zoneEvent.events.map(rawEvent => {
    const identifier = rawEvent.mac || rawEvent.id;
    const zoneId = rawEvent.zone_id;
    const zoneSeed = process.env[`MIST_${
      zoneId
        .toUpperCase()
        .replace(/-/g, '')
    }_ROTATING_KEY`];

    // do not include event if no zone seed is set in environment
    if (!zoneSeed) return null;

    // hash identifier
    const hash = crypto
      .createHmac('sha256', zoneSeed)
      .update(identifier!) // one of mac or id is always defined
      .digest('hex');

    // return anonymized event, reconstruct so as not to unintentially
    // include unexpected identifiable fields.
    return {
      site_id: rawEvent.site_id,
      map_id: rawEvent.map_id,
      zone_id: rawEvent.zone_id,
      trigger: rawEvent.trigger,
      timestamp: rawEvent.timestamp,
      type: rawEvent.type,
      id: hash,
    } as AnonymizedEvent
  }).filter(event => event !== null) as AnonymizedEvent[];

  // * publish to sns
  // create client
  const snsClient = new SNSClient({});

  // loop through all messages, sns does not support batch publishing
  const ops = processedEvents.map(processedEvent => {
    // create publish command
    const publishCommand = new PublishCommand({
      TopicArn: process.env.TOPIC_ARN!,
      Message: JSON.stringify(processedEvent),
      MessageAttributes: {
        'site_id': {
          DataType: 'String',
          StringValue: processedEvent.site_id
        },
        'map_id': {
          DataType: 'String',
          StringValue: processedEvent.map_id
        },
        'zone_id': {
          DataType: 'String',
          StringValue: processedEvent.zone_id
        },
        'trigger': {
          DataType: 'String',
          StringValue: processedEvent.trigger
        },
        'type': {
          DataType: 'String',
          StringValue: processedEvent.type
        }
      }
    });

    // publish
    return snsClient.send(publishCommand);
  });

  // await all publish operations, log but do not reattempt failures
  const results = await Promise.allSettled(ops);
  const failures = results.filter(r => r.status === 'rejected');
  failures.forEach(failure => {
    console.error('Failed to publish message:', failure);
  });

  // * return success
  console.log(`Successfully processed ${processedEvents.length
    - failures.length}/${processedEvents.length} event(s).`);
  return {
    body: JSON.stringify({
      message: `Successfully processed ${processedEvents.length
        - failures.length}/${processedEvents.length} event(s).`
    }),
    statusCode: 200
  };
};
