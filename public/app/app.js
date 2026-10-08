/* Appli Nounou : parents, nounous et back-office, sur l'API du meme serveur. */
"use strict";

const APP_NAME = "Nounou"; // nom provisoire : a changer ici et dans index.html

/* ================================================================== */
/* Outils                                                              */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fcfa = (n) => `${Number(n || 0).toLocaleString("fr-FR")} F`;
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

const QUARTIERS = [
  "Almadies", "Fann", "Grand Yoff", "HLM", "Liberté 6", "Médina", "Mermoz", "Ngor",
  "Ouakam", "Parcelles Assainies", "Plateau", "Point E", "Sacré-Cœur", "Sicap", "Yoff",
];
const TYPES = {
  PONCTUELLE: "Garde ponctuelle",
  SORTIE_ECOLE: "Sortie d'école",
  REGULIERE: "Garde régulière",
  NUIT: "Garde de nuit",
};
const LANGUES = ["Français", "Wolof", "Pulaar", "Sérère", "Diola", "Mandingue", "Anglais", "Arabe"];
const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const JOURS_COURTS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const ORDRE_JOURS = [1, 2, 3, 4, 5, 6, 0];
const CRENEAUX = [
  { id: "matin", short: "Matin", label: "Matin", start: "08:00", end: "12:00" },
  { id: "midi", short: "Midi", label: "Après-midi", start: "12:00", end: "16:00" },
  { id: "soir", short: "Soir", label: "Fin de journée", start: "16:00", end: "20:00" },
  { id: "nuit", short: "Nuit", label: "Soirée", start: "20:00", end: "23:00" },
];
const PAIEMENTS = { WAVE: "Wave", ORANGE_MONEY: "Orange Money", FREE_MONEY: "Free Money", CARD: "Carte bancaire" };

const STATUTS = {
  PENDING: ["En attente de réponse", "warn"],
  CONFIRMED: ["Confirmée", "ok"],
  IN_PROGRESS: ["En cours", "ok"],
  COMPLETED: ["Terminée", ""],
  PAID_OUT: ["Terminée", ""],
  REFUSED: ["Refusée", "off"],
  EXPIRED: ["Sans réponse", "off"],
  CANCELLED: ["Annulée", "off"],
  DISPUTED: ["Litige en cours", "bad"],
};
const DOC_LABEL = {
  CNI: "Carte d'identité",
  CASIER_JUDICIAIRE: "Casier judiciaire",
  JUSTIFICATIF_DOMICILE: "Justificatif de domicile",
  REFERENCE: "Référence d'une famille",
  CERTIFICAT_SCOLARITE: "Certificat de scolarité",
};
const DOSSIER = {
  MISSING: ["À envoyer", "off"],
  UNDER_REVIEW: ["En vérification", "warn"],
  VERIFIED: ["Validée", "ok"],
  REJECTED: ["À renvoyer", "bad"],
  PENDING: ["En attente", "warn"],
};

function pill([label, tone]) {
  return `<span class="pill ${tone}">${esc(label)}</span>`;
}

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/** Chaque nounou a son propre pagne : 3 couleurs choisies depuis son nom. */
const WAX = ["#23307A", "#A3245A", "#F2A93B", "#2E7D55", "#D9622B", "#5B3FA0", "#1F7A8C"];
function pagne(name, size = "") {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const i = h % 7, j0 = (h >>> 3) % 7, j = j0 === i ? (i + 1) % 7 : j0;
  let k = (h >>> 6) % 7;
  while (k === i || k === j) k = (k + 1) % 7;
  const a = WAX[i], b = WAX[j], c = WAX[k];
  return `<div class="pagne ${size}" style="--a:${a};--b:${b};--c:${c}" aria-hidden="true"><span>${esc(initials(name))}</span></div>`;
}

const dateFr = (d, opts) => new Date(d).toLocaleDateString("fr-FR", opts ?? { weekday: "long", day: "numeric", month: "long" });
const heureFr = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const quand = (d) => `${dateFr(d)} à ${heureFr(d)}`;
const ageEnfant = (year) => {
  const age = new Date().getFullYear() - year;
  return age <= 0 ? "moins d'un an" : plural(age, "an");
};

function stars(avg, count) {
  if (!count) return `<span class="muted small">Nouvelle</span>`;
  return `<span class="stars">★ ${Number(avg).toFixed(1).replace(".", ",")}</span> <span class="muted small">(${count})</span>`;
}

function slotsSummary(avail) {
  const days = [...new Set(avail.filter((a) => a.weekday !== null && a.isAvailable !== false).map((a) => a.weekday))];
  if (!days.length) return "Disponibilités à préciser";
  return ORDRE_JOURS.filter((d) => days.includes(d)).map((d) => JOURS_COURTS[d]).join(", ");
}

/* ================================================================== */
/* Stockage de session (tolerant : navigation privee, etc.)            */
/* ================================================================== */

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("nounou." + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("nounou." + k, JSON.stringify(v)); } catch { /* sans stockage, la session dure le temps de l'onglet */ } },
  del(k) { try { localStorage.removeItem("nounou." + k); } catch { /* idem */ } },
};

const S = {
  config: { demo: false, feePct: 10, commissionPct: 10 },
  token: store.get("token"),
  refresh: store.get("refresh"),
  user: store.get("user"),
  pendingRole: store.get("pendingRole") || "PARENT",
  cache: {},
};

function saveSession(r) {
  S.token = r.accessToken;
  if (r.refreshToken) S.refresh = r.refreshToken;
  if (r.user) S.user = r.user;
  store.set("token", S.token);
  store.set("refresh", S.refresh);
  store.set("user", S.user);
}

function clearSession() {
  S.token = S.refresh = S.user = null;
  S.cache = {};
  ["token", "refresh", "user"].forEach(store.del);
}

/* ================================================================== */
/* API                                                                 */
/* ================================================================== */

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function api(method, path, body, retry = true) {
  const headers = {};
  if (S.token) headers.Authorization = "Bearer " + S.token;
  const isForm = body instanceof FormData;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch("/api" + path, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });

  // Jeton expire : on le renouvelle une fois puis on rejoue la requete
  if (res.status === 401 && retry && S.refresh && !path.startsWith("/auth/")) {
    const r = await fetch("/api/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: S.refresh }),
    });
    if (r.ok) { saveSession(await r.json()); return api(method, path, body, false); }
    clearSession();
    go("#/");
    throw new ApiError(401, "SESSION", "Votre session a expiré, reconnectez-vous");
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code, humanize(data?.error?.message) || "Le serveur ne répond pas, réessayez");
  return data;
}

/** Les messages de l'API sont sans accents : on les rend lisibles pour l'utilisateur. */
function humanize(msg) {
  if (!msg) return msg;
  const fix = {
    "Profil famille non cree": "Profil famille à créer",
    "Nounou indisponible": "Cette nounou n'est plus disponible",
    "La date est deja passee": "Cette date est déjà passée",
    "Code incorrect": "Code incorrect, vérifiez les 6 chiffres",
    "Code expire ou introuvable, demandez-en un nouveau": "Code expiré, demandez-en un nouveau",
    "Patientez avant de redemander un code": "Patientez une minute avant de redemander un code",
    "Ce compte est suspendu": "Ce compte est suspendu. Contactez l'équipe.",
  };
  if (fix[msg]) return fix[msg];
  return msg
    .replace(/\bdeja\b/g, "déjà").replace(/\bcree\b/g, "créé").replace(/\bverifie\b/g, "vérifié")
    .replace(/\breservation\b/gi, "réservation").replace(/\bdelai\b/g, "délai").replace(/\bdepasse\b/g, "dépassé")
    .replace(/\bcompletez\b/gi, "Complétez").replace(/\bpieces?\b/g, (m) => m.replace("ie", "iè"))
    .replace(/\btraitee\b/g, "traitée").replace(/\bconfirmee\b/g, "confirmée").replace(/\bterminee\b/g, "terminée")
    .replace(/\beffectue\b/g, "effectué").replace(/\bcaracteres\b/g, "caractères").replace(/\bproposes\b/g, "proposés")
    .replace(/\betudiante\b/g, "étudiante").replace(/\betablissement\b/g, "établissement").replace(/\bequipe\b/g, "équipe")
    .replace(/\bscolarite\b/g, "scolarité").replace(/\bidentite\b/g, "identité").replace(/\bjudiciaire\b/g, "judiciaire")
    .replace(/\breference\b/gi, (m) => m[0] === "R" ? "Référence" : "référence").replace(/\bannulee\b/g, "annulée")
    .replace(/\bvalidee\b/g, "validée").replace(/\bsupprimee\b/g, "supprimée").replace(/\bdebut\b/g, "début");
}

/* ================================================================== */
/* Interface : toast, feuille, en-tete, onglets                        */
/* ================================================================== */

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/** Execute une action et affiche l'erreur proprement. Desactive le bouton pendant l'appel. */
async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message || "Une erreur est survenue", true); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

let lastFocus = null;
function openSheet(html, { wide = false } = {}) {
  lastFocus = document.activeElement;
  const s = $("#sheet");
  s.innerHTML = html;
  s.classList.toggle("doc", wide);
  s.hidden = false;
  $("#sheet-backdrop").hidden = false;
  const first = s.querySelector("input, select, textarea, button");
  (first || s).focus?.();
  return s;
}
function closeSheet() {
  const s = $("#sheet");
  s.hidden = true;
  $("#sheet-backdrop").hidden = true;
  s.querySelectorAll("img, iframe").forEach((el) => el.src.startsWith("blob:") && URL.revokeObjectURL(el.src));
  s.innerHTML = "";
  lastFocus?.focus?.();
}
$("#sheet-backdrop").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

