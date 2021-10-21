import * as path from 'path';

import * as cdk from '@aws-cdk/core';
import * as gateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';

export class MistAnonymizationProxyStack extends cdk.Stack {
  proxy: NodejsFunction;
  api: gateway.RestApi;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.proxy = new NodejsFunction(this, 'proxy', {
      memorySize: 128,
      timeout: cdk.Duration.seconds(2),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'main',
      entry: path.join(__dirname, '/../src/handler.ts')
    });

    this.api = new gateway.RestApi(this, 'api', {
      restApiName: 'mist-proxy',
      description: 'Anonymize mist events'
    });

    const proxyIntegration = new gateway.LambdaIntegration(this.proxy, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' }
    });

    this.api.root.addMethod('GET', proxyIntegration);
  }
}
