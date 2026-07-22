import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   THEBREAKROOM — a community hub for insurance folks
   Login: phone number + PIN (shared pattern for your branch apps).
   Shared chat, bulletin board, and presence are visible to everyone.
   Study progress + your login stay private to your account.
   NOTE: this is app-level convenience login, not bank-grade security.
   ============================================================ */

const CHANNELS = [
  { id: "big-table", name: "The Big Table", blurb: "General chatter. Pull up a chair.", emoji: "🍽️", type: "chat" },
  { id: "wins", name: "Wins & Shoutouts", blurb: "Closed a policy? Passed an exam? Post it and let people cheer you on.", emoji: "🏆", type: "forum" },
  { id: "study-buddies", name: "The Stage", blurb: "Important notices, big news, and anything worth the spotlight.", emoji: "🎤", type: "forum" },
  { id: "ask-a-veteran", name: "Ask a Veteran", blurb: "Post a question for the folks who've been around.", emoji: "🧭", type: "forum" },
  { id: "off-topic", name: "Off Topic", blurb: "Weekend plans, sports, pets, whatever.", emoji: "☕", type: "forum" },
  { id: "wellness-commons", name: "The Commons", blurb: "Body, mind, and spirit — check-ins, wins, and whatever helps you feel human today.", emoji: "🌿", type: "forum" },
];

// Shown for The Commons only — a quiet reminder that this room is peer support, not professional care.
const WELLNESS_NOTE = "This room is for leaning on each other, not for medical, mental health, or nutrition advice. If you're going through something serious, please talk to a doctor or licensed professional. In a crisis, call or text 988 (Suicide & Crisis Lifeline) — free, confidential, 24/7.";


const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
};

const ONLINE_WINDOW = 2 * 60 * 1000; // seen in the last 2 minutes = "here now"
const RECENT_WINDOW = 24 * 60 * 60 * 1000;

// Lightweight obfuscation so the manager password isn't stored in plain text.
// This is convenience-level protection, not a real credential — same spirit as
// everywhere else in the app, and unrelated to the real phone+PIN login system.
const hashPin = (salt, pw) => {
  let h = 5381;
  const s = `tbr|${salt}|${pw}|v1`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16) + "-" + s.length.toString(16);
};