function setHeader(title, back) {
  $("#title").textContent = title;
  document.title = title === APP_NAME ? `${APP_NAME} — garde d'enfants vérifiée à Dakar` : `${title} · ${APP_NAME}`;
  const b = $("#back");
  b.hidden = !back;
  b.onclick = back ? () => (back === true ? history.back() : go(back)) : null;
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.3-4 4.2-6 7.5-6s6.2 2 7.5 6"/>',
  home: '<path d="M4 11l8-6.5 8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  folder: '<path d="M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9.5A1.5 1.5 0 0 0 18.5 8H12l-2-2.5H5.5A1.5 1.5 0 0 0 4 7.5z"/><path d="M9 13.5l2 2 4-4"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M16 14.5h1.5"/>',
  chart: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  shield: '<path d="M12 3.5l7 3v5.5c0 4.3-3 7.4-7 8.5-4-1.1-7-4.2-7-8.5V6.5z"/><path d="M9 12l2 2 4-4"/>',
};
const icon = (name, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const TABS = {
  PARENT: [["#/", "search", "Trouver"], ["#/reservations", "calendar", "Réservations"], ["#/profil", "user", "Famille"]],
  NANNY: [["#/", "home", "Accueil"], ["#/dossier", "folder", "Dossier"], ["#/gains", "wallet", "Gains"], ["#/profil", "user", "Profil"]],
  ADMIN: [["#/", "shield", "Dossiers"], ["#/stats", "chart", "Activité"]],
};

function setTabs(role, badges = {}) {
  const nav = $("#tabs");
  const tabs = role && TABS[role];
  document.body.classList.toggle("has-tabs", !!tabs);
  document.body.classList.toggle("wide", role === "ADMIN");
  if (!tabs) { nav.hidden = true; return; }
  const here = "#/" + (location.hash.replace(/^#\/?/, "").split("/")[0] || "");
  nav.innerHTML = tabs.map(([href, ic, label]) => `
    <a href="${href}" ${href === here ? 'aria-current="page"' : ""}>
      ${icon(ic)}${badges[href] ? `<span class="dot">${badges[href]}</span>` : ""}<span>${label}</span>
    </a>`).join("");
  nav.hidden = false;
}

const view = () => $("#view");
const loading = () => { view().innerHTML = '<div class="spinner" role="progressbar" aria-label="Chargement"></div>'; };

/* ================================================================== */
/* Routeur                                                             */
/* ================================================================== */

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

async function render() {
  closeSheet();
  const [path, ...params] = location.hash.replace(/^#\/?/, "").split("/");
  window.scrollTo(0, 0);
  try {
    if (!S.user) return await publicRoute(path, params);
    const routes = ROUTES[S.user.role] || {};
    const handler = routes[path || ""] || routes[""];
    setTabs(S.user.role, S.cache.badges);
    await handler(...params);
    view().focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ApiError && e.code === "SESSION") return;
    view().innerHTML = `<div class="empty"><h3>Impossible d'afficher cette page</h3><p>${esc(e.message)}</p>
      <button class="btn ghost" data-act="reload">Réessayer</button></div>`;
    $("[data-act=reload]").onclick = render;
  }
}
window.addEventListener("hashchange", render);

/* ================================================================== */
/* Accueil et connexion                                                */
/* ================================================================== */

async function publicRoute(path) {
  setTabs(null);
  if (path === "connexion") return screenLogin();
  return screenWelcome();
}

const CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function screenWelcome() {
  setHeader(APP_NAME);
  view().innerHTML = `
    <div class="welcome">
      <div>
        <div class="welcome-art">${pagne("Fatou Ndiaye")}${pagne("Mariama Sow")}${pagne("Khady Mbaye")}</div>
        <h2>Une nounou de confiance, dans votre quartier.</h2>
        <p class="lead">Des nounous expérimentées et des étudiantes, toutes vérifiées par notre équipe à Dakar.</p>
        <ul class="promise">
          <li>${CHECK}<span>Pièce d'identité, casier judiciaire et références contrôlés, puis entretien</span></li>
          <li>${CHECK}<span>Paiement par Wave ou Orange Money, versé à la nounou après la garde</span></li>
          <li>${CHECK}<span>Arrivée et départ de la nounou enregistrés en direct</span></li>
        </ul>
      </div>
      <div class="role-pick">
        <button class="btn" data-role="PARENT">Je cherche une nounou <span aria-hidden="true">›</span></button>
        <button class="btn ghost" data-role="NANNY">Je veux garder des enfants <span aria-hidden="true">›</span></button>
        <p class="muted small" style="text-align:center;margin-top:6px">Déjà inscrit ? <a href="#/connexion">Se connecter</a></p>
      </div>
    </div>`;
  $$("[data-role]").forEach((b) => b.addEventListener("click", () => {
    S.pendingRole = b.dataset.role;
    store.set("pendingRole", S.pendingRole);
    go("#/connexion");
  }));
}

function screenLogin() {
  setHeader("Connexion", "#/");
  const demo = S.config.demo ? `
    <div class="panel" style="margin-top:22px">
      <h3 style="margin-bottom:6px">Comptes de démonstration</h3>
      <p class="muted small">Touchez un compte pour remplir le numéro.</p>
      ${[["774444444", "Parent", "Famille Diallo, Mermoz"], ["771111111", "Nounou", "Fatou Ndiaye, étudiante"], ["772222222", "Nounou", "Mariama Sow, 9 ans d'expérience"], ["770000000", "Équipe", "Back-office de validation"]]
        .map(([tel, role, who]) => `<button class="list-line link-like" data-tel="${tel}" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer">
          <span><b>${role}</b><br><span class="muted small">${who}</span></span><span class="muted">${tel.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4")}</span></button>`).join("")}
    </div>` : "";

  view().innerHTML = `
    <form id="f-phone">
      <p class="lead" style="margin-bottom:18px">Nous vous envoyons un code à 6 chiffres sur WhatsApp pour vous connecter. Pas de mot de passe à retenir.</p>
      <label class="field"><span>Numéro WhatsApp</span>
        <div class="phone"><b>+221</b><input class="input" id="tel" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="77 123 45 67" required></div>
      </label>
      <button class="btn block">Recevoir le code</button>
    </form>
    <form id="f-code" hidden>
      <p class="lead" id="code-msg" style="margin-bottom:18px"></p>
      <label class="field"><span>Code reçu</span>
        <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required>
      </label>
      <button class="btn block">Se connecter</button>
      <p style="margin-top:14px;text-align:center"><button type="button" class="link-btn" id="change-tel">Changer de numéro</button></p>
    </form>
    ${demo}`;

  $$("[data-tel]").forEach((b) => b.addEventListener("click", () => { $("#tel").value = b.dataset.tel; $("#tel").focus(); }));

  $("#f-phone").addEventListener("submit", (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const r = await api("POST", "/auth/otp/request", { phone: $("#tel").value });
      $("#f-phone").hidden = true;
      $("#f-code").hidden = false;
      $$("[data-tel]").forEach((b) => b.closest(".panel")?.setAttribute("hidden", ""));
      $("#code-msg").textContent = r.devCode
        ? `Mode démo : aucun message WhatsApp n'est envoyé, le code est déjà rempli.`
        : `Code envoyé sur WhatsApp au ${r.phone}. Il expire dans ${r.expiresInMinutes} minutes.`;
      if (r.devCode) $("#code").value = r.devCode;
      $("#code").focus();
    });
  });
  $("#change-tel").addEventListener("click", () => screenLogin());

  $("#f-code").addEventListener("submit", (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const r = await api("POST", "/auth/otp/verify", { phone: $("#tel").value, code: $("#code").value.trim(), role: S.pendingRole });
      saveSession(r);
      toast(r.isNew ? "Bienvenue !" : "Vous êtes connecté");
      go(r.hasProfile ? "#/" : "#/bienvenue");
    });
  });
}

async function logout() {
  try { await api("POST", "/auth/logout"); } catch { /* on deconnecte quand meme cote appareil */ }
  clearSession();
  go("#/");
}

/* ================================================================== */
/* Champs reutilisables                                                */
/* ================================================================== */

const optionsQuartiers = (sel, withAll = false) =>
  (withAll ? `<option value="">Tout Dakar</option>` : "") +
  QUARTIERS.map((q) => `<option ${q === sel ? "selected" : ""}>${esc(q)}</option>`).join("");

