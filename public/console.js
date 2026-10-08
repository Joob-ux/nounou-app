const API = "/api";
let token = null;
let user = null;

const $ = (id) => document.getElementById(id);
const fcfa = (n) => n.toLocaleString("fr-FR") + " F";

function journal(method, path, body, status, data) {
  const j = $("journal");
  const bloc = document.createElement("div");
  const ok = status < 400;
  bloc.innerHTML = `<div class="req">${method} ${path}</div>` +
    (body ? `<pre>→ ${escapeHtml(JSON.stringify(body, null, 2))}</pre>` : "") +
    `<pre class="${ok ? "ok" : "ko"}">← ${status} ${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  j.appendChild(bloc);
  j.scrollTop = j.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  journal(method, path, body, res.status, data);
  if (!res.ok) throw new Error(data?.error?.message || "Erreur " + res.status);
  return data;
}

async function callForm(path, form) {
  const res = await fetch(API + path, { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
  const data = await res.json().catch(() => null);
  journal("POST", path, Object.fromEntries([...form.entries()].map(([k, v]) => [k, v instanceof File ? `[fichier ${v.name}]` : v])), res.status, data);
  if (!res.ok) throw new Error(data?.error?.message || "Erreur " + res.status);
  return data;
}

async function ouvrirFichier(path) {
  const res = await fetch(API + path, { headers: { Authorization: "Bearer " + token } });
  journal("GET", path, null, res.status, res.ok ? "[fichier]" : await res.clone().json().catch(() => null));
  if (!res.ok) throw new Error("Erreur " + res.status);
  window.open(URL.createObjectURL(await res.blob()), "_blank");
}

const essayer = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { alert(e.message); }
};

function majSession(hasProfile) {
  $("session").textContent = user
    ? `${user.role} · ${user.phone}${hasProfile === false ? " · profil à compléter" : ""}`
    : "Non connecté";
  $("secParent").classList.toggle("cache", user?.role !== "PARENT");
  $("secNanny").classList.toggle("cache", user?.role !== "NANNY");
  $("secAdmin").classList.toggle("cache", user?.role !== "ADMIN");
}

/* 1. Connexion */
document.querySelectorAll("[data-tel]").forEach((el) =>
  el.addEventListener("click", () => { $("tel").value = el.dataset.tel; }));

$("btnOtp").addEventListener("click", essayer(async () => {
  const r = await call("POST", "/auth/otp/request", { phone: $("tel").value });
  if (r.devCode) $("code").value = r.devCode; // mode demo : pas de SMS
  $("code").focus();
}));

$("btnVerify").addEventListener("click", essayer(async () => {
  const r = await call("POST", "/auth/otp/verify", { phone: $("tel").value, code: $("code").value.trim(), role: $("role").value });
  token = r.accessToken;
  user = r.user;
  majSession(r.hasProfile);
  ["pVue", "nVue", "aListe", "aDossier", "reservations", "wallet"].forEach((id) => { $(id).innerHTML = ""; });
}));

$("btnLogout").addEventListener("click", essayer(async () => {
  if (token) await call("POST", "/auth/logout");
  token = null; user = null; majSession();
}));

/* 2. Recherche */
$("btnSearch").addEventListener("click", essayer(async () => {
  const q = new URLSearchParams({ neighborhood: $("quartier").value, type: $("type").value });
  const r = await call("GET", "/nannies?" + q);
  $("resultats").innerHTML = r.items.length ? r.items.map((n) => `
    <div class="item"><b>${escapeHtml(n.fullName)}</b> · ${escapeHtml(n.neighborhood)} · ${fcfa(n.hourlyRateXof)}/h
      ${n.isStudent ? " · étudiante" : ""}
      <div class="actions"><button class="clair" data-choisir="${n.id}" data-nom="${escapeHtml(n.fullName)}">Choisir</button></div>
    </div>`).join("") : '<p class="aide">Aucun résultat.</p>';
}));

$("resultats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-choisir]");
  if (!b) return;
  $("nannyId").value = b.dataset.choisir;
  $("nannyId").title = b.dataset.nom;
});

/* 3. Réservation + paiement simulé */
const demain = new Date(Date.now() + 86_400_000);
demain.setHours(16, 0, 0, 0);
$("startAt").value = new Date(demain.getTime() - demain.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

$("btnBook").addEventListener("click", essayer(async () => {
  const booking = await call("POST", "/bookings", {
    nannyId: $("nannyId").value,
    type: $("type").value,
    startAt: new Date($("startAt").value).toISOString(),
    hours: Number($("hours").value),
    address: $("address").value,
  });
  const pay = await call("POST", "/payments/init", { bookingId: booking.id, method: $("method").value });
  await call("POST", `/dev/payments/${pay.paymentId}/succeed`);
  await lister();
}));

/* 4. Réservations */
async function lister() {
  const list = await call("GET", "/bookings");
  $("reservations").innerHTML = list.length ? list.map((b) => {
    const m = b.missions[0];
    let actions = "";
    if (user?.role === "NANNY") {
      if (b.status === "PENDING") actions = `<button class="vert" data-accept="${b.id}">Accepter</button><button class="clair" data-refuse="${b.id}">Refuser</button>`;
      if (b.status === "CONFIRMED") actions = `<button class="vert" data-checkin="${m.id}">Check-in</button>`;
      if (b.status === "IN_PROGRESS") actions = `<button class="vert" data-checkout="${m.id}">Check-out</button>`;
    }
    return `<div class="item">
      <b>${escapeHtml(b.nanny.fullName)}</b> pour ${escapeHtml(b.parent.fullName)} · <span class="statut">${b.status}</span><br>
      ${new Date(b.startAt).toLocaleString("fr-FR")} · ${b.hours} h · total ${fcfa(b.totalXof)} · net nounou ${fcfa(b.amountXof - b.commissionXof)}
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </div>`;
  }).join("") : '<p class="aide">Aucune réservation.</p>';
}

$("btnList").addEventListener("click", essayer(lister));

$("reservations").addEventListener("click", essayer(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.accept) await call("POST", `/bookings/${b.dataset.accept}/respond`, { accept: true });
  if (b.dataset.refuse) await call("POST", `/bookings/${b.dataset.refuse}/respond`, { accept: false });
  if (b.dataset.checkin) await call("POST", `/bookings/missions/${b.dataset.checkin}/checkin`, {});
  if (b.dataset.checkout) await call("POST", `/bookings/missions/${b.dataset.checkout}/checkout`, {});
  await lister();
}));

$("btnRelease").addEventListener("click", essayer(async () => {
  await call("POST", "/dev/release-now");
  await lister();
}));

/* 5. Portefeuille */
$("btnWallet").addEventListener("click", essayer(async () => {
  const w = await call("GET", "/payments/wallet");
  $("wallet").innerHTML = `<div class="item">Disponible : <b>${fcfa(w.balanceXof)}</b> · En attente : <b>${fcfa(w.pendingXof)}</b></div>`;
}));

/* Profil parent */
function afficherParent(p) {
  $("pVue").innerHTML = `<div class="item"><b>${escapeHtml(p.fullName)}</b> · ${escapeHtml(p.neighborhood)}
    ${p.children.map((c) => `<div class="ligne">${escapeHtml(c.firstName)} · né(e) en ${c.birthYear}
      <button class="clair" data-supprenfant="${c.id}">Retirer</button></div>`).join("") || '<p class="aide">Aucun enfant.</p>'}
  </div>`;
}

const enfant = () => ({ firstName: $("eNom").value, birthYear: Number($("eAnnee").value) });

$("btnPCreate").addEventListener("click", essayer(async () => {
  afficherParent(await call("POST", "/parents/me", { fullName: $("pNom").value, neighborhood: $("pQuartier").value, children: [enfant()] }));
}));
$("btnPChild").addEventListener("click", essayer(async () => {
  await call("POST", "/parents/me/children", enfant());
  afficherParent(await call("GET", "/parents/me"));
}));
$("btnPGet").addEventListener("click", essayer(async () => afficherParent(await call("GET", "/parents/me"))));
$("pVue").addEventListener("click", essayer(async (e) => {
  const b = e.target.closest("[data-supprenfant]");
  if (!b) return;
  await call("DELETE", `/parents/me/children/${b.dataset.supprenfant}`);
  afficherParent(await call("GET", "/parents/me"));
}));

/* Profil nounou + dossier */
const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

function afficherNounou(n) {
  const d = n.dossier;
  $("nVue").innerHTML = `<div class="item">
    <b>${escapeHtml(n.fullName)}</b> · ${escapeHtml(n.neighborhood)} · ${fcfa(n.hourlyRateXof)}/h
    · statut <span class="pastille ${n.verificationStatus}">${n.verificationStatus}</span><br>
    <span class="aide">Dispos : ${n.availabilities.map((a) => `${JOURS[a.weekday]} ${a.startTime}–${a.endTime}`).join(", ") || "aucune"}</span>
    <div style="margin-top:8px">${d.items.map((i) => `<div class="ligne">${escapeHtml(i.label)}
      <span><span class="pastille ${i.status}">${i.status}</span>${i.note ? ` <span class="aide">${escapeHtml(i.note)}</span>` : ""}</span></div>`).join("")}</div>
    ${d.missingFields.length ? `<p class="aide">À compléter : ${escapeHtml(d.missingFields.join(", "))}</p>` : ""}
    <p class="aide">${d.canSubmit ? "✅ Dossier prêt à être soumis." : ""}</p>
  </div>`;
}

const formNounou = () => ({
  fullName: $("nNom").value,
  neighborhood: $("nQuartier").value,
  hourlyRateXof: Number($("nTarif").value),
  isStudent: $("nEtudiante").checked,
  ...($("nEtudiante").checked ? { school: $("nEcole").value } : {}),
  bio: $("nBio").value,
  bookingTypes: [...document.querySelectorAll(".nType:checked")].map((c) => c.value),
});

$("btnNCreate").addEventListener("click", essayer(async () => afficherNounou(await call("POST", "/nannies/me", formNounou()))));
$("btnNSave").addEventListener("click", essayer(async () => {
  const { fullName, isStudent, ...modifiable } = formNounou();
  afficherNounou(await call("PATCH", "/nannies/me", modifiable));
}));
$("btnNDispo").addEventListener("click", essayer(async () => {
  await call("PUT", "/nannies/me/availabilities", { slots: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "16:00", endTime: "19:00" })) });
  afficherNounou(await call("GET", "/nannies/me"));
}));
$("btnDoc").addEventListener("click", essayer(async () => {
  const f = $("docFile").files[0];
  if (!f) throw new Error("Choisis un fichier");
  const form = new FormData();
  form.append("type", $("docType").value);
  form.append("file", f);
  await callForm("/nannies/me/documents", form);
  $("docFile").value = "";
  const sel = $("docType");
  if (sel.selectedIndex < sel.options.length - 1) sel.selectedIndex++;
  afficherNounou(await call("GET", "/nannies/me"));
}));
$("btnNGet").addEventListener("click", essayer(async () => afficherNounou(await call("GET", "/nannies/me"))));
$("btnSubmit").addEventListener("click", essayer(async () => afficherNounou(await call("POST", "/nannies/me/submit"))));

/* Back-office */
async function listerDossiers() {
  const r = await call("GET", "/admin/nannies?status=" + $("aStatut").value);
  $("aListe").innerHTML = r.items.length ? r.items.map((n) => `<div class="item">
    <b>${escapeHtml(n.fullName)}</b> · ${escapeHtml(n.neighborhood)} · ${escapeHtml(n.user.phone)}${n.isStudent ? " · étudiante" : ""}
    · ${n._count.documents} pièce(s)
    <div class="actions"><button class="clair" data-dossier="${n.id}">Ouvrir le dossier</button></div></div>`).join("")
    : '<p class="aide">Aucun dossier.</p>';
}

async function ouvrirDossier(id) {
  const d = await call("GET", "/admin/nannies/" + id);
  $("aDossier").innerHTML = `<div class="item" style="border-color:var(--nuit)">
    <b>${escapeHtml(d.fullName)}</b> · <span class="pastille ${d.verificationStatus}">${d.verificationStatus}</span><br>
    <span class="aide">${escapeHtml(d.user.phone)} · ${escapeHtml(d.neighborhood)} · ${fcfa(d.hourlyRateXof)}/h${d.isStudent ? " · " + escapeHtml(d.school || "") : ""}</span>
    <p>${escapeHtml(d.bio || "")}</p>
    ${d.documents.map((doc) => `<div class="ligne">${escapeHtml(doc.label)} <span class="pastille ${doc.status}">${doc.status}</span>
      <span class="actions" style="margin:0">
        <button class="clair" data-voir="${doc.id}">Voir</button>
        <button class="vert" data-valdoc="${doc.id}">Valider</button>
        <button class="clair" data-refdoc="${doc.id}">Refuser</button>
      </span></div>`).join("") || '<p class="aide">Aucune pièce.</p>'}
    <div class="actions">
      <button class="vert" data-approuver="${d.id}">Valider le profil (entretien fait)</button>
      <button class="clair" data-rejeter="${d.id}">Refuser le profil</button>
      <button class="clair" data-suspendre="${d.user.id}">${d.user.status === "ACTIVE" ? "Suspendre le compte" : "Réactiver le compte"}</button>
    </div>
    <p class="aide">Historique : ${d.history.map((h) => escapeHtml(h.action)).join(" ← ") || "—"}</p>
  </div>`;
  $("aDossier").dataset.id = id;
  $("aDossier").dataset.userStatus = d.user.status;
}

$("btnAList").addEventListener("click", essayer(listerDossiers));
$("btnAStats").addEventListener("click", essayer(async () => {
  const s = await call("GET", "/admin/stats");
  $("aDossier").innerHTML = `<div class="item">Parents : <b>${s.parents}</b> · Nounous : ${Object.entries(s.nannies).map(([k, v]) => `${k} ${v}`).join(", ") || "0"}<br>
    Volume 30 j : <b>${fcfa(s.revenueLast30Days.volumeXof)}</b> · Revenu plateforme : <b>${fcfa(s.revenueLast30Days.platformXof)}</b> · Litiges ouverts : ${s.openDisputes}</div>`;
}));
$("aListe").addEventListener("click", essayer(async (e) => {
  const b = e.target.closest("[data-dossier]");
  if (b) await ouvrirDossier(b.dataset.dossier);
}));
$("aDossier").addEventListener("click", essayer(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const id = $("aDossier").dataset.id;
  if (b.dataset.voir) return ouvrirFichier(`/admin/documents/${b.dataset.voir}/file`);
  if (b.dataset.valdoc) await call("POST", `/admin/documents/${b.dataset.valdoc}/review`, { status: "VERIFIED" });
  if (b.dataset.refdoc) {
    const note = prompt("Motif du refus (visible par la nounou) :", "Document illisible, merci de renvoyer une photo nette");
    if (!note) return;
    await call("POST", `/admin/documents/${b.dataset.refdoc}/review`, { status: "REJECTED", note });
  }
  if (b.dataset.approuver) await call("POST", `/admin/nannies/${b.dataset.approuver}/decision`, { decision: "VERIFIED", interviewDone: true });
  if (b.dataset.rejeter) {
    const note = prompt("Motif du refus du profil :", "Références non concluantes");
    if (!note) return;
    await call("POST", `/admin/nannies/${b.dataset.rejeter}/decision`, { decision: "REJECTED", note });
  }
  if (b.dataset.suspendre) {
    const actif = $("aDossier").dataset.userStatus === "ACTIVE";
    const reason = prompt("Motif :", actif ? "Plainte d'un parent en cours d'examen" : "Vérification terminée");
    if (!reason) return;
    await call("POST", `/admin/users/${b.dataset.suspendre}/status`, { status: actif ? "SUSPENDED" : "ACTIVE", reason });
  }
  await ouvrirDossier(id);
  await listerDossiers();
}));
