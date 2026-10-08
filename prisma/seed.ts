import bcrypt from "bcryptjs";
import { PrismaClient, type BookingType } from "@prisma/client";

const prisma = new PrismaClient();

// Jeu de donnees de demonstration. Relancable sans creer de doublons (upsert par telephone).
// Tous les comptes de demo ont le mot de passe DEMO_PASSWORD.
const DEMO_PASSWORD = "demo1234";

type SeedNanny = {
  phone: string;
  email: string;
  fullName: string;
  neighborhood: string;
  rate: number;
  student: boolean;
  school?: string;
  field?: string;
  years: number;
  firstAid: boolean;
  languages: string[];
  types: BookingType[];
  bio: string;
  rating: [number, number];
  slots: [number, string, string][];
};

const weekdays = (start: string, end: string): [number, string, string][] =>
  [1, 2, 3, 4, 5].map((d) => [d, start, end]);

const nannies: SeedNanny[] = [
  {
    phone: "+221771111111", email: "fatou@nounou.test", fullName: "Fatou Ndiaye", neighborhood: "Mermoz", rate: 2500,
    student: true, school: "UCAD", field: "Lettres modernes", years: 3, firstAid: true,
    languages: ["Français", "Wolof"], types: ["PONCTUELLE", "SORTIE_ECOLE"],
    bio: "Étudiante en lettres, je garde les enfants de ma famille depuis trois ans. J'aide volontiers aux devoirs et je lis beaucoup d'histoires.",
    rating: [4.8, 12], slots: weekdays("16:00", "20:00"),
  },
  {
    phone: "+221772222222", email: "mariama@nounou.test", fullName: "Mariama Sow", neighborhood: "Ouakam", rate: 3000,
    student: false, years: 9, firstAid: true,
    languages: ["Français", "Wolof", "Pulaar"], types: ["PONCTUELLE", "REGULIERE", "NUIT"],
    bio: "Neuf ans de garde à domicile, dont quatre auprès de jumeaux. Je m'occupe aussi des bébés : biberons, siestes, bain.",
    rating: [4.9, 31], slots: [...weekdays("08:00", "12:00"), ...weekdays("12:00", "16:00"), [6, "08:00", "12:00"]],
  },
  {
    phone: "+221773333333", email: "awa@nounou.test", fullName: "Awa Diallo", neighborhood: "Mermoz", rate: 2200,
    student: true, school: "UCAD", field: "Psychologie", years: 2, firstAid: true,
    languages: ["Français", "Wolof"], types: ["PONCTUELLE", "SORTIE_ECOLE"],
    bio: "En licence de psychologie, j'ai été monitrice de colonie deux étés. Jeux calmes, devoirs, et beaucoup de patience.",
    rating: [4.6, 7], slots: [[1, "16:00", "20:00"], [3, "12:00", "16:00"], [3, "16:00", "20:00"], [6, "08:00", "12:00"]],
  },
  {
    phone: "+221775555551", email: "ndeye@nounou.test", fullName: "Ndèye Coumba Faye", neighborhood: "Sacré-Cœur", rate: 2800,
    student: false, years: 6, firstAid: false,
    languages: ["Français", "Wolof", "Sérère"], types: ["REGULIERE", "SORTIE_ECOLE"],
    bio: "Maman de deux grands enfants, j'ai travaillé six ans dans une crèche à Sacré-Cœur. Je cherche une famille pour des gardes régulières.",
    rating: [4.7, 18], slots: weekdays("12:00", "16:00"),
  },
  {
    phone: "+221775555552", email: "aissatou@nounou.test", fullName: "Aïssatou Ba", neighborhood: "Point E", rate: 2400,
    student: true, school: "ESP", field: "Génie informatique", years: 1, firstAid: true,
    languages: ["Français", "Wolof", "Anglais"], types: ["PONCTUELLE", "SORTIE_ECOLE"],
    bio: "Élève ingénieure, je peux aider en maths et en anglais. Disponible en fin d'après-midi et le samedi.",
    rating: [4.5, 4], slots: [...weekdays("16:00", "20:00"), [6, "12:00", "16:00"]],
  },
  {
    phone: "+221775555553", email: "khady@nounou.test", fullName: "Khady Mbaye", neighborhood: "Almadies", rate: 3500,
    student: false, years: 12, firstAid: true,
    languages: ["Français", "Wolof", "Anglais"], types: ["REGULIERE", "NUIT", "PONCTUELLE"],
    bio: "Douze ans auprès de familles expatriées et sénégalaises. Gardes de nuit possibles, références disponibles sur demande.",
    rating: [5, 26], slots: [...weekdays("08:00", "12:00"), [5, "20:00", "23:00"], [6, "20:00", "23:00"]],
  },
  {
    phone: "+221775555554", email: "seynabou@nounou.test", fullName: "Seynabou Gueye", neighborhood: "Liberté 6", rate: 2000,
    student: true, school: "UCAD", field: "Sciences de l'éducation", years: 2, firstAid: false,
    languages: ["Français", "Wolof"], types: ["SORTIE_ECOLE", "PONCTUELLE"],
    bio: "Future enseignante, je récupère les enfants à l'école et je les accompagne pour les devoirs jusqu'au retour des parents.",
    rating: [4.4, 5], slots: weekdays("16:00", "20:00"),
  },
  {
    phone: "+221775555555", email: "binta@nounou.test", fullName: "Binta Sarr", neighborhood: "Ouakam", rate: 2600,
    student: false, years: 5, firstAid: true,
    languages: ["Français", "Wolof"], types: ["PONCTUELLE", "SORTIE_ECOLE", "REGULIERE"],
    bio: "Cinq ans de garde dans le quartier, formée aux premiers secours par la Croix-Rouge. Calme, ponctuelle et organisée.",
    rating: [4.8, 15], slots: [...weekdays("12:00", "16:00"), ...weekdays("16:00", "20:00")],
  },
];

