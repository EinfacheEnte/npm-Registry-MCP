#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "mcp-npm-registry",
  version: "1.0.0",
});

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_API = "https://api.npmjs.org";
const NPMS_API = "https://api.npms.io/v2";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Tool: search_packages ───────────────────────────────────────────────────

server.tool(
  "search_packages",
  "Search for npm packages by keyword. Returns name, description, version, downloads and quality score.",
  {
    query: z.string().describe("Search query, e.g. 'csv parser' or 'react animation'"),
    limit: z.number().min(1).max(20).default(5).describe("Number of results to return (1-20)"),
  },
  async ({ query, limit }) => {
    if (!query.trim()) {
      return { content: [{ type: "text", text: "Please provide a search query." }] };
    }
    const data = await fetchJSON(
      `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`
    );

    if (!data.objects?.length) {
      return { content: [{ type: "text", text: `No packages found for "${query}".` }] };
    }

    const results = data.objects.map((obj: any) => {
      const p = obj.package;
      const score = obj.score?.detail;
      return [
        `📦 **${p.name}** v${p.version}`,
        `   ${p.description ?? "No description"}`,
        `   🔗 https://www.npmjs.com/package/${p.name}`,
        score
          ? `   Score — quality: ${(score.quality * 100).toFixed(0)}%  maintenance: ${(score.maintenance * 100).toFixed(0)}%  popularity: ${(score.popularity * 100).toFixed(0)}%`
          : "",
        p.date ? `   Last published: ${new Date(p.date).toLocaleDateString()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${data.total} packages for "${query}". Top ${results.length}:\n\n${results.join("\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: get_package_info ──────────────────────────────────────────────────

server.tool(
  "get_package_info",
  "Get detailed info about an npm package: description, latest version, license, maintainers, repository, dependencies and more.",
  {
    name: z.string().describe("Exact package name, e.g. 'express' or '@types/node'"),
  },
  async ({ name }) => {
    const [registry, downloads, npms] = await Promise.allSettled([
      fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`),
      fetchJSON(`${NPM_API}/downloads/point/last-month/${encodeURIComponent(name)}`),
      fetchJSON(`${NPMS_API}/package/${encodeURIComponent(name)}`),
    ]);

    if (registry.status === "rejected") {
      return { content: [{ type: "text", text: `Package "${name}" not found on npm.` }] };
    }

    const pkg = registry.value;
    const latest = pkg["dist-tags"]?.latest;
    const info = pkg.versions?.[latest] ?? {};
    const dl = downloads.status === "fulfilled" ? downloads.value.downloads : null;
    const score = npms.status === "fulfilled" ? npms.value.score?.detail : null;

    const deps = Object.keys(info.dependencies ?? {});
    const devDeps = Object.keys(info.devDependencies ?? {});

    const lines = [
      `📦 **${pkg.name}** v${latest}`,
      ``,
      `📝 ${pkg.description ?? "No description"}`,
      ``,
      `🔗 https://www.npmjs.com/package/${pkg.name}`,
      info.homepage ? `🌐 Homepage: ${info.homepage}` : null,
      pkg.repository?.url ? `📁 Repo: ${pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}` : null,
      ``,
      `📋 License: ${info.license ?? "Unknown"}`,
      `👥 Maintainers: ${pkg.maintainers?.map((m: any) => m.name).join(", ") ?? "Unknown"}`,
      `📅 Last published: ${pkg.time?.[latest] ? new Date(pkg.time[latest]).toLocaleDateString() : "Unknown"}`,
      dl != null ? `📥 Downloads last month: ${dl.toLocaleString()}` : null,
      ``,
      deps.length ? `🔗 Dependencies (${deps.length}): ${deps.slice(0, 10).join(", ")}${deps.length > 10 ? ` +${deps.length - 10} more` : ""}` : `🔗 No dependencies`,
      devDeps.length ? `🛠  Dev dependencies (${devDeps.length}): ${devDeps.slice(0, 5).join(", ")}${devDeps.length > 5 ? ` +${devDeps.length - 5} more` : ""}` : null,
      info.dist?.unpackedSize ? `📦 Unpacked size: ${formatBytes(info.dist.unpackedSize)}` : null,
      score
        ? `\n⭐ Scores — quality: ${(score.quality * 100).toFixed(0)}%  maintenance: ${(score.maintenance * 100).toFixed(0)}%  popularity: ${(score.popularity * 100).toFixed(0)}%`
        : null,
    ]
      .filter((l) => l !== null)
      .join("\n");

    return { content: [{ type: "text", text: lines }] };
  }
);

// ─── Tool: get_package_versions ──────────────────────────────────────────────