async function loadShared(key, fallback) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : fallback;
  } catch (e) {
    return fallback;
  }
}
async function saveShared(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), true);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Media: compressed image uploads + link embeds ---------- */
const mediaCache = {};

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("not-image")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const shrink = (maxDim, q) => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL("image/jpeg", q);
        };
        // Step down until the payload is comfortably small for storage.
        let out = shrink(900, 0.72);
        if (out.length > 300000) out = shrink(640, 0.6);
        if (out.length > 300000) out = shrink(480, 0.52);
        if (out.length > 300000) out = shrink(360, 0.45);
        if (out.length > 450000) { reject(new Error("too-big")); return; }
        resolve(out);
      };
      img.onerror = () => reject(new Error("decode"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Media saves are the biggest writes in the app, so retry a couple of times with backoff
// in case a background timer momentarily hogs the storage rate limit.
async function saveMedia(id, dataUrl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await window.storage.set(`caf-media-${id}`, JSON.stringify(dataUrl), true);
      return true;
    } catch (e) {
      console.error(`Photo upload attempt ${attempt + 1} failed:`, e);
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  return false;
}

function MediaImage({ id }) {
  const [src, setSrc] = useState(mediaCache[id] || null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (mediaCache[id]) { setSrc(mediaCache[id]); return; }
    let live = true;
    (async () => {
      try {
        const r = await window.storage.get(`caf-media-${id}`, true);
        if (!live) return;
        if (r) {
          const v = JSON.parse(r.value);
          mediaCache[id] = v;
          setSrc(v);
        } else setErr(true);
      } catch (e) { if (live) setErr(true); }
    })();
    return () => { live = false; };
  }, [id]);
  if (err) return <div className="caf-media-miss">🖼 image unavailable</div>;
  if (!src) return <div className="caf-media-load">loading photo…</div>;
  return <img className="caf-media-img" src={src} alt="Shared photo" />;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

function embedForUrl(url, key) {
  const path = url.toLowerCase().split(/[?#]/)[0];
  if (/\.(png|jpe?g|gif|webp)$/.test(path)) {
    return <img key={key} className="caf-media-img" src={url} alt="Linked" loading="lazy" />;
  }
  if (/\.(mp4|webm|ogg|mov)$/.test(path)) {
    return <video key={key} className="caf-media-video" src={url} controls preload="metadata" />;
  }
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) {
    return (
      <iframe
        key={key}
        className="caf-media-video"
        src={`https://www.youtube.com/embed/${yt[1]}`}
        title="Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return <a key={key} href={url} target="_blank" rel="noreferrer" className="caf-link">{url}</a>;
}

function RichText({ text }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? embedForUrl(p, i) : <TextWithMentions key={i} text={p} />
      )}
    </>
  );
}

const REACT_SET = ["👍", "❤️", "😂", "🎉", "🔥", "👏"];
const COMPOSER_EMOJIS = ["😀", "😂", "😅", "🥲", "😮", "😎", "❤️", "👍", "👏", "🎉", "🔥", "💯", "☕", "🍩", "🙏", "😤"];

const isMentioned = (text, name) => {
  if (!text) return false;
  const t = text.toLowerCase();
  const first = name.split(" ")[0].toLowerCase();
  return t.includes("@" + first) || t.includes("@" + name.toLowerCase()) || t.includes("@everyone");
};

const MENTION_RE = /(@[A-Za-z][\w'.-]*)/g;

function TextWithMentions({ text }) {
  const parts = text.split(MENTION_RE);
  return (
    <>
      {parts.map((p, i) =>
        /^@[A-Za-z]/.test(p)
          ? <span key={i} className="caf-mention">{p}</span>
          : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </>
  );
}

function ReactionBar({ reacts, myName, onToggle }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(reacts || {}).filter(([, names]) => names && names.length > 0);
  return (
    <div className="caf-reacts">
      {entries.map(([emoji, names]) => (
        <button
          key={emoji}
          className={`caf-react ${names.includes(myName) ? "on" : ""}`}
          title={names.join(", ")}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {names.length}
        </button>
      ))}
      <span className="caf-react-wrap">
        <button className="caf-react add" title="Add a reaction" onClick={() => setOpen(!open)}>{entries.length === 0 ? "☺+" : "+"}</button>
        {open && (
          <span className="caf-react-pop">
            {REACT_SET.map((e) => (
              <button key={e} onClick={() => { onToggle(e); setOpen(false); }}>{e}</button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function toggleName(reacts, emoji, name) {
  const next = { ...(reacts || {}) };
  const names = next[emoji] ? [...next[emoji]] : [];
  const i = names.indexOf(name);
  if (i >= 0) names.splice(i, 1); else names.push(name);
  next[emoji] = names;
  return next;
}

function EmojiPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="caf-emoji-wrap">
      <button className="caf-clip" title="Add an emoji" onClick={() => setOpen(!open)}>😊</button>
      {open && (
        <span className="caf-emoji-pop">
          {COMPOSER_EMOJIS.map((e) => (
            <button key={e} onClick={() => { onPick(e); setOpen(false); }}>{e}</button>
          ))}
        </span>
      )}
    </span>
  );
}

/* ---------- Edit & delete controls for your own messages/posts/replies ---------- */
function MessageActions({ canEdit, editing, onEdit, onDelete, deleting }) {
  if (!canEdit) return null;
  return (
    <div className="caf-msg-actions">
      {!editing && <button className="caf-msg-action" onClick={onEdit}>edit</button>}
      <button className="caf-msg-action danger" onClick={onDelete} disabled={deleting}>{deleting ? "…" : "delete"}</button>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel, saving }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="caf-editbox">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(val.trim());
          if (e.key === "Escape") onCancel();
        }}
        maxLength={500}
        autoFocus
      />
      <button onClick={() => onSave(val.trim())} disabled={!val.trim() || saving}>{saving ? "…" : "Save"}</button>
      <button className="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function AttachControl({ attach, setAttach, err, setErr }) {
  const fileRef = useRef(null);
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.type.startsWith("video/")) {
      setErr("Video files are too big to store here — paste a YouTube or video link in your message instead and it'll play inline.");
      return;
    }
    try {
      const d = await compressImage(f);
      setAttach(d);
      setErr("");
    } catch (ex) {
      setErr(ex.message === "too-big"
        ? "That image is still huge after compression. Try a smaller one."
        : "Couldn't read that file — try a JPG, PNG, or WebP.");
    }
  };
  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
      <button className="caf-clip" title="Attach a photo" onClick={() => fileRef.current && fileRef.current.click()}>📎</button>
      {(attach || err) && (
        <div className="caf-attach-bar">
          {attach && (
            <div className="caf-attach-preview">
              <img src={attach} alt="Attachment preview" />
              <button onClick={() => setAttach(null)} title="Remove">✕</button>
            </div>
          )}
          {err && <div className="caf-err">{err}</div>}
        </div>
      )}
    </>
  );
}

/* ---------- Brand mark: circular ring, line-art side profile, four concentric speech arcs ---------- */
function BrandMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="100" cy="100" r="78" stroke="#e9edf7" strokeWidth="6" />
      <path
        d="M 126,36 C 108,38 100,50 93,64 C 87,76 82,84 70,98 C 82,104 88,110 93,120 C 100,134 106,148 122,154 C 130,157 136,155 140,150"
        stroke="#e9edf7" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M 68,88 A 12,12 0 0 0 68,112" stroke="#88aef1" strokeWidth="6" strokeLinecap="round" />
      <path d="M 68,76 A 24,24 0 0 0 68,124" stroke="#e2a84d" strokeWidth="6" strokeLinecap="round" />
      <path d="M 68,64 A 36,36 0 0 0 68,136" stroke="#74c690" strokeWidth="6" strokeLinecap="round" />
      <path d="M 68,56 A 44,44 0 0 0 68,144" stroke="#e0718a" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export default function TheBreakRoom() {
  const [profile, setProfile] = useState(null); // { name, phone, joined }
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [view, setView] = useState("lobby");
  const [channel, setChannel] = useState("big-table");
  const [menuOpen, setMenuOpen] = useState(false);

  // Every screen change here used to be invisible to the browser — pure React
  // state, no history entry. That meant pressing Back had nothing of ours to
  // land on, so it fell straight through to whatever loaded before this page
  // (topclosers.wtf, via the SSO redirect). navigate() pushes a real history
  // entry per screen; the popstate listener below syncs state back when the
  // person actually uses Back/Forward, so those now move between THIS app's
  // own screens first, same as any normal multi-page site.
  const navigate = useCallback((nextView, nextChannel) => {
    setView(nextView);
    if (nextChannel) setChannel(nextChannel);
    const params = new URLSearchParams();
    params.set("view", nextView);
    if (nextChannel) params.set("channel", nextChannel);
    history.pushState({ view: nextView, channel: nextChannel || null }, "", `?${params}`);
  }, []);

  useEffect(() => {
    // Baseline entry so the very first Back press has somewhere of ours to
    // go before it can ever reach outside the app.
    const params = new URLSearchParams(window.location.search);
    const initialView = params.get("view") || "lobby";
    const initialChannel = params.get("channel") || "big-table";
    setView(initialView);
    setChannel(initialChannel);
    history.replaceState({ view: initialView, channel: initialChannel }, "", `?view=${initialView}${initialChannel ? `&channel=${initialChannel}` : ""}`);

    const onPopState = (e) => {
      const s = e.state;
      if (s) {
        setView(s.view || "lobby");
        if (s.channel) setChannel(s.channel);
      } else {
        setView("lobby");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    (async () => {
      // Real shared login now lives at topclosers.wtf. This checks the
      // browser's actual shared-domain session cookie — if it's not valid,
      // there is no local login form anymore; the only way in is through
      // the central login page.
      let s;
      try {
        const res = await fetch("https://auth.topclosers.wtf/api/session", { credentials: "include" });
        s = await res.json();
      } catch (e) {
        s = { status: "error" };
      }

      if (s.status === "ok" && s.student) {
        // Session check succeeded. Anything that goes wrong from here on
        // (rendering, later data loads, etc.) must never bounce back to the
        // central login — that's only for a genuinely failed session check.
        try {
          setProfile({ id: s.student.id, name: s.student.name, phone: s.student.phone, joined: Date.now() });
          setProfileLoaded(true);
        } catch (e) {
          console.error("Error after a successful session check (not redirecting):", e);
          setProfileLoaded(true);
        }
        return;
      }

      // Only reached when the session check itself failed or came back
      // not-ok — this is the one and only redirect-to-login path.
      setRedirecting(true);
      window.location.href = "https://topclosers.wtf";
    })();
  }, []);

  // Presence heartbeat: tell the building you're here, prune stale entries.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const beat = async () => {
      const pres = await loadShared("caf-presence", {});
      if (cancelled) return;
      const now = Date.now();
      const next = {};
      for (const k of Object.keys(pres)) {
        if (now - (pres[k].lastSeen || 0) < RECENT_WINDOW) next[k] = pres[k];
      }
      next[profile.id] = { name: profile.name, lastSeen: now, joined: profile.joined };
      await saveShared("caf-presence", next);
    };
    beat();
    const t = setInterval(beat, 45000);
    return () => { cancelled = true; clearInterval(t); };
  }, [profile]);

  // Direct-message metadata: shared index of conversations + your private read receipts.
  const [dmMeta, setDmMeta] = useState({ index: {}, read: {} });
  useEffect(() => {
    if (!profile) return;
    let stop = false;
    const load = async () => {
      const index = await loadShared("caf-dm-index", {});
      let read = {};
      try {
        const r = await window.storage.get("caf-dm-read");
        if (r) read = JSON.parse(r.value);
      } catch (e) {}
      if (!stop) setDmMeta({ index, read });
    };
    load();
    const t = setInterval(load, 60000);
    return () => { stop = true; clearInterval(t); };
  }, [profile]);

  const markDmRead = useCallback((pairKey) => {
    setDmMeta((m) => {
      const read = { ...m.read, [pairKey]: Date.now() };
      try { window.storage.set("caf-dm-read", JSON.stringify(read)); } catch (e) {}
      return { ...m, read };
    });
  }, []);

  const dmUnread = profile
    ? Object.entries(dmMeta.index).filter(([k, v]) =>
        (v.a === profile.id || v.b === profile.id) &&
        v.lastFrom !== profile.id &&
        v.lastTs > (dmMeta.read[k] || 0)
      ).length
    : 0;

  // One-time cleanup: purge any bot messages/accounts/presence left over from earlier testing.
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const done = await window.storage.get("caf-bots-purged");
        if (done) return;
      } catch (e) {}
      const FORMER_BOTS = ["Rosa M. 🤖", "Derek T. 🤖", "Priya K. 🤖"];
      const FORMER_BOT_PHONES = ["5550000001", "5550000002", "5550000003"];
      for (const c of CHANNELS) {
        const k = `caf-chat-${c.id}`;
        const msgs = await loadShared(k, []);
        const cleaned = msgs
          .filter((m) => !FORMER_BOTS.includes(m.author))
          .map((m) => {
            if (!m.reacts) return m;
            const reacts = {};
            for (const [e, names] of Object.entries(m.reacts)) reacts[e] = (names || []).filter((n) => !FORMER_BOTS.includes(n));
            return { ...m, reacts };
          });
        if (cleaned.length !== msgs.length || JSON.stringify(cleaned) !== JSON.stringify(msgs)) await saveShared(k, cleaned);
      }
      const pres = await loadShared("caf-presence", {});
      let presChanged = false;
      FORMER_BOT_PHONES.forEach((p) => { if (pres[p]) { delete pres[p]; presChanged = true; } });
      if (presChanged) await saveShared("caf-presence", pres);
      const idx = await loadShared("caf-dm-index", {});
      let idxChanged = false;
      for (const [k, v] of Object.entries(idx)) {
        if (FORMER_BOT_PHONES.includes(v.a) || FORMER_BOT_PHONES.includes(v.b)) {
          delete idx[k];
          idxChanged = true;
          try { await window.storage.delete(`caf-${k}`, true); } catch (e) {}
        }
      }
      if (idxChanged) { await saveShared("caf-dm-index", idx); setDmMeta((m) => ({ ...m, index: idx })); }
      try { await window.storage.set("caf-bots-purged", JSON.stringify(true)); } catch (e) {}
    })();
  }, [profile]);

  const logout = async () => {
    // Mark yourself gone from the presence board first.
    if (profile) {
      const pres = await loadShared("caf-presence", {});
      if (pres[profile.id]) {
        pres[profile.id] = { ...pres[profile.id], lastSeen: Date.now() - ONLINE_WINDOW - 1000 };
        await saveShared("caf-presence", pres);
      }
    }
    // Clear the real shared session at the auth service, not just local state —
    // otherwise reloading this page (or any other app) logs you right back in.
    // NOTE: assuming POST /api/logout on the same auth host — flag if that's
    // not the actual path/method, since this is the one endpoint I'm inferring
    // rather than one you handed me directly.
    try {
      await fetch("https://auth.topclosers.wtf/api/logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    window.location.href = "https://topclosers.wtf/";
  };

  if (!profileLoaded) {
    return (
      <div className="caf-root">
        <Style />
        <div className="caf-loading">{redirecting ? "Taking you to sign in…" : "Setting the tables…"}</div>
      </div>
    );
  }

  if (!profile) {
    // Shouldn't normally be reached — the effect above redirects before this
    // renders — but if it ever is, don't show a broken app with no way in.
    return (
      <div className="caf-root">
        <Style />
        <div className="caf-loading">Taking you to sign in…</div>
      </div>
    );
  }

  return (
    <div className="caf-root">
      <Style />
      <header className="caf-topbar">
        <button className="caf-burger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">☰</button>
        <div className="caf-brand">
          <span className="caf-brand-mark"><BrandMark size={30} /></span>
          <div>
            <div className="caf-brand-name"><span className="caf-brand-letter">T</span>he<span className="caf-brand-letter">B</span>reak<span className="caf-brand-letter">R</span>oom</div>
            <div className="caf-brand-sub">where the team hangs out</div>
          </div>
        </div>
        <div className="caf-user">🪪 {profile.name}</div>
        <button className="caf-logout" onClick={logout}>Sign out</button>
      </header>

      <div className="caf-body">
        <nav className={`caf-nav ${menuOpen ? "open" : ""}`}>
          <button
            className={`caf-nav-item ${view === "lobby" ? "active" : ""}`}
            onClick={() => { navigate("lobby"); setMenuOpen(false); }}
          >
            <span className="caf-nav-emoji">🏛️</span> The Lobby
          </button>

          <div className="caf-nav-section">Main Hall</div>
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              className={`caf-nav-item ${view === "cafeteria" && channel === c.id ? "active" : ""}`}
              onClick={() => { navigate("cafeteria", c.id); setMenuOpen(false); }}
            >
              <span className="caf-nav-emoji">{c.emoji}</span> {c.name}
            </button>
          ))}
          <button
            className={`caf-nav-item ${view === "board" ? "active" : ""}`}
            onClick={() => { navigate("board"); setMenuOpen(false); }}
          >
            <span className="caf-nav-emoji">📌</span> Bulletin Board
          </button>
          <button
            className={`caf-nav-item ${view === "mail" ? "active" : ""}`}
            onClick={() => { navigate("mail"); setMenuOpen(false); }}
          >
            <span className="caf-nav-emoji">📬</span> The Mailroom
            {dmUnread > 0 && <span className="caf-badge">{dmUnread}</span>}
          </button>

          <div className="caf-nav-section">Down the Hall</div>
          <button className={`caf-nav-item branch ${view === "hall" ? "active" : ""}`} onClick={() => { navigate("hall"); setMenuOpen(false); }}>
            <span className="caf-nav-emoji">🚪</span> Other Buildings
          </button>
          <div className="caf-nav-foot">Chats, board posts, and the who's-here list are shared with everyone using this app. Your PIN stays private.</div>
        </nav>

        <main className="caf-main">
          {view === "lobby" && <Lobby profile={profile} goTo={(v) => navigate(v)} dmUnread={dmUnread} />}
          {view === "cafeteria" && (() => {
            const c = CHANNELS.find((c) => c.id === channel);
            return c.type === "chat"
              ? <ChatRoom channel={c} profile={profile} />
              : <Forum
                  profile={profile}
                  storageKey={`caf-forum-${c.id}`}
                  headerEmoji={c.emoji}
                  headerTitle={c.name}
                  headerSub={c.blurb}
                  green={c.id === "wellness-commons"}
                  wellnessNote={c.id === "wellness-commons" ? WELLNESS_NOTE : null}
                  postVerb="Post"
                />;
          })()}
          {view === "board" && <BulletinBoard profile={profile} />}
          {view === "mail" && <Mailroom profile={profile} index={dmMeta.index} readMap={dmMeta.read} markRead={markDmRead} />}
          {view === "hall" && <Hallway />}
        </main>
      </div>
    </div>
  );
}

