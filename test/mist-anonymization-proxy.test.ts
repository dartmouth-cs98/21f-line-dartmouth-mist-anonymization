import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as MistAnonymizationProxy from '../infra/lib/anonymizationStack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new MistAnonymizationProxy.MistAnonymizationProxyStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
