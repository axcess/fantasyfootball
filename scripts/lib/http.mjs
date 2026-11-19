const UA = "fantasy-command-center (GitHub Action; personal, read-only)";

export async function getRaw(url, { timeout = 30000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, (e.status === 429 ? 5000 : 1500) * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getJSON(url, opts) {
  const res = await getRaw(url, opts);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${redact(url)}`), { status: res.status });
  return res.json();
}

export async function getText(url, opts) {
  const res = await getRaw(url, opts);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${redact(url)}`), { status: res.status });
  return res.text();
}

export const redact = (url) => String(url).replace(/apiKey=[^&]+/i, "apiKey=***");
