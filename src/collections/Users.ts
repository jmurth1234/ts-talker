import { CollectionConfig } from 'payload/types'
import { accessAdminOrCurrent } from '../lib/access'

const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: 'Users'
  },
  access: accessAdminOrCurrent(),
  fields: [
    {
      name: "isAdmin",
      label: "Is Admin",
      type: "checkbox",
      access: {
        update: ({ req }) => req.user && req.user.isAdmin,
      },
    },
    {
      name: "discordId",
      label: "Discord ID",
      type: "text",
      admin: {
        readOnly: true,
      },
    },
    {
      name: "discordUsername",
      label: "Discord Username",
      type: "text",
      admin: {
        readOnly: true,
      },
    },
    {
      name: "currentChannelId",
      label: "Current Channel ID",
      type: "text",
      admin: {
        readOnly: true,
      },
    },
    {
      name: "userMessagePreference",
      label: "User Message Preference",
      type: "select",
      options: [
        {
          label: "None",
          value: "none",
        },
        {
          label: "Mentions",
          value: "mentions",
        },
        {
          label: "All",
          value: "all",
        },
      ],
      defaultValue: "all",
      admin: {
        description:
          "This allows you to control which of your messages the bot sees. Mentions will only allow the bot to see messages where you mention it. None will prevent the bot from seeing any of your messages. All will allow the bot to see all of your messages.",
      },
    },
    {
      name: "preventPings",
      label: "Prevent Pings",
      type: "checkbox",
      defaultValue: false,
      admin: {
        description:
          "This will prevent the bot from pinging you when it responds to your messages.",
      },
    },
  ],
}

export default Users
