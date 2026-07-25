const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const get = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  if (!res.ok) throw new Error(`Search provider returned ${res.status}`);
  return res;
};

const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

/**
 * DuckDuckGo's image endpoint needs a per-query "vqd" token scraped from the
 * HTML page first. It changes format occasionally — hence the two patterns.
 */
async function vqdFor(query) {
  const html = await (await get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`)).text();
  const match = html.match(/vqd="([^"]+)"/) || html.match(/vqd=([\d-]+)&/);
  if (!match) throw new Error("Image search is unavailable right now.");
  return match[1];
}

/** Image search — used by `.img`. */
async function images(query, limit = 5) {
  const vqd = await vqdFor(query);
  const url =
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
    `&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const data = await (await get(url, { headers: { Referer: "https://duckduckgo.com/" } })).json();
  return (data.results || []).slice(0, limit).map((r) => ({
    image: r.image,
    thumbnail: r.thumbnail,
    title: decode(r.title),
    source: r.url,
    width: r.width,
    height: r.height,
  }));
}

/** Web search — used by `.find`. */
async function web(query, limit = 5) {
  const html = await (
    await get("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: query }).toString(),
    })
  ).text();

  // Anchor-driven rather than container-driven: the wrapper's class list has
  // changed before ("links_main links_deep result__body"), whereas the result
  // link itself has stayed `class="result__a"`. Attribute order varies too, so
  // the anchor is matched first and its href read out separately.
  const results = [];
  const anchors = [...html.matchAll(/<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)];

  for (const [, attrs, label] of anchors) {
    if (results.length >= limit) break;

    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    if (!href) continue;

    let url = decode(href);
    // Outbound links go through a redirector; unwrap to the real destination.
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);

    // Sponsored results route through y.js and aren't real search hits.
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;

    const title = decode(label);
    if (!title || !/^https?:\/\//.test(url)) continue;
    if (results.some((r) => r.url === url)) continue;

    // The snippet sits after the anchor in the same block.
    const after = html.slice(html.indexOf(href) + href.length);
    const snippet = after.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]{0,400}?)<\/a>/);

    results.push({ title, url, snippet: snippet ? decode(snippet[1]) : "" });
  }

  if (!results.length) throw new Error("No results found.");
  return results;
}

module.exports = { images, web, decode, get, UA };