const chipsHtml = (name, entries, checked = [], type = "checkbox") =>
  `<div class="chips">${entries.map(([v, l]) => `<label class="chip"><input type="${type}" name="${name}" value="${esc(v)}" ${checked.includes(v) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div>`;

const checkedValues = (root, name) => $$(`input[name="${name}"]:checked`, root).map((i) => i.value);

function childRow(c = {}) {
  return `<div class="two child-row">
    <label class="field"><span>Prénom</span><input class="input" name="cName" value="${esc(c.firstName || "")}" required></label>
    <label class="field"><span>Année de naissance</span><input class="input" name="cYear" type="number" inputmode="numeric" min="${new Date().getFullYear() - 14}" max="${new Date().getFullYear()}" value="${esc(c.birthYear || "")}" required></label>
  </div>`;
}

/* ================================================================== */
/* PARENT                                                              */
/* ================================================================== */

async function parentProfile(force = false) {
  if (!S.cache.parent || force) S.cache.parent = await api("GET", "/parents/me");
  return S.cache.parent;
}

function parentOnboarding() {
  setHeader("Votre famille");
  setTabs(null);
  view().innerHTML = `
    <form id="f">
      <p class="lead" style="margin-bottom:18px">Ces informations aident la nounou à préparer la garde. Votre adresse n'est partagée qu'après sa confirmation.</p>
      <label class="field"><span>Nom de la famille</span><input class="input" name="fullName" placeholder="Famille Ndiaye" required minlength="2"></label>
      <label class="field"><span>Quartier</span><select class="input" name="neighborhood">${optionsQuartiers("Mermoz")}</select></label>
      <label class="field"><span>Adresse</span><input class="input" name="address" placeholder="Villa, rue, repère"><small>Facultatif, vous pourrez la donner à chaque réservation.</small></label>
      <h2>Vos enfants</h2>
      <div id="children">${childRow()}</div>
      <button type="button" class="btn ghost small" id="add-child">Ajouter un enfant</button>
      <div style="margin-top:26px"><button class="btn block">Enregistrer et trouver une nounou</button></div>
    </form>`;
  $("#add-child").onclick = () => $("#children").insertAdjacentHTML("beforeend", childRow());
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const children = $$(".child-row", f).map((r) => ({ firstName: $("[name=cName]", r).value.trim(), birthYear: Number($("[name=cYear]", r).value) })).filter((c) => c.firstName);
    run(e.submitter, async () => {
      S.cache.parent = await api("POST", "/parents/me", {
        fullName: f.fullName.value, neighborhood: f.neighborhood.value,
        ...(f.address.value.trim() ? { address: f.address.value.trim() } : {}), children,
      });
      toast("Profil famille enregistré");
      go("#/");
    });
  });
}

async function parentSearch() {
  setHeader("Trouver une nounou");
  loading();
  const parent = await parentProfile();
  const f = S.cache.filters ||= { neighborhood: parent.neighborhood, type: "", profile: "", firstAid: false, maxRate: "" };

  view().innerHTML = `
    <form id="filters">
      <label class="field" style="margin-bottom:10px"><span class="sr">Quartier</span>
        <select class="input" name="neighborhood" aria-label="Quartier">${optionsQuartiers(f.neighborhood, true)}</select>
      </label>
      <div class="scroll-x" role="group" aria-label="Type de garde">
        ${[["", "Toutes les gardes"], ...Object.entries(TYPES)].map(([v, l]) => `<label class="chip"><input type="radio" name="type" value="${v}" ${f.type === v ? "checked" : ""}>${l}</label>`).join("")}
      </div>
      <div class="scroll-x" role="group" aria-label="Profil" style="margin-top:8px">
        ${[["", "Tous les profils"], ["exp", "Expérimentées"], ["etu", "Étudiantes"]].map(([v, l]) => `<label class="chip"><input type="radio" name="profile" value="${v}" ${f.profile === v ? "checked" : ""}>${l}</label>`).join("")}
        <label class="chip"><input type="checkbox" name="firstAid" ${f.firstAid ? "checked" : ""}>Premiers secours</label>
        <label class="chip"><input type="checkbox" name="cheap" ${f.maxRate ? "checked" : ""}>2 500 F/h max</label>
      </div>
    </form>
    <div id="results" style="margin-top:16px"></div>`;

  const load = async () => {
    const q = new URLSearchParams({ perPage: "30" });
    if (f.neighborhood) q.set("neighborhood", f.neighborhood);
    if (f.type) q.set("type", f.type);
    if (f.profile) q.set("isStudent", String(f.profile === "etu"));
    if (f.firstAid) q.set("firstAid", "true");
    if (f.maxRate) q.set("maxRate", f.maxRate);
    $("#results").innerHTML = '<div class="spinner"></div>';
    const r = await api("GET", "/nannies?" + q);
    $("#results").innerHTML = r.items.length
      ? `<p class="muted small">${plural(r.total, "nounou vérifiée")}${f.neighborhood ? " à " + esc(f.neighborhood) : " à Dakar"}</p>` + r.items.map(nannyCard).join("")
      : `<div class="empty"><h3>Personne pour ces critères</h3><p>Élargissez la recherche à tout Dakar ou retirez un filtre.</p>
         ${f.neighborhood ? `<button class="btn ghost" id="all-dakar">Chercher dans tout Dakar</button>` : ""}</div>`;
    $("#all-dakar")?.addEventListener("click", () => { f.neighborhood = ""; parentSearch(); });
  };

  $("#filters").addEventListener("change", (e) => {
    const form = e.currentTarget;
    f.neighborhood = form.neighborhood.value;
    f.type = checkedValues(form, "type")[0] ?? "";
    f.profile = checkedValues(form, "profile")[0] ?? "";
    f.firstAid = form.firstAid.checked;
    f.maxRate = form.cheap.checked ? "2500" : "";
    run(null, load);
  });
  await load();
}

function nannyCard(n) {
  return `<a class="card tap nanny-card" href="#/nounou/${n.id}">
    ${pagne(n.fullName)}
    <div class="grow">
      <div class="row" style="align-items:flex-start"><h3 class="grow">${esc(n.fullName)}</h3><span class="price">${fcfa(n.hourlyRateXof)}<small>/h</small></span></div>
      <p class="meta">${esc(n.neighborhood)} · ${n.isStudent ? `Étudiante${n.school ? " " + esc(n.school) : ""}` : plural(n.experienceYears, "an") + " d'expérience"}</p>
      <div class="tags">
        <span class="tag verified">Vérifiée</span>
        ${n.firstAidCertified ? `<span class="tag">Premiers secours</span>` : ""}
        <span class="tag">${stars(n.ratingAvg, n.ratingCount)}</span>
      </div>
    </div>
  </a>`;
}

function weekTable(avail, editable = false) {
  const has = (d, c) => avail.some((a) => a.weekday === d && a.startTime === c.start && a.endTime === c.end);
  return `<table class="week">
    <thead><tr><th></th>${CRENEAUX.map((c) => `<th scope="col" title="${c.start}–${c.end}">${c.short}</th>`).join("")}</tr></thead>
    <tbody>${ORDRE_JOURS.map((d) => `<tr><th scope="row">${JOURS_COURTS[d]}</th>${CRENEAUX.map((c) => editable
      ? `<td><label><input type="checkbox" name="slot" value="${d}|${c.start}|${c.end}" ${has(d, c) ? "checked" : ""} aria-label="${JOURS[d]} ${c.label} ${c.start}–${c.end}"></label></td>`
      : `<td class="${has(d, c) ? "on" : ""}" title="${JOURS[d]} ${c.start}–${c.end}"><span class="sr">${has(d, c) ? "Disponible" : ""}</span></td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  <p class="muted small" style="margin-top:6px">${CRENEAUX.map((c) => `${c.short} ${c.start.replace(":00", "h")}–${c.end.replace(":00", "h")}`).join(" · ")}</p>`;
}

async function parentNanny(id) {
  setHeader("Profil", "#/");
  loading();
  const n = await api("GET", "/nannies/" + id);
  const avg = (k) => n.reviews.length ? n.reviews.reduce((s, r) => s + r[k], 0) / n.reviews.length : null;
  setHeader(n.fullName.split(" ")[0], "#/");

  view().innerHTML = `
    <div class="hero">
      ${pagne(n.fullName, "lg")}
      <div>
        <h2>${esc(n.fullName)}</h2>
        <p class="meta" style="margin:0 0 6px">${esc(n.neighborhood)} · ${stars(n.ratingAvg, n.ratingCount)}</p>
        <span class="tag verified" title="Identité, casier judiciaire et références contrôlés, entretien réalisé">Vérifiée par l'équipe</span>
      </div>
    </div>
    <div class="facts">
      <div><b>${n.experienceYears}</b><span>${n.experienceYears > 1 ? "ans" : "an"} d'expérience</span></div>
      <div><b>${n.ratingCount}</b><span>avis de familles</span></div>
      <div><b>${n.firstAidCertified ? "Oui" : "Non"}</b><span>premiers secours</span></div>
    </div>
    ${n.bio ? `<p>${esc(n.bio)}</p>` : ""}
    <div class="card">
      ${n.isStudent ? `<div class="kv"><span class="muted">Études</span><span>${esc([n.fieldOfStudy, n.school].filter(Boolean).join(", ")) || "Étudiante"}</span></div>` : ""}
      <div class="kv"><span class="muted">Langues</span><span>${esc(n.languages.join(", "))}</span></div>
      <div class="kv"><span class="muted">Gardes</span><span style="text-align:right">${esc(n.bookingTypes.map((t) => TYPES[t]).join(", "))}</span></div>
    </div>
    <h2>Disponibilités habituelles</h2>
    ${weekTable(n.availabilities)}
    <h2>Avis des familles</h2>
    ${n.reviews.length ? `
      <div class="card">
        ${[["punctuality", "Ponctualité"], ["care", "Attention aux enfants"], ["communication", "Communication"], ["instructions", "Respect des consignes"]]
          .map(([k, l]) => `<div class="kv"><span>${l}</span><span class="stars">★ ${avg(k).toFixed(1).replace(".", ",")}</span></div>`).join("")}
      </div>
      ${n.reviews.filter((r) => r.comment).map((r) => `<div class="panel"><p style="margin:0 0 4px">« ${esc(r.comment)} »</p><p class="muted small" style="margin:0">${dateFr(r.createdAt, { month: "long", year: "numeric" })}</p></div>`).join("")}`
      : `<p class="muted">${n.ratingCount ? `Note moyenne de ${String(n.ratingAvg).replace(".", ",")} sur ${n.ratingCount} gardes.` : "Pas encore d'avis : soyez la première famille à la noter."}</p>`}
    <div class="sticky-cta">
      <div class="grow"><span class="price" style="font-size:20px">${fcfa(n.hourlyRateXof)}</span><span class="muted small"> / heure</span></div>
      <a class="btn" href="#/reserver/${n.id}">Réserver</a>
    </div>`;
}

function timeOptions(sel = "16:00") {
  const out = [];
  for (let h = 7; h <= 22; h++) for (const m of ["00", "30"]) {
    const v = `${String(h).padStart(2, "0")}:${m}`;
    out.push(`<option ${v === sel ? "selected" : ""}>${v}</option>`);
  }
  return out.join("");
}

async function parentBook(id) {
  setHeader("Réserver", "#/nounou/" + id);
  loading();
  const [n, parent] = await Promise.all([api("GET", "/nannies/" + id), parentProfile()]);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  view().innerHTML = `
    <div class="row" style="margin-bottom:16px">${pagne(n.fullName, "sm")}<div class="grow"><h3>${esc(n.fullName)}</h3><span class="muted small">${fcfa(n.hourlyRateXof)} / heure</span></div></div>
    <form id="f">
      <label class="field"><span>Type de garde</span><select class="input" name="type">${n.bookingTypes.map((t) => `<option value="${t}">${TYPES[t]}</option>`).join("")}</select></label>
      <div class="two">
        <label class="field"><span>Date</span><input class="input" type="date" name="date" min="${iso(new Date())}" value="${iso(tomorrow)}" required></label>
        <label class="field"><span>Début</span><select class="input" name="time">${timeOptions()}</select></label>
      </div>
      <label class="field"><span>Durée</span>
        <select class="input" name="hours">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i === 2 ? "selected" : ""}>${plural(i + 1, "heure")}</option>`).join("")}</select>
      </label>
      ${parent.children.length ? `<div class="field"><span>Enfants gardés</span>${chipsHtml("kids", parent.children.map((c) => [c.firstName, `${c.firstName}, ${ageEnfant(c.birthYear)}`]), parent.children.map((c) => c.firstName))}</div>` : ""}
      <label class="field"><span>Adresse de la garde</span><input class="input" name="address" value="${esc(parent.address || "")}" placeholder="Villa, rue, repère" required minlength="5"></label>
      <label class="field"><span>Consignes pour la nounou</span><textarea class="input" name="instructions" maxlength="400" placeholder="Allergies, heure du goûter, devoirs, personne à prévenir…"></textarea></label>

      <h2>Paiement</h2>
      <div class="card" id="recap"></div>
      <div class="field"><span>Payer avec</span>${chipsHtml("method", Object.entries(PAIEMENTS), ["WAVE"], "radio")}</div>
      <p class="muted small">L'argent reste bloqué jusqu'à la fin de la garde. Si la nounou refuse ou ne répond pas sous 24 h, vous êtes remboursé.</p>
      <button class="btn block" id="pay" style="margin-top:8px">Payer et envoyer la demande</button>
    </form>`;

  const form = $("#f");
  const recap = () => {
    const h = Number(form.hours.value);
    const amount = n.hourlyRateXof * h;
    const fee = Math.round((amount * S.config.feePct) / 100);
    $("#recap").innerHTML = `
      <div class="kv"><span>${fcfa(n.hourlyRateXof)} × ${plural(h, "heure")}</span><span>${fcfa(amount)}</span></div>
      <div class="kv"><span>Frais de service (${S.config.feePct} %)</span><span>${fcfa(fee)}</span></div>
      <div class="kv total"><span>Total</span><span>${fcfa(amount + fee)}</span></div>`;
    $("#pay").textContent = `Payer ${fcfa(amount + fee)} et envoyer la demande`;
  };
  form.addEventListener("change", recap);
  recap();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const kids = checkedValues(form, "kids");
    const consignes = [kids.length ? `Enfants : ${kids.join(", ")}.` : "", form.instructions.value.trim()].filter(Boolean).join(" ");
    const startAt = new Date(`${form.date.value}T${form.time.value}:00`);
    run(e.submitter, async () => {
      if (startAt < new Date()) throw new Error("Choisissez une date et une heure à venir");
      const booking = await api("POST", "/bookings", {
        nannyId: n.id, type: form.type.value, startAt: startAt.toISOString(),
        hours: Number(form.hours.value), address: form.address.value.trim(),
        ...(consignes ? { instructions: consignes.slice(0, 500) } : {}),
      });
      const method = checkedValues(form, "method")[0];
      const pay = await api("POST", "/payments/init", { bookingId: booking.id, method });
      if (S.config.demo) {
        await api("POST", `/dev/payments/${pay.paymentId}/succeed`);
      } else {
        location.href = pay.checkoutUrl; // page de paiement de l'agregateur
        return;
      }
      bookingSent(n, booking, method);
    });
  });
}

