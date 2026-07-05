/**
 * X (Twitter) MCP tools — post tweets, read timeline, search, manage DMs,
 * get user info, and handle mentions.
 *
 * Uses X API v2. Credentials injected via container env vars.
 * OAuth 1.0a (user context) for write operations, Bearer token for reads.
 */
import crypto from 'crypto';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

const BASE = 'https://api.twitter.com/2';

function bearerToken(): string {
  return process.env.X_BEARER_TOKEN ?? '';
}

function oauth1Credentials() {
  return {
    consumerKey: process.env.X_CONSUMER_KEY ?? '',
    consumerSecret: process.env.X_CONSUMER_SECRET ?? '',
    accessToken: process.env.X_ACCESS_TOKEN ?? '',
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? '',
  };
}

function noCredentials() {
  return {
    content: [{ type: 'text' as const, text: 'X credentials are not configured.' }],
    isError: true,
  };
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string) {
  return { content: [{ type: 'text' as const, text: `X API error: ${msg}` }], isError: true };
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signing (required for write operations)
// ---------------------------------------------------------------------------

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuth1Header(method: string, url: string, bodyParams: Record<string, string> = {}): string {
  const creds = oauth1Credentials();
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...bodyParams, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams['oauth_signature'] = signature;

  const headerValue = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerValue}`;
}

async function xGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bearerToken()}` },
  });
  return res.json();
}

