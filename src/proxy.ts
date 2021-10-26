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
  }]
}

export const main = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // * parse event
  const { body } = event;
  // api gateway lowercases the signature header key
  const signature = event.headers['x-mist-signature'];

  // return if missing body or signature
  if (!body || !signature) {
    return {
      body: JSON.stringify({
        message: 'The request signature and/or body is missing.'
      }),
      statusCode: 400
    };
  }

  // * parse body
  const zoneEvent: ZoneEvent = JSON.parse(body);

  // * verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.MIST_SECRET!)
    .update(body)
    .digest('hex');

  // return if signature does not match
  if (!crypto.timingSafeEqual(Buffer.from(signature),
    Buffer.from(expectedSignature))) {
    return {
      body: JSON.stringify({
        message: 'The request signature is invalid.'
      }),
      statusCode: 400
    };
  }

  // * process event
  // hash mac addresses to anonymize
  for (let i = 0; i < zoneEvent.events.length; i++) {
    const identifier = zoneEvent.events[i].mac || zoneEvent.events[i].id;
    const hash = crypto
      .createHash('sha256')
      .update(identifier!) // one of mac or id is always defined
      .digest('hex');

    // overwrite id with hash
    zoneEvent.events[i].id = hash;

    // remove other identifiers
    delete zoneEvent.events[i].mac;
    delete zoneEvent.events[i].asset_id;
    delete zoneEvent.events[i].name;
  }

  // * publish to sns
  // create client
  const snsClient = new SNSClient({});

  // loop through all messages, sns does not support batch publishing
  const ops = zoneEvent.events.map(event => {
    // create publish command
    const publishCommand = new PublishCommand({
      TopicArn: process.env.TOPIC_ARN!,
      Message: JSON.stringify(event)
    });

    // publish
    return snsClient.send(publishCommand);
  });

  // await all publish operations, log but do not reattempt failures
  const results = await Promise.allSettled(ops);
  const failures = results.filter(r => r.status === 'rejected');
  failures.forEach(failure => {
    console.error('Failed to publish message:', failure);
  })

  // * return success
  return {
    body: JSON.stringify({
      message: `Successfully processed ${zoneEvent.events.length
        - failures.length}/${zoneEvent.events.length} event(s).`
    }),
    statusCode: 200,
  };
};