function bookingSent(n, b, method) {
  setHeader("Demande envoyée");
  view().innerHTML = `
    <div class="empty" style="padding-top:20px">
      <div style="display:flex;justify-content:center;margin-bottom:16px">${pagne(n.fullName, "lg")}</div>
      <h3 style="font-size:22px">${esc(n.fullName.split(" ")[0])} a reçu votre demande</h3>
      <p>${esc(TYPES[b.type])}, ${quand(b.startAt)}, ${plural(b.hours, "heure")}.</p>
      <p>Paiement de <b>${fcfa(b.totalXof)}</b> par ${PAIEMENTS[method]} reçu et bloqué jusqu'à la fin de la garde.</p>
      ${S.config.demo ? `<p class="small">Mode démo : le paiement est simulé.</p>` : ""}
      <p>Elle a 24 heures pour répondre. Son numéro s'affichera dans vos réservations dès qu'elle aura accepté.</p>
      <div style="display:grid;gap:8px;margin-top:20px">
        <a class="btn" href="#/reservations">Voir mes réservations</a>
        <a class="btn ghost" href="#/">Retour à la recherche</a>
      </div>
    </div>`;
}

async function parentBookings() {
  setHeader("Réservations");
  loading();
  const list = await api("GET", "/bookings");
  const active = ["PENDING", "CONFIRMED", "IN_PROGRESS"];
  const upcoming = list.filter((b) => active.includes(b.status)).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const past = list.filter((b) => !active.includes(b.status));

  const card = (b) => {
    const canReview = ["COMPLETED", "PAID_OUT"].includes(b.status) && !b.reviewed;
    return `<div class="card">
      <div class="row" style="align-items:flex-start">
        ${pagne(b.nanny.fullName, "sm")}
        <div class="grow">
          <h3>${esc(b.nanny.fullName)}</h3>
          <p style="margin:4px 0 2px">${pill(STATUTS[b.status])}</p>
          <p class="meta" style="margin-bottom:2px">${esc(TYPES[b.type])} · ${quand(b.startAt)} · ${b.hours} h</p>
          <p class="small" style="margin:0">${fcfa(b.totalXof)} ${b.status === "CANCELLED" ? "" : b.paid ? "<span class='muted'>payé</span>" : "<span class='muted'>en attente de paiement</span>"}</p>
          ${b.nanny.phone ? `<p class="small" style="margin:6px 0 0">Téléphone : <a href="tel:${esc(b.nanny.phone)}">${esc(b.nanny.phone)}</a></p>` : ""}
          ${b.status === "IN_PROGRESS" && b.missions[0]?.checkinAt ? `<p class="small" style="margin:6px 0 0;color:var(--baobab)"><b>Arrivée à ${heureFr(b.missions[0].checkinAt)}</b></p>` : ""}
        </div>
      </div>
      ${["PENDING", "CONFIRMED"].includes(b.status) || canReview ? `<div class="btn-row" style="margin-top:12px">
        ${["PENDING", "CONFIRMED"].includes(b.status) ? `<button class="btn ghost small" data-cancel="${b.id}">Annuler</button>` : ""}
        ${canReview ? `<button class="btn small" data-review="${b.id}" data-name="${esc(b.nanny.fullName)}">Donner mon avis</button>` : ""}
      </div>` : ""}
    </div>`;
  };

  view().innerHTML = `
    <h2>À venir</h2>
    ${upcoming.length ? upcoming.map(card).join("") : `<div class="empty"><h3>Aucune garde prévue</h3><p>Trouvez une nounou disponible près de chez vous.</p><a class="btn" href="#/">Trouver une nounou</a></div>`}
    ${past.length ? `<h2>Historique</h2>${past.map(card).join("")}` : ""}`;

  view().onclick = (e) => {
    const c = e.target.closest("[data-cancel]");
    if (c) return cancelSheet(c.dataset.cancel);
    const r = e.target.closest("[data-review]");
    if (r) return reviewSheet(r.dataset.review, r.dataset.name);
  };
}

async function cancelSheet(id) {
  const p = await run(null, () => api("GET", `/bookings/${id}/cancel-preview`));
  if (!p) return;
  openSheet(`
    <h2 id="sheet-title">Annuler cette garde ?</h2>
    <div class="card" style="background:var(--sky)">
      <div class="kv"><span>Remboursé</span><b>${fcfa(p.refundXof)}</b></div>
      ${p.toNannyXof ? `<div class="kv"><span>Versé à la nounou</span><span>${fcfa(p.toNannyXof)}</span></div>` : ""}
    </div>
    <p class="muted small">Remboursement complet jusqu'à 24 h avant la garde. Entre 24 h et 2 h avant, la nounou reçoit la moitié de sa rémunération ; à moins de 2 h, la totalité.</p>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" data-close>Garder la réservation</button>
      <button class="btn danger" id="confirm-cancel">Annuler la garde</button>
    </div>`);
  $("[data-close]").onclick = closeSheet;
  $("#confirm-cancel").onclick = (e) => run(e.target, async () => {
    await api("POST", `/bookings/${id}/cancel`);
    toast("Garde annulée");
    render();
  });
}

function reviewSheet(id, name) {
  const crit = [["punctuality", "Ponctualité"], ["care", "Attention aux enfants"], ["communication", "Communication"], ["instructions", "Respect des consignes"]];
  openSheet(`
    <h2 id="sheet-title">Comment s'est passée la garde avec ${esc(name.split(" ")[0])} ?</h2>
    <form id="f-review">
      ${crit.map(([k, l]) => `<fieldset class="field" style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:700;font-size:14.5px;margin-bottom:2px">${l}</legend>
        <div class="rate">${[5, 4, 3, 2, 1].map((v) => `<input type="radio" id="${k}${v}" name="${k}" value="${v}" required><label for="${k}${v}" title="${v} sur 5">★</label>`).join("")}</div></fieldset>`).join("")}
      <label class="field"><span>Un mot pour les autres familles</span><textarea class="input" name="comment" maxlength="500" placeholder="Facultatif"></textarea></label>
      <button class="btn block">Publier mon avis</button>
    </form>`);
  $("#f-review").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(e.submitter, async () => {
      await api("POST", `/bookings/${id}/review`, {
        ...Object.fromEntries(crit.map(([k]) => [k, Number(checkedValues(f, k)[0])])),
        ...(f.comment.value.trim() ? { comment: f.comment.value.trim() } : {}),
      });
      toast("Avis publié, merci");
      render();
    });
  });
}

