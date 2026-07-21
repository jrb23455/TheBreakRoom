// Replaces the Claude-artifact-only `window.storage` API with a real backend.
// The app's ~2000 lines of chat/board/DM logic call window.storage.get/set/delete/list
// exactly as before — this file is the only thing that changed underneath them.
//
// Backing store: a single Supabase table, public.breakroom_kv_store (key, owner, value).
// "shared" rows (owner = '') are visible to everyone using the app, matching the
// original design. "Personal" rows (owner = a per-browser device id) are scoped to
// whichever browser is signed in — same idea as the artifact sandbox's private storage.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjmnyxybsrazsahcwvul.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbW55eHlic3JhenNhaGN3dnVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODExNTcsImV4cCI6MjA5ODg1NzE1N30.PCVO83dZuBjby4DotCHySN7Q4eIwUhIdYHr8L4qcDcU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TABLE = "breakroom_kv_store";

function getDeviceOwner() {
  let id = localStorage.getItem("tbr_device_id");
  if (!id) {
    id = "dev_" + crypto.randomUUID();
    localStorage.setItem("tbr_device_id", id);
  }
  return id;
}

window.storage = {
  async get(key, shared = false) {
    const owner = shared ? "" : getDeviceOwner();
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .eq("owner", owner)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: JSON.stringify(data.value), shared };
  },

  async set(key, value, shared = false) {
    const owner = shared ? "" : getDeviceOwner();
    const parsed = JSON.parse(value);
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { key, owner, value: parsed, updated_at: new Date().toISOString() },
        { onConflict: "key,owner" }
      );
    if (error) throw error;
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const owner = shared ? "" : getDeviceOwner();
    const { error } = await supabase.from(TABLE).delete().eq("key", key).eq("owner", owner);
    if (error) throw error;
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const owner = shared ? "" : getDeviceOwner();
    let query = supabase.from(TABLE).select("key").eq("owner", owner);
    if (prefix) query = query.like("key", `${prefix}%`);
    const { data, error } = await query;
    if (error) throw error;
    return { keys: (data || []).map((r) => r.key), prefix, shared };
  },
};

// Login/session is now handled entirely by the central auth service at
// topclosers.wtf (see App.jsx's session check + redirect on load) — this
// app no longer authenticates anyone itself. listPeople() stays: it's just
// the Mailroom's "who can I message" directory, unrelated to login.
window.breakroomAuth = {
  async listPeople() {
    const { data, error } = await supabase.rpc("breakroom_list_people");
    if (error) throw error;
    return data || []; // [{ id, name }]
  },
};
