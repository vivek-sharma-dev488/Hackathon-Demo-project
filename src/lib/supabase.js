import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const originalSignal = init?.signal;

  let abortListener;
  if (originalSignal) {
    abortListener = () => controller.abort(originalSignal.reason);
    originalSignal.addEventListener("abort", abortListener, { once: true });
  }

  const timeoutId = setTimeout(() => controller.abort(new Error("Request timed out")), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
    if (originalSignal && abortListener) {
      originalSignal.removeEventListener("abort", abortListener);
    }
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep this warning explicit for local setup troubleshooting.
  console.warn("Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  global: {
    fetch: fetchWithTimeout
  }
});
