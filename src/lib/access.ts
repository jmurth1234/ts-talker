import { Access } from "payload/config";

interface AccessDefinition {
  create?: Access;
  read?: Access;
  readVersions?: Access;
  update?: Access;
  delete?: Access;
  admin?: (args?: any) => boolean | Promise<boolean>;
  unlock?: Access;
}

/**
 * Access control for the users collection. Allow access to all
 **/
export function adminOnlyUsers({ req }) {
  if (!req.user) return false;

  if (req.user.isAdmin) return true;

  return {
    id: {
      equals: req.user.id,
    },
  };
}

export function accessAdminOrCurrent(
  access: AccessDefinition = {},
  defaultAccess = adminOnlyUsers
): AccessDefinition {
  const defaultAccessDefinition = {
    create: defaultAccess,
    read: defaultAccess,
    readVersions: defaultAccess,
    update: defaultAccess,
    delete: defaultAccess,
    admin: ({ req }) => !!req.user,
    unlock: defaultAccess,
  };

  return {
    ...defaultAccessDefinition,
    ...access,
  };
}

/**
 * Access control for other collections. 
 **/
export function adminOnly({ req }) {
  return req.user && req.user.collection === "users" && req.user.isAdmin;
}

export function accessAdminOnly(
  access: AccessDefinition = {},
  defaultAccess = adminOnly
): AccessDefinition {
  const defaultAccessDefinition = {
    create: defaultAccess,
    read: defaultAccess,
    readVersions: defaultAccess,
    update: defaultAccess,
    delete: defaultAccess,
    admin: ({ req }) => !!req.user,
    unlock: defaultAccess,
  };

  return {
    ...defaultAccessDefinition,
    ...access,
  };
}

/**
 * Access control for the discord-user collection. Only allow access to bots
 * who's channelId matches the currentChannelId of the user.
 */

export function discordUserCurrentChannel({ req }) {
  if (!req.user) return false;

  if (req.user.isAdmin) return true;

  return {
    channelId: {
      equals: req.user.currentChannelId,
    },
  };
}

export function accessDiscordUserCurrentChannel(
  access: AccessDefinition = {},
  defaultAccess = discordUserCurrentChannel
): AccessDefinition {
  const defaultAccessDefinition = {
    create: adminOnly,
    read: defaultAccess,
    readVersions: defaultAccess,
    update: defaultAccess,
    delete: defaultAccess,
    admin: adminOnly,
    unlock: adminOnly,
  };

  return {
    ...defaultAccessDefinition,
    ...access,
  };
}
