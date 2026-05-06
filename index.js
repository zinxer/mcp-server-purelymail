#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_TOKEN = process.env.PURELYMAIL_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: PURELYMAIL_API_TOKEN environment variable is required.");
  console.error("Get your token at https://purelymail.com/manage/account");
  process.exit(1);
}

const BASE_URL = "https://purelymail.com/api/v0";

async function call(endpoint, body = {}) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Purelymail-Api-Token": API_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { type: "error", message: text };
  }
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "purelymail", version: "1.0.0" });

server.registerTool("list_domains", {
  description: "List all domains on the Purelymail account with their DNS validation status (MX, SPF, DKIM, DMARC)",
  inputSchema: {
    includeShared: z.boolean().optional().describe("Include shared Purelymail domains (default: false)"),
  },
}, async ({ includeShared = false }) => {
  return ok(await call("listDomains", { includeShared }));
});

server.registerTool("get_ownership_code", {
  description: "Get the TXT record value needed to prove domain ownership. Add this as a TXT record at the root of your domain before calling add_domain.",
  inputSchema: {},
}, async () => {
  return ok(await call("getOwnershipCode"));
});

server.registerTool("add_domain", {
  description: "Add a domain to Purelymail. The ownership TXT record and MX record must be set in DNS first. Use get_ownership_code to get the exact TXT value.",
  inputSchema: {
    domainName: z.string().describe("The domain to add, e.g. 'example.com'"),
  },
}, async ({ domainName }) => {
  return ok(await call("addDomain", { domainName }));
});

server.registerTool("delete_domain", {
  description: "Delete a domain and all its associated users from Purelymail",
  inputSchema: {
    domainName: z.string().describe("The domain to delete"),
  },
}, async ({ domainName }) => {
  return ok(await call("deleteDomain", { domainName }));
});

server.registerTool("create_user", {
  description: "Create a new email mailbox on a Purelymail domain",
  inputSchema: {
    userName: z.string().describe("Local part only — e.g. 'hello' for hello@example.com"),
    domainName: z.string().describe("The domain — e.g. 'example.com'"),
    password: z.string().describe("Password for the mailbox"),
    recoveryEmail: z.string().optional().describe("Recovery email address"),
    sendWelcomeEmail: z.boolean().optional().describe("Send a welcome email on creation (default: true)"),
    enableSearchIndexing: z.boolean().optional().describe("Enable search indexing (default: true)"),
  },
}, async ({ userName, domainName, password, recoveryEmail, sendWelcomeEmail, enableSearchIndexing }) => {
  return ok(await call("createUser", {
    userName,
    domainName,
    password,
    ...(recoveryEmail !== undefined && { recoveryEmail }),
    ...(sendWelcomeEmail !== undefined && { sendWelcomeEmail }),
    ...(enableSearchIndexing !== undefined && { enableSearchIndexing }),
  }));
});

server.registerTool("list_users", {
  description: "List all email users/mailboxes on the Purelymail account",
  inputSchema: {},
}, async () => {
  return ok(await call("listUsers"));
});

server.registerTool("get_user", {
  description: "Get details for a specific Purelymail user",
  inputSchema: {
    userName: z.string().describe("Full email address, e.g. 'hello@example.com'"),
  },
}, async ({ userName }) => {
  return ok(await call("getUser", { userName }));
});

server.registerTool("modify_user", {
  description: "Modify an existing Purelymail mailbox (password, recovery email, search indexing)",
  inputSchema: {
    userName: z.string().describe("Full email address to modify, e.g. 'hello@example.com'"),
    password: z.string().optional().describe("New password"),
    recoveryEmail: z.string().optional().describe("New recovery email"),
    enableSearchIndexing: z.boolean().optional().describe("Enable or disable search indexing"),
  },
}, async ({ userName, ...rest }) => {
  return ok(await call("modifyUser", { userName, ...rest }));
});

server.registerTool("delete_user", {
  description: "Delete an email mailbox from Purelymail",
  inputSchema: {
    userName: z.string().describe("Full email address to delete, e.g. 'hello@example.com'"),
  },
}, async ({ userName }) => {
  return ok(await call("deleteUser", { userName }));
});

server.registerTool("list_routing_rules", {
  description: "List all email routing/forwarding rules on the Purelymail account",
  inputSchema: {},
}, async () => {
  return ok(await call("listRoutingRules"));
});

server.registerTool("create_routing_rule", {
  description: "Create an email routing rule to forward or alias addresses. E.g. forward support@example.com to another inbox.",
  inputSchema: {
    domainName: z.string().describe("The domain the rule applies to"),
    prefix: z.string().describe("The local part to match — e.g. 'support' matches support@example.com"),
    targetAddresses: z.array(z.string()).describe("Email addresses to forward matching mail to"),
    matchUser: z.boolean().optional().describe("Whether to also match existing users with this prefix (default: false)"),
  },
}, async ({ domainName, prefix, targetAddresses, matchUser = false }) => {
  return ok(await call("createRoutingRule", { domainName, prefix, targetAddresses, matchUser }));
});

server.registerTool("delete_routing_rule", {
  description: "Delete an email routing rule. Get the rule ID from list_routing_rules.",
  inputSchema: {
    id: z.string().describe("Routing rule ID from list_routing_rules"),
    domainName: z.string(),
    prefix: z.string(),
    matchUser: z.boolean().optional(),
    targetAddresses: z.array(z.string()),
  },
}, async (args) => {
  return ok(await call("deleteRoutingRule", args));
});

const transport = new StdioServerTransport();
await server.connect(transport);
