import { CollectionConfig } from 'payload/types'
import { accessAdminOnly } from '../lib/access'

const Functions: CollectionConfig = {
  slug: 'functions',
  admin: {
    useAsTitle: 'name',
    group: 'Bot Configuration',
    defaultColumns: ['name', 'description', 'template'],
  },
  access: accessAdminOnly(),
  fields: [
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      label: 'Description',
      type: 'text',
      required: true,
    },
    {
      name: 'template',
      label: 'Template',
      type: 'textarea',
      required: false,
    },
    {
      name: 'parameters',
      label: 'Parameters',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
        },
        {
          name: 'type',
          label: 'Type',
          type: 'select',
          required: true,
          options: [
            {
              label: 'String',
              value: 'string',
            },
            {
              label: 'Integer',
              value: 'integer',
            },
            {
              label: 'Boolean',
              value: 'boolean',
            },
            {
              label: 'Array',
              value: 'array',
            },
          ],
        },
        {
          name: 'allowedValues',
          label: 'Allowed Values',
          type: 'array',
          fields: [
            {
              name: 'value',
              label: 'Value',
              type: 'text',
              required: true,
            },
          ],
        },
        {
          name: 'description',
          label: 'Description',
          type: 'text',
          required: true,
        },
        {
          name: 'required',
          label: 'Required',
          type: 'checkbox',
          required: true,
        },
      ],

    }
  ],
}

export default Functions
