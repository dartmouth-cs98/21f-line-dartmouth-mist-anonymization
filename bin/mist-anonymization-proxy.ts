#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { MistAnonymizationProxyStack } from '../lib/mist-anonymization-proxy-stack';

const app = new cdk.App();
new MistAnonymizationProxyStack(app, 'MistAnonymizationProxyStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
