import * as path from 'path';
import * as dotenv from 'dotenv';

import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as gateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as sns from '@aws-cdk/aws-sns';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';

const { parsed } = dotenv.config();

export class MistAnonymizationProxyStack extends cdk.Stack {
  proxy: NodejsFunction;
  rotator: NodejsFunction;
  api: gateway.RestApi;
  topic: sns.Topic;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // * sns
    // this topic does NOT enforce deduplication
    this.topic = new sns.Topic(this, 'topic', {
      topicName: 'mist-dwell-proxy-topic',
      displayName: 'Mist Dwell Proxy Topic',
    });

    // * proxy
    // create proxy lambda role
    const proxyRole = new iam.Role(this, 'proxy-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ]
    });

    // allow sns publish on topic
    proxyRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:Publish'
      ],
      resources: [this.topic.topicArn]
    }));

    // create proxy lambda
    this.proxy = new NodejsFunction(this, 'proxy', {
      functionName: 'mist-dwell-proxy-lambda',
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'main',
      entry: path.join(__dirname, '/../../src/proxy.ts'),
      environment: {
        TOPIC_ARN: this.topic.topicArn,
        ...parsed // destructure env vars
      },
      role: proxyRole
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
    // create rotator lambda role
    const rotatorRole = new iam.Role(this, 'rotator-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ]
    });

    // give permission to manage proxy lambda
    rotatorRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:GetFunctionConfiguration',
        'lambda:UpdateFunctionConfiguration'
      ],
      resources: [this.proxy.functionArn]
    }));

    // create rotation lambda
    this.rotator = new NodejsFunction(this, 'rotator', {
      functionName: 'mist-dwell-proxy-rotator',
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'main',
      entry: path.join(__dirname, '/../../src/rotator.ts'),
      environment: {
        PROXY_FUNCTION_NAME: this.proxy.functionName
      },
      role: rotatorRole
    });

    // * cron
    // create scheduling rule (run every day at 4 am)
    const rule = new events.Rule(this, 'daily-rotation', {
      ruleName: 'mist-dwell-proxy-daily-rotation',
      schedule: events.Schedule.expression('cron(0 9 * * ? *)')
    });

    // set cron target
    rule.addTarget(new targets.LambdaFunction(this.rotator));
  }
}