async function xPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${BASE}${path}`;
  const authHeader = buildOAuth1Header('POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function xDelete(path: string): Promise<unknown> {
  const url = `${BASE}${path}`;
  const authHeader = buildOAuth1Header('DELETE', url);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: authHeader },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const postTweet: McpToolDefinition = {
  tool: {
    name: 'x_post_tweet',
    description: 'Post a tweet (or reply to an existing tweet) on X.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Tweet text (max 280 chars)' },
        reply_to_id: { type: 'string', description: 'Tweet ID to reply to (optional)' },
        quote_tweet_id: { type: 'string', description: 'Tweet ID to quote-tweet (optional)' },
      },
      required: ['text'],
    },
  },
  async handler(args) {
    if (!oauth1Credentials().consumerKey) return noCredentials();
    const body: Record<string, unknown> = { text: args.text as string };
    if (args.reply_to_id) body.reply = { in_reply_to_tweet_id: args.reply_to_id };
    if (args.quote_tweet_id) body.quote_tweet_id = args.quote_tweet_id;
    const data = await xPost('/tweets', body);
    return ok(data);
  },
};

const deleteTweet: McpToolDefinition = {
  tool: {
    name: 'x_delete_tweet',
    description: 'Delete a tweet by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: { type: 'string', description: 'Tweet ID to delete' },
      },
      required: ['tweet_id'],
    },
  },
  async handler(args) {
    if (!oauth1Credentials().consumerKey) return noCredentials();
    const data = await xDelete(`/tweets/${args.tweet_id as string}`);
    return ok(data);
  },
};

const getMyProfile: McpToolDefinition = {
  tool: {
    name: 'x_get_my_profile',
    description: 'Get the authenticated user\'s X profile (id, name, username, description, metrics).',
    inputSchema: { type: 'object', properties: {} },
  },
  async handler() {
    if (!bearerToken()) return noCredentials();
    const data = await xGet('/users/me', {
      'user.fields': 'id,name,username,description,public_metrics,created_at,verified',
    });
    return ok(data);
  },
};

const getUser: McpToolDefinition = {
  tool: {
    name: 'x_get_user',
    description: 'Get an X user\'s profile by username.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'X username without the @ symbol' },
      },
      required: ['username'],
    },
  },
  async handler(args) {
    if (!bearerToken()) return noCredentials();
    const username = args.username as string;
    const data = await xGet(`/users/by/username/${username}`, {
      'user.fields': 'id,name,username,description,public_metrics,created_at,verified',
    });
    return ok(data);
  },
};

const searchTweets: McpToolDefinition = {
  tool: {
    name: 'x_search_tweets',
    description: 'Search recent tweets (last 7 days). Supports full X query syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g. "from:username", "#hashtag", "keyword -filter:retweets")' },
        max_results: { type: 'number', description: 'Number of results (10–100, default 20)' },
      },
      required: ['query'],
    },
  },
  async handler(args) {
    if (!bearerToken()) return noCredentials();
    const data = await xGet('/tweets/search/recent', {
      query: args.query as string,
      max_results: String(Math.min(100, Math.max(10, (args.max_results as number | undefined) ?? 20))),
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,conversation_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    return ok(data);
  },
};

const getMyTimeline: McpToolDefinition = {
  tool: {
    name: 'x_get_my_timeline',
    description: 'Get the authenticated user\'s home timeline (recent tweets from followed accounts).',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Number of tweets (5–100, default 20)' },
      },
    },
  },
  async handler(args) {
    if (!bearerToken()) return noCredentials();
    // First get own user ID
    const me = (await xGet('/users/me')) as { data?: { id: string } };
    if (!me?.data?.id) return err('Could not determine authenticated user ID');
    const data = await xGet(`/users/${me.data.id}/timelines/reverse_chronological`, {
      max_results: String(Math.min(100, Math.max(5, (args.max_results as number | undefined) ?? 20))),
      'tweet.fields': 'id,text,author_id,created_at,public_metrics',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    return ok(data);
  },
};

const getMyMentions: McpToolDefinition = {
  tool: {
    name: 'x_get_my_mentions',
    description: 'Get recent tweets that mention the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Number of results (5–100, default 20)' },
      },
    },
  },
  async handler(args) {
    if (!bearerToken()) return noCredentials();
    const me = (await xGet('/users/me')) as { data?: { id: string } };
    if (!me?.data?.id) return err('Could not determine authenticated user ID');
    const data = await xGet(`/users/${me.data.id}/mentions`, {
      max_results: String(Math.min(100, Math.max(5, (args.max_results as number | undefined) ?? 20))),
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,conversation_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    return ok(data);
  },
};

const getMyTweets: McpToolDefinition = {
  tool: {
    name: 'x_get_my_tweets',
    description: 'Get the authenticated user\'s own recent tweets.',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Number of results (5–100, default 20)' },
      },
    },
  },
  async handler(args) {
    if (!bearerToken()) return noCredentials();
    const me = (await xGet('/users/me')) as { data?: { id: string } };
    if (!me?.data?.id) return err('Could not determine authenticated user ID');
    const data = await xGet(`/users/${me.data.id}/tweets`, {
      max_results: String(Math.min(100, Math.max(5, (args.max_results as number | undefined) ?? 20))),
      'tweet.fields': 'id,text,created_at,public_metrics',
    });
    return ok(data);
  },
};

const likeTweet: McpToolDefinition = {
  tool: {
    name: 'x_like_tweet',
    description: 'Like a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: { type: 'string', description: 'Tweet ID to like' },
      },
      required: ['tweet_id'],
    },
  },
  async handler(args) {
    if (!oauth1Credentials().consumerKey) return noCredentials();
    const me = (await xGet('/users/me')) as { data?: { id: string } };
    if (!me?.data?.id) return err('Could not determine authenticated user ID');
    const data = await xPost(`/users/${me.data.id}/likes`, { tweet_id: args.tweet_id as string });
    return ok(data);
  },
};

const retweetTweet: McpToolDefinition = {
  tool: {
    name: 'x_retweet',
    description: 'Retweet a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: { type: 'string', description: 'Tweet ID to retweet' },
      },
      required: ['tweet_id'],
    },
  },
  async handler(args) {
    if (!oauth1Credentials().consumerKey) return noCredentials();
    const me = (await xGet('/users/me')) as { data?: { id: string } };
    if (!me?.data?.id) return err('Could not determine authenticated user ID');
    const data = await xPost(`/users/${me.data.id}/retweets`, { tweet_id: args.tweet_id as string });
    return ok(data);
  },
};

registerTools([
  postTweet,
  deleteTweet,
  getMyProfile,
  getUser,
  searchTweets,
  getMyTimeline,
  getMyMentions,
  getMyTweets,
  likeTweet,
  retweetTweet,
]);
