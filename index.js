#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dns from "node:dns/promises";

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

server.registerTool("check_deliverability", {
  description: "Run live DNS deliverability checks for a domain — MX, SPF, DKIM (all 3 Purelymail keys), and DMARC. Returns a scored report with issues and recommendations.",
  inputSchema: {
    domainName: z.string().describe("The domain to check, e.g. 'example.com'"),
  },
}, async ({ domainName }) => {
  const checks = {};
  const issues = [];
  const recommendations = [];

  // MX
  try {
    const mx = await dns.resolveMx(domainName);
    const sorted = mx.sort((a, b) => a.priority - b.priority);
    const hasPurelymail = sorted.some(r => r.exchange.includes("purelymail.com"));
    checks.mx = { pass: true, records: sorted };
    if (!hasPurelymail) {
      issues.push("MX records do not point to purelymail.com — mail will not be delivered to Purelymail");
      checks.mx.pass = false;
    }
  } catch {
    checks.mx = { pass: false, error: "No MX records found" };
    issues.push("No MX records — domain cannot receive email");
  }

  // SPF
  try {
    const txts = await dns.resolveTxt(domainName);
    const spfRecord = txts.flat().find(r => r.startsWith("v=spf1"));
    if (spfRecord) {
      const allMechanism = spfRecord.match(/([~\-+?])all/)?.[1];
      const allMap = { "-": "fail (strict)", "~": "softfail", "+": "pass (open)", "?": "neutral" };
      checks.spf = { pass: true, record: spfRecord, allMechanism: allMap[allMechanism] || "unknown" };
      if (allMechanism === "+") {
        issues.push("SPF uses +all — allows any server to send on your behalf, severely hurts deliverability");
        checks.spf.pass = false;
      } else if (allMechanism === "~") {
        recommendations.push("SPF uses ~all (softfail) — upgrade to -all for stricter enforcement and better deliverability");
      }
      if (!spfRecord.includes("purelymail.com") && !spfRecord.includes("include:")) {
        issues.push("SPF record may not authorize Purelymail servers — ensure 'include:purelymail.com' or equivalent is present");
      }
    } else {
      checks.spf = { pass: false, error: "No SPF record found" };
      issues.push("No SPF record — receiving servers cannot verify your sending authorization");
    }
  } catch {
    checks.spf = { pass: false, error: "TXT lookup failed" };
    issues.push("SPF TXT lookup failed");
  }

  // DKIM — Purelymail uses 3 keys: key1, key2, key3
  const dkimKeys = ["key1", "key2", "key3"];
  const dkimResults = [];
  for (const key of dkimKeys) {
    const selector = `${key}._domainkey.${domainName}`;
    try {
      const cname = await dns.resolveCname(selector);
      dkimResults.push({ key, pass: true, cname: cname[0] });
    } catch {
      // May be published as TXT directly rather than CNAME
      try {
        const txt = await dns.resolveTxt(selector);
        const record = txt.flat().find(r => r.includes("v=DKIM1"));
        if (record) {
          dkimResults.push({ key, pass: true, type: "TXT" });
        } else {
          dkimResults.push({ key, pass: false, error: "No DKIM record at selector" });
        }
      } catch {
        dkimResults.push({ key, pass: false, error: "No DKIM record at selector" });
      }
    }
  }
  const dkimPassed = dkimResults.filter(r => r.pass).length;
  checks.dkim = {
    pass: dkimPassed === 3,
    keys: dkimResults,
  };
  if (dkimPassed === 0) {
    issues.push("No DKIM keys found — emails cannot be cryptographically signed, deliverability will be poor");
  } else if (dkimPassed < 3) {
    const missing = dkimResults.filter(r => !r.pass).map(r => r.key).join(", ");
    issues.push(`DKIM partially configured — missing keys: ${missing}. All 3 Purelymail DKIM keys are required.`);
  }

  // DMARC — check CNAME then TXT, handle each independently
  const dmarcHost = `_dmarc.${domainName}`;
  try {
    let dmarcRecord = null;
    let dmarcMeta = {};

    // Try CNAME first (Purelymail delegates via CNAME)
    let cnameTarget = null;
    try {
      const cname = await dns.resolveCname(dmarcHost);
      cnameTarget = cname[0];
      dmarcMeta.via = "CNAME";
      dmarcMeta.cname = cnameTarget;
    } catch { /* no CNAME, fall through to TXT */ }

    // Try TXT at CNAME target, then directly at _dmarc host
    const targets = cnameTarget ? [cnameTarget, dmarcHost] : [dmarcHost];
    for (const host of targets) {
      try {
        const txt = await dns.resolveTxt(host);
        const found = txt.flat().find(r => r.startsWith("v=DMARC1"));
        if (found) { dmarcRecord = found; break; }
      } catch { /* try next */ }
    }

    checks.dmarc = { pass: !!dmarcRecord, record: dmarcRecord || null, ...dmarcMeta };

    if (dmarcRecord) {
      const policy = dmarcRecord.match(/p=(\w+)/)?.[1];
      const subdomainPolicy = dmarcRecord.match(/sp=(\w+)/)?.[1];
      const pct = dmarcRecord.match(/pct=(\d+)/)?.[1];
      checks.dmarc.policy = policy;
      checks.dmarc.subdomainPolicy = subdomainPolicy || policy;
      checks.dmarc.pct = pct ? parseInt(pct) : 100;

      if (policy === "none") {
        recommendations.push("DMARC policy is p=none (monitor only) — upgrade to p=quarantine then p=reject to protect your domain from spoofing");
      } else if (policy === "quarantine") {
        recommendations.push("DMARC policy is p=quarantine — consider upgrading to p=reject for maximum protection");
      }
      if (checks.dmarc.pct < 100) {
        recommendations.push(`DMARC pct=${pct} — policy applies to only ${pct}% of mail. Set pct=100 when confident in your setup.`);
      }
    } else {
      checks.dmarc.pass = false;
      issues.push("DMARC record found but could not be parsed — check the record format");
    }
  } catch {
    checks.dmarc = { pass: false, error: "No DMARC record found" };
    issues.push("No DMARC record — your domain is vulnerable to spoofing and many providers will mark mail as spam");
  }

  // Score
  const weights = { mx: 30, spf: 25, dkim: 30, dmarc: 15 };
  const score = Object.entries(weights).reduce((sum, [k, w]) => sum + (checks[k]?.pass ? w : 0), 0);
  const grade = score === 100 ? "A" : score >= 85 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";

  return ok({
    domain: domainName,
    score: `${score}/100`,
    grade,
    checks,
    issues,
    recommendations,
    summary: issues.length === 0 && recommendations.length === 0
      ? "All deliverability checks passed. Your domain is well configured for high email deliverability."
      : issues.length === 0
        ? "No critical issues. Review recommendations to further improve deliverability."
        : `${issues.length} issue(s) found that will harm deliverability. Fix these first.`,
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
