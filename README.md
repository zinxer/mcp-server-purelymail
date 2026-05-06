# mcp-server-purelymail

MCP server for the [Purelymail](https://purelymail.com) API. Manage email domains, mailboxes, and routing rules directly from Claude Code.

## Setup

### 1. Get your API token

Go to your [Purelymail account settings](https://purelymail.com/manage/account) and generate an API token.

### 2. Add to Claude Code

```bash
claude mcp add purelymail \
  --scope user \
  -e PURELYMAIL_API_TOKEN=your-token-here \
  -- npx mcp-server-purelymail
```

Or run from a local clone:

```bash
git clone https://github.com/zinxer/mcp-server-purelymail.git
cd mcp-server-purelymail
npm install

claude mcp add purelymail \
  --scope user \
  -e PURELYMAIL_API_TOKEN=your-token-here \
  -- node /path/to/mcp-server-purelymail/index.js
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_domains` | List domains with DNS validation status (MX, SPF, DKIM, DMARC) |
| `get_ownership_code` | Get the TXT record value needed to add a new domain |
| `add_domain` | Add a verified domain to Purelymail |
| `delete_domain` | Delete a domain and all its users |
| `create_user` | Create a new email mailbox |
| `list_users` | List all mailboxes |
| `get_user` | Get details for a specific user |
| `modify_user` | Change password, recovery email, or settings |
| `delete_user` | Delete a mailbox |
| `list_routing_rules` | List all routing/forwarding rules |
| `create_routing_rule` | Forward or alias an email address |
| `delete_routing_rule` | Remove a routing rule |

## Adding a new domain (example workflow)

Ask Claude:

> "Add email for mysite.com on Purelymail and set up the DNS records in Cloudflare"

Claude will:
1. Call `get_ownership_code` to get the exact TXT record value
2. Add the TXT, MX, SPF, DKIM, and DMARC records to Cloudflare
3. Call `add_domain` once DNS is verified

## License

MIT
