/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mammoth", "unpdf"],
  poweredByHeader: false,
  // The dashboard shows candidate details: keep it out of search engines, caches and frames.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
};
export default nextConfig;
