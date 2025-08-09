import { AppEnv } from "./app.js";

export function getContainerShardId({
  userId,
  prefix,
}: {
  userId: string;
  prefix?: string;
}) {
  // When you are developing cloudflare stuff, if you run `npm run deploy:dev`,
  // your current containers will not die and you won't notice any changes. To
  // get around this, you can route "all users" (in dev just you) to userid +
  // xxxxx, where xxxxx is a constant arbitrary suffix, to get new containers.
  // This also guarantees that when you merge to main, everyone's containers
  // will automatically be upgraded to the new ones without having to wait for them to die.
  // This is manual since we don't always want to update this, just during
  // developing the container (changing containers is slow).
  return (prefix ? `${prefix}-${userId}` : userId) + "00033";
}

/**
 * Get a container by container name, container ID, or user ID.
 */
export function getContainer(
  params: { env: AppEnv } & (
    | { userId: string }
    | { containerName: string }
    | { containerId: string }
  ),
  attemptsLeft = 2
) {
  const { env } = params;

  if (attemptsLeft <= 0) {
    throw new Error("Failed to get container after multiple attempts");
  }

  if ("userId" in params) {
    console.info(
      `Attempting to get container for user ${params.userId}, attempts left: ${attemptsLeft}`
    );
    try {
      const shardId = getContainerShardId({
        prefix: attemptsLeft.toString(),
        userId: params.userId,
      });
      return env.NODE_ENV === "development"
        ? env.DEV_LSP_CONTAINER.get(env.DEV_LSP_CONTAINER.idFromName(shardId))
        : env.PROD_LSP_CONTAINER.get(
            env.PROD_LSP_CONTAINER.idFromName(shardId)
          );
    } catch {
      // If we fail to get the container, try to give the user a different container in case
      // the first one was "bad"
      console.warn(
        `Failed to get container for user ${params.userId}, attempts left: ${
          attemptsLeft - 1
        }`
      );
      return getContainer({ userId: params.userId, env }, attemptsLeft - 1);
    }
  }

  if ("containerId" in params) {
    return env.NODE_ENV === "development"
      ? env.DEV_LSP_CONTAINER.get(
          env.DEV_LSP_CONTAINER.idFromString(params.containerId)
        )
      : env.PROD_LSP_CONTAINER.get(
          env.PROD_LSP_CONTAINER.idFromString(params.containerId)
        );
  }

  if ("containerName" in params) {
    return env.NODE_ENV === "development"
      ? env.DEV_LSP_CONTAINER.get(
          env.DEV_LSP_CONTAINER.idFromName(params.containerName)
        )
      : env.PROD_LSP_CONTAINER.get(
          env.PROD_LSP_CONTAINER.idFromName(params.containerName)
        );
  }
}
