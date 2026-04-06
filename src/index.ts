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
    let pkg: any;
    try {
      pkg = await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}" not found on npm.` }] };
    }

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
    let data: any;
    try {
      data = await fetchJSON(`${NPM_API}/downloads/point/${period}/${encodeURIComponent(name)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}" not found or has no download stats.` }] };
    }

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
    // Verify the package and version exist before auditing
    try {
      await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}@${version}" not found on npm.` }] };
    }

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

// ─── Tool: get_changelog ─────────────────────────────────────────────────────

function extractGitHubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#]|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// Compare two semver strings numerically. Returns negative if a < b, positive if a > b, 0 if equal.
// Pads missing parts with 0 so "5.0" == "5.0.0"
function semverCompare(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [aParts, bParts] = [parse(a), parse(b)];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

server.tool(
  "get_changelog",
  "Get release notes for an npm package. Optionally filter between two versions. Falls back to CHANGELOG.md if no GitHub releases exist.",
  {
    name: z.string().describe("Package name, e.g. 'express'"),
    from_version: z.string().optional().describe("Start version (exclusive), e.g. '4.18.0'"),
    to_version: z.string().optional().describe("End version (inclusive), e.g. '5.0.0'"),
    limit: z.number().min(1).max(20).default(5).describe("Max releases to show when no version range is given"),
  },
  async ({ name, from_version, to_version, limit }) => {
    // Step 1: get repo URL from npm
    let pkg: any;
    try {
      pkg = await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}" not found on npm.` }] };
    }

    const repoUrl: string = pkg.repository?.url ?? "";
    const gh = extractGitHubRepo(repoUrl);

    if (!gh) {
      return {
        content: [{
          type: "text",
          text: `**${name}** does not have a GitHub repository linked on npm — cannot fetch changelog.\nRepository: ${repoUrl || "not set"}`,
        }],
      };
    }

    const { owner, repo } = gh;
    const ghBase = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = { "User-Agent": "mcp-npm-registry", "Accept": "application/vnd.github+json" };

    // Step 2: fetch releases
    let releases: any[] = [];
    try {
      const res = await fetch(`${ghBase}/releases?per_page=50`, { headers });
      if (res.status === 403) {
        return { content: [{ type: "text", text: `GitHub API rate limit reached. Try again in a few minutes.` }] };
      }
      if (!res.ok) throw new Error(`${res.status}`);
      releases = await res.json();
    } catch {
      // Step 3: fallback to CHANGELOG.md
      for (const branch of ["main", "master"]) {
        try {
          const raw = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/CHANGELOG.md`);
          if (!raw.ok) continue;
          const text = await raw.text();
          const lines = text.split("\n");
          const preview = lines.slice(0, 60).join("\n");
          return {
            content: [{ type: "text", text: `No GitHub releases found. Here is the CHANGELOG.md for **${name}**:\n\n${preview}${lines.length > 60 ? "\n\n*(truncated — see full file on GitHub)*" : ""}` }],
          };
        } catch { continue; }
      }
      return { content: [{ type: "text", text: `Could not fetch changelog for **${name}**. No GitHub releases or CHANGELOG.md found.` }] };
    }

    if (!releases.length) {
      return { content: [{ type: "text", text: `**${name}** has no GitHub releases published yet.` }] };
    }

    // Step 4: filter by version range using semver comparison
    if (from_version || to_version) {
      releases = releases.filter((r: any) => {
        const v = r.tag_name;
        const afterFrom = from_version ? semverCompare(v, from_version) > 0 : true;
        const beforeTo = to_version ? semverCompare(v, to_version) <= 0 : true;
        return afterFrom && beforeTo;
      });

      if (!releases.length) {
        return {
          content: [{ type: "text", text: `No releases found for **${name}**${from_version ? ` after v${from_version}` : ""}${to_version ? ` up to v${to_version}` : ""}.` }],
        };
      }
    } else {
      releases = releases.slice(0, limit);
    }

    // Step 5: format output
    const formatted = releases.map((r: any) => {
      const date = new Date(r.published_at).toLocaleDateString();
      const body = r.body?.trim()
        ? r.body.trim().split("\n").slice(0, 20).join("\n") + (r.body.trim().split("\n").length > 20 ? "\n*(truncated)*" : "")
        : "_No release notes provided._";
      return `### ${r.tag_name} — ${date}\n${body}`;
    });

    const header = from_version || to_version
      ? `Changelog for **${name}**${from_version ? ` after v${from_version}` : ""}${to_version ? ` up to v${to_version}` : ""}:`
      : `Last ${releases.length} release${releases.length === 1 ? "" : "s"} for **${name}**:`;

    return {
      content: [{ type: "text", text: `${header}\n\n${formatted.join("\n\n---\n\n")}` }],
    };
  }
);

// ─── Tool: get_dependents ────────────────────────────────────────────────────

server.tool(
  "get_dependents",
  "Find packages that depend on a given npm package, ranked by popularity. Shows total dependent count and top dependents.",
  {
    name: z.string().describe("Package name, e.g. 'lodash'"),
    limit: z.number().min(1).max(20).default(10).describe("Number of top dependents to show"),
  },
  async ({ name, limit }) => {
    // Verify package exists first
    let pkg: any;
    try {
      pkg = await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}" not found on npm.` }] };
    }

    const latest = pkg["dist-tags"]?.latest;

    // npms.io provides dependent count and a ranked list
    let npmsData: any;
    try {
      npmsData = await fetchJSON(`${NPMS_API}/package/${encodeURIComponent(name)}`);
    } catch {
      npmsData = null;
    }

    // Search npm for packages that depend on this one
    // npm search supports "dependencies:package-name" syntax
    let dependents: any[] = [];
    try {
      const searchData = await fetchJSON(
        `${NPM_REGISTRY}/-/v1/search?text=dependencies:${encodeURIComponent(name)}&size=${limit}`
      );
      dependents = searchData.objects ?? [];
    } catch {
      dependents = [];
    }

    const totalStr = npmsData?.collected?.npm?.dependentsCount != null
      ? `**${(npmsData.collected.npm.dependentsCount as number).toLocaleString()}** packages depend on **${name}**`
      : `Packages that depend on **${name}**`;

    if (!dependents.length) {
      return {
        content: [{ type: "text", text: `${totalStr} (v${latest}).\n\nNo dependent packages found in search results.` }],
      };
    }

    const lines = dependents.slice(0, limit).map((obj: any) => {
      const p = obj.package;
      const dl = obj.score?.detail?.popularity;
      return [
        `📦 **${p.name}** v${p.version}`,
        `   ${p.description ?? "No description"}`,
        `   🔗 https://www.npmjs.com/package/${p.name}`,
        dl != null ? `   Popularity score: ${(dl * 100).toFixed(0)}%` : "",
      ].filter(Boolean).join("\n");
    });

    return {
      content: [{
        type: "text",
        text: `${totalStr} (v${latest}).\n\nTop ${dependents.length} dependents by popularity:\n\n${lines.join("\n\n")}`,
      }],
    };
  }
);

