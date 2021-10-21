import * as path from 'path';

import * as cdk from '@aws-cdk/core';
import * as gateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';

export class MistAnonymizationProxyStack extends cdk.Stack {
  proxy: NodejsFunction;
  rotator: NodejsFunction;
  api: gateway.RestApi;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // * proxy

    // create proxy lambda
    this.proxy = new NodejsFunction(this, 'proxy', {
      functionName: 'mist-dwell-proxy-lambda',
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'main',
      entry: path.join(__dirname, '/../../src/proxy.ts')
    });

    // * gateway

    // create api gateway
    this.api = new gateway.RestApi(this, 'api', {
      restApiName: 'mist-dwell-proxy-api',
      description: 'Anonymize mist events'
    });

    // create gateway lambda integration
    const proxyIntegration = new gateway.LambdaIntegration(this.proxy, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    });

    // create gateway endpoint
    this.api.root.addMethod('POST', proxyIntegration);

    // * rotator

    // create rotation lambda
    this.rotator = new NodejsFunction(this, 'rotator', {
      functionName: 'mist-dwell-proxy-rotator',
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'main',
      entry: path.join(__dirname, '/../../src/rotator.ts'),
      environment: {
        'PROXY_FUNCTION_NAME': this.proxy.functionName
      }
    });

    // * cron

    // create scheduling rule (run every day at 4 am)
    const rule = new events.Rule(this, 'daily-rotation', {
      ruleName: 'mist-dwell-proxy-daily-rotation',
      schedule: events.Schedule.expression('cron(0 9 * * ? *)')
    })

    // set cron target
    rule.addTarget(new targets.LambdaFunction(this.rotator));
  }
}
