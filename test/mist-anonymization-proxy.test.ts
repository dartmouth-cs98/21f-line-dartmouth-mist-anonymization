import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as MistAnonymizationProxy from '../infra/lib/anonymizationStack';

test('Stack matches snapshot', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new MistAnonymizationProxy.MistAnonymizationProxyStack(app, 'TestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT));
});