/* ---------- Morning Brief: what happened since you were last here ---------- */
function MorningBrief({ profile, dmUnread }) {
  const [brief, setBrief] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    (async () => {
      let lastVisit = 0;
      try {
        const r = await window.storage.get("caf-last-visit");
        if (r) lastVisit = JSON.parse(r.value);
      } catch (e) {}
      const isFirstVisit = !lastVisit;

      let newMsgCount = 0;
      let mentionCount = 0;
      const activeRooms = new Set();
      for (const c of CHANNELS) {
        const msgs = await loadShared(`caf-chat-${c.id}`, []);
        for (const m of msgs) {
          if (m.ts > lastVisit && m.author !== profile.name) {
            newMsgCount++;
            activeRooms.add(c.name);
            if (isMentioned(m.text, profile.name)) mentionCount++;
          }
        }
      }

      const posts = await loadShared("caf-board-posts", []);
      const newPosts = posts.filter((p) => p.ts > lastVisit && p.author !== profile.name).length;
      const newReplies = posts.reduce(
        (n, p) => n + p.replies.filter((r) => r.ts > lastVisit && r.author !== profile.name).length,
        0
      );

      if (!alive) return;
      setBrief({ newMsgCount, mentionCount, newPosts, newReplies, activeRooms: [...activeRooms], isFirstVisit });

      // Record this visit AFTER computing the brief, so the numbers reflect the gap since last time.
      try { await window.storage.set("caf-last-visit", JSON.stringify(Date.now())); } catch (e) {}
    })();
    return () => { alive = false; };
  }, [profile.name]);

  if (brief === null) {
    return (
      <div className="caf-brief">
        <div className="caf-brief-title">☀️ Morning Brief</div>
        <div className="caf-dim">Reading the room…</div>
      </div>
    );
  }

  const { newMsgCount, mentionCount, newPosts, newReplies, activeRooms, isFirstVisit } = brief;
  const quiet = newMsgCount === 0 && newPosts === 0 && newReplies === 0 && dmUnread === 0;

  if (isFirstVisit) {
    return (
      <div className="caf-brief">
        <div className="caf-brief-title">☀️ Morning Brief</div>
        <div className="caf-brief-line">First time in the building — welcome. Once you've been through, this'll catch you up on what you missed between visits.</div>
      </div>
    );
  }

  return (
    <div className="caf-brief">
      <div className="caf-brief-title">☀️ Morning Brief</div>
      {quiet ? (
        <div className="caf-brief-line">All caught up — quiet since you were last here.</div>
      ) : (
        <ul className="caf-brief-list">
          {newMsgCount > 0 && (
            <li>💬 <strong>{newMsgCount}</strong> new message{newMsgCount === 1 ? "" : "s"} in the Main Hall{activeRooms.length ? ` — ${activeRooms.slice(0, 3).join(", ")}${activeRooms.length > 3 ? ", …" : ""}` : ""}</li>
          )}
          {mentionCount > 0 && <li>📣 You were mentioned <strong>{mentionCount}</strong> time{mentionCount === 1 ? "" : "s"}</li>}
          {newPosts > 0 && <li>📌 <strong>{newPosts}</strong> new pin{newPosts === 1 ? "" : "s"} on the Bulletin Board</li>}
          {newReplies > 0 && <li>🗨️ <strong>{newReplies}</strong> new repl{newReplies === 1 ? "y" : "ies"} on the board</li>}
          {dmUnread > 0 && <li>📬 <strong>{dmUnread}</strong> unread message{dmUnread === 1 ? "" : "s"} in the Mailroom</li>}
        </ul>
      )}
    </div>
  );
}