server.tool(
  "get_package_versions",
  "List all published versions of an npm package with their publish dates.",
  {
    name: z.string().describe("Package name"),
    limit: z.number().min(1).max(50).default(10).describe("How many recent versions to show"),
  },
  async ({ name, limit }) => {
    const pkg = await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);

    const times: Record<string, string> = pkg.time ?? {};
    const versions = Object.entries(times)
      .filter(([v]) => !["created", "modified"].includes(v))
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .slice(0, limit);

    if (!versions.length) {
      return { content: [{ type: "text", text: `No versions found for "${name}".` }] };
    }

    const latest = pkg["dist-tags"]?.latest;
    const lines = versions.map(([v, date]) =>
      `${v === latest ? "→" : " "} ${v.padEnd(20)} ${new Date(date).toLocaleDateString()}`
    );

    return {
      content: [
        {
          type: "text",
          text: `**${name}** — last ${versions.length} versions (→ = latest):\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: get_download_stats ────────────────────────────────────────────────

server.tool(
  "get_download_stats",
  "Get download statistics for an npm package over a given period.",
  {
    name: z.string().describe("Package name"),
    period: z
      .enum(["last-day", "last-week", "last-month", "last-year"])
      .default("last-month")
      .describe("Time period for download stats"),
  },
  async ({ name, period }) => {
    const data = await fetchJSON(
      `${NPM_API}/downloads/point/${period}/${encodeURIComponent(name)}`
    );

    return {
      content: [
        {
          type: "text",
          text: `📥 **${name}** downloads (${period}): **${data.downloads?.toLocaleString() ?? 0}**\n   Period: ${data.start} → ${data.end}`,
        },
      ],
    };
  }
);

// ─── Tool: check_vulnerabilities ────────────────────────────────────────────

server.tool(
  "check_vulnerabilities",
  "Check if a specific version of an npm package has known security vulnerabilities.",
  {
    name: z.string().describe("Package name"),
    version: z.string().describe("Package version, e.g. '4.17.21'"),
  },
  async ({ name, version }) => {
    const body = { [name]: version };
    const res = await fetch("https://registry.npmjs.org/-/npm/v1/security/audits/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "audit", version: "1.0.0", requires: body, dependencies: { [name]: { version } } }),
    });

    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Could not fetch vulnerability data for ${name}@${version}.` }],
      };
    }

    const data = await res.json() as any;
    const advisories = Object.values(data.advisories ?? {}) as any[];

    if (!advisories.length) {
      return {
        content: [{ type: "text", text: `✅ No known vulnerabilities found for **${name}@${version}**.` }],
      };
    }

    const lines = advisories.map((a: any) =>
      [
        `⚠️  **${a.title}** (${a.severity?.toUpperCase()})`,
        `   CVE: ${a.cves?.join(", ") || "N/A"}`,
        `   Affected: ${a.vulnerable_versions}  →  Patched: ${a.patched_versions}`,
        `   ${a.url}`,
      ].join("\n")
    );

    return {
      content: [
        {
          type: "text",
          text: `🚨 Found **${advisories.length}** vulnerabilit${advisories.length === 1 ? "y" : "ies"} for **${name}@${version}**:\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: compare_packages ──────────────────────────────────────────────────

server.tool(
  "compare_packages",
  "Compare two npm packages side by side: downloads, maintenance, quality, dependencies and more.",
  {
    package1: z.string().describe("First package name"),
    package2: z.string().describe("Second package name"),
  },
  async ({ package1, package2 }) => {
    const [a, b] = await Promise.all(
      [package1, package2].map(async (name) => {
        const [registry, downloads, npms] = await Promise.allSettled([
          fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`),
          fetchJSON(`${NPM_API}/downloads/point/last-month/${encodeURIComponent(name)}`),
          fetchJSON(`${NPMS_API}/package/${encodeURIComponent(name)}`),
        ]);
        return { name, registry, downloads, npms };
      })
    );

    const format = (p: typeof a) => {
      if (p.registry.status === "rejected") return `❌ ${p.name} not found`;
      const pkg = p.registry.value;
      const latest = pkg["dist-tags"]?.latest;
      const info = pkg.versions?.[latest] ?? {};
      const dl = p.downloads.status === "fulfilled" ? p.downloads.value.downloads : null;
      const score = p.npms.status === "fulfilled" ? p.npms.value.score?.detail : null;
      const deps = Object.keys(info.dependencies ?? {}).length;

      return [
        `**${p.name}** v${latest}`,
        `  License: ${info.license ?? "Unknown"}`,
        `  Downloads/month: ${dl != null ? dl.toLocaleString() : "N/A"}`,
        `  Dependencies: ${deps}`,
        `  Last published: ${pkg.time?.[latest] ? new Date(pkg.time[latest]).toLocaleDateString() : "Unknown"}`,
        score
          ? `  Quality: ${(score.quality * 100).toFixed(0)}%  Maintenance: ${(score.maintenance * 100).toFixed(0)}%  Popularity: ${(score.popularity * 100).toFixed(0)}%`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    };

    return {
      content: [
        {
          type: "text",
          text: `## Package Comparison\n\n${format(a)}\n\n${"─".repeat(40)}\n\n${format(b)}`,
        },
      ],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-npm-registry running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