async function parentAccount() {
  setHeader("Famille");
  loading();
  const p = await parentProfile(true);
  view().innerHTML = `
    <div class="card">
      <h3>${esc(p.fullName)}</h3>
      <p class="muted small" style="margin:2px 0 0">${esc(p.neighborhood)}${p.address ? " · " + esc(p.address) : ""} · ${esc(S.user.phone)}</p>
    </div>
    <form id="f-info">
      <h2>Coordonnées</h2>
      <label class="field"><span>Nom de la famille</span><input class="input" name="fullName" value="${esc(p.fullName)}" required minlength="2"></label>
      <label class="field"><span>Quartier</span><select class="input" name="neighborhood">${optionsQuartiers(p.neighborhood)}</select></label>
      <label class="field"><span>Adresse</span><input class="input" name="address" value="${esc(p.address || "")}"></label>
      <button class="btn ghost block">Enregistrer</button>
    </form>
    <h2>Enfants</h2>
    <div class="card">
      ${p.children.length ? p.children.map((c) => `<div class="list-line"><span><b>${esc(c.firstName)}</b> <span class="muted">${ageEnfant(c.birthYear)}</span>${c.specialNeeds ? `<br><span class="small muted">${esc(c.specialNeeds)}</span>` : ""}</span>
        <button class="link-btn" data-del="${c.id}" aria-label="Retirer ${esc(c.firstName)}">Retirer</button></div>`).join("") : `<p class="muted" style="margin:0">Aucun enfant enregistré.</p>`}
    </div>
    <form id="f-child" class="panel">
      <h3 style="margin-bottom:10px">Ajouter un enfant</h3>
      ${childRow()}
      <label class="field"><span>Allergies ou besoins particuliers</span><input class="input" name="needs" placeholder="Facultatif"></label>
      <button class="btn ghost small">Ajouter</button>
    </form>
    <button class="btn danger block" id="logout" style="margin-top:24px">Se déconnecter</button>`;

  $("#f-info").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(e.submitter, async () => {
      S.cache.parent = await api("PATCH", "/parents/me", { fullName: f.fullName.value, neighborhood: f.neighborhood.value, address: f.address.value.trim() });
      S.cache.filters = null;
      toast("Coordonnées enregistrées");
      parentAccount();
    });
  });
  $("#f-child").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(e.submitter, async () => {
      await api("POST", "/parents/me/children", {
        firstName: f.cName.value.trim(), birthYear: Number(f.cYear.value),
        ...(f.needs.value.trim() ? { specialNeeds: f.needs.value.trim() } : {}),
      });
      toast("Enfant ajouté");
      parentAccount();
    });
  });
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => run(b, async () => {
    await api("DELETE", "/parents/me/children/" + b.dataset.del);
    toast("Enfant retiré");
    parentAccount();
  })));
  $("#logout").onclick = logout;
}


/* ================================================================== */
/* NOUNOU                                                              */
/* ================================================================== */

async function nannyProfile(force = false) {
  if (!S.cache.nanny || force) S.cache.nanny = await api("GET", "/nannies/me");
  return S.cache.nanny;
}

function nannyOnboarding() {
  setHeader("Votre profil de nounou");
  setTabs(null);
  view().innerHTML = `
    <form id="f">
      <p class="lead" style="margin-bottom:18px">Les familles verront ce profil une fois votre dossier validé par l'équipe.</p>
      <label class="field"><span>Nom complet</span><input class="input" name="fullName" autocomplete="name" required minlength="2"><small>Tel qu'il figure sur votre pièce d'identité.</small></label>
      <div class="two">
        <label class="field"><span>Quartier</span><select class="input" name="neighborhood">${optionsQuartiers("Mermoz")}</select></label>
        <label class="field"><span>Tarif par heure</span><input class="input" name="rate" type="number" inputmode="numeric" min="500" max="20000" step="100" value="2500" required></label>
      </div>
      <label class="field"><span>Années d'expérience avec des enfants</span><input class="input" name="years" type="number" inputmode="numeric" min="0" max="50" value="1"></label>
      <label class="toggle"><span><b>Je suis étudiante</b><br><span class="muted small">Un certificat de scolarité vous sera demandé.</span></span><input type="checkbox" name="isStudent"></label>
      <div id="student" hidden>
        <div class="two">
          <label class="field"><span>Établissement</span><input class="input" name="school" placeholder="UCAD, UGB, ESP…"></label>
          <label class="field"><span>Filière</span><input class="input" name="field" placeholder="Psychologie…"></label>
        </div>
      </div>
      <label class="toggle"><span><b>Formée aux premiers secours</b></span><input type="checkbox" name="firstAid"></label>
      <div class="field"><span>Gardes proposées</span>${chipsHtml("types", Object.entries(TYPES), ["PONCTUELLE", "SORTIE_ECOLE"])}</div>
      <div class="field"><span>Langues parlées</span>${chipsHtml("langs", LANGUES.map((l) => [l, l]), ["Français", "Wolof"])}</div>
      <label class="field"><span>Présentez-vous aux familles</span><textarea class="input" name="bio" maxlength="600" placeholder="Votre expérience, ce que vous aimez faire avec les enfants, vos disponibilités…"></textarea><small>30 caractères minimum pour soumettre votre dossier.</small></label>
      <button class="btn block">Créer mon profil</button>
    </form>`;
  const f = $("#f");
  f.isStudent.addEventListener("change", () => { $("#student").hidden = !f.isStudent.checked; f.school.required = f.isStudent.checked; });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const types = checkedValues(f, "types"), langs = checkedValues(f, "langs");
      if (!types.length) throw new Error("Choisissez au moins un type de garde");
      if (!langs.length) throw new Error("Choisissez au moins une langue");
      S.cache.nanny = await api("POST", "/nannies/me", {
        fullName: f.fullName.value.trim(), neighborhood: f.neighborhood.value,
        hourlyRateXof: Number(f.rate.value), experienceYears: Number(f.years.value || 0),
        isStudent: f.isStudent.checked,
        ...(f.isStudent.checked ? { school: f.school.value.trim(), ...(f.field.value.trim() ? { fieldOfStudy: f.field.value.trim() } : {}) } : {}),
        firstAidCertified: f.firstAid.checked, bookingTypes: types, languages: langs,
        ...(f.bio.value.trim() ? { bio: f.bio.value.trim() } : {}),
      });
      toast("Profil créé. Place à votre dossier.");
      go("#/dossier");
    });
  });
}

function statusBanner(n) {
  const d = n.dossier;
  if (n.verificationStatus === "VERIFIED") {
    const exam = n.examModeUntil && new Date(n.examModeUntil) > new Date();
    return exam
      ? `<div class="banner warn"><h3>Mode examens activé</h3><p>Vous n'apparaissez pas dans les recherches jusqu'au ${dateFr(n.examModeUntil, { day: "numeric", month: "long" })}.</p><p><a href="#/profil">Modifier</a></p></div>`
      : `<div class="banner ok"><h3>Profil vérifié</h3><p>Les familles de ${esc(n.neighborhood)} et alentours peuvent vous réserver.</p></div>`;
  }
  if (n.verificationStatus === "UNDER_REVIEW")
    return `<div class="banner info"><h3>Dossier en cours de vérification</h3><p>L'équipe examine vos pièces et vous appellera pour un court entretien. Comptez 2 à 3 jours.</p></div>`;
  if (n.verificationStatus === "REJECTED")
    return `<div class="banner bad"><h3>Votre dossier est à corriger</h3><p>Certaines pièces doivent être renvoyées. Le motif est indiqué pour chacune.</p><p><a class="btn small" href="#/dossier">Corriger mon dossier</a></p></div>`;
  const done = d.items.filter((i) => i.status !== "MISSING" && i.status !== "REJECTED").length;
  return `<div class="banner warn"><h3>Complétez votre dossier</h3><p>${done} pièce${done > 1 ? "s" : ""} sur ${d.items.length} envoyée${done > 1 ? "s" : ""}. Vous apparaîtrez dans les recherches une fois votre dossier validé.</p><p><a class="btn small" href="#/dossier">Continuer mon dossier</a></p></div>`;
}

