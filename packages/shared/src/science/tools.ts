import { TOOL_IDS } from "../tools/catalog";
import type { SourceId } from "./sources";

// "source": every number shown has a verified source. "heuristic": none does. "mixed": the
// parts are sourced but something Belay adds is not, and `heuristic` says what.
export type ScienceLabel = "source" | "heuristic" | "mixed";
export type ScienceContent = {
  title: string;
  brief: string; // 2–3 sentences
  keep: readonly string[]; // at most 3 bullets
  heuristic?: string; // required unless label is "source"
  formula: readonly string[];
  limits: readonly string[];
};
export type ToolScience = {
  label: ScienceLabel;
  sourceIds: readonly SourceId[];
  content: { fr: ScienceContent; en: ScienceContent };
};

// Every tool, then the rules Belay applies to tracked data (the profile's loss range).
export const SCIENCE_IDS = [...TOOL_IDS, "target-rate"] as const;
export type ScienceId = (typeof SCIENCE_IDS)[number];

export const TOOL_SCIENCE: Record<ScienceId, ToolScience> = {
  "one-rep-max": {
    label: "source",
    sourceIds: ["reynolds-2006", "brzycki-1993", "lesuer-1997", "nuzzo-2024"],
    content: {
      fr: {
        title: "1RM estimé",
        brief:
          "Plus tu enchaînes de répétitions avec une charge, plus ton maximum est élevé. Deux formules connues, Epley et Brzycki, traduisent ça en un chiffre. Belay affiche les deux côte à côte pour que tu voies l'écart.",
        keep: [
          "C'est une estimation, pas un test.",
          "Fiable jusqu'à environ 10 répétitions.",
          "Le lien entre répétitions et maximum change d'un exercice à l'autre.",
        ],
        formula: [
          "Epley : 1RM = charge × (1 + répétitions / 30)",
          "Brzycki : 1RM = charge × 36 / (37 − répétitions)",
          "Avec 1 répétition, le 1RM est la charge soulevée.",
          "Résultat arrondi à 0,5 kg.",
          "Epley (1985) est cité tel que reproduit dans Reynolds 2006 : l'ouvrage d'origine n'a pas d'identifiant vérifiable.",
        ],
        limits: [
          "Reynolds 2006 conclut qu'il ne faut pas dépasser 10 répétitions dans ces équations ; la meilleure précision vient des séries de 5 répétitions.",
          "LeSuer 1997 trouve de fortes corrélations, mais toutes les équations testées sous-estiment le soulevé de terre.",
          "Nuzzo 2024 (269 études) montre qu'on fait plus de répétitions à la presse à cuisses qu'au développé couché pour un même pourcentage du maximum : une formule unique ne convient pas à tous les exercices.",
        ],
      },
      en: {
        title: "One-rep max",
        brief:
          "The more reps you can do with a load, the higher your max. Two well-known formulas, Epley and Brzycki, turn that into a number. Belay shows both side by side so you can see the gap.",
        keep: [
          "It's an estimate, not a test.",
          "Reliable up to about 10 reps.",
          "The link between reps and max changes from one exercise to another.",
        ],
        formula: [
          "Epley: 1RM = load × (1 + reps / 30)",
          "Brzycki: 1RM = load × 36 / (37 − reps)",
          "With 1 rep, the 1RM is the load lifted.",
          "Result rounded to 0.5 kg.",
          "Epley (1985) is cited as reproduced in Reynolds 2006: the original book has no verifiable identifier.",
        ],
        limits: [
          "Reynolds 2006 concludes that no more than 10 reps should go into these equations; sets of 5 reps give the best accuracy.",
          "LeSuer 1997 finds high correlations, but every equation tested underestimates the deadlift.",
          "Nuzzo 2024 (269 studies) shows that people do more reps on the leg press than on the bench press at the same percentage of their max: one formula does not fit every exercise.",
        ],
      },
    },
  },
  plates: {
    label: "source",
    sourceIds: ["iwf-tcrr-2020"],
    content: {
      fr: {
        title: "Disques",
        brief:
          "Belay cherche la combinaison qui atteint ta charge avec le moins de disques possible, à partir de ton matériel. Si la charge exacte n'est pas faisable, tu vois la charge faisable juste en dessous et juste au-dessus.",
        keep: [
          "Le calcul suppose autant de disques de chaque poids que nécessaire.",
          "Chaque disque porte son poids écrit, en plus de sa couleur.",
          "Les colliers ne sont pas comptés.",
        ],
        formula: [
          "Par côté = (charge visée − barre) / 2",
          "Calcul en centièmes de kilo, sans erreur d'arrondi.",
          "Parmi les combinaisons possibles, celle qui utilise le moins de disques ; à nombre égal, les disques les plus lourds d'abord.",
        ],
        limits: [
          "Couleurs IWF (règle 3.3.3.6) : 25 et 2,5 kg rouge, 20 et 2 kg bleu, 15 et 1,5 kg jaune, 10 et 1 kg vert, 5 et 0,5 kg blanc.",
          "Les règles IWF ne prévoient ni disque de 1,25 kg ni couleur officielle pour lui : Belay l'affiche en gris neutre, comme toute valeur hors de cette liste.",
          "Le calcul lui-même est de l'arithmétique : il n'a pas besoin de source.",
        ],
      },
      en: {
        title: "Plates",
        brief:
          "Belay looks for the combination that reaches your load with as few plates as possible, from your own equipment. If the exact load can't be made, you see the closest loads just below and just above.",
        keep: [
          "The calculation assumes as many plates of each weight as needed.",
          "Each plate shows its weight in writing, not just its colour.",
          "Collars are not counted.",
        ],
        formula: [
          "Per side = (target load − bar) / 2",
          "Worked out in hundredths of a kilo, with no rounding error.",
          "Among the possible combinations, the one with the fewest plates; on a tie, the heaviest plates first.",
        ],
        limits: [
          "IWF colours (rule 3.3.3.6): 25 and 2.5 kg red, 20 and 2 kg blue, 15 and 1.5 kg yellow, 10 and 1 kg green, 5 and 0.5 kg white.",
          "The IWF rules have no 1.25 kg disc and no official colour for one: Belay draws it neutral grey, like any value outside this list.",
          "The calculation itself is arithmetic: it needs no source.",
        ],
      },
    },
  },
  warmup: {
    label: "heuristic",
    sourceIds: ["ribeiro-2020"],
    content: {
      fr: {
        title: "Montée en charge",
        brief:
          "Avant tes séries de travail, Belay propose 1 à 3 séries de montée, selon la charge. Chaque charge est arrondie à ce que ton matériel permet de charger.",
        keep: [
          "Aucune étude ne valide un schéma d'échauffement unique.",
          "Ajuste le nombre de séries avec − et +, de 0 à 3.",
          "Une série qui tomberait sous la barre devient « barre seule ».",
        ],
        heuristic:
          "Tout le schéma est une heuristique Belay : une progression courante, qu'aucune étude ne valide.",
        formula: [
          "Nombre par défaut : 1 série sous 60 kg, 2 séries de 60 à moins de 120 kg, 3 séries à partir de 120 kg.",
          "1 série : 60 % × 5",
          "2 séries : 50 % × 5, puis 75 % × 3",
          "3 séries : 40 % × 5, 60 % × 3, puis 80 % × 1",
          "Chaque charge est arrondie à la charge faisable la plus proche avec ton matériel, jamais sous la barre. Deux séries identiques après arrondi n'en font qu'une, et une série qui atteindrait ta charge de travail est retirée.",
        ],
        limits: [
          "Ribeiro 2020 (40 hommes entraînés) trouve qu'un échauffement avec peu de répétitions et des charges légères ne suffit pas à optimiser la performance au squat et au développé couché.",
          "C'est une seule étude, courte, qui mesure la vitesse et le travail, pas les blessures ni les effets à long terme.",
          "Le bon échauffement dépend aussi de l'exercice, de ta forme du jour et de ton expérience.",
        ],
      },
      en: {
        title: "Warm-up",
        brief:
          "Before your working sets, Belay suggests 1 to 3 ramp-up sets, depending on the load. Each load is rounded to what your equipment can load.",
        keep: [
          "No study validates a single warm-up scheme.",
          "Adjust the number of sets with − and +, from 0 to 3.",
          "A set that would fall under the bar becomes “bar only”.",
        ],
        heuristic:
          "The whole scheme is a Belay heuristic: a common progression that no study validates.",
        formula: [
          "Default count: 1 set under 60 kg, 2 sets from 60 to under 120 kg, 3 sets from 120 kg.",
          "1 set: 60 % × 5",
          "2 sets: 50 % × 5, then 75 % × 3",
          "3 sets: 40 % × 5, 60 % × 3, then 80 % × 1",
          "Each load is rounded to the closest load your equipment can make, never under the bar. Two sets that round to the same load become one, and a set that would reach your working load is dropped.",
        ],
        limits: [
          "Ribeiro 2020 (40 trained men) finds that warming up with few reps and light loads is not enough to optimise squat and bench press performance.",
          "It is a single, short study that measures velocity and work, not injuries or long-term effects.",
          "The right warm-up also depends on the exercise, how you feel that day and your experience.",
        ],
      },
    },
  },
  energy: {
    label: "mixed",
    sourceIds: ["mifflin-1990", "frankenfield-2003", "fao-2004"],
    content: {
      fr: {
        title: "Dépense énergétique",
        brief:
          "Belay estime d'abord ta dépense au repos avec l'équation de Mifflin-St Jeor, puis la multiplie par un niveau d'activité de la FAO. Le résultat est un point de départ, que tes pesées et tes apports affineront plus tard.",
        keep: [
          "Environ 1 personne sur 5 est à plus de 10 % de sa mesure réelle.",
          "La fourchette affichée est de ±10 %.",
          "Les niveaux d'activité décrivent ton mode de vie, pas un nombre de séances.",
        ],
        heuristic:
          "Chaque élément a sa source, mais aucune étude ne valide l'association de Mifflin et des niveaux d'activité : cette combinaison est une heuristique Belay.",
        formula: [
          "Dépense au repos = 10 × poids (kg) + 6,25 × taille (cm) − 5 × âge (ans) + s",
          "s = +5 avec la formule homme, −161 avec la formule femme",
          "Dépense du jour = dépense au repos × niveau d'activité, arrondie à 10 kcal",
          "Niveaux d'activité (FAO 2004) : 1,40 · 1,55 · 1,75 · 2,00",
          "Fourchette : ±10 %",
        ],
        limits: [
          "Frankenfield 2003 (130 adultes) : avec Mifflin, l'écart dépasse 10 % de la mesure chez 22 % des personnes.",
          "L'étude de Mifflin portait sur 498 adultes en bonne santé, de 19 à 78 ans.",
          "La FAO définit ses niveaux d'activité par rapport au métabolisme de base, alors que Mifflin mesure la dépense au repos : c'est proche, mais pas identique.",
          "Aucune source traçable trouvée pour les coefficients 1,2 · 1,375 · 1,55 · 1,725 · 1,9 ; la consultation FAO/OMS a jugé 1,21 trop bas et retient 1,40 comme plancher sédentaire.",
        ],
      },
      en: {
        title: "Energy expenditure",
        brief:
          "Belay first estimates your resting expenditure with the Mifflin-St Jeor equation, then multiplies it by an FAO activity level. The result is a starting point that your weigh-ins and intake will refine later.",
        keep: [
          "About 1 person in 5 is more than 10% away from their measured value.",
          "The range shown is ±10%.",
          "Activity levels describe your lifestyle, not a number of sessions.",
        ],
        heuristic:
          "Each part has a source, but no study validates pairing Mifflin with the activity levels: that combination is a Belay heuristic.",
        formula: [
          "Resting energy expenditure = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + s",
          "s = +5 with the male formula, −161 with the female formula",
          "Daily expenditure = resting energy expenditure × activity level, rounded to 10 kcal",
          "Activity levels (FAO 2004): 1.40 · 1.55 · 1.75 · 2.00",
          "Range: ±10%",
        ],
        limits: [
          "Frankenfield 2003 (130 adults): with Mifflin, the error exceeds 10% of the measured value for 22% of people.",
          "Mifflin's study covered 498 healthy adults aged 19 to 78.",
          "The FAO defines its activity levels against basal metabolism, while Mifflin measures resting expenditure: close, but not the same.",
          "No traceable source found for the coefficients 1.2 · 1.375 · 1.55 · 1.725 · 1.9; the FAO/WHO consultation judged 1.21 too low and keeps 1.40 as the sedentary floor.",
        ],
      },
    },
  },
  protein: {
    label: "mixed",
    sourceIds: ["jager-2017", "morton-2018", "helms-2014-ijsnem"],
    content: {
      fr: {
        title: "Protéines",
        brief:
          "Tes besoins en protéines dépendent de ton objectif. Belay reprend une fourchette publiée pour chacun, maintien, prise et sèche, puis la répartit sur 3 ou 4 repas.",
        keep: [
          "En sèche, la fourchette se calcule sur ta masse maigre, pas sur ton poids.",
          "Ajouter ta masse grasse rend la fourchette de sèche plus juste.",
          "C'est une fourchette, pas un chiffre exact à atteindre chaque jour.",
        ],
        heuristic:
          "Les trois fourchettes ont leur source. Deux garde-fous sont des heuristiques Belay : sans masse grasse, la sèche utilise 1,8 à 2,5 g par kg de poids ; et en sèche, la fourchette ne descend jamais sous 1,6 g par kg de poids.",
        formula: [
          "Maintien : 1,4 à 2,0 g par kg de poids (Jäger 2017)",
          "Prise : 1,6 à 2,2 g par kg de poids (Morton 2018)",
          "Sèche : 2,3 à 3,1 g par kg de masse maigre (Helms 2014), avec masse maigre = poids × (1 − masse grasse)",
          "Arrondi à 5 g (vers le haut pour le plancher de 1,6 g par kg en sèche) ; par repas, calculé depuis la fourchette du jour affichée, divisée par 3 ou par 4 : le bas arrondi vers le haut, le haut vers le bas, à 5 g",
        ],
        limits: [
          "Morton 2018 situe le plateau à 1,62 g par kg et par jour (intervalle de confiance 1,03 à 2,20). L'étude portait sur des suppléments pendant l'entraînement, pas sur des périodes de déficit.",
          "Helms 2014 repose sur 6 études chez des athlètes minces et entraînés en force. Il conseille de monter dans la fourchette quand le déficit est plus marqué et la masse grasse plus basse.",
          "La position de l'ISSN (Jäger 2017) écrit 2,3 à 3,1 g par kg de poids, mais sa source, Helms 2014, l'exprime par kg de masse maigre : Belay suit Helms.",
        ],
      },
      en: {
        title: "Protein",
        brief:
          "How much protein you need depends on your goal. Belay uses a published range for each one, maintain, gain and cut, then splits it over 3 or 4 meals.",
        keep: [
          "When cutting, the range is worked out from your lean mass, not your weight.",
          "Adding your body fat makes the cut range more accurate.",
          "It's a range, not an exact number to hit every day.",
        ],
        heuristic:
          "The three ranges have sources. Two guards are Belay heuristics: without a body-fat value, a cut uses 1.8 to 2.5 g per kg of body weight; and when cutting, the range never drops below 1.6 g per kg of body weight.",
        formula: [
          "Maintain: 1.4 to 2.0 g per kg of body weight (Jäger 2017)",
          "Gain: 1.6 to 2.2 g per kg of body weight (Morton 2018)",
          "Cut: 2.3 to 3.1 g per kg of lean mass (Helms 2014), with lean mass = weight × (1 − body fat)",
          "Rounded to 5 g (up for the 1.6 g per kg cut floor); per meal, worked out from the daily range shown, divided by 3 or by 4: the low end rounded up, the high end down, to 5 g",
        ],
        limits: [
          "Morton 2018 puts the plateau at 1.62 g per kg per day (confidence interval 1.03 to 2.20). The study looked at supplements during training, not at periods of deficit.",
          "Helms 2014 rests on 6 studies of lean, strength-trained athletes. It advises moving up the range as the deficit gets steeper and body fat gets lower.",
          "The ISSN position stand (Jäger 2017) writes 2.3 to 3.1 g per kg of body weight, but its source, Helms 2014, gives it per kg of lean mass: Belay follows Helms.",
        ],
      },
    },
  },
  projection: {
    label: "mixed",
    sourceIds: ["garthe-2011", "helms-2014-jissn", "hall-2011"],
    content: {
      fr: {
        title: "Projection",
        brief:
          "Belay calcule combien de semaines il te faut pour atteindre ton objectif en perdant chaque semaine un pourcentage de ton poids du moment. Le résultat est une fourchette de dates, parce que la perte ralentit à mesure que tu perds du poids.",
        keep: [
          "Les études recommandent un rythme de 0,5 à 1 % du poids par semaine.",
          "Chez des athlètes, un rythme plus rapide (≈ 1 %/semaine) s'est accompagné de moins de gain de masse maigre (Garthe 2011).",
          "Refais le calcul avec ton poids moyen à chaque pesée.",
        ],
        heuristic:
          "La marge de 30 % qui donne la date la plus tardive n'a pas de source : toute la fourchette de dates est une heuristique Belay.",
        formula: [
          "Semaines (basse) = ⌈ ln(objectif / poids actuel) / ln(1 − rythme) ⌉",
          "Semaines (haute) = ⌈ 1,3 × semaines (basse) ⌉",
          "Dates = aujourd'hui + semaines (basse), et aujourd'hui + semaines (haute)",
          "Le rythme est un pourcentage de ton poids du moment : les kilos perdus chaque semaine diminuent avec le temps.",
        ],
        limits: [
          "Garthe 2011 (24 athlètes de haut niveau) : à 0,7 % par semaine, la masse maigre augmente ; le groupe qui visait 1,4 % a réellement perdu 1,0 % par semaine et n'a pas gagné de masse maigre.",
          "Helms 2014 recommande 0,5 à 1 % du poids par semaine pour préparer une compétition de culturisme naturel.",
          "Hall 2011 montre que le poids répond lentement à un changement d'apport, avec une demi-vie d'environ un an : ça explique le ralentissement, mais ça ne chiffre pas la marge.",
          "La projection ne calcule qu'une perte de poids.",
        ],
      },
      en: {
        title: "Projection",
        brief:
          "Belay works out how many weeks you need to reach your goal if you lose a percentage of your current weight each week. The result is a range of dates, because the loss slows down as you lose weight.",
        keep: [
          "Studies recommend a pace of 0.5 to 1% of body weight per week.",
          "In athletes, a faster pace (≈ 1%/week) came with less lean-mass gain (Garthe 2011).",
          "Run it again with your average weight at each weigh-in.",
        ],
        heuristic:
          "The 30% margin that gives the later date has no source: the whole date range is a Belay heuristic.",
        formula: [
          "Weeks (low) = ⌈ ln(goal / current weight) / ln(1 − pace) ⌉",
          "Weeks (high) = ⌈ 1.3 × weeks (low) ⌉",
          "Dates = today + weeks (low), and today + weeks (high)",
          "The pace is a percentage of your current weight: the kilos lost each week shrink over time.",
        ],
        limits: [
          "Garthe 2011 (24 elite athletes): at 0.7% per week, lean mass went up; the group aiming for 1.4% actually lost 1.0% per week and gained no lean mass.",
          "Helms 2014 recommends 0.5 to 1% of body weight per week to prepare a natural bodybuilding contest.",
          "Hall 2011 shows that body weight responds slowly to a change in intake, with a half-time of about a year: that explains the slowdown, but it does not size the margin.",
          "The projection only works out a weight loss.",
        ],
      },
    },
  },
  bmi: {
    label: "source",
    sourceIds: ["who-trs-894", "ode-2007"],
    content: {
      fr: {
        title: "IMC",
        brief:
          "L'IMC divise ton poids par ta taille au carré. L'OMS s'en sert pour classer les adultes en plages, les mêmes à tout âge et pour les deux sexes.",
        keep: [
          "L'IMC ne distingue pas le muscle de la graisse.",
          "C'est un repère de population, pas un diagnostic.",
          "Chez les personnes musclées, il surestime souvent la masse grasse.",
        ],
        formula: [
          "IMC = poids (kg) / taille (m)²",
          "Affiché à 0,1 près ; la plage est choisie sur la valeur affichée.",
          "Plages de l'OMS : moins de 18,5 · 18,5 à 25 · 25 à 30 · 30 et plus. 25,0 appartient à 25 – 30.",
          "Belay suggère d'en parler à un professionnel de santé sous 18,5 et à partir de 35 (obésité de classe II, OMS TRS 894).",
        ],
        limits: [
          "L'OMS écrit elle-même que l'IMC ne distingue pas le poids lié au muscle du poids lié à la graisse.",
          "Ode 2007 (226 athlètes, 213 non-athlètes) : un IMC de 25 ou plus désigne souvent à tort un excès de graisse chez les athlètes ; les auteurs appellent à la prudence.",
          "Une même valeur d'IMC ne correspond pas à la même masse grasse dans toutes les populations.",
          "Les noms des plages dans Belay sont descriptifs ; ils ne reprennent pas les termes de l'OMS.",
        ],
      },
      en: {
        title: "BMI",
        brief:
          "BMI divides your weight by your height squared. The WHO uses it to sort adults into ranges, the same at every age and for both sexes.",
        keep: [
          "BMI doesn't tell muscle from fat.",
          "It's a population marker, not a diagnosis.",
          "In muscular people, it often overstates body fat.",
        ],
        formula: [
          "BMI = weight (kg) / height (m)²",
          "Shown to 0.1; the range is picked from the value shown.",
          "WHO ranges: under 18.5 · 18.5 to 25 · 25 to 30 · 30 and over. 25.0 belongs to 25 – 30.",
          "Belay suggests talking to a health professional below 18.5 and from 35 (WHO TRS 894 obesity class II).",
        ],
        limits: [
          "The WHO itself writes that BMI does not distinguish weight from muscle and weight from fat.",
          "Ode 2007 (226 athletes, 213 non-athletes): a BMI of 25 or more often wrongly flags excess fat in athletes; the authors call for caution.",
          "The same BMI does not mean the same body fat in every population.",
          "The range names in Belay are descriptive; they do not reuse the WHO's terms.",
        ],
      },
    },
  },
  "body-fat": {
    label: "source",
    sourceIds: [
      "hodgdon-beckett-1984-men",
      "hodgdon-beckett-1984-women",
      "hodgdon-friedl-1999",
      "dodi-1308-3",
      "potter-2022",
      "gallagher-2000",
    ],
    content: {
      fr: {
        title: "Masse grasse",
        brief:
          "La méthode de la marine américaine estime ta masse grasse à partir de ta taille et de quelques tours mesurés au mètre ruban. Belay compare ensuite le résultat à des repères publiés selon l'âge et la formule.",
        keep: [
          "C'est une estimation, à environ 4 points près.",
          "Elle surestime souvent les personnes minces et sous-estime les personnes à forte masse grasse.",
          "Mesure toujours au même endroit, ruban à plat, sans serrer.",
        ],
        formula: [
          "Formule homme : % = 86,010 × log10(taille au nombril − cou) − 70,041 × log10(taille) + 30,295",
          "Formule femme : % = 163,205 × log10(taille au plus fin + hanches − cou) − 97,684 × log10(taille) − 104,912",
          "Toutes les mesures en cm ; résultat arrondi à l'entier (DoDI 1308.3).",
          "Ces constantes en cm sont la conversion exacte de celles en pouces de la DoDI 1308.3 (36,76 et −78,387).",
          "Où mesurer : le cou juste sous la pomme d'Adam ; la taille au nombril (formule homme) ou à l'endroit le plus fin (formule femme) ; les hanches à l'endroit le plus large.",
          "Repères : Gallagher 2000, tableau 4 (standard) ou tableau 5 (personnes d'origine asiatique), pour 20–39, 40–59 et 60–79 ans.",
        ],
        limits: [
          "Dans les rapports d'origine (602 hommes, 214 femmes, comparés à la pesée hydrostatique), l'erreur type est d'environ 3,5 à 3,7 points ; des écarts individuels de 8 points ne sont pas rares.",
          "Potter 2022 (Marines américains, comparés au DXA) : les personnes minces sont surestimées, celles à forte masse grasse sous-estimées.",
          "Le « ±1 % » de la DoDI mesure l'accord entre mesureurs entraînés, pas la justesse.",
          "L'article ne nomme pas de plages de masse grasse : il donne la masse grasse correspondant à un IMC de 18,5, 25 et 30. Belay les présente ainsi, sans étiquette.",
          "Le tableau 5 a été établi sur des personnes vivant au Japon.",
          "L'article précise que ce ne sont pas des plages définitives, et que les repères aux IMC bas ont de larges intervalles de confiance : ce sont des repères provisoires.",
        ],
      },
      en: {
        title: "Body fat",
        brief:
          "The US Navy method estimates your body fat from your height and a few girths taken with a tape measure. Belay then compares the result with published reference values for your age and formula.",
        keep: [
          "It's an estimate, within about 4 points.",
          "It often overestimates lean people and underestimates people with more body fat.",
          "Always measure at the same spot, tape flat, without pulling tight.",
        ],
        formula: [
          "Male formula: % = 86.010 × log10(waist at the navel − neck) − 70.041 × log10(height) + 30.295",
          "Female formula: % = 163.205 × log10(waist at the narrowest + hips − neck) − 97.684 × log10(height) − 104.912",
          "All measurements in cm; result rounded to a whole number (DoDI 1308.3).",
          "These centimetre constants are the exact conversion of the inch constants in DoDI 1308.3 (36.76 and −78.387).",
          "Where to measure: the neck just below the Adam's apple; the waist at the navel (male formula) or at its narrowest (female formula); the hips at their widest.",
          "Reference values: Gallagher 2000, table 4 (standard) or table 5 (people of Asian origin), for ages 20–39, 40–59 and 60–79.",
        ],
        limits: [
          "In the original reports (602 men, 214 women, checked against underwater weighing), the standard error is about 3.5 to 3.7 points; individual errors of 8 points are not rare.",
          "Potter 2022 (US Marines, checked against DXA): lean people are overestimated and people with more body fat underestimated.",
          "The “±1%” in the DoDI measures agreement between trained measurers, not accuracy.",
          "The paper does not name body-fat ranges: it gives the body fat matching a BMI of 18.5, 25 and 30. Belay presents them that way, without a label.",
          "Table 5 was built from people living in Japan.",
          "The paper states that these are not definitive ranges, and that the values at low BMIs have wide confidence intervals: they are provisional reference values.",
        ],
      },
    },
  },
  "target-rate": {
    label: "source",
    sourceIds: ["helms-2014-jissn", "garthe-2011"],
    content: {
      fr: {
        title: "Fourchette de perte",
        brief:
          "Ta fourchette dit à quel rythme tu veux perdre, en pourcentage de ton poids moyen par semaine. Belay s'en sert pour écrire « dans ta fourchette » à côté de ta perte par semaine. Elle va de 0,5 à 1 % par défaut, comme le recommandent les études.",
        keep: [
          "Les études recommandent un rythme de 0,5 à 1 % du poids par semaine.",
          "Chez des athlètes, un rythme plus rapide (≈ 1 %/semaine) s'est accompagné de moins de gain de masse maigre (Garthe 2011).",
          "Belay ne propose pas plus de 1 % par semaine.",
        ],
        formula: [
          "Perte par semaine = (moyenne de la semaine d'avant − moyenne de la semaine) / moyenne de la semaine d'avant × 100",
          "« Dans ta fourchette » quand cette perte, arrondie au dixième, est entre ton minimum et ton maximum.",
        ],
        limits: [
          "Helms 2014 recommande 0,5 à 1 % du poids par semaine pour préparer une compétition de culturisme naturel.",
          "Garthe 2011 (24 athlètes de haut niveau) : à 0,7 % par semaine, la masse maigre augmente ; le groupe qui visait 1,4 % a réellement perdu 1,0 % par semaine et n'a pas gagné de masse maigre.",
          "Ces deux sources portent sur des athlètes entraînés.",
        ],
      },
      en: {
        title: "Loss range",
        brief:
          "Your range says how fast you want to lose, as a percentage of your average weight per week. Belay uses it to write “in your range” next to your loss per week. It runs from 0.5 to 1% by default, as studies recommend.",
        keep: [
          "Studies recommend a pace of 0.5 to 1% of body weight per week.",
          "In athletes, a faster pace (≈ 1%/week) came with less lean-mass gain (Garthe 2011).",
          "Belay offers no more than 1% per week.",
        ],
        formula: [
          "Loss per week = (average of the week before − average of the week) / average of the week before × 100",
          "“In your range” when that loss, rounded to the tenth, lies between your minimum and your maximum.",
        ],
        limits: [
          "Helms 2014 recommends 0.5 to 1% of body weight per week to prepare a natural bodybuilding contest.",
          "Garthe 2011 (24 elite athletes): at 0.7% per week, lean mass went up; the group aiming for 1.4% actually lost 1.0% per week and gained no lean mass.",
          "Both sources studied trained athletes.",
        ],
      },
    },
  },
};
