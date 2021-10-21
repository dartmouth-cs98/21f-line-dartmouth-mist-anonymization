import { EventBridgeEvent } from 'aws-lambda';
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand
} from '@aws-sdk/client-lambda';
import { v4 as uuidv4 } from 'uuid';

export const main = async (
  _event: EventBridgeEvent<any, any>
) => {
  // get lambda client
  const client = new LambdaClient({});

  // get current proxy configuration
  const getConfigurationCommand = new GetFunctionConfigurationCommand({
    FunctionName: process.env.PROXY_FUNCTION_NAME
  });
  const { Environment: environment } =
    await client.send(getConfigurationCommand);

  // if no environment variables set, set alert
  if (!environment?.Variables) {
    // TODO - cloudwatch alert

    return;
  }

  // get environment variables to rotate
  const toRotate = Object.keys(environment.Variables).filter(
    key => /^MIST_[A-Z_]+_ROTATING_KEY$/gm.test(key)
  );

  // generate new key values
  const newKeys = toRotate.reduce((keys, key) => {
    Object.assign(keys, { [key]: uuidv4() });
    return keys;
  }, {});

  // compile new environment variables
  const newEnvironmentVariables = {
    ...environment.Variables,
    ...newKeys
  };

  // update configuration
  const updateConfigurationCommand = new UpdateFunctionConfigurationCommand({
    FunctionName: process.env.PROXY_FUNCTION_NAME,
    Environment: {
      Variables: newEnvironmentVariables
    }
  });
  const { Environment: newEnvironment } =
    await client.send(updateConfigurationCommand);

  // verify update
  if (newEnvironment?.Variables == newEnvironmentVariables) {
    // TODO - log success in cloudwatch (alarm if no recent success?)
  }
};