// ─── Tool: get_package_readme ────────────────────────────────────────────────

server.tool(
  "get_package_readme",
  "Fetch the full README of an npm package. Useful for understanding how to install, configure and use a package.",
  {
    name: z.string().describe("Package name, e.g. 'express' or '@types/node'"),
    version: z.string().optional().describe("Specific version to fetch README for. Defaults to latest."),
  },
  async ({ name, version }) => {
    let pkg: any;
    try {
      pkg = await fetchJSON(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    } catch {
      return { content: [{ type: "text", text: `Package "${name}" not found on npm.` }] };
    }

    const resolvedVersion = version ?? pkg["dist-tags"]?.latest;

    if (!resolvedVersion) {
      return { content: [{ type: "text", text: `Could not determine version for "${name}".` }] };
    }

    const versionData = pkg.versions?.[resolvedVersion];
    if (!versionData) {
      return { content: [{ type: "text", text: `Version "${resolvedVersion}" not found for "${name}".` }] };
    }

    const MAX_CHARS = 12000;
    const header = `# ${name}@${resolvedVersion}\n📦 https://www.npmjs.com/package/${name}\n\n---\n\n`;

    const trim = (text: string) =>
      text.length > MAX_CHARS
        ? text.slice(0, MAX_CHARS) + "\n\n*(README truncated — see full docs on npmjs.com)*"
        : text;

    // 1. Try readme stored directly in registry document
    const registryReadme: string = pkg.readme ?? "";
    if (registryReadme && registryReadme.trim() !== "ERROR: No README data found!") {
      return { content: [{ type: "text", text: header + trim(registryReadme) }] };
    }

    // 2. Fall back to fetching README from GitHub
    const repoUrl: string = pkg.repository?.url ?? versionData.repository?.url ?? "";
    const gh = extractGitHubRepo(repoUrl);

    if (gh) {
      const { owner, repo } = gh;
      for (const branch of ["main", "master"]) {
        for (const filename of ["README.md", "readme.md", "Readme.md"]) {
          try {
            const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`);
            if (!res.ok) continue;
            let text = await res.text();
            if (!text.trim()) continue;

            // Handle monorepos where root README just points to a sub-path
            if (text.trim().endsWith(".md") && !text.includes("\n")) {
              const subPath = text.trim();
              const subRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subPath}`);
              if (subRes.ok) text = await subRes.text();
            }

            if (text.trim()) {
              return { content: [{ type: "text", text: header + trim(text) }] };
            }
          } catch { continue; }
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: `No README found for **${name}@${resolvedVersion}**.\n\nSee the package page: https://www.npmjs.com/package/${name}`,
      }],
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