async function nannyHome() {
  setHeader("Accueil");
  loading();
  const [n, list] = await Promise.all([nannyProfile(true), api("GET", "/bookings")]);
  const requests = list.filter((b) => b.status === "PENDING" && new Date(b.respondBy) > new Date());
  const missions = list.filter((b) => ["CONFIRMED", "IN_PROGRESS"].includes(b.status)).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const done = list.filter((b) => ["COMPLETED", "PAID_OUT"].includes(b.status));
  S.cache.badges = { "#/": requests.length || 0 };
  setTabs("NANNY", S.cache.badges);
  setHeader(`Bonjour ${n.fullName.split(" ")[0]}`);

  const net = (b) => b.amountXof - b.commissionXof;
  const left = (d) => { const h = Math.max(0, Math.round((new Date(d) - Date.now()) / 3_600_000)); return h < 1 ? "moins d'une heure" : plural(h, "heure"); };

  const reqCard = (b) => `<div class="card">
      <div class="row"><h3 class="grow">${esc(b.parent.fullName)}</h3><span class="price">${fcfa(net(b))}</span></div>
      <p class="meta">${esc(TYPES[b.type])} · ${esc(b.parent.neighborhood)}<br>${quand(b.startAt)} · ${b.hours} h</p>
      ${b.instructions ? `<p class="small" style="background:var(--sky);padding:8px 10px;border-radius:10px">${esc(b.instructions)}</p>` : ""}
      <p class="small muted">Vous recevrez ${fcfa(net(b))} après la garde (commission de ${S.config.commissionPct} % déduite). Répondez dans ${left(b.respondBy)}.</p>
      <div class="btn-row"><button class="btn ghost small" data-refuse="${b.id}">Refuser</button><button class="btn ok small" data-accept="${b.id}">Accepter</button></div>
    </div>`;

  const missionCard = (b) => {
    const m = b.missions[0];
    const action = b.status === "CONFIRMED"
      ? `<button class="btn ok block" data-checkin="${m.id}">Je suis arrivée</button>`
      : `<button class="btn block" data-checkout="${m.id}">J'ai terminé la garde</button>`;
    return `<div class="card">
      <div class="row"><h3 class="grow">${esc(b.parent.fullName)}</h3>${pill(STATUTS[b.status])}</div>
      <p class="meta">${esc(TYPES[b.type])} · ${quand(b.startAt)} · ${b.hours} h</p>
      <div class="kv small"><span class="muted">Adresse</span><span style="text-align:right">${esc(b.address)}</span></div>
      ${b.parent.phone ? `<div class="kv small"><span class="muted">Téléphone</span><a href="tel:${esc(b.parent.phone)}">${esc(b.parent.phone)}</a></div>` : ""}
      ${b.instructions ? `<p class="small" style="background:var(--sky);padding:8px 10px;border-radius:10px;margin-top:8px">${esc(b.instructions)}</p>` : ""}
      ${m.checkinAt ? `<p class="small" style="color:var(--baobab)"><b>Arrivée enregistrée à ${heureFr(m.checkinAt)}</b></p>` : ""}
      <div style="margin-top:10px">${action}</div>
    </div>`;
  };

  view().innerHTML = `
    ${statusBanner(n)}
    ${requests.length ? `<h2>Demandes à traiter</h2>${requests.map(reqCard).join("")}` : ""}
    <h2>Mes gardes</h2>
    ${missions.length ? missions.map(missionCard).join("") : `<div class="empty"><h3>Aucune garde prévue</h3><p>${n.verificationStatus === "VERIFIED" ? "Les nouvelles demandes apparaîtront ici. Des disponibilités à jour vous rendent plus visible." : "Elles apparaîtront ici une fois votre profil vérifié."}</p>${n.verificationStatus === "VERIFIED" ? `<a class="btn ghost" href="#/profil">Mettre à jour mes disponibilités</a>` : ""}</div>`}
    ${done.length ? `<h2>Gardes terminées</h2><div class="card">${done.slice(0, 8).map((b) => `<div class="list-line"><span>${esc(b.parent.fullName)}<br><span class="muted small">${dateFr(b.startAt, { day: "numeric", month: "short" })} · ${b.hours} h</span></span><span>${fcfa(net(b))} ${b.status === "PAID_OUT" ? pill(["Versé", "ok"]) : pill(["Sous 24 h", "warn"])}</span></div>`).join("")}</div>` : ""}`;

  view().onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.accept || b.dataset.refuse) {
      const accept = !!b.dataset.accept;
      return run(b, async () => {
        await api("POST", `/bookings/${b.dataset.accept || b.dataset.refuse}/respond`, { accept });
        toast(accept ? "Garde acceptée. La famille est prévenue." : "Demande refusée, la famille est remboursée.");
        nannyHome();
      });
    }
    if (b.dataset.checkin || b.dataset.checkout) {
      const kind = b.dataset.checkin ? "checkin" : "checkout";
      return run(b, async () => {
        const pos = await position();
        await api("POST", `/bookings/missions/${b.dataset.checkin || b.dataset.checkout}/${kind}`, pos);
        toast(kind === "checkin" ? "Arrivée enregistrée, la famille est prévenue" : "Garde terminée. Paiement versé sous 24 h.");
        nannyHome();
      });
    }
  };
}

/** Position GPS si le telephone l'autorise ; sinon on enregistre quand meme l'heure. */
function position() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    // Si la demande d'autorisation reste sans reponse, on n'attend pas plus de 8 s
    setTimeout(() => resolve({}), 8000);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}

const DOC_HELP = {
  CNI: "Recto et verso lisibles, en photo ou en PDF.",
  CASIER_JUDICIAIRE: "Extrait de moins de 3 mois, à demander au tribunal.",
  JUSTIFICATIF_DOMICILE: "Facture Senelec, Sen'Eau ou certificat de résidence.",
  REFERENCE: "Attestation d'une famille ou d'une structure pour laquelle vous avez gardé des enfants.",
  CERTIFICAT_SCOLARITE: "De l'année en cours.",
};

async function nannyDossier() {
  setHeader("Mon dossier");
  loading();
  const n = await nannyProfile(true);
  const d = n.dossier;
  const locked = n.verificationStatus === "UNDER_REVIEW";
  const doneCount = d.items.filter((i) => i.status !== "MISSING" && i.status !== "REJECTED").length;

  view().innerHTML = `
    ${n.verificationStatus === "VERIFIED" ? `<div class="banner ok"><h3>Dossier validé</h3><p>Merci, toutes vos pièces ont été vérifiées.</p></div>`
      : locked ? `<div class="banner info"><h3>Dossier envoyé</h3><p>L'équipe vérifie vos pièces. Vous serez appelée pour un court entretien avant la validation.</p></div>`
      : `<p class="lead" style="margin-bottom:6px">Ces pièces permettent de rassurer les familles. Elles ne sont jamais montrées aux parents.</p>
         <p class="muted small" style="margin-bottom:14px">${doneCount} sur ${d.items.length} envoyées</p>`}
    ${d.items.map((i) => `<div class="card">
      <div class="row"><h3 class="grow">${esc(DOC_LABEL[i.type])}</h3>${pill(DOSSIER[i.status])}</div>
      <p class="muted small" style="margin:4px 0 0">${esc(DOC_HELP[i.type] || "")}</p>
      ${i.status === "REJECTED" && i.note ? `<p class="small" style="color:var(--alert);margin:8px 0 0"><b>Motif :</b> ${esc(i.note)}</p>` : ""}
      ${!locked && i.status !== "VERIFIED" ? `<label class="btn ${i.status === "MISSING" || i.status === "REJECTED" ? "" : "ghost"} small" style="margin-top:12px">
          ${i.status === "MISSING" ? "Envoyer" : "Remplacer"} le document
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-type="${i.type}" class="sr">
        </label>` : ""}
    </div>`).join("")}
    ${d.missingFields.length && !locked ? `<div class="banner warn"><p>À compléter sur votre profil : ${esc(humanize(d.missingFields.join(", ")))}.</p><p><a href="#/profil">Compléter mon profil</a></p></div>` : ""}
    ${["PENDING", "REJECTED"].includes(n.verificationStatus) ? `
      <button class="btn block" id="submit" ${d.canSubmit ? "" : "disabled"} style="margin-top:8px">Envoyer mon dossier à l'équipe</button>
      ${d.canSubmit ? "" : `<p class="muted small" style="text-align:center;margin-top:8px">Disponible quand toutes les pièces sont envoyées.</p>`}` : ""}`;

  $$("input[type=file][data-type]").forEach((inp) => inp.addEventListener("change", () => {
    const file = inp.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast("Fichier trop lourd : 5 Mo maximum", true);
    const fd = new FormData();
    fd.append("type", inp.dataset.type);
    fd.append("file", file);
    run(inp.closest("label"), async () => {
      toast("Envoi en cours…");
      await api("POST", "/nannies/me/documents", fd);
      toast("Document envoyé");
      nannyDossier();
    });
  }));
  $("#submit")?.addEventListener("click", (e) => run(e.target, async () => {
    S.cache.nanny = await api("POST", "/nannies/me/submit");
    toast("Dossier envoyé à l'équipe");
    nannyDossier();
  }));
}

async function nannyAccount() {
  setHeader("Mon profil");
  loading();
  const n = await nannyProfile(true);
  const locked = ["UNDER_REVIEW", "VERIFIED"].includes(n.verificationStatus);
  const exam = n.examModeUntil && new Date(n.examModeUntil) > new Date();
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  view().innerHTML = `
    <div class="hero">${pagne(n.fullName, "lg")}<div><h2>${esc(n.fullName)}</h2><p class="meta" style="margin:0">${esc(n.neighborhood)} · ${stars(n.ratingAvg, n.ratingCount)}</p></div></div>

    <h2>Disponibilités habituelles</h2>
    <form id="f-slots">
      <p class="muted small">Touchez les créneaux où vous êtes généralement libre.</p>
      ${weekTable(n.availabilities, true)}
      <button class="btn ghost block" style="margin-top:12px">Enregistrer mes disponibilités</button>
    </form>

    <h2>Période d'examens</h2>
    <div class="card">
      <label class="toggle" style="padding-top:0"><span><b>Mettre mon profil en pause</b><br><span class="muted small">Vous n'apparaissez plus dans les recherches, sans perdre vos avis.</span></span><input type="checkbox" id="exam" ${exam ? "checked" : ""}></label>
      <label class="field" id="exam-date" ${exam ? "" : "hidden"} style="margin:6px 0 0"><span>Jusqu'au</span><input class="input" type="date" value="${exam ? n.examModeUntil.slice(0, 10) : inTwoWeeks}" min="${new Date().toISOString().slice(0, 10)}"></label>
    </div>

    <form id="f-profile">
      <h2>Mon annonce</h2>
      <label class="field"><span>Présentation</span><textarea class="input" name="bio" maxlength="600">${esc(n.bio || "")}</textarea></label>
      <div class="two">
        <label class="field"><span>Tarif par heure</span><input class="input" name="rate" type="number" min="500" max="20000" step="100" value="${n.hourlyRateXof}"></label>
        <label class="field"><span>Quartier</span><select class="input" name="neighborhood">${optionsQuartiers(n.neighborhood)}</select></label>
      </div>
      <p class="muted small" style="margin-top:-6px">Un changement de tarif ne modifie pas les gardes déjà réservées.</p>
      <label class="field"><span>Années d'expérience</span><input class="input" name="years" type="number" min="0" max="50" value="${n.experienceYears}"></label>
      <label class="toggle"><span><b>Formée aux premiers secours</b></span><input type="checkbox" name="firstAid" ${n.firstAidCertified ? "checked" : ""}></label>
      <div class="field"><span>Gardes proposées</span>${chipsHtml("types", Object.entries(TYPES), n.bookingTypes)}</div>
      <div class="field"><span>Langues parlées</span>${chipsHtml("langs", LANGUES.map((l) => [l, l]), n.languages)}</div>
      ${locked ? `<p class="muted small">Nom et statut d'étudiante sont vérifiés : pour les changer, contactez l'équipe.</p>` : ""}
      <button class="btn block">Enregistrer mon annonce</button>
    </form>
    <p class="muted small" style="margin-top:20px">Connectée avec le ${esc(S.user.phone)}</p>
    <button class="btn danger block" id="logout">Se déconnecter</button>`;

  $("#f-slots").addEventListener("submit", (e) => {
    e.preventDefault();
    const slots = checkedValues(e.target, "slot").map((v) => { const [d, s, en] = v.split("|"); return { weekday: Number(d), startTime: s, endTime: en }; });
    run(e.submitter, async () => {
      await api("PUT", "/nannies/me/availabilities", { slots });
      toast(slots.length ? `${plural(slots.length, "créneau")} enregistré${slots.length > 1 ? "s" : ""}`.replace("créneaus", "créneaux") : "Disponibilités effacées");
    });
  });

  const saveExam = () => run(null, async () => {
    const on = $("#exam").checked;
    $("#exam-date").hidden = !on;
    const until = $("#exam-date input").value;
    S.cache.nanny = await api("PATCH", "/nannies/me", { examModeUntil: on ? new Date(until + "T23:59:00").toISOString() : null });
    toast(on ? `Profil en pause jusqu'au ${dateFr(until, { day: "numeric", month: "long" })}` : "Profil de nouveau visible");
  });
  $("#exam").addEventListener("change", saveExam);
  $("#exam-date input").addEventListener("change", saveExam);

  $("#f-profile").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(e.submitter, async () => {
      const types = checkedValues(f, "types"), langs = checkedValues(f, "langs");
      if (!types.length) throw new Error("Choisissez au moins un type de garde");
      if (!langs.length) throw new Error("Choisissez au moins une langue");
      S.cache.nanny = await api("PATCH", "/nannies/me", {
        bio: f.bio.value.trim(), hourlyRateXof: Number(f.rate.value), neighborhood: f.neighborhood.value,
        experienceYears: Number(f.years.value || 0), firstAidCertified: f.firstAid.checked, bookingTypes: types, languages: langs,
      });
      toast("Annonce enregistrée");
    });
  });
  $("#logout").onclick = logout;
}