function Lobby({ profile, goTo, dmUnread }) {
  const [presence, setPresence] = useState(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    const pres = await loadShared("caf-presence", {});
    setPresence(pres);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    // Quick second look shortly after mount, in case a heartbeat write lands a beat late.
    const warm = setTimeout(refresh, 2500);
    const t = setInterval(refresh, 30000);
    return () => { clearTimeout(warm); clearInterval(t); };
  }, [refresh]);

  const entries = presence
    ? Object.entries(presence)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.lastSeen - a.lastSeen)
    : [];
  const online = entries.filter((e) => now - e.lastSeen < ONLINE_WINDOW);
  const recent = entries.filter((e) => now - e.lastSeen >= ONLINE_WINDOW && now - e.lastSeen < RECENT_WINDOW);

  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return (
    <div className="caf-lobby">
      <div className="caf-lobby-hero">
        <div className="caf-lobby-eyebrow">The Lobby</div>
        <h1 className="caf-lobby-title">{greeting}, {profile.name.split(" ")[0]}.</h1>
        <p className="caf-lobby-sub">This is home base — the chat rooms and bulletin board are through the Main Hall, private notes go through the Mailroom, and the branch apps are listed under Other Buildings. Same phone + PIN gets you into every one of them.</p>
      </div>

      <MorningBrief profile={profile} dmUnread={dmUnread} />

      <div className="caf-sign">
        <div className="caf-sign-title">Who's in the building</div>
        <div className="caf-sign-count">
          <span className="caf-dot live" /> {online.length} here now
          {recent.length > 0 && <span className="caf-sign-recent"> · {recent.length} stopped by today</span>}
          <button className="caf-refresh-inline" onClick={refresh}>↻</button>
        </div>

        {presence === null && <div className="caf-dim">Checking the sign-in sheet…</div>}

        {presence !== null && online.length === 0 && (
          <div className="caf-dim" style={{ padding: "8px 0" }}>Looks quiet — you're holding down the fort. Leave a message in The Big Table so people see it when they walk in.</div>
        )}

        <div className="caf-roster">
          {online.map((e) => (
            <span key={e.id} className="caf-chip live">
              <span className="caf-dot live" />
              {e.name}{e.id === profile.id ? " (you)" : ""}
            </span>
          ))}
          {recent.map((e) => (
            <span key={e.id} className="caf-chip away" title={`seen ${timeAgo(e.lastSeen)}`}>
              <span className="caf-dot" />
              {e.name}
              <span className="caf-chip-time">{timeAgo(e.lastSeen)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="caf-lobby-grid">
        <button className="caf-lobby-card" onClick={() => goTo("cafeteria")}>
          <div className="caf-lobby-card-emoji">🍽️</div>
          <div className="caf-lobby-card-title">Grab a table</div>
          <div className="caf-lobby-card-text">The Big Table is live chat. Wins, The Stage, Ask a Veteran, Off Topic, and The Commons are all post-and-comment forums — make a post, others reply when they get to it. Everything you post is visible to the whole team.</div>
        </button>
        <button className="caf-lobby-card" onClick={() => goTo("board")}>
          <div className="caf-lobby-card-emoji">📌</div>
          <div className="caf-lobby-card-title">Check the board</div>
          <div className="caf-lobby-card-text">Announcements from managers. Everyone can read and reply — posting a new one needs the manager password.</div>
        </button>
        <button className="caf-lobby-card" onClick={() => goTo("mail")}>
          <div className="caf-lobby-card-emoji">📬</div>
          <div className="caf-lobby-card-title">Slide a note</div>
          <div className="caf-lobby-card-text">One-on-one messages in the Mailroom — for anything that doesn't belong at the big table. Unread notes show a badge in the sidebar.</div>
        </button>
        <button className="caf-lobby-card" onClick={() => goTo("hall")}>
          <div className="caf-lobby-card-emoji">🚪</div>
          <div className="caf-lobby-card-title">Head to another building</div>
          <div className="caf-lobby-card-text">Study tools and role-specific apps live in their own buildings. Find the doors here — your same login works in all of them.</div>
        </button>
      </div>

      <div className="caf-houserules">
        <div className="caf-houserules-title">House rules</div>
        <ol>
          <li>Talk like you're in a real breakroom — coworkers can read everything in the Main Hall and on the board.</li>
          <li>No client personal info anywhere in here. Ever. Policy numbers, names, addresses — keep it out.</li>
          <li>Your display name is public; your phone number and PIN never are.</li>
        </ol>
      </div>
    </div>
  );
}

/* ---------- Chat room ---------- */
function ChatRoom({ channel, profile }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState(null);
  const [attachErr, setAttachErr] = useState("");
  const endRef = useRef(null);
  const key = `caf-chat-${channel.id}`;

  const refresh = useCallback(async () => {
    const msgs = await loadShared(key, []);
    setMessages(msgs);
  }, [key]);

  useEffect(() => {
    setMessages(null);
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attach) || sending) return;
    setSending(true);
    let mediaId = null;
    if (attach) {
      mediaId = uid();
      const ok = await saveMedia(mediaId, attach);
      if (!ok) {
        setAttachErr("Couldn't upload the photo — try again or send without it.");
        setSending(false);
        return;
      }
      mediaCache[mediaId] = attach;
    }
    const latest = await loadShared(key, []);
    const msg = { id: uid(), author: profile.name, text, ts: Date.now() };
    if (mediaId) msg.media = mediaId;
    const next = [...latest, msg].slice(-80);
    const ok = await saveShared(key, next);
    if (ok) {
      setMessages(next);
      setDraft("");
      setAttach(null);
      setAttachErr("");
    }
    setSending(false);
  };

  const toggleReact = async (msgId, emoji) => {
    const latest = await loadShared(key, []);
    const next = latest.map((m) => (m.id === msgId ? { ...m, reacts: toggleName(m.reacts, emoji, profile.name) } : m));
    if (await saveShared(key, next)) setMessages(next);
  };

  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const saveEdit = async (msgId, newText) => {
    if (!newText) return;
    setBusyId(msgId);
    const latest = await loadShared(key, []);
    const next = latest.map((m) => (m.id === msgId ? { ...m, text: newText, edited: true } : m));
    if (await saveShared(key, next)) setMessages(next);
    setBusyId(null);
    setEditingId(null);
  };

  const deleteMsg = async (msgId) => {
    setBusyId(msgId);
    const latest = await loadShared(key, []);
    const next = latest.filter((m) => m.id !== msgId);
    if (await saveShared(key, next)) setMessages(next);
    setBusyId(null);
  };

  return (
    <div className="caf-chat">
      <div className="caf-menuboard">
        <div className="caf-menuboard-title">{channel.emoji} {channel.name}</div>
        <div className="caf-menuboard-sub">{channel.blurb}</div>
        <button className="caf-refresh" onClick={refresh} title="Check for new messages">↻ refresh</button>
      </div>

      <div className="caf-msgs">
        {messages === null && <div className="caf-dim">Wiping down the table…</div>}
        {messages !== null && messages.length === 0 && (
          <div className="caf-dim">Nobody's sitting here yet. Say something and get it started.</div>
        )}
        {messages !== null && messages.map((m) => {
          const mine = m.author === profile.name;
          return (
            <div key={m.id} className={`caf-msg ${mine ? "mine" : ""} ${isMentioned(m.text, profile.name) ? "pinged" : ""}`}>
              <div className="caf-msg-meta">
                <span className="caf-msg-author">{m.author}</span>
                <span className="caf-msg-time">{timeAgo(m.ts)}{m.edited ? " · edited" : ""}</span>
                <MessageActions
                  canEdit={mine}
                  editing={editingId === m.id}
                  onEdit={() => setEditingId(m.id)}
                  onDelete={() => deleteMsg(m.id)}
                  deleting={busyId === m.id}
                />
              </div>
              {editingId === m.id ? (
                <EditBox initial={m.text || ""} saving={busyId === m.id} onCancel={() => setEditingId(null)} onSave={(t) => saveEdit(m.id, t)} />
              ) : (
                m.text && <div className="caf-msg-text"><RichText text={m.text} /></div>
              )}
              {m.media && <MediaImage id={m.media} />}
              <ReactionBar reacts={m.reacts} myName={profile.name} onToggle={(e) => toggleReact(m.id, e)} />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="caf-composer">
        <AttachControl attach={attach} setAttach={setAttach} err={attachErr} setErr={setAttachErr} />
        <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message ${channel.name}… (@name to tag someone)`}
          maxLength={500}
        />
        <button onClick={send} disabled={(!draft.trim() && !attach) || sending}>{sending ? "…" : "Send"}</button>
      </div>
    </div>
  );
}

/* ---------- The Mailroom: private messages ---------- */
const pairKeyFor = (a, b) => "dm-" + [a, b].sort().join("-");

function Mailroom({ profile, index, readMap, markRead }) {
  const [people, setPeople] = useState(null);
  const [openConvo, setOpenConvo] = useState(null); // { pairKey, other: {id, name} }
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPeople(await window.breakroomAuth.listPeople());
      } catch (e) {
        setPeople([]);
      }
    })();
  }, []);

  const me = profile.id;
  const convos = Object.entries(index)
    .filter(([, v]) => v.a === me || v.b === me)
    .map(([k, v]) => {
      const otherId = v.a === me ? v.b : v.a;
      const otherName = v.a === me ? v.bn : v.an;
      return { pairKey: k, other: { id: otherId, name: otherName }, lastTs: v.lastTs, unread: v.lastFrom !== me && v.lastTs > (readMap[k] || 0) };
    })
    .sort((x, y) => y.lastTs - x.lastTs);

  const members = people
    ? people
        .filter((p) => p.id !== me)
        .sort((x, y) => x.name.localeCompare(y.name))
    : [];

  if (openConvo) {
    return (
      <DMThread
        profile={profile}
        other={openConvo.other}
        pairKey={openConvo.pairKey}
        markRead={markRead}
        onBack={() => setOpenConvo(null)}
      />
    );
  }

  return (
    <div className="caf-mail">
      <div className="caf-menuboard">
        <div className="caf-menuboard-title">📬 The Mailroom</div>
        <div className="caf-menuboard-sub">One-on-one messages, out of the main rooms. This directory is shared with ProSim, RepLine, and the other branch apps — same people, same accounts. Heads up: this is workplace-private, not vault-private — same rule as everywhere else, nothing you wouldn't want on a breakroom whiteboard.</div>
      </div>

      {!picking ? (
        <button className="caf-pin-new" onClick={() => setPicking(true)}>+ New message</button>
      ) : (
        <div className="caf-memberlist">
          <div className="caf-memberlist-head">
            <span>Who are you writing to?</span>
            <button className="ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
          {people === null && <div className="caf-dim">Checking the directory…</div>}
          {people !== null && members.length === 0 && <div className="caf-dim">Nobody else has signed up yet. Recruit some coworkers!</div>}
          {members.map((m) => (
            <button
              key={m.id}
              className="caf-member"
              onClick={() => { setPicking(false); setOpenConvo({ pairKey: pairKeyFor(me, m.id), other: m }); }}
            >
              ✉️ {m.name}
            </button>
          ))}
        </div>
      )}

      <div className="caf-convos">
        {convos.length === 0 && !picking && (
          <div className="caf-dim">No conversations yet. Hit "New message" to slide a note into someone's mailbox.</div>
        )}
        {convos.map((c) => (
          <button key={c.pairKey} className="caf-convo" onClick={() => setOpenConvo({ pairKey: c.pairKey, other: c.other })}>
            <span className="caf-convo-name">{c.unread && <span className="caf-dot live" />} {c.other.name}</span>
            <span className="caf-convo-time">{timeAgo(c.lastTs)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DMThread({ profile, other, pairKey, markRead, onBack }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState(null);
  const [attachErr, setAttachErr] = useState("");
  const endRef = useRef(null);
  const key = `caf-${pairKey}`;

  const refresh = useCallback(async () => {
    const msgs = await loadShared(key, []);
    setMessages(msgs);
    markRead(pairKey);
  }, [key, pairKey, markRead]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attach) || sending) return;
    setSending(true);
    let mediaId = null;
    if (attach) {
      mediaId = uid();
      const ok = await saveMedia(mediaId, attach);
      if (!ok) { setAttachErr("Couldn't upload the photo — try again."); setSending(false); return; }
      mediaCache[mediaId] = attach;
    }
    const latest = await loadShared(key, []);
    const msg = { id: uid(), author: profile.name, from: profile.id, text, ts: Date.now() };
    if (mediaId) msg.media = mediaId;
    const next = [...latest, msg].slice(-100);
    const ok = await saveShared(key, next);
    if (ok) {
      // Update the shared conversation index so both mailboxes see this thread.
      const [p1, p2] = [profile.id, other.id].sort();
      const idx = await loadShared("caf-dm-index", {});
      idx[pairKey] = {
        a: p1,
        b: p2,
        an: p1 === profile.id ? profile.name : other.name,
        bn: p2 === profile.id ? profile.name : other.name,
        lastTs: Date.now(),
        lastFrom: profile.id,
      };
      await saveShared("caf-dm-index", idx);
      setMessages(next);
      setDraft("");
      setAttach(null);
      setAttachErr("");
      markRead(pairKey);
    }
    setSending(false);
  };

  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const saveEdit = async (msgId, newText) => {
    if (!newText) return;
    setBusyId(msgId);
    const latest = await loadShared(key, []);
    const next = latest.map((m) => (m.id === msgId ? { ...m, text: newText, edited: true } : m));
    if (await saveShared(key, next)) setMessages(next);
    setBusyId(null);
    setEditingId(null);
  };

  const deleteMsg = async (msgId) => {
    setBusyId(msgId);
    const latest = await loadShared(key, []);
    const next = latest.filter((m) => m.id !== msgId);
    if (await saveShared(key, next)) setMessages(next);
    setBusyId(null);
  };

  return (
    <div className="caf-chat">
      <button className="caf-back" onClick={onBack}>← Back to the Mailroom</button>
      <div className="caf-menuboard">
        <div className="caf-menuboard-title">✉️ {other.name}</div>
        <div className="caf-menuboard-sub">A private thread between the two of you.</div>
        <button className="caf-refresh" onClick={refresh}>↻ refresh</button>
      </div>

      <div className="caf-msgs">
        {messages === null && <div className="caf-dim">Opening the envelope…</div>}
        {messages !== null && messages.length === 0 && (
          <div className="caf-dim">No messages yet. Start the thread.</div>
        )}
        {messages !== null && messages.map((m) => {
          const mine = m.from ? m.from === profile.id : m.author === profile.name;
          return (
            <div key={m.id} className={`caf-msg ${mine ? "mine" : ""}`}>
              <div className="caf-msg-meta">
                <span className="caf-msg-author">{m.author}</span>
                <span className="caf-msg-time">{timeAgo(m.ts)}{m.edited ? " · edited" : ""}</span>
                <MessageActions
                  canEdit={mine}
                  editing={editingId === m.id}
                  onEdit={() => setEditingId(m.id)}
                  onDelete={() => deleteMsg(m.id)}
                  deleting={busyId === m.id}
                />
              </div>
              {editingId === m.id ? (
                <EditBox initial={m.text || ""} saving={busyId === m.id} onCancel={() => setEditingId(null)} onSave={(t) => saveEdit(m.id, t)} />
              ) : (
                m.text && <div className="caf-msg-text"><RichText text={m.text} /></div>
              )}
              {m.media && <MediaImage id={m.media} />}
              <ReactionBar
                reacts={m.reacts}
                myName={profile.name}
                onToggle={async (emoji) => {
                  const latest = await loadShared(key, []);
                  const next = latest.map((x) => (x.id === m.id ? { ...x, reacts: toggleName(x.reacts, emoji, profile.name) } : x));
                  if (await saveShared(key, next)) setMessages(next);
                }}
              />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="caf-composer">
        <AttachControl attach={attach} setAttach={setAttach} err={attachErr} setErr={setAttachErr} />
        <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message ${other.name}…`}
          maxLength={500}
        />
        <button onClick={send} disabled={(!draft.trim() && !attach) || sending}>{sending ? "…" : "Send"}</button>
      </div>
    </div>
  );
}

/* ---------- Bulletin board (forum) ---------- */
const SORT_MODES = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "replies", label: "Most replies" },
  { id: "reactions", label: "Most reactions" },
];

function reactionCount(reacts) {
  if (!reacts) return 0;
  return Object.values(reacts).reduce((n, names) => n + (names ? names.length : 0), 0);
}

function sortPosts(posts, mode) {
  const copy = [...posts];
  switch (mode) {
    case "oldest": return copy.sort((a, b) => a.ts - b.ts);
    case "replies": return copy.sort((a, b) => b.replies.length - a.replies.length);
    case "reactions": return copy.sort((a, b) => reactionCount(b.reacts) - reactionCount(a.reacts));
    case "newest":
    default: return copy.sort((a, b) => b.ts - a.ts);
  }
}

/* ---------- Forum: post + comment, reusable for any room ---------- */
function Forum({ profile, storageKey, headerEmoji, headerTitle, headerSub, green, wellnessNote, postVerb = "Post", canCompose = true, lockedNotice = null }) {
  const [posts, setPosts] = useState(null);
  const [open, setOpen] = useState(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(null);
  const [attachErr, setAttachErr] = useState("");
  const [sortMode, setSortMode] = useState("newest");
  const KEY = storageKey;

  const refresh = useCallback(async () => {
    const p = await loadShared(KEY, []);
    setPosts(p);
    return p;
  }, [KEY]);

  useEffect(() => { setPosts(null); setOpen(null); refresh(); }, [refresh]);

  const submitPost = async () => {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    let mediaId = null;
    if (attach) {
      mediaId = uid();
      const ok = await saveMedia(mediaId, attach);
      if (!ok) { setAttachErr("Couldn't upload the photo — try again."); setBusy(false); return; }
      mediaCache[mediaId] = attach;
    }
    const latest = await loadShared(KEY, []);
    const post = { id: uid(), author: profile.name, title: title.trim(), body: body.trim(), ts: Date.now(), replies: [] };
    if (mediaId) post.media = mediaId;
    const next = [post, ...latest].slice(0, 200);
    if (await saveShared(KEY, next)) {
      setPosts(next);
      setTitle(""); setBody(""); setAttach(null); setAttachErr(""); setComposing(false);
    }
    setBusy(false);
  };

  const submitReply = async (postId) => {
    if (!reply.trim() || busy) return;
    setBusy(true);
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) =>
      p.id === postId ? { ...p, replies: [...p.replies, { id: uid(), author: profile.name, text: reply.trim(), ts: Date.now() }] } : p
    );
    if (await saveShared(KEY, next)) {
      setPosts(next);
      setReply("");
    }
    setBusy(false);
  };

  const toggleReactPost = async (postId, emoji) => {
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) => (p.id === postId ? { ...p, reacts: toggleName(p.reacts, emoji, profile.name) } : p));
    if (await saveShared(KEY, next)) setPosts(next);
  };

  const toggleReactReply = async (postId, replyId, emoji) => {
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) =>
      p.id === postId
        ? { ...p, replies: p.replies.map((r) => (r.id === replyId ? { ...r, reacts: toggleName(r.reacts, emoji, profile.name) } : r)) }
        : p
    );
    if (await saveShared(KEY, next)) setPosts(next);
  };

  const [editingPost, setEditingPost] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [busyRowId, setBusyRowId] = useState(null);

  const savePostEdit = async (postId, newBody) => {
    if (!newBody) return;
    setBusyRowId(postId);
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) => (p.id === postId ? { ...p, body: newBody, edited: true } : p));
    if (await saveShared(KEY, next)) setPosts(next);
    setBusyRowId(null);
    setEditingPost(false);
  };

  const deletePost = async (postId) => {
    setBusyRowId(postId);
    const latest = await loadShared(KEY, []);
    const next = latest.filter((p) => p.id !== postId);
    if (await saveShared(KEY, next)) { setPosts(next); setOpen(null); }
    setBusyRowId(null);
  };

  const saveReplyEdit = async (postId, replyId, newText) => {
    if (!newText) return;
    setBusyRowId(replyId);
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) =>
      p.id === postId ? { ...p, replies: p.replies.map((r) => (r.id === replyId ? { ...r, text: newText, edited: true } : r)) } : p
    );
    if (await saveShared(KEY, next)) setPosts(next);
    setBusyRowId(null);
    setEditingReplyId(null);
  };

  const deleteReply = async (postId, replyId) => {
    setBusyRowId(replyId);
    const latest = await loadShared(KEY, []);
    const next = latest.map((p) => (p.id === postId ? { ...p, replies: p.replies.filter((r) => r.id !== replyId) } : p));
    if (await saveShared(KEY, next)) setPosts(next);
    setBusyRowId(null);
  };

  const openPost = posts?.find((p) => p.id === open);
  const sorted = posts ? sortPosts(posts, sortMode) : [];

  return (
    <div className="caf-board">
      <div className={`caf-menuboard ${green ? "green" : "cork"}`}>
        <div className="caf-menuboard-title">{headerEmoji} {headerTitle}</div>
        <div className="caf-menuboard-sub">{headerSub}</div>
        <button className="caf-refresh" onClick={refresh}>↻ refresh</button>
      </div>

      {wellnessNote && <div className="caf-wellnote">🌿 {wellnessNote}</div>}

      {!openPost && (
        <>
          {canCompose ? (
            !composing ? (
              <button className="caf-pin-new" onClick={() => setComposing(true)}>+ {postVerb} something</button>
            ) : (
              <div className="caf-pin-form">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={90} />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you want to say? Paste a YouTube or video link to embed it." rows={4} maxLength={2000} />
                <div className="caf-row">
                  <AttachControl attach={attach} setAttach={setAttach} err={attachErr} setErr={setAttachErr} />
                  <button className="ghost" onClick={() => { setComposing(false); setAttach(null); setAttachErr(""); }}>Cancel</button>
                  <button onClick={submitPost} disabled={!title.trim() || !body.trim() || busy}>{postVerb} it</button>
                </div>
              </div>
            )
          ) : (
            lockedNotice
          )}

          {posts !== null && posts.length > 0 && (
            <div className="caf-sortbar">
              <span className="caf-sortbar-label">Sort:</span>
              {SORT_MODES.map((s) => (
                <button key={s.id} className={sortMode === s.id ? "on" : ""} onClick={() => setSortMode(s.id)}>{s.label}</button>
              ))}
            </div>
          )}

          <div className="caf-pins">
            {posts === null && <div className="caf-dim">Checking for posts…</div>}
            {posts !== null && posts.length === 0 && <div className="caf-dim">Nothing here yet. First post gets the good spot.</div>}
            {posts !== null && sorted.map((p) => (
              <div key={p.id} className="caf-pin-wrap">
                <button className="caf-pin" onClick={() => setOpen(p.id)}>
                  <div className="caf-pin-title">{p.media ? "🖼 " : ""}{p.title}</div>
                  <div className="caf-pin-body">{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</div>
                  <div className="caf-pin-meta">{p.author} · {timeAgo(p.ts)}{p.edited ? " · edited" : ""} · {p.replies.length} {p.replies.length === 1 ? "reply" : "replies"}{reactionCount(p.reacts) > 0 ? ` · ${reactionCount(p.reacts)} reactions` : ""}</div>
                </button>
                {p.author === profile.name && (
                  <button className="caf-pin-x" title="Delete this post" onClick={() => deletePost(p.id)} disabled={busyRowId === p.id}>✕</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {openPost && (
        <div className="caf-thread">
          <button className="caf-back" onClick={() => setOpen(null)}>← Back</button>
          <div className="caf-thread-card">
            <div className="caf-pin-title big">{openPost.title}</div>
            <div className="caf-pin-meta-row">
              <div className="caf-pin-meta">{openPost.author} · {timeAgo(openPost.ts)}{openPost.edited ? " · edited" : ""}</div>
              <MessageActions
                canEdit={openPost.author === profile.name}
                editing={editingPost}
                onEdit={() => setEditingPost(true)}
                onDelete={() => deletePost(openPost.id)}
                deleting={busyRowId === openPost.id}
              />
            </div>
            {editingPost ? (
              <EditBox initial={openPost.body} saving={busyRowId === openPost.id} onCancel={() => setEditingPost(false)} onSave={(t) => savePostEdit(openPost.id, t)} />
            ) : (
              <div className="caf-thread-body"><RichText text={openPost.body} /></div>
            )}
            {openPost.media && <MediaImage id={openPost.media} />}
            <ReactionBar reacts={openPost.reacts} myName={profile.name} onToggle={(e) => toggleReactPost(openPost.id, e)} />
          </div>
          <div className="caf-replies">
            {openPost.replies.map((r) => (
              <div key={r.id} className="caf-reply">
                <div className="caf-msg-meta">
                  <span className="caf-msg-author">{r.author}</span>
                  <span className="caf-msg-time">{timeAgo(r.ts)}{r.edited ? " · edited" : ""}</span>
                  <MessageActions
                    canEdit={r.author === profile.name}
                    editing={editingReplyId === r.id}
                    onEdit={() => setEditingReplyId(r.id)}
                    onDelete={() => deleteReply(openPost.id, r.id)}
                    deleting={busyRowId === r.id}
                  />
                </div>
                {editingReplyId === r.id ? (
                  <EditBox initial={r.text} saving={busyRowId === r.id} onCancel={() => setEditingReplyId(null)} onSave={(t) => saveReplyEdit(openPost.id, r.id, t)} />
                ) : (
                  <div><RichText text={r.text} /></div>
                )}
                <ReactionBar reacts={r.reacts} myName={profile.name} onToggle={(e) => toggleReactReply(openPost.id, r.id, e)} />
              </div>
            ))}
            {openPost.replies.length === 0 && <div className="caf-dim">No replies yet.</div>}
          </div>
          <div className="caf-composer">
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitReply(openPost.id)} placeholder="Add a reply…" maxLength={800} />
            <button onClick={() => submitReply(openPost.id)} disabled={!reply.trim() || busy}>Reply</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Bulletin Board: everyone can see posts, only managers can create them ---------- */
function BulletinBoard({ profile }) {
  const [unlocked, setUnlocked] = useState(false);
  const [hasPassword, setHasPassword] = useState(null); // null = checking
  const [showLogin, setShowLogin] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const PW_KEY = "caf-board-pw-hash";

  useEffect(() => {
    (async () => {
      const stored = await loadShared(PW_KEY, null);
      setHasPassword(!!stored);
    })();
  }, []);

  const submitExisting = async () => {
    if (!pw) return;
    setBusy(true);
    setErr("");
    const stored = await loadShared(PW_KEY, null);
    if (stored === hashPin("board", pw)) {
      setUnlocked(true);
      setShowLogin(false);
      setPw("");
    } else {
      setErr("That's not the manager password.");
    }
    setBusy(false);
  };

  const setInitialPassword = async () => {
    if (!pw) return;
    setBusy(true);
    setErr("");
    const existing = await loadShared(PW_KEY, null);
    if (existing) {
      // Someone else set it moments ago — don't overwrite, just ask this person to sign in with it.
      setHasPassword(true);
      setBusy(false);
      return;
    }
    const ok = await saveShared(PW_KEY, hashPin("board", pw));
    setBusy(false);
    if (ok) { setUnlocked(true); setShowLogin(false); setPw(""); }
    else setErr("Couldn't save the password. Try again.");
  };

  const lockedNotice = showLogin ? (
    <div className="caf-gate-inline" style={{ marginBottom: 14 }}>
      {hasPassword === null && <div className="caf-dim">Checking…</div>}
      {hasPassword === false && (
        <>
          <p>No manager password has been set yet. If you're a manager, set one now — you'll need it (and so will every other manager) to post here from now on.</p>
          <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setInitialPassword()} type="password" placeholder="Choose a manager password" maxLength={60} autoFocus />
          {err && <div className="caf-err">{err}</div>}
          <div className="caf-row">
            <button className="ghost" onClick={() => { setShowLogin(false); setErr(""); }}>Cancel</button>
            <button disabled={!pw || busy} onClick={setInitialPassword}>{busy ? "Setting…" : "Set password & unlock posting"}</button>
          </div>
        </>
      )}
      {hasPassword === true && (
        <>
          <p>Enter the manager password to post here.</p>
          <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitExisting()} type="password" placeholder="Manager password" maxLength={60} autoFocus />
          {err && <div className="caf-err">{err}</div>}
          <div className="caf-row">
            <button className="ghost" onClick={() => { setShowLogin(false); setErr(""); }}>Cancel</button>
            <button disabled={!pw || busy} onClick={submitExisting}>{busy ? "Checking…" : "Unlock posting"}</button>
          </div>
        </>
      )}
    </div>
  ) : (
    <button className="caf-pin-new" onClick={() => setShowLogin(true)}>🔒 Manager sign-in to post</button>
  );

  return (
    <Forum
      profile={profile}
      storageKey="caf-board-posts"
      headerEmoji="📌"
      headerTitle="Bulletin Board"
      headerSub="Announcements from managers — everyone can read and reply, only managers can post."
      postVerb="Pin"
      canCompose={unlocked}
      lockedNotice={lockedNotice}
    />
  );
}

/* ---------- Hallway: doors to the separate branch apps ---------- */
function Hallway() {
  const DOORS = [
    { id: "prosim", name: "ProSim — Insurance Sales Trainer", url: "https://pro-sim-sepia.vercel.app/" },
    { id: "repline", name: "RepLine", url: "https://repline-theta.vercel.app/" },
    { id: "mosaic", name: "Mosaic — Goal Alignment Platform", url: "https://vision-board-vert.vercel.app/" },
    { id: "logbook", name: "LogBook", url: "https://logbook-prosim.vercel.app/" },
  ];

  return (
    <div className="caf-hall">
      <div className="caf-menuboard">
        <div className="caf-menuboard-title">🚪 Other Buildings</div>
        <div className="caf-menuboard-sub">TheBreakRoom is just the hangout — the Claims Wing and other tools live in their own apps. Same phone + PIN gets you in everywhere.</div>
      </div>

      <div className="caf-doors">
        {DOORS.map((d) => (
          <div key={d.id} className="caf-door">
            <a href={d.url} target="_blank" rel="noreferrer" className="caf-door-link">
              <span className="caf-door-emoji">🚪</span>
              <span className="caf-door-name">{d.name}</span>
              <span className="caf-door-go">Enter →</span>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */
function Style() {
  return (
    <style>{`
      .caf-root {
        --bg0: #090d17;
        --bg1: #0d1220;
        --card: #101627;
        --card2: #141b30;
        --line: #262f4d;
        --line-soft: #1c2440;
        --text: #e9edf7;
        --body: #aeb9d8;
        --dim: #6a7494;
        --blue: #88aef1;
        --amber: #e2a84d;
        --amber-dk: #c98d2f;
        --green: #74c690;
        --pink: #e0718a;
        --live: #74c690;
        --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        --serif: Georgia, "Times New Roman", serif;
        min-height: 100vh;
        background: radial-gradient(circle at 25% -10%, #101830 0%, var(--bg0) 55%);
        color: var(--body);
        font-family: var(--serif);
        display: flex;
        flex-direction: column;
      }
      .caf-root * { box-sizing: border-box; }
      .caf-root button { font-family: var(--mono); cursor: pointer; }
      .caf-loading { margin: auto; padding: 4rem; color: var(--dim); font-size: 1.05rem; font-family: var(--mono); letter-spacing: .08em; }

      .caf-topbar {
        background: rgba(13,18,32,.92);
        color: var(--text);
        display: flex; align-items: center; gap: 14px;
        padding: 14px 20px;
        border-bottom: 1px solid var(--line);
      }
      .caf-burger { display: none; background: none; border: none; color: var(--text); font-size: 1.3rem; }
      .caf-brand { display: flex; align-items: center; gap: 11px; }
      .caf-brand-mark { font-size: 1.6rem; display: inline-flex; }
      .caf-brand-name { font-family: var(--serif); font-weight: 700; font-size: 1.35rem; letter-spacing: .01em; }
      .caf-brand-name { color: var(--text); }
      .caf-brand-letter { color: var(--blue); }
      .caf-brand-sub { font-family: var(--mono); font-size: .62rem; color: var(--dim); letter-spacing: .28em; text-transform: uppercase; margin-top: 2px; }
      .caf-user { margin-left: auto; font-family: var(--mono); font-size: .78rem; background: var(--card); border: 1px solid var(--line); color: var(--body); padding: 6px 13px; border-radius: 999px; }
      .caf-logout { background: none; border: 1px solid var(--line); color: var(--dim); border-radius: 999px; padding: 6px 13px; font-size: .72rem; }
      .caf-logout:hover { color: var(--text); border-color: var(--blue); }

      .caf-body { display: flex; flex: 1; min-height: 0; }
      .caf-nav {
        width: 244px; flex-shrink: 0;
        background: var(--bg1);
        border-right: 1px solid var(--line-soft);
        padding: 16px 10px 20px;
        display: flex; flex-direction: column; gap: 3px;
        overflow-y: auto;
      }
      .caf-nav-section {
        font-family: var(--mono);
        font-size: .62rem; letter-spacing: .3em; text-transform: uppercase;
        color: var(--dim); padding: 16px 10px 7px;
      }
      .caf-nav-item {
        display: flex; align-items: center; gap: 10px;
        background: none; border: 1px solid transparent; text-align: left;
        padding: 8px 11px; border-radius: 9px;
        font-size: .8rem; color: var(--body);
      }
      .caf-nav-item:hover { background: var(--card); border-color: var(--line-soft); }
      .caf-nav-item.active { background: var(--card); border-color: var(--line); color: var(--text); }
      .caf-nav-item.active .caf-nav-emoji { filter: none; }
      .caf-nav-emoji { width: 20px; text-align: center; }
      .caf-nav-note { margin-left: auto; font-size: .58rem; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
      .caf-nav-foot { margin-top: auto; padding: 16px 10px 0; font-size: .72rem; color: var(--dim); line-height: 1.5; font-family: var(--serif); }
      .caf-badge { margin-left: auto; background: var(--amber); color: #131313; font-size: .66rem; font-weight: 700; border-radius: 999px; padding: 2px 8px; }

      .caf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 20px; overflow-y: auto; }

      /* Lobby */
      .caf-lobby { display: flex; flex-direction: column; gap: 18px; max-width: 900px; margin: 0 auto; width: 100%; }
      .caf-lobby-hero { padding: 8px 4px 0; }
      .caf-lobby-eyebrow { font-family: var(--mono); font-size: .68rem; letter-spacing: .32em; text-transform: uppercase; color: var(--blue); }
      .caf-lobby-title { font-family: var(--serif); font-weight: 700; color: var(--text); font-size: 2.1rem; margin: 8px 0 10px; }
      .caf-lobby-sub { color: var(--body); line-height: 1.6; max-width: 64ch; margin: 0; font-size: .98rem; }

      .caf-brief { background: var(--card); border: 1px solid rgba(226,168,77,.4); border-radius: 14px; padding: 16px 20px; }
      .caf-brief-title { font-family: var(--mono); font-size: .68rem; letter-spacing: .26em; text-transform: uppercase; color: var(--amber); margin-bottom: 8px; }
      .caf-brief-line { color: var(--body); font-size: .92rem; line-height: 1.55; }
      .caf-brief-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
      .caf-brief-list li { font-size: .92rem; color: var(--text); line-height: 1.5; }
      .caf-brief-list strong { color: var(--amber); }

      .caf-sign {
        background: var(--card);
        border-radius: 16px;
        border: 1px solid #2b3a63;
        padding: 20px;
        color: var(--body);
      }
      .caf-sign-title { font-family: var(--mono); color: var(--amber); font-size: .72rem; letter-spacing: .28em; text-transform: uppercase; }
      .caf-sign-count { display: flex; align-items: center; gap: 7px; font-size: .86rem; color: var(--body); margin: 10px 0 14px; }
      .caf-sign-recent { color: var(--dim); }
      .caf-refresh-inline { background: var(--card2); border: 1px solid var(--line); color: var(--body); border-radius: 999px; width: 26px; height: 26px; margin-left: 6px; }
      .caf-refresh-inline:hover { border-color: var(--blue); color: var(--text); }
      .caf-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #4a5473; flex-shrink: 0; }
      .caf-dot.live { background: var(--live); box-shadow: 0 0 0 0 rgba(116,198,144,.5); animation: caf-pulse 2s infinite; }
      @keyframes caf-pulse {
        0% { box-shadow: 0 0 0 0 rgba(116,198,144,.5); }
        70% { box-shadow: 0 0 0 7px rgba(116,198,144,0); }
        100% { box-shadow: 0 0 0 0 rgba(116,198,144,0); }
      }

      .caf-roster { display: flex; flex-wrap: wrap; gap: 8px; }
      .caf-chip {
        display: inline-flex; align-items: center; gap: 7px;
        background: var(--card2);
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: 999px;
        padding: 6px 14px 6px 10px;
        font-size: .85rem;
        line-height: 1;
        font-family: var(--serif);
      }
      .caf-chip.live { border-color: rgba(116,198,144,.55); background: rgba(116,198,144,.09); }
      .caf-chip.away { color: var(--dim); }
      .caf-chip-time { font-family: var(--mono); font-size: .62rem; color: var(--dim); margin-left: 2px; }

      .caf-lobby-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 13px; }
      .caf-lobby-card {
        background: var(--card); border: 1px solid var(--line); border-radius: 16px;
        padding: 18px; text-align: left; display: flex; flex-direction: column; gap: 7px;
        transition: border-color .15s ease, transform .15s ease;
        font-family: var(--serif);
      }
      .caf-lobby-card:hover { border-color: #3a4a78; transform: translateY(-2px); }
      .caf-lobby-card-emoji { font-size: 1.4rem; }
      .caf-lobby-card-title { font-family: var(--serif); font-weight: 700; font-size: 1.08rem; color: var(--text); }
      .caf-lobby-card-text { font-size: .86rem; color: var(--body); line-height: 1.55; }

      .caf-houserules { background: var(--card); border: 1px solid rgba(116,198,144,.35); border-radius: 16px; padding: 18px 20px; }
      .caf-houserules-title { font-family: var(--mono); font-size: .7rem; letter-spacing: .28em; text-transform: uppercase; color: var(--green); margin-bottom: 10px; }
      .caf-houserules ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; font-size: .9rem; line-height: 1.55; color: var(--body); }

      /* Section header boards */
      .caf-menuboard {
        background: var(--card);
        color: var(--body);
        border-radius: 16px;
        padding: 18px 20px;
        position: relative;
        border: 1px solid #2b3a63;
        margin-bottom: 14px;
        flex-shrink: 0;
      }
      .caf-menuboard.green { border-color: rgba(116,198,144,.45); }
      .caf-menuboard.cork { border-color: rgba(226,168,77,.5); }
      .caf-menuboard-title { font-family: var(--serif); font-weight: 700; font-size: 1.3rem; color: var(--text); }
      .caf-menuboard-sub { font-size: .88rem; color: var(--body); margin-top: 6px; max-width: 62ch; line-height: 1.55; }
      .caf-refresh {
        position: absolute; top: 16px; right: 16px;
        background: var(--card2); color: var(--body);
        border: 1px solid var(--line); border-radius: 999px; padding: 5px 13px; font-size: .68rem; letter-spacing: .06em;
      }
      .caf-refresh:hover { border-color: var(--blue); color: var(--text); }

      .caf-wellnote { background: rgba(116,198,144,.08); border: 1px solid rgba(116,198,144,.35); border-radius: 12px; padding: 12px 16px; font-size: .82rem; line-height: 1.55; color: var(--body); margin-bottom: 12px; }

      /* Chat */
      .caf-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .caf-msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 10px; }
      .caf-msg { background: var(--card); border: 1px solid var(--line-soft); border-radius: 12px; padding: 11px 15px; max-width: 660px; }
      .caf-msg.mine { border-left: 3px solid var(--amber); }
      .caf-msg.pinged { background: rgba(226,168,77,.08); border-color: rgba(226,168,77,.45); }
      .caf-msg-meta { display: flex; gap: 10px; align-items: baseline; margin-bottom: 4px; }
      .caf-msg-author { font-family: var(--mono); font-weight: 700; font-size: .74rem; color: var(--blue); letter-spacing: .03em; }
      .caf-msg-time { font-family: var(--mono); font-size: .64rem; color: var(--dim); }
      .caf-msg-text { font-size: .95rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--text); }

      .caf-composer { display: flex; gap: 8px; padding-top: 10px; flex-shrink: 0; position: relative; }
      .caf-composer input, .caf-pin-form input, .caf-pin-form textarea, .caf-gate-card input, .caf-gate-inline input {
        flex: 1; border: 1px solid var(--line); border-radius: 10px;
        padding: 12px 15px; font-size: .95rem; background: var(--bg1);
        font-family: var(--serif); color: var(--text); width: 100%;
      }
      .caf-composer input::placeholder, .caf-pin-form input::placeholder, .caf-pin-form textarea::placeholder, .caf-gate-card input::placeholder { color: var(--dim); }
      .caf-composer input:focus, .caf-pin-form input:focus, .caf-pin-form textarea:focus, .caf-gate-card input:focus {
        outline: 1px solid var(--blue); outline-offset: 1px; border-color: var(--blue);
      }
      .caf-composer button, .caf-pin-form button, .caf-gate-card button, .caf-row button, .caf-gate-inline button {
        background: var(--amber); border: none; border-radius: 10px;
        padding: 11px 20px; font-weight: 700; color: #131313; font-size: .8rem; letter-spacing: .04em;
      }
      .caf-composer button:hover:not(:disabled) { background: var(--amber-dk); }
      .caf-composer button:disabled, .caf-pin-form button:disabled, .caf-gate-card button:disabled { opacity: .4; cursor: default; }
      button.ghost { background: transparent !important; border: 1px solid var(--line) !important; color: var(--body) !important; font-weight: 400 !important; }
      button.ghost:hover { border-color: var(--blue) !important; color: var(--text) !important; }

      .caf-dim { color: var(--dim); font-size: .88rem; }

      /* Media */
      .caf-media-img { display: block; max-width: min(340px, 100%); max-height: 300px; border-radius: 10px; margin-top: 8px; border: 1px solid var(--line); }
      .caf-media-video { display: block; width: min(420px, 100%); aspect-ratio: 16 / 9; border-radius: 10px; margin-top: 8px; border: 1px solid var(--line); background: #000; }
      .caf-media-load, .caf-media-miss { font-family: var(--mono); font-size: .68rem; color: var(--dim); background: var(--card2); border: 1px dashed var(--line); border-radius: 8px; padding: 10px 14px; margin-top: 8px; display: inline-block; letter-spacing: .05em; }
      .caf-link { color: var(--blue); word-break: break-all; }

      /* Reactions, mentions, emoji picker */
      .caf-reacts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; align-items: center; }
      .caf-react { background: var(--card2); border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font-size: .74rem; line-height: 1.5; color: var(--body); }
      .caf-react:hover { border-color: var(--amber); }
      .caf-react.on { background: rgba(226,168,77,.14); border-color: var(--amber); color: var(--text); font-weight: 700; }
      .caf-react.add { color: var(--dim); background: transparent; border-style: dashed; opacity: 0; transition: opacity .12s ease; }
      .caf-msg:hover .caf-react.add, .caf-thread-card:hover .caf-react.add, .caf-reply:hover .caf-react.add, .caf-react.add:focus { opacity: 1; }
      @media (hover: none) { .caf-react.add { opacity: .55; } }
      .caf-react-wrap, .caf-emoji-wrap { position: relative; display: inline-flex; }
      .caf-react-pop, .caf-emoji-pop {
        position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20;
        background: var(--card2); border: 1px solid var(--line); border-radius: 12px;
        padding: 6px; display: flex; gap: 2px; box-shadow: 0 10px 26px rgba(0,0,0,.5);
      }
      .caf-emoji-pop { flex-wrap: wrap; width: 232px; }
      .caf-react-pop button, .caf-emoji-pop button { background: none; border: none; font-size: 1.15rem; padding: 5px 7px; border-radius: 8px; line-height: 1; }
      .caf-react-pop button:hover, .caf-emoji-pop button:hover { background: var(--card); }
      .caf-mention { background: rgba(136,174,241,.14); color: var(--blue); font-weight: 700; border-radius: 5px; padding: 0 3px; }

      .caf-msg-actions { display: flex; gap: 8px; margin-left: auto; opacity: 0; transition: opacity .12s ease; }
      .caf-msg:hover .caf-msg-actions, .caf-thread-card:hover .caf-msg-actions, .caf-reply:hover .caf-msg-actions, .caf-msg-actions:focus-within { opacity: 1; }
      @media (hover: none) { .caf-msg-actions { opacity: .6; } }
      .caf-msg-action { background: none; border: none; color: var(--dim); font-family: var(--mono); font-size: .64rem; letter-spacing: .06em; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
      .caf-msg-action:hover { color: var(--blue); }
      .caf-msg-action.danger:hover { color: var(--pink); }
      .caf-editbox { display: flex; gap: 8px; margin-top: 6px; }
      .caf-editbox input { flex: 1; border: 1px solid var(--blue); border-radius: 8px; padding: 8px 11px; font-size: .9rem; background: var(--bg1); color: var(--text); font-family: var(--serif); }
      .caf-editbox button { padding: 8px 14px; font-size: .72rem; border-radius: 8px; }

      .caf-pin-meta-row { display: flex; align-items: baseline; gap: 10px; margin: 4px 0; }
      .caf-pin-wrap { position: relative; }
      .caf-pin-wrap .caf-pin { width: 100%; }
      .caf-pin-x { position: absolute; top: 10px; right: 10px; background: var(--card2); border: 1px solid var(--line); border-radius: 999px; color: var(--dim); width: 24px; height: 24px; font-size: .68rem; opacity: 0; transition: opacity .12s ease; }
      .caf-pin-wrap:hover .caf-pin-x { opacity: 1; }
      .caf-pin-x:hover { color: var(--pink); border-color: var(--pink); }
      @media (hover: none) { .caf-pin-x { opacity: .7; } }

      .caf-err { color: var(--pink); font-size: .82rem; margin: -2px 0 6px; font-family: var(--serif); }
      .caf-fineprint { font-size: .74rem !important; margin-top: 12px !important; }

      /* Login gate */
      .caf-gate { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .caf-gate-card { background: var(--card); border: 1px solid var(--line); border-top: 3px solid var(--amber); border-radius: 18px; padding: 32px; max-width: 430px; width: 100%; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,.45); display: flex; flex-direction: column; }
      .caf-gate-emoji { font-size: 2.3rem; display: flex; justify-content: center; }
      .caf-gate-card h2 { font-family: var(--serif); color: var(--text); margin: 10px 0 8px; font-size: 1.5rem; }
      .caf-gate-card p { font-size: .88rem; color: var(--body); line-height: 1.55; margin: 0 0 8px; }
      .caf-gate-card input { margin: 6px 0; text-align: center; }
      .caf-gate-card button { width: 100%; margin-top: 8px; }
      .caf-gate-card p.caf-fineprint { color: var(--dim); }

      /* Bulletin board */
      .caf-pin-new { background: transparent; border: 1px dashed rgba(226,168,77,.55); border-radius: 12px; padding: 14px; font-weight: 700; color: var(--amber); width: 100%; margin-bottom: 14px; font-size: .8rem; letter-spacing: .05em; }

      .caf-sortbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
      .caf-sortbar-label { font-family: var(--mono); font-size: .68rem; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
      .caf-sortbar button { background: var(--card2); border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; font-size: .74rem; color: var(--body); }
      .caf-sortbar button.on { background: var(--amber); border-color: var(--amber-dk); color: #131313; font-weight: 700; }
      .caf-sortbar button:hover:not(.on) { border-color: var(--blue); color: var(--text); }

      .caf-gate-inline { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; max-width: 420px; }
      .caf-gate-inline p { font-size: .9rem; color: var(--body); line-height: 1.55; margin: 0 0 12px; }
      .caf-gate-inline input { margin-bottom: 10px; }
      .caf-pin-new:hover { background: rgba(226,168,77,.07); }
      .caf-pin-form { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .caf-pin-form textarea { resize: vertical; }
      .caf-row { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
      .caf-row.center { justify-content: center; }
      .caf-pins { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .caf-pin { background: var(--card); border: 1px solid var(--line); border-top: 3px solid var(--amber); border-radius: 12px; padding: 15px; text-align: left; display: flex; flex-direction: column; gap: 7px; font-family: var(--serif); transition: border-color .15s ease; }
      .caf-pin:hover { border-color: #3a4a78; border-top-color: var(--amber); }
      .caf-pin-title { font-family: var(--serif); font-weight: 700; font-size: 1.02rem; color: var(--text); }
      .caf-pin-title.big { font-size: 1.35rem; }
      .caf-pin-body { font-size: .87rem; color: var(--body); line-height: 1.5; }
      .caf-pin-meta { font-family: var(--mono); font-size: .64rem; color: var(--dim); margin-top: auto; letter-spacing: .03em; }

      .caf-back { background: none; border: none; color: var(--dim); padding: 0 0 12px; font-size: .74rem; letter-spacing: .05em; }
      .caf-back:hover { color: var(--blue); }
      .caf-thread-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
      .caf-thread-body { margin-top: 12px; line-height: 1.6; white-space: pre-wrap; font-size: .96rem; color: var(--text); }
      .caf-replies { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
      .caf-reply { background: var(--card); border: 1px solid var(--line-soft); border-left: 3px solid var(--green); border-radius: 10px; padding: 11px 14px; font-size: .92rem; color: var(--text); }

      /* Mailroom */
      .caf-mail { max-width: 720px; width: 100%; }
      .caf-convos { display: flex; flex-direction: column; gap: 8px; }
      .caf-convo { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 17px; font-size: .95rem; text-align: left; font-family: var(--serif); transition: border-color .15s ease; }
      .caf-convo:hover { border-color: #3a4a78; }
      .caf-convo-name { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text); }
      .caf-convo-time { font-family: var(--mono); font-size: .64rem; color: var(--dim); flex-shrink: 0; }
      .caf-memberlist { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
      .caf-memberlist-head { display: flex; align-items: center; justify-content: space-between; font-family: var(--serif); font-weight: 700; color: var(--text); font-size: .95rem; padding: 2px 4px 6px; }
      .caf-member { background: none; border: 1px solid transparent; border-radius: 9px; padding: 10px 11px; text-align: left; font-size: .92rem; color: var(--body); font-family: var(--serif); }
      .caf-member:hover { background: var(--card2); border-color: var(--line-soft); color: var(--text); }

      /* Hallway */
      .caf-hall { max-width: 720px; width: 100%; }
      .caf-doors { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
      .caf-door { display: flex; align-items: center; gap: 8px; }
      .caf-door-link { flex: 1; display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--blue); border-radius: 12px; padding: 15px 17px; text-decoration: none; color: var(--text); transition: border-color .15s ease, transform .15s ease; font-family: var(--serif); }
      .caf-door-link:hover { border-color: #3a4a78; border-left-color: var(--blue); transform: translateX(2px); }
      .caf-door-emoji { font-size: 1.25rem; }
      .caf-door-name { font-weight: 700; font-size: 1rem; }
      .caf-door-go { margin-left: auto; font-family: var(--mono); font-size: .68rem; font-weight: 700; color: var(--blue); letter-spacing: .06em; }
      .caf-door-x { background: none; border: 1px solid var(--line); border-radius: 8px; color: var(--dim); width: 32px; height: 32px; flex-shrink: 0; }
      .caf-door-x:hover { color: var(--pink); border-color: var(--pink); }

      /* Attach control */
      .caf-clip, .caf-composer button.caf-clip, .caf-row button.caf-clip { background: var(--card2); border: 1px solid var(--line); border-radius: 10px; padding: 9px 13px; font-size: 1rem; flex-shrink: 0; font-weight: 400; color: var(--body); }
      .caf-clip:hover, .caf-composer button.caf-clip:hover:not(:disabled), .caf-row button.caf-clip:hover { background: var(--card2); border-color: var(--amber); }
      .caf-attach-bar { position: absolute; bottom: calc(100% + 8px); left: 0; right: 0; background: var(--card2); border: 1px solid var(--line); border-radius: 12px; padding: 10px; display: flex; gap: 10px; align-items: center; box-shadow: 0 10px 26px rgba(0,0,0,.5); z-index: 5; }
      .caf-attach-preview { position: relative; }
      .caf-attach-preview img { height: 64px; border-radius: 8px; display: block; }
      .caf-attach-preview button { position: absolute; top: -8px; right: -8px; background: var(--pink); color: #131313; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: .7rem; line-height: 1; padding: 0; }
      .caf-pin-form .caf-attach-bar { position: static; box-shadow: none; border: none; padding: 0; margin-right: auto; background: transparent; }
      .caf-pin-form .caf-clip { padding: 8px 12px; }

      /* Scrollbars */
      .caf-root ::-webkit-scrollbar { width: 10px; height: 10px; }
      .caf-root ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 5px; }
      .caf-root ::-webkit-scrollbar-track { background: transparent; }

      @media (max-width: 760px) {
        .caf-burger { display: block; }
        .caf-nav { position: fixed; top: 0; left: 0; bottom: 0; z-index: 40; transform: translateX(-100%); transition: transform .2s ease; box-shadow: 4px 0 24px rgba(0,0,0,.5); padding-top: 70px; }
        .caf-nav.open { transform: translateX(0); }
        .caf-user { font-size: .68rem; }
        .caf-main { padding: 12px; }
        .caf-refresh { position: static; margin-top: 10px; }
        .caf-lobby-title { font-size: 1.55rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        .caf-root * { transition: none !important; animation: none !important; }
      }
    `}</style>
  );
}
