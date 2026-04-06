# npm Registry MCP

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives Claude direct access to the npm registry — search packages, check versions, audit vulnerabilities, compare libraries and more, all without leaving your conversation.

![License](https://img.shields.io/github/license/EinfacheEnte/npm-Registry-MCP)
![MCP](https://img.shields.io/badge/MCP-compatible-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## Why

When you're coding with Claude and need to pick a package, check if something is still maintained, or audit a dependency for vulnerabilities — you normally have to stop, switch tabs, google it, and come back. This server removes that friction entirely. Claude can query the npm registry directly, in context, mid-conversation.

---

## Tools

| Tool | What it does |
|---|---|
| `search_packages` | Search npm by keyword with quality and maintenance scores |
| `get_package_info` | Full details — license, maintainers, dependencies, size, downloads |
| `get_package_versions` | Full version history with publish dates |
| `get_download_stats` | Download counts over any period (day / week / month / year) |
| `check_vulnerabilities` | Known CVEs for a specific package version |
| `compare_packages` | Side-by-side comparison of two packages |

---

## Example prompts

Once installed, just ask Claude naturally:

```
"What's the best package for parsing CSV files in Node?"
"Is moment.js still actively maintained?"
"Compare lodash and ramda"
"Are there any known vulnerabilities in axios 0.21.1?"
"What changed in express between v4 and v5?"
"How many downloads does react get per month?"
```

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [Claude Desktop](https://claude.ai/download)

### 1. Clone and build

```bash
git clone https://github.com/EinfacheEnte/npm-Registry-MCP.git
cd npm-Registry-MCP
npm install
npm run build
```

### 2. Add to Claude Desktop config

Open your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following (replace the path with wherever you cloned the repo):

```json
{
  "mcpServers": {
    "npm-registry": {
      "command": "node",
      "args": ["/absolute/path/to/npm-Registry-MCP/dist/index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

Fully quit and reopen Claude Desktop. You should see a tools icon confirming the server is connected.

No API key required — the npm registry is fully public.

---

## Development

```bash
# Run in dev mode (no build step needed)
npm run dev

# Build
npm run build
```

The server communicates over stdio using the MCP protocol. You can test it directly:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

---

## Data sources

All data is fetched live from public APIs — no database, no cache, no rate limits on your end:

- [registry.npmjs.org](https://registry.npmjs.org) — package metadata and versions
- [api.npmjs.org](https://api.npmjs.org) — download statistics
- [api.npms.io](https://api.npms.io) — quality, maintenance and popularity scores
- [registry.npmjs.org/-/npm/v1/security/advisories](https://registry.npmjs.org) — vulnerability data

---

## Roadmap

- [ ] `get_changelog` — diff between two versions
- [ ] Package README as an MCP resource
- [ ] `get_dependents` — what packages depend on this one
- [ ] Publish to npm for one-line `npx` install

---

## License

MIT
