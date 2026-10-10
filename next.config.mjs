// Fully static: `next build` writes plain files to out/, which GitHub Pages serves.
// NEXT_PUBLIC_BASE_PATH is "/recap" for the Pages build (site lives at /recap/) and empty locally.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
};

export default nextConfig;