async function nannyEarnings() {
  setHeader("Mes gains");
  loading();
  const w = await api("GET", "/payments/wallet");
  const PAYOUT = { REQUESTED: ["Demandé", "warn"], PROCESSING: ["En cours", "warn"], PAID: ["Versé", "ok"], FAILED: ["Échec", "bad"] };
  view().innerHTML = `
    <div class="facts" style="grid-template-columns:1fr 1fr">
      <div><b style="font-size:24px;color:var(--baobab)">${fcfa(w.balanceXof)}</b><span>disponible</span></div>
      <div><b style="font-size:24px">${fcfa(w.pendingXof)}</b><span>en attente (24 h après la garde)</span></div>
    </div>
    <form id="f-payout" class="card">
      <h3 style="margin-bottom:12px">Retirer mon argent</h3>
      <label class="field"><span>Montant</span><input class="input" name="amount" type="number" inputmode="numeric" min="1000" max="${w.balanceXof}" step="1" value="${w.balanceXof >= 1000 ? w.balanceXof : ""}" required><small>1 000 F minimum.</small></label>
      <div class="field"><span>Recevoir sur</span>${chipsHtml("method", [["WAVE", "Wave"], ["ORANGE_MONEY", "Orange Money"], ["FREE_MONEY", "Free Money"]], ["WAVE"], "radio")}</div>
      <label class="field"><span>Numéro du compte</span><input class="input" name="phone" type="tel" value="${esc(S.user.phone)}" required></label>
      <button class="btn block" ${w.balanceXof < 1000 ? "disabled" : ""}>Demander le versement</button>
      ${w.balanceXof < 1000 ? `<p class="muted small" style="margin:8px 0 0;text-align:center">Votre solde disponible doit atteindre 1 000 F.</p>` : ""}
    </form>
    <h2>Versements</h2>
    ${w.payouts.length ? `<div class="card">${w.payouts.map((p) => `<div class="list-line"><span>${fcfa(p.amountXof)}<br><span class="muted small">${PAIEMENTS[p.method]} · ${dateFr(p.createdAt, { day: "numeric", month: "short" })}</span></span>${pill(PAYOUT[p.status])}</div>`).join("")}</div>`
      : `<p class="muted">Aucun versement pour l'instant.</p>`}`;

  $("#f-payout").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(e.submitter, async () => {
      await api("POST", "/payments/payouts", { amountXof: Number(f.amount.value), method: checkedValues(f, "method")[0], phone: f.phone.value });
      toast("Versement demandé");
      nannyEarnings();
    });
  });
}

/* ================================================================== */
/* BACK-OFFICE                                                         */
/* ================================================================== */

const ADMIN_TABS = [["UNDER_REVIEW", "À examiner"], ["PENDING", "Incomplets"], ["REJECTED", "À corriger"], ["VERIFIED", "Vérifiées"]];
const ACTIONS = {
  DOCUMENT_VIEWED: "Pièce consultée", DOCUMENT_VERIFIED: "Pièce validée", DOCUMENT_REJECTED: "Pièce refusée",
  NANNY_VERIFIED: "Profil validé", NANNY_REJECTED: "Profil renvoyé", USER_SUSPENDED: "Compte suspendu",
  USER_BANNED: "Compte banni", USER_ACTIVE: "Compte réactivé",
};

async function adminQueue() {
  setHeader("Dossiers des nounous");
  const status = S.cache.adminTab || "UNDER_REVIEW";
  view().innerHTML = `
    <div class="seg" role="group" aria-label="Statut des dossiers">${ADMIN_TABS.map(([v, l]) => `<button aria-pressed="${v === status}" data-tab="${v}">${l}</button>`).join("")}</div>
    <input class="input" id="q" type="search" placeholder="Nom, téléphone ou quartier" style="margin-bottom:14px" value="${esc(S.cache.adminQ || "")}">
    <div id="list"><div class="spinner"></div></div>`;

  const load = async () => {
    const q = new URLSearchParams({ status: S.cache.adminTab || "UNDER_REVIEW" });
    if (S.cache.adminQ) q.set("q", S.cache.adminQ);
    const r = await api("GET", "/admin/nannies?" + q);
    $("#list").innerHTML = r.items.length ? r.items.map((n) => `
      <a class="card tap nanny-card" href="#/dossier/${n.id}">
        ${pagne(n.fullName, "sm")}
        <div class="grow">
          <div class="row"><h3 class="grow">${esc(n.fullName)}</h3>${n.user.status !== "ACTIVE" ? pill(["Suspendu", "bad"]) : ""}</div>
          <p class="meta" style="margin:0">${esc(n.neighborhood)} · ${esc(n.user.phone)} · ${n.isStudent ? "Étudiante" : "Expérimentée"} · ${plural(n._count.documents, "pièce")}</p>
          <p class="muted small" style="margin:0">Inscrite le ${dateFr(n.createdAt, { day: "numeric", month: "long" })}</p>
        </div>
      </a>`).join("") : `<div class="empty"><h3>Aucun dossier ici</h3><p>${status === "UNDER_REVIEW" ? "Tous les dossiers soumis ont été traités." : "Rien pour ce filtre."}</p></div>`;
  };

  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => { S.cache.adminTab = b.dataset.tab; adminQueue(); }));
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.cache.adminQ = e.target.value.trim(); run(null, load); }, 300); });
  await load();
}

