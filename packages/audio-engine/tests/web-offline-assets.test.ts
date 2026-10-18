import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistrar } from "../../../apps/web/components/ServiceWorkerRegistrar";
import { parseSoundPacks } from "../src/packs";
import {
  collectPackAssetUrls,
  isPrecacheableUrl,
} from "../../../apps/web/lib/offlineAssets";

const origin = "https://kairos.example";
const packsDocument = JSON.parse(readFileSync(
  new URL("../../../apps/web/public/packs.json", import.meta.url), "utf8",
));
const workerSource = readFileSync(new URL("../../../apps/web/public/sw.js", import.meta.url), "utf8");

const registrar = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  listener: undefined as (() => void) | undefined,
  state: { debugInfo: null as null | { currentTheme: string; contextState: string } },
  unsubscribe: vi.fn(),
}));
vi.mock("../../../apps/web/node_modules/react/index.js", () => ({ useEffect: (effect: () => (() => void) | undefined) => {
  registrar.effect = effect;
} }));
vi.mock("../../../apps/web/lib/soundscapeRuntime", () => ({
  useSoundscapeRuntime: {
    getState: () => registrar.state,
    subscribe: (listener: () => void) => {
      registrar.listener = listener;
      return registrar.unsubscribe;
    },
  },
}));

function workerHarness() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const entries = new Map<string, Response>();
  const key = (request: Request | string) => new URL(
    typeof request === "string" ? request : request.url, origin,
  ).href;
  const cache = {
    match: vi.fn(async (request: Request | string) => entries.get(key(request))?.clone()),
    put: vi.fn(async (request: Request | string, response: Response) => {
      entries.set(key(request), response.clone());
    }),
  };
  const fetch = vi.fn(async (_request: Request | string) => new Response("asset"));
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["old-cache", "kairos-offline-v1"]),
    delete: vi.fn(async () => true),
  };
  const claim = vi.fn(async () => {});
  const context = {
    URL, Request, fetch, caches,
    self: {
      location: { origin }, clients: { claim },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        handlers[type] = handler;
      },
    },
  };
  runInNewContext(workerSource, context);
  const validate = runInNewContext("isPrecacheableUrl", context) as (value: string) => boolean;
  async function dispatch(type: string, properties = {}) {
    let completion: Promise<unknown> | undefined;
    handlers[type]({
      ...properties,
      waitUntil: (promise: Promise<unknown>) => { completion = promise; },
      respondWith: (promise: Promise<unknown>) => { completion = promise; },
    });
    return completion;
  }
  return { validate, dispatch, entries, cache, fetch, caches, claim };
}

describe("offline pack assets", () => {
  it("collects every unique take, one-shot, IR and cue from the real packs.json", () => {
    const packs = parseSoundPacks(packsDocument);
    const urls = collectPackAssetUrls(packs);
    // Independently walk the document's leaf strings, rather than mirroring the collector.
    const assetPaths = JSON.stringify(packsDocument).match(/"\/(?:audio|ir)\/[^" ]+"/g)!;
    const expected = new Set(assetPaths.map((path) => JSON.parse(path) as string));
    expect(urls.length).toBe(expected.size);
    expect(new Set(urls)).toEqual(expected);
    expect(collectPackAssetUrls([...packs, ...packs])).toEqual(urls);
    for (const url of urls) {
      expect(isPrecacheableUrl(url, origin)).toBe(true);
      expect(workerHarness().validate(url)).toBe(true);
    }
  });

  const cases: [string, boolean][] = [
    ["/audio/study/pad_01.wav", true],
    ["/ir/room_small.wav", true],
    ["/packs.json", true],
    ["https://kairos.example/audio/test.wav", true],
    ["/audio/test.wav?version=1", true],
    ["https://other.example/audio/test.wav", false],
    ["//other.example/audio/test.wav", false],
    ["/settings", false],
    ["/icons/icon-192.png", false],
    ["/_next/static/app.js", false],
    ["/packs.json/extra", false],
    ["/audio-other/test.wav", false],
    ["/audio/../ir/test.wav", false],
    ["/audio/%2e%2e/test.wav", false],
    ["/audio/..%2ftest.wav", false],
    ["/audio/%5ctest.wav", false],
    ["/audio/%zz.wav", false],
    ["https://listener@kairos.example/audio/test.wav", false],
    ["https://:placeholder@kairos.example/audio/test.wav", false],
  ];
  it.each(cases)("applies the same page and worker policy to %s", (url, expected) => {
    expect(isPrecacheableUrl(url, origin)).toBe(expected);
    expect(workerHarness().validate(url)).toBe(expected);
  });
});

