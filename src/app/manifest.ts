import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Economy",
    short_name: "Family $",
    description: "Earn, spend, save and convert family Points.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f4",
    theme_color: "#0e3b36",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
