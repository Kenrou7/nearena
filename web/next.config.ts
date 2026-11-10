import type { NextConfig } from "next";

const isGithubActionsBuild = process.env.GITHUB_ACTIONS === "true";
const configuredPagesBasePath = process.env.GH_PAGES_BASE_PATH?.trim();

function resolveGithubPagesBasePath(): string {
  if (!isGithubActionsBuild) {
    return "";
  }

  if (configuredPagesBasePath && configuredPagesBasePath !== "/") {
    return configuredPagesBasePath.startsWith("/") ? configuredPagesBasePath : `/${configuredPagesBasePath}`;
  }

  return "";
}

const githubPagesBasePath = resolveGithubPagesBasePath();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isGithubActionsBuild
    ? {
        output: "export",
        trailingSlash: true,
        images: {
          unoptimized: true,
        },
        basePath: githubPagesBasePath,
        assetPrefix: githubPagesBasePath,
      }
    : {}),
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    return config;
  },
};

export default nextConfig;
