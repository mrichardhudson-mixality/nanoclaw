/**
 * Stripe MCP tools — balance, customers, charges, payment intents,
 * products, subscriptions, invoices, and payment links.
 *
 * Reads STRIPE_SECRET_KEY from env (injected by host at container spawn time).
 * All calls go directly to the Stripe REST API via fetch.
 */
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

const BASE = 'https://api.stripe.com/v1';

function apiKey(): string {
  return process.env.STRIPE_SECRET_KEY ?? '';
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${apiKey()}:`).toString('base64')}`;
}

async function stripeGet(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader() },
  });
  return res.json();
}

async function stripePost(path: string, body: Record<string, string | number | undefined>): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  return res.json();
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string) {
  return { content: [{ type: 'text' as const, text: `Stripe error: ${msg}` }], isError: true };
}

function noKey() {
  return err('STRIPE_SECRET_KEY is not configured. Ask the operator to set it in the nanoclaw .env file.');
}

// ---------------------------------------------------------------------------

const getBalance: McpToolDefinition = {
  tool: {
    name: 'stripe_get_balance',
    description: 'Get the current Stripe account balance (available and pending funds by currency).',
    inputSchema: { type: 'object', properties: {} },
  },
  async handler() {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/balance');
    return ok(data);
  },
};

const listCustomers: McpToolDefinition = {
  tool: {
    name: 'stripe_list_customers',
    description: 'List Stripe customers. Optionally filter by email.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Filter by exact email address' },
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        starting_after: { type: 'string', description: 'Cursor for pagination (customer ID)' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/customers', {
      email: args.email as string | undefined,
      limit: (args.limit as number | undefined) ?? 10,
      starting_after: args.starting_after as string | undefined,
    });
    return ok(data);
  },
};

const getCustomer: McpToolDefinition = {
  tool: {
    name: 'stripe_get_customer',
    description: 'Retrieve a Stripe customer by their ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stripe customer ID (cus_...)' },
      },
      required: ['id'],
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const id = args.id as string;
    if (!id) return err('id is required');
    const data = await stripeGet(`/customers/${id}`);
    return ok(data);
  },
};

const listCharges: McpToolDefinition = {
  tool: {
    name: 'stripe_list_charges',
    description: 'List recent Stripe charges. Optionally filter by customer.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Filter by customer ID (cus_...)' },
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        starting_after: { type: 'string', description: 'Cursor for pagination (charge ID)' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/charges', {
      customer: args.customer as string | undefined,
      limit: (args.limit as number | undefined) ?? 10,
      starting_after: args.starting_after as string | undefined,
    });
    return ok(data);
  },
};

const listPaymentIntents: McpToolDefinition = {
  tool: {
    name: 'stripe_list_payment_intents',
    description: 'List Stripe payment intents. Optionally filter by customer.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Filter by customer ID (cus_...)' },
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        starting_after: { type: 'string', description: 'Cursor for pagination (pi_...)' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/payment_intents', {
      customer: args.customer as string | undefined,
      limit: (args.limit as number | undefined) ?? 10,
      starting_after: args.starting_after as string | undefined,
    });
    return ok(data);
  },
};

const listProducts: McpToolDefinition = {
  tool: {
    name: 'stripe_list_products',
    description: 'List Stripe products and their prices.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        active: { type: 'boolean', description: 'Filter by active status' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const products = await stripeGet('/products', {
      limit: (args.limit as number | undefined) ?? 10,
      active: args.active !== undefined ? String(args.active) : undefined,
    });
    // Also fetch prices so the agent can see full product+price info
    const prices = await stripeGet('/prices', { limit: 100 });
    return ok({ products, prices });
  },
};

const listSubscriptions: McpToolDefinition = {
  tool: {
    name: 'stripe_list_subscriptions',
    description: 'List Stripe subscriptions. Optionally filter by customer or status.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Filter by customer ID (cus_...)' },
        status: {
          type: 'string',
          description: 'Filter by status: active, past_due, canceled, trialing, unpaid, or all',
        },
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        starting_after: { type: 'string', description: 'Cursor for pagination (sub_...)' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/subscriptions', {
      customer: args.customer as string | undefined,
      status: args.status as string | undefined,
      limit: (args.limit as number | undefined) ?? 10,
      starting_after: args.starting_after as string | undefined,
    });
    return ok(data);
  },
};

const listInvoices: McpToolDefinition = {
  tool: {
    name: 'stripe_list_invoices',
    description: 'List Stripe invoices. Optionally filter by customer or status.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Filter by customer ID (cus_...)' },
        status: {
          type: 'string',
          description: 'Filter by status: draft, open, paid, uncollectible, or void',
        },
        limit: { type: 'number', description: 'Number of results (1–100, default 10)' },
        starting_after: { type: 'string', description: 'Cursor for pagination (in_...)' },
      },
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const data = await stripeGet('/invoices', {
      customer: args.customer as string | undefined,
      status: args.status as string | undefined,
      limit: (args.limit as number | undefined) ?? 10,
      starting_after: args.starting_after as string | undefined,
    });
    return ok(data);
  },
};

const createPaymentLink: McpToolDefinition = {
  tool: {
    name: 'stripe_create_payment_link',
    description:
      'Create a Stripe payment link for a price. Returns a shareable URL the customer can pay through.',
    inputSchema: {
      type: 'object',
      properties: {
        price_id: {
          type: 'string',
          description: 'Stripe price ID (price_...). Use stripe_list_products to find available prices.',
        },
        quantity: { type: 'number', description: 'Quantity of the item (default 1)' },
      },
      required: ['price_id'],
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const priceId = args.price_id as string;
    if (!priceId) return err('price_id is required');
    const data = await stripePost('/payment_links', {
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': (args.quantity as number | undefined) ?? 1,
    });
    return ok(data);
  },
};

const retrieveObject: McpToolDefinition = {
  tool: {
    name: 'stripe_retrieve',
    description:
      'Retrieve any Stripe object by ID. Useful for looking up charges, payment intents, invoices, subscriptions, etc. by their IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          description:
            'The Stripe object type: charges, customers, payment_intents, invoices, subscriptions, products, prices, payment_links',
        },
        id: { type: 'string', description: 'The object ID' },
      },
      required: ['object_type', 'id'],
    },
  },
  async handler(args) {
    if (!apiKey()) return noKey();
    const type = args.object_type as string;
    const id = args.id as string;
    if (!type || !id) return err('object_type and id are required');
    const data = await stripeGet(`/${type}/${id}`);
    return ok(data);
  },
};

registerTools([
  getBalance,
  listCustomers,
  getCustomer,
  listCharges,
  listPaymentIntents,
  listProducts,
  listSubscriptions,
  listInvoices,
  createPaymentLink,
  retrieveObject,
]);