describe("service worker caching", () => {
  it("removes old caches and claims clients on activation", async () => {
    const worker = workerHarness();
    await worker.dispatch("activate");
    expect(worker.caches.delete.mock.calls).toEqual([["old-cache"]]);
    expect(worker.claim).toHaveBeenCalledOnce();
  });

  it("preloads all screens, their static dependencies and exported navigation payloads", async () => {
    const worker = workerHarness();
    worker.fetch.mockImplementation(async (request) => {
      const url = typeof request === "string" ? request : request.url;
      if (new URL(url, origin).pathname === "/") {
        return new Response('<script src="/_next/static/home.js"></script><link href="/_next/static/app.css">', {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.endsWith("app.css")) {
        return new Response('src:url(/_next/static/font.woff2)', {
          headers: { "content-type": "text/css" },
        });
      }
      return new Response("asset");
    });
    await worker.dispatch("install");
    for (const path of ["/", "/timer", "/stopwatch", "/pomodoro", "/settings", "/credit",
      "/timer.txt", "/index.txt", "/_next/static/home.js", "/_next/static/font.woff2"]) {
      expect(worker.entries.has(origin + path)).toBe(true);
    }
  });

  it("serves cached static files and audio without fetching again", async () => {
    const worker = workerHarness();
    for (const path of ["/_next/static/app.js", "/audio/test.wav", "/ir/test.wav", "/packs.json",
      "/icons/icon-192.png"]) {
      const request = new Request(origin + path);
      await worker.dispatch("fetch", { request });
      const cached = await worker.dispatch("fetch", { request }) as Response;
      expect(await cached.text()).toBe("asset");
    }
    expect(worker.fetch).toHaveBeenCalledTimes(5);
  });

  it("uses the network for navigation and falls back to the page, then home", async () => {
    const worker = workerHarness();
    worker.entries.set(origin + "/", new Response("home"));
    const request = { url: origin + "/settings", method: "GET", mode: "navigate" };
    const online = await worker.dispatch("fetch", { request }) as Response;
    expect(await online.text()).toBe("asset");
    worker.fetch.mockRejectedValue(new TypeError("offline"));
    const cached = await worker.dispatch("fetch", { request }) as Response;
    expect(await cached.text()).toBe("asset");
    const fallback = await worker.dispatch("fetch", {
      request: { ...request, url: origin + "/unknown" },
    }) as Response;
    expect(await fallback.text()).toBe("home");
  });

  it("caches message URLs sequentially, rejects unsafe entries and continues after a failure", async () => {
    const worker = workerHarness();
    let active = 0;
    worker.fetch.mockImplementation(async (request) => {
      active++;
      expect(active).toBe(1);
      await Promise.resolve();
      active--;
      if (request === "/audio/missing.wav") throw new TypeError("offline");
      return new Response("audio");
    });
    await worker.dispatch("message", { data: { type: "precache", urls: [
      "/settings", "/audio/missing.wav", "/audio/test.wav", "/ir/test.wav",
      "https://listener@kairos.example/audio/test.wav",
      "https://:placeholder@kairos.example/audio/test.wav", null,
    ] } });
    expect(worker.fetch.mock.calls.map(([request]) => request)).toEqual([
      "/audio/missing.wav", "/audio/test.wav", "/ir/test.wav",
    ]);
    expect(worker.entries.has(origin + "/ir/test.wav")).toBe(true);
  });
});

describe("service worker registration", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mount(mode: string, saveData = false, idleSupported = true) {
    vi.stubEnv("NODE_ENV", mode);
    registrar.state.debugInfo = null;
    registrar.listener = undefined;
    const postMessage = vi.fn();
    const register = vi.fn(async () => ({}));
    const idle = vi.fn<(callback: () => void) => number>(() => 1);
    const timeout = vi.fn<(callback: () => void, delay: number) => number>(() => 2);
    const cancelIdle = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => packsDocument }));
    vi.stubGlobal("navigator", {
      connection: { saveData },
      serviceWorker: { register, ready: Promise.resolve({ active: { postMessage } }) },
    });
    vi.stubGlobal("location", { origin });
    vi.stubGlobal("window", {
      requestIdleCallback: idleSupported ? idle : undefined,
      cancelIdleCallback: cancelIdle,
      setTimeout: timeout, clearTimeout: cancelIdle,
    });
    vi.stubGlobal("fetch", fetch);
    ServiceWorkerRegistrar();
    cleanup = registrar.effect?.();
    function play() {
      registrar.state.debugInfo = { currentTheme: "study", contextState: "running" };
      registrar.listener?.();
    }
    return { register, idle, timeout, postMessage, fetch, play, cancelIdle };
  }

  it("does not register in development", () => {
    const mounted = mount("development");
    expect(mounted.register).not.toHaveBeenCalled();
  });

  it("waits for actual playback and idle, then requests all packs exactly once", async () => {
    const mounted = mount("production");
    expect(mounted.register).toHaveBeenCalledWith("/sw.js");
    expect(mounted.idle).not.toHaveBeenCalled();
    expect(mounted.fetch).not.toHaveBeenCalled();
    mounted.play();
    mounted.play();
    expect(mounted.idle).toHaveBeenCalledOnce();
    expect(mounted.postMessage).not.toHaveBeenCalled();
    mounted.idle.mock.calls[0][0]();
    await vi.waitFor(() => expect(mounted.postMessage).toHaveBeenCalledOnce());
    expect(mounted.postMessage).toHaveBeenCalledWith({ type: "precache", urls: [
      "/packs.json", ...collectPackAssetUrls(parseSoundPacks(packsDocument)),
    ] });
  });

  it("skips precaching when saveData is enabled", () => {
    const mounted = mount("production", true);
    mounted.play();
    expect(mounted.idle).not.toHaveBeenCalled();
    expect(mounted.fetch).not.toHaveBeenCalled();
  });

  it("uses setTimeout when idle callbacks are unavailable and cancels on unmount", () => {
    const mounted = mount("production", false, false);
    mounted.play();
    expect(mounted.timeout).toHaveBeenCalledOnce();
    cleanup?.();
    cleanup = undefined;
    expect(mounted.cancelIdle).toHaveBeenCalledWith(2);
  });
});