async function main() {
  // Mot de passe connu de tous : jamais en production reelle
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
    console.log("Production hors demo : comptes de test non crees.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const account = (phone: string, email: string, role: "ADMIN" | "NANNY" | "PARENT") => {
    const login = { email, passwordHash, emailVerifiedAt: new Date() };
    return prisma.user.upsert({ where: { phone }, update: login, create: { phone, role, ...login } });
  };

  const admin = await account("+221770000000", "equipe@nounou.test", "ADMIN");

  for (const n of nannies) {
    const user = await account(n.phone, n.email, "NANNY");
    const existing = await prisma.nannyProfile.findUnique({ where: { userId: user.id } });
    if (existing) continue;
    await prisma.nannyProfile.create({
      data: {
        userId: user.id,
        fullName: n.fullName,
        neighborhood: n.neighborhood,
        hourlyRateXof: n.rate,
        languages: n.languages,
        experienceYears: n.years,
        isStudent: n.student,
        school: n.school,
        fieldOfStudy: n.field,
        firstAidCertified: n.firstAid,
        bookingTypes: n.types,
        bio: n.bio,
        ratingAvg: n.rating[0],
        ratingCount: n.rating[1],
        verificationStatus: "VERIFIED",
        verifiedAt: new Date(),
        wallet: { create: {} },
        availabilities: { create: n.slots.map(([weekday, startTime, endTime]) => ({ weekday, startTime, endTime })) },
      },
    });
  }

  const parentUser = await account("+221774444444", "parent@nounou.test", "PARENT");
  await prisma.parentProfile.upsert({
    where: { userId: parentUser.id },
    update: {},
    create: {
      userId: parentUser.id,
      fullName: "Famille Diallo",
      neighborhood: "Mermoz",
      address: "Villa 42, Cité Mermoz",
      children: { create: [{ firstName: "Adama", birthYear: 2020 }, { firstName: "Mame Diarra", birthYear: 2023 }] },
    },
  });

  console.log(`Donnees de test inserees. Admin : ${admin.email} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
