import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest, { dynamic } from "../../../apps/web/app/manifest";

describe("PWA manifest", () => {
  it("provides install metadata and supports static export", () => {
    expect(dynamic).toBe("force-static");
    expect(manifest()).toEqual({
      name: "Kairos",
      short_name: "Kairos",
      start_url: "/",
      display: "standalone",
      background_color: "#0A0A0C",
      theme_color: "#0A0A0C",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });
  });

  it.each(manifest().icons!)("ships a PNG matching $src ($sizes, $purpose)", (icon) => {
    const png = readFileSync(new URL(`../../../apps/web/public${icon.src}`, import.meta.url));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    const [width, height] = icon.sizes!.split("x").map(Number);
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  });
});
