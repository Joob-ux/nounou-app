# API — Marketplace de garde d'enfants (Dakar)

Backend Node.js / Express / TypeScript / PostgreSQL, conforme au cahier des charges.

## Démarrer

```bash
cp .env.example .env          # puis remplir JWT_SECRET
docker compose up -d          # PostgreSQL + PostGIS sur le port 5432
npm install
npx prisma migrate dev --name init
npm run seed                  # données de test
npm run dev                   # http://localhost:4000
```

En développement, le code OTP n'est pas envoyé par WhatsApp : il est affiché dans les logs du serveur.

## L'appli

Servie à la racine du serveur (`/`), sans étape de build : `public/app/` (HTML, CSS et JavaScript simples).

- **Parents** : inscription par OTP, profil famille et enfants, recherche par quartier, type de garde et profil (expérimentées / étudiantes), fiche nounou avec disponibilités et avis, réservation avec récapitulatif du prix, paiement Wave / Orange Money / Free Money / carte, suivi des réservations, annulation avec aperçu du remboursement, avis en 4 critères.
- **Nounous** : création du profil, dossier de vérification pièce par pièce (motif affiché si refus), demandes à accepter ou refuser, arrivée et fin de garde géolocalisées, gains et demande de versement, disponibilités hebdomadaires, mode examens.
- **Équipe** : file des dossiers, ouverture des pièces, validation ou refus avec motif, décision après entretien, suspension, activité sur 30 jours. Mise en page large sur ordinateur.

Le nom « Nounou » est provisoire : il se change dans `public/app/index.html` et en tête de `public/app/app.js`. La console technique reste disponible sur `/console.html` en mode démo.

## Mettre en ligne (démo sur Render)

Le fichier `render.yaml` crée l'API et la base PostgreSQL en une fois (offre gratuite).

1. Pousser ce dossier sur un dépôt GitHub (privé), **sans** `node_modules` ni `.env`.
2. Sur https://dashboard.render.com : **New → Blueprint**, choisir le dépôt, puis **Apply**.
3. Attendre la fin du déploiement (5 à 10 min), puis ouvrir l'URL `https://nounou-api-xxxx.onrender.com` : elle redirige vers la console.

Au démarrage, `render:start` crée les tables (`prisma db push`) puis charge les comptes de test (seed sans doublons).

**Mode démo** (`DEMO_MODE=true`) : aucun message WhatsApp, le code OTP est renvoyé par l'API et se remplit seul dans la console ; console et routes `/api/dev` actives. N'importe qui ayant l'URL peut se connecter, y compris en admin de test : **aucune vraie donnée**, et passer `DEMO_MODE=false` avant l'arrivée de vrais utilisateurs.

Limites de l'offre gratuite : le serveur s'endort après 15 min sans visite (≈ 1 min pour se réveiller), les pièces envoyées sont effacées à chaque redéploiement (disque non persistant), et la base gratuite Render expire au bout de 30 jours.

## Tester en local

- **Console de test** : http://localhost:4000/console.html — tout le parcours en boutons, avec le journal des requêtes et réponses.
- **Base de données** : `npx prisma studio` ouvre http://localhost:5555 pour voir les tables se remplir.
- **Routes de dev** (désactivées en production) : `POST /api/dev/payments/:id/succeed` simule le paiement, `POST /api/dev/release-now` saute l'attente de 24 h.

## Arborescence

```
prisma/schema.prisma       modèle de données complet
prisma/seed.ts             jeu de données de test
src/config/env.ts          variables d'environnement validées au démarrage
src/lib/money.ts           frais, commission, politique d'annulation
src/lib/otp.ts             génération et vérification des codes
src/lib/tokens.ts          JWT d'accès + refresh tokens hachés
src/middleware/            authentification, validation Zod, erreurs
src/lib/storage.ts         stockage des pièces (disque en dev, S3 plus tard)
src/lib/audit.ts           journal des actions du back-office
src/modules/auth/          inscription et connexion par OTP
src/modules/parents/       profil famille et enfants
src/modules/nannies/       recherche, profil nounou, disponibilités, dossier de vérification
src/modules/admin/         back-office : validation des dossiers, suspensions, stats, audit
src/modules/bookings/      réservation, check-in/out, libération des fonds
src/modules/payments/      paiement, webhook signé, portefeuille, versements
```

## Routes

