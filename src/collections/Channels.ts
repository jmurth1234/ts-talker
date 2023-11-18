import { CollectionConfig } from 'payload/types'
import { accessAdminOnly } from '../lib/access'

const Channels: CollectionConfig = {
  slug: 'channels',
  admin: {
    group: 'Bot Configuration',
    hidden: true,
  },
  access: accessAdminOnly(),
  fields: [
    {
      name: 'channelId',
      label: 'Channel ID',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'webhookId',
      label: 'Webhook ID',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
      },
    }
  ],
}

export default Channels
