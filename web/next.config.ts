import type { NextConfig } from "next";

const isGithubActionsBuild = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const githubPagesBasePath = isGithubActionsBuild && repositoryName ? `/${repositoryName}` : "";

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