| Méthode | Route | Rôle | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/otp/request` | — | Envoie un code à 6 chiffres |
| POST | `/api/auth/otp/verify` | — | Vérifie le code, crée le compte si besoin, renvoie les jetons |
| POST | `/api/auth/refresh` | — | Renouvelle l'access token |
| GET | `/api/auth/me` | connecté | Rôle, statut, `hasProfile` (sinon l'appli ouvre « compléter mon profil ») |
| POST | `/api/auth/logout` | connecté | Révoque tous les refresh tokens |
| POST / GET / PATCH | `/api/parents/me` | parent | Profil famille (création avec enfants possible) |
| POST | `/api/parents/me/children` | parent | Ajoute un enfant (0 à 14 ans, 8 max) |
| PATCH / DELETE | `/api/parents/me/children/:id` | parent | Modifie ou retire un enfant |
| GET | `/api/config` | — | Mode démo et pourcentages, lus par l'appli au démarrage |
| GET | `/api/nannies` | — | Recherche (quartier et type facultatifs), tarif, statut étudiant, premiers secours |
| GET | `/api/nannies/:id` | — | Fiche publique (jamais les pièces d'identité) |
| POST | `/api/nannies/me` | nounou | Crée le profil + le portefeuille |
| GET | `/api/nannies/me` | nounou | Profil, pièces, dispos, portefeuille et état du dossier (`dossier.canSubmit`) |
| PATCH | `/api/nannies/me` | nounou | Tarif, bio, types de garde, mode examens… (nom et statut étudiant figés après soumission) |
| PUT | `/api/nannies/me/availabilities` | nounou | Remplace les créneaux hebdo (chevauchements refusés) |
| POST | `/api/nannies/me/documents` | nounou | Envoi d'une pièce (multipart : `type` + `file`, JPG/PNG/WEBP/PDF, 5 Mo) |
| DELETE | `/api/nannies/me/documents/:id` | nounou | Retire une pièce non validée |
| POST | `/api/nannies/me/submit` | nounou | Soumet le dossier complet à l'équipe |
| GET | `/api/admin/stats` | admin | Nounous par statut, réservations et revenu sur 30 jours, litiges ouverts |
| GET | `/api/admin/nannies?status=` | admin | File d'attente des dossiers (recherche nom / téléphone / quartier) |
| GET | `/api/admin/nannies/:id` | admin | Dossier complet + checklist + historique |
| GET | `/api/admin/documents/:id/file` | admin | Ouvre une pièce (consultation journalisée) |
| POST | `/api/admin/documents/:id/review` | admin | Valide ou refuse une pièce (motif obligatoire si refus) |
| POST | `/api/admin/nannies/:id/decision` | admin | Valide (entretien confirmé, toutes pièces validées) ou refuse le profil |
| POST | `/api/admin/users/:id/status` | admin | Suspend / bannit / réactive un compte, coupe ses sessions |
| GET | `/api/admin/audit` | admin | Journal des actions |
| POST | `/api/bookings` | parent | Crée la réservation et fige le tarif |
| GET | `/api/bookings` | connecté | Réservations du parent ou missions de la nounou (téléphones échangés une fois la garde confirmée) |
| GET | `/api/bookings/:id/cancel-preview` | parent | Montant remboursé si on annule maintenant |
| POST | `/api/bookings/:id/cancel` | parent | Annule selon la politique (100 % > 24 h, 50 % du net à la nounou entre 2 et 24 h, 100 % < 2 h) |
| POST | `/api/bookings/:id/review` | parent | Avis en 4 critères après la garde, met à jour la note |
| POST | `/api/bookings/:id/respond` | nounou | Accepte ou refuse, dans les 24 h |
| POST | `/api/bookings/missions/:id/checkin` | nounou | Check-in géolocalisé |
| POST | `/api/bookings/missions/:id/checkout` | nounou | Check-out, met le net en attente |
| POST | `/api/payments/init` | parent | Crée le paiement chez l'agrégateur |
| POST | `/api/payments/webhook` | agrégateur | Signature HMAC vérifiée, idempotent |
| GET | `/api/payments/wallet` | nounou | Solde disponible et en attente |
| POST | `/api/payments/payouts` | nounou | Demande de versement Wave ou Orange Money |

## Règles métier déjà codées

- **Montants** en entiers FCFA. Frais de service 10 % payés par le parent, commission 10 % retenue sur la nounou. Le tarif horaire est figé dans la réservation : une hausse ultérieure du profil ne change pas les réservations passées.
- **Séquestre.** Le paiement passe en `ESCROW` au webhook. Le check-out crédite le net en `pendingXof`. `releaseDueFunds()` tourne toutes les 15 minutes et ne libère que les missions terminées depuis plus de 24 h et sans litige ouvert.
- **Recherche.** Seules les nounous `VERIFIED` et hors période d'examens remontent.
- **Sécurité.** Refresh tokens hachés en base, OTP haché avec bcrypt et limité en tentatives, webhook vérifié par HMAC à comparaison à temps constant, pièces d'identité jamais exposées par l'API publique.

## Vérification des nounous (4 niveaux)

1. **Identité** : CNI. 2. **Antécédents** : casier judiciaire + justificatif de domicile. 3. **Références** : au moins une attestation. 4. **Entretien** : confirmé par l'admin au moment de valider. Les étudiantes ajoutent un certificat de scolarité.

Statuts du profil : `PENDING` (dossier en cours) → `UNDER_REVIEW` (soumis, modifications bloquées) → `VERIFIED` (visible dans la recherche) ou `REJECTED` (la nounou voit le motif, corrige et re-soumet).

Les fichiers sont vérifiés par leur signature binaire (un `.exe` renommé en `.png` est refusé), stockés hors du dossier public, et chaque consultation par un admin est tracée dans `AuditLog`.

## Ce qui reste à brancher

1. **Agrégateur de paiement.** Comparer PayTech et PayDunya sur les frais et l'API de versement, puis remplir `initWithProvider()` dans `payments.routes.ts`.
2. **Envoi des codes par WhatsApp.** `sendCode()` dans `src/lib/otp.ts` est branché sur l'API WhatsApp Cloud de Meta : renseigner `WHATSAPP_TOKEN` et `WHATSAPP_PHONE_NUMBER_ID`, et faire valider un modèle « Authentification » nommé `code_connexion` (français, bouton « Copier le code »).
3. **Recherche par distance.** Activer PostGIS (`CREATE EXTENSION postgis;`) et remplacer le filtre par quartier par un rayon en kilomètres.
4. **Stockage des pièces en production.** Remplacer `saveFile` / `readFile` de `src/lib/storage.ts` par S3 (ou équivalent) chiffré. L'accès admin et l'audit sont déjà en place.
5. **Back-office (suite).** Gestion des litiges, versements à valider, interface web Next.js.
6. **Photo de profil** publique de la nounou et notifications SMS/WhatsApp des décisions de validation.
7. **Messagerie.** Socket.IO sur la conversation liée à chaque réservation, avec détection des numéros de téléphone.