async function adminDossier(id) {
  setHeader("Dossier", "#/");
  loading();
  const d = await api("GET", "/admin/nannies/" + id);
  const allOk = d.checklist.allVerified;
  setHeader(d.fullName, "#/");

  view().innerHTML = `
    <div class="admin-split">
      <div>
        <div class="hero">${pagne(d.fullName, "lg")}<div>
          <h2>${esc(d.fullName)}</h2>
          <p class="meta" style="margin:0 0 6px">${esc(d.user.phone)} · ${esc(d.neighborhood)}</p>
          ${pill(DOSSIER[d.verificationStatus])} ${d.user.status !== "ACTIVE" ? pill(["Compte suspendu", "bad"]) : ""}
        </div></div>
        <div class="card">
          <div class="kv"><span class="muted">Profil</span><span>${d.isStudent ? `Étudiante, ${esc([d.fieldOfStudy, d.school].filter(Boolean).join(", "))}` : "Expérimentée"}</span></div>
          <div class="kv"><span class="muted">Expérience</span><span>${plural(d.experienceYears, "an")}</span></div>
          <div class="kv"><span class="muted">Tarif</span><span>${fcfa(d.hourlyRateXof)} / h</span></div>
          <div class="kv"><span class="muted">Premiers secours</span><span>${d.firstAidCertified ? "Oui" : "Non"}</span></div>
          <div class="kv"><span class="muted">Inscrite le</span><span>${dateFr(d.createdAt, { day: "numeric", month: "long", year: "numeric" })}</span></div>
        </div>
        ${d.bio ? `<p>${esc(d.bio)}</p>` : `<p class="muted">Pas de présentation.</p>`}
      </div>
      <div>
        <h2>Pièces exigées</h2>
        ${d.checklist.items.map((i) => {
          const doc = d.documents.find((x) => x.id === i.documentId);
          return `<div class="card">
            <div class="row"><h3 class="grow" style="font-size:16px">${esc(DOC_LABEL[i.type])}</h3>${pill(DOSSIER[i.status])}</div>
            ${doc ? `<p class="muted small" style="margin:4px 0 0">Reçue le ${dateFr(doc.createdAt, { day: "numeric", month: "short" })}${doc.note ? ` · ${esc(doc.note)}` : ""}</p>
              <div class="btn-row" style="margin-top:10px">
                <button class="btn ghost small" data-view="${doc.id}" data-label="${esc(DOC_LABEL[i.type])}">Ouvrir</button>
                ${doc.status !== "VERIFIED" ? `<button class="btn ok small" data-ok="${doc.id}">Valider</button>` : ""}
                ${doc.status !== "REJECTED" ? `<button class="btn danger small" data-ko="${doc.id}">Refuser</button>` : ""}
              </div>` : `<p class="muted small" style="margin:4px 0 0">Pas encore envoyée.</p>`}
          </div>`;
        }).join("")}
        ${d.verificationStatus === "UNDER_REVIEW" ? `
          <h2>Décision</h2>
          <div class="card">
            <label class="toggle" style="padding-top:0"><span><b>Entretien réalisé</b><br><span class="muted small">Appel ou rencontre avec la nounou.</span></span><input type="checkbox" id="interview"></label>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn danger" id="reject">Renvoyer le dossier</button>
              <button class="btn ok" id="approve" ${allOk ? "" : "disabled"}>Valider le profil</button>
            </div>
            ${allOk ? "" : `<p class="muted small" style="margin:8px 0 0">Validez d'abord chaque pièce.</p>`}
          </div>` : ""}
        <h2>Compte</h2>
        <button class="btn ${d.user.status === "ACTIVE" ? "danger" : "ghost"} block" id="suspend">${d.user.status === "ACTIVE" ? "Suspendre le compte" : "Réactiver le compte"}</button>
        <h2>Historique</h2>
        ${d.history.length ? `<div class="card">${d.history.map((h) => `<div class="list-line small"><span>${esc(ACTIONS[h.action] || h.action)}${h.payload?.note || h.payload?.reason ? `<br><span class="muted">${esc(h.payload.note || h.payload.reason)}</span>` : ""}</span><span class="muted" style="text-align:right">${dateFr(h.createdAt, { day: "numeric", month: "short" })} ${heureFr(h.createdAt)}</span></div>`).join("")}</div>` : `<p class="muted">Aucune action pour l'instant.</p>`}
      </div>
    </div>`;

  const askNote = (title, label, placeholder) => new Promise((resolve) => {
    openSheet(`<h2 id="sheet-title">${esc(title)}</h2>
      <form id="f-note"><label class="field"><span>${esc(label)}</span><textarea class="input" name="note" required minlength="5" maxlength="500" placeholder="${esc(placeholder)}"></textarea></label>
      <div class="btn-row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn danger">Confirmer</button></div></form>`);
    $("[data-close]").onclick = () => { closeSheet(); resolve(null); };
    $("#f-note").addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.note.value.trim(); closeSheet(); resolve(v); });
  });

  view().onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.view) return run(b, async () => {
      const res = await fetch(`/api/admin/documents/${b.dataset.view}/file`, { headers: { Authorization: "Bearer " + S.token } });
      if (!res.ok) throw new Error("Impossible d'ouvrir la pièce");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      openSheet(`<h2 id="sheet-title">${esc(b.dataset.label)}</h2><div class="doc-view">${blob.type === "application/pdf" ? `<iframe src="${url}" title="${esc(b.dataset.label)}"></iframe>` : `<img src="${url}" alt="${esc(b.dataset.label)}">`}</div>
        <p class="muted small" style="margin-top:8px">Consultation enregistrée dans l'historique.</p><button class="btn ghost block" data-close>Fermer</button>`, { wide: true });
      $("[data-close]").onclick = closeSheet;
    });
    if (b.dataset.ok) return run(b, async () => { await api("POST", `/admin/documents/${b.dataset.ok}/review`, { status: "VERIFIED" }); toast("Pièce validée"); adminDossier(id); });
    if (b.dataset.ko) {
      const note = await askNote("Refuser la pièce", "Motif (la nounou le verra)", "Photo floue, merci de renvoyer une image nette");
      if (note) run(null, async () => { await api("POST", `/admin/documents/${b.dataset.ko}/review`, { status: "REJECTED", note }); toast("Pièce refusée"); adminDossier(id); });
      return;
    }
    if (b.id === "approve") {
      if (!$("#interview").checked) return toast("Cochez « Entretien réalisé » avant de valider", true);
      return run(b, async () => { await api("POST", `/admin/nannies/${id}/decision`, { decision: "VERIFIED", interviewDone: true }); toast("Profil validé, visible par les familles"); adminDossier(id); });
    }
    if (b.id === "reject") {
      const note = await askNote("Renvoyer le dossier", "Ce qu'il faut corriger", "Merci de renvoyer une référence lisible");
      if (note) run(null, async () => { await api("POST", `/admin/nannies/${id}/decision`, { decision: "REJECTED", note }); toast("Dossier renvoyé à la nounou"); adminDossier(id); });
      return;
    }
    if (b.id === "suspend") {
      const active = d.user.status === "ACTIVE";
      const reason = await askNote(active ? "Suspendre le compte" : "Réactiver le compte", "Motif (gardé dans l'historique)", active ? "Plainte d'une famille en cours d'examen" : "Vérification terminée");
      if (reason) run(null, async () => { await api("POST", `/admin/users/${d.user.id}/status`, { status: active ? "SUSPENDED" : "ACTIVE", reason }); toast(active ? "Compte suspendu et déconnecté" : "Compte réactivé"); adminDossier(id); });
    }
  };
}

async function adminStats() {
  setHeader("Activité");
  loading();
  const s = await api("GET", "/admin/stats");
  const b = s.bookingsLast30Days;
  const sum = (...k) => k.reduce((t, x) => t + (b[x] || 0), 0);
  const nn = s.nannies;
  view().innerHTML = `
    <h2>Nounous</h2>
    <div class="stats">
      <div><b>${nn.VERIFIED || 0}</b><span>vérifiées</span></div>
      <div><b>${nn.UNDER_REVIEW || 0}</b><span>dossiers à examiner</span></div>
      <div><b>${(nn.PENDING || 0) + (nn.REJECTED || 0)}</b><span>dossiers incomplets</span></div>
      <div><b>${s.parents}</b><span>familles inscrites</span></div>
    </div>
    <h2>30 derniers jours</h2>
    <div class="stats">
      <div><b>${sum("COMPLETED", "PAID_OUT")}</b><span>gardes réalisées</span></div>
      <div><b>${sum("PENDING", "CONFIRMED", "IN_PROGRESS")}</b><span>gardes à venir</span></div>
      <div><b>${sum("CANCELLED", "REFUSED", "EXPIRED")}</b><span>annulées ou refusées</span></div>
      <div><b>${s.openDisputes}</b><span>litiges ouverts</span></div>
    </div>
    <div class="stats" style="margin-top:10px">
      <div><b>${fcfa(s.revenueLast30Days.volumeXof)}</b><span>payé par les familles</span></div>
      <div><b style="color:var(--baobab)">${fcfa(s.revenueLast30Days.platformXof)}</b><span>revenu de la plateforme (frais + commission)</span></div>
    </div>
    <button class="btn danger" id="logout" style="margin-top:28px">Se déconnecter</button>`;
  $("#logout").onclick = logout;
}

/* ================================================================== */
/* Routes et demarrage                                                 */
/* ================================================================== */

/** Si le profil n'existe pas encore, on envoie vers l'inscription. */
const needProfile = (loader, onboarding, screen) => async (...args) => {
  try { await loader(); } catch (e) {
    if (e.status === 404) return onboarding();
    throw e;
  }
  return screen(...args);
};

const ROUTES = {
  PARENT: {
    "": needProfile(parentProfile, parentOnboarding, parentSearch),
    bienvenue: needProfile(parentProfile, parentOnboarding, () => go("#/")),
    nounou: needProfile(parentProfile, parentOnboarding, parentNanny),
    reserver: needProfile(parentProfile, parentOnboarding, parentBook),
    reservations: needProfile(parentProfile, parentOnboarding, parentBookings),
    profil: needProfile(parentProfile, parentOnboarding, parentAccount),
  },
  NANNY: {
    "": needProfile(nannyProfile, nannyOnboarding, nannyHome),
    bienvenue: needProfile(nannyProfile, nannyOnboarding, () => go("#/dossier")),
    dossier: needProfile(nannyProfile, nannyOnboarding, nannyDossier),
    gains: needProfile(nannyProfile, nannyOnboarding, nannyEarnings),
    profil: needProfile(nannyProfile, nannyOnboarding, nannyAccount),
  },
  ADMIN: {
    "": adminQueue,
    dossier: adminDossier,
    stats: adminStats,
  },
};

(async function start() {
  try {
    S.config = await fetch("/api/config").then((r) => r.json());
  } catch { /* valeurs par defaut */ }
  $("#demo-flag").hidden = !S.config.demo;
  await render();
})();
