# The science behind Belay's tools

Generated from `packages/shared/src/science`. Do not edit by hand: run `pnpm science:doc`.

Each tool in Belay, and each rule it applies to what you track, shows its formula, its sources and its limits. Every reference below was checked on the date shown, against its DOI or a stable identifier on an authoritative record; where a copy rather than the official host was read, the entry says so. What has no source is labelled "Belay heuristic".

## One-rep max

**Label:** Scientific source

The more reps you can do with a load, the higher your max. Two well-known formulas, Epley and Brzycki, turn that into a number. Belay shows both side by side so you can see the gap.

**Keep in mind**

- It's an estimate, not a test.
- Reliable up to about 10 reps.
- The link between reps and max changes from one exercise to another.

**Formula**

- Epley: 1RM = load × (1 + reps / 30)
- Brzycki: 1RM = load × 36 / (37 − reps)
- With 1 rep, the 1RM is the load lifted.
- Result rounded to 0.5 kg.
- Epley (1985) is cited as reproduced in Reynolds 2006: the original book has no verifiable identifier.

**Limits**

- Reynolds 2006 concludes that no more than 10 reps should go into these equations; sets of 5 reps give the best accuracy.
- LeSuer 1997 finds high correlations, but every equation tested underestimates the deadlift.
- Nuzzo 2024 (269 studies) shows that people do more reps on the leg press than on the bench press at the same percentage of their max: one formula does not fit every exercise.

**Sources**

- Reynolds et al. 2006. Prediction of one repetition maximum strength from multiple repetition maximum testing and anthropometry. _J Strength Cond Res. 2006;20(3):584–592._ [doi:10.1519/R-15304.1](https://doi.org/10.1519/R-15304.1) · [PMID 16937972](https://pubmed.ncbi.nlm.nih.gov/16937972/) (DOI verified on 2026-09-30.)
- Brzycki M 1993. Strength testing—predicting a one-rep max from reps-to-fatigue. _Journal of Physical Education, Recreation & Dance. 1993;64(1):88–90._ [doi:10.1080/07303084.1993.10606684](https://doi.org/10.1080/07303084.1993.10606684) (DOI verified on 2026-09-30.)
- LeSuer et al. 1997. The accuracy of prediction equations for estimating 1-RM performance in the bench press, squat, and deadlift. _J Strength Cond Res. 1997;11(4):211–213._ [doi:10.1519/00124278-199711000-00001](https://doi.org/10.1519/00124278-199711000-00001) (DOI verified on 2026-09-30.)
- Nuzzo et al. 2024. Maximal number of repetitions at percentages of the one repetition maximum: a meta-regression and moderator analysis of sex, age, training status, and exercise. _Sports Med. 2024;54(2):303–321._ [doi:10.1007/s40279-023-01937-7](https://doi.org/10.1007/s40279-023-01937-7) · [PMID 37792272](https://pubmed.ncbi.nlm.nih.gov/37792272/) (DOI verified on 2026-09-30.)

## Plates

**Label:** Scientific source

Belay looks for the combination that reaches your load with as few plates as possible, from your own equipment. If the exact load can't be made, you see the closest loads just below and just above.

**Keep in mind**

- The calculation assumes as many plates of each weight as needed.
- Each plate shows its weight in writing, not just its colour.
- Collars are not counted.

**Formula**

- Per side = (target load − bar) / 2
- Worked out in hundredths of a kilo, with no rounding error.
- Among the possible combinations, the one with the fewest plates; on a tie, the heaviest plates first.

**Limits**

- IWF colours (rule 3.3.3.6): 25 and 2.5 kg red, 20 and 2 kg blue, 15 and 1.5 kg yellow, 10 and 1 kg green, 5 and 0.5 kg white.
- The IWF rules have no 1.25 kg disc and no official colour for one: Belay draws it neutral grey, like any value outside this list.
- The calculation itself is arithmetic: it needs no source.

**Sources**

- International Weightlifting Federation 2020. Technical and Competition Rules & Regulations 2020. _IWF, in effect 1 January 2020._ IWF TCRR 2020, rule 3.3.3.6 [Record read](https://web.archive.org/web/20250707232059if_/https://iwf.sport/wp-content/uploads/downloads/2020/01/IWF_TCRR_2020.pdf). (stable identifier, no DOI on 2026-09-30.)

## Warm-up

**Label:** Belay heuristic

Before your working sets, Belay suggests 1 to 3 ramp-up sets, depending on the load. Each load is rounded to what your equipment can load.

**Keep in mind**

- No study validates a single warm-up scheme.
- Adjust the number of sets with − and +, from 0 to 3.
- A set that would fall under the bar becomes “bar only”.

**Belay heuristic:** The whole scheme is a Belay heuristic: a common progression that no study validates.

**Formula**

- Default count: 1 set under 60 kg, 2 sets from 60 to under 120 kg, 3 sets from 120 kg.
- 1 set: 60 % × 5
- 2 sets: 50 % × 5, then 75 % × 3
- 3 sets: 40 % × 5, 60 % × 3, then 80 % × 1
- Each load is rounded to the closest load your equipment can make, never under the bar. Two sets that round to the same load become one, and a set that would reach your working load is dropped.

**Limits**

- Ribeiro 2020 (40 trained men) finds that warming up with few reps and light loads is not enough to optimise squat and bench press performance.
- It is a single, short study that measures velocity and work, not injuries or long-term effects.
- The right warm-up also depends on the exercise, how you feel that day and your experience.

**Sources**

- Ribeiro et al. 2020. The role of specific warm-up during bench press and squat exercises: a novel approach. _Int J Environ Res Public Health. 2020;17(18):6882._ [doi:10.3390/ijerph17186882](https://doi.org/10.3390/ijerph17186882) · [PMID 32971729](https://pubmed.ncbi.nlm.nih.gov/32971729/) (DOI verified on 2026-09-30.)

## Energy expenditure

**Label:** Scientific source, with a Belay heuristic

Belay first estimates your resting expenditure with the Mifflin-St Jeor equation, then multiplies it by an FAO activity level. The result is a starting point that your weigh-ins and intake will refine later.

**Keep in mind**

- About 1 person in 5 is more than 10% away from their measured value.
- The range shown is ±10%.
- Activity levels describe your lifestyle, not a number of sessions.

**Belay heuristic:** Each part has a source, but no study validates pairing Mifflin with the activity levels: that combination is a Belay heuristic.

**Formula**

- Resting energy expenditure = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + s
- s = +5 with the male formula, −161 with the female formula
- Daily expenditure = resting energy expenditure × activity level, rounded to 10 kcal
- Activity levels (FAO 2004): 1.40 · 1.55 · 1.75 · 2.00
- Range: ±10%

**Limits**

- Frankenfield 2003 (130 adults): with Mifflin, the error exceeds 10% of the measured value for 22% of people.
- Mifflin's study covered 498 healthy adults aged 19 to 78.
- The FAO defines its activity levels against basal metabolism, while Mifflin measures resting expenditure: close, but not the same.
- No traceable source found for the coefficients 1.2 · 1.375 · 1.55 · 1.725 · 1.9; the FAO/WHO consultation judged 1.21 too low and keeps 1.40 as the sedentary floor.

**Sources**

- Mifflin et al. 1990. A new predictive equation for resting energy expenditure in healthy individuals. _Am J Clin Nutr. 1990;51(2):241–247._ [doi:10.1093/ajcn/51.2.241](https://doi.org/10.1093/ajcn/51.2.241) · [PMID 2305711](https://pubmed.ncbi.nlm.nih.gov/2305711/) (DOI verified on 2026-09-30.)
- Frankenfield et al. 2003. Validation of several established equations for resting metabolic rate in obese and nonobese people. _J Am Diet Assoc. 2003;103(9):1152–1159._ [doi:10.1016/S0002-8223(03)00982-9](<https://doi.org/10.1016/S0002-8223(03)00982-9>) · [PMID 12963943](https://pubmed.ncbi.nlm.nih.gov/12963943/) (DOI verified on 2026-09-30.)
- Joint FAO/WHO/UNU Expert Consultation 2004. Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation, Rome, 17–24 October 2001. _FAO Food and Nutrition Technical Report Series 1. Rome: FAO; 2004._ ISBN 92-5-105212-3 · ISSN 1813-3932 [Record read](https://www.fao.org/4/y5686e/y5686e00.htm). (stable identifier, no DOI on 2026-09-30.)

## Protein

**Label:** Scientific source, with a Belay heuristic

How much protein you need depends on your goal. Belay uses a published range for each one, maintain, gain and cut, then splits it over 3 or 4 meals.

**Keep in mind**

- When cutting, the range is worked out from your lean mass, not your weight.
- Adding your body fat makes the cut range more accurate.
- It's a range, not an exact number to hit every day.

**Belay heuristic:** The three ranges have sources. Two guards are Belay heuristics: without a body-fat value, a cut uses 1.8 to 2.5 g per kg of body weight; and when cutting, the range never drops below 1.6 g per kg of body weight.

**Formula**

- Maintain: 1.4 to 2.0 g per kg of body weight (Jäger 2017)
- Gain: 1.6 to 2.2 g per kg of body weight (Morton 2018)
- Cut: 2.3 to 3.1 g per kg of lean mass (Helms 2014), with lean mass = weight × (1 − body fat)
- Rounded to 5 g (up for the 1.6 g per kg cut floor); per meal, worked out from the daily range shown, divided by 3 or by 4: the low end rounded up, the high end down, to 5 g

**Limits**

- Morton 2018 puts the plateau at 1.62 g per kg per day (confidence interval 1.03 to 2.20). The study looked at supplements during training, not at periods of deficit.
- Helms 2014 rests on 6 studies of lean, strength-trained athletes. It advises moving up the range as the deficit gets steeper and body fat gets lower.
- The ISSN position stand (Jäger 2017) writes 2.3 to 3.1 g per kg of body weight, but its source, Helms 2014, gives it per kg of lean mass: Belay follows Helms.

**Sources**

- Jäger et al. 2017. International Society of Sports Nutrition Position Stand: protein and exercise. _J Int Soc Sports Nutr. 2017;14:20._ [doi:10.1186/s12970-017-0177-8](https://doi.org/10.1186/s12970-017-0177-8) · [PMID 28642676](https://pubmed.ncbi.nlm.nih.gov/28642676/) (DOI verified on 2026-09-30.)
- Morton et al. 2018. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. _Br J Sports Med. 2018;52(6):376–384._ [doi:10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608) · [PMID 28698222](https://pubmed.ncbi.nlm.nih.gov/28698222/) (DOI verified on 2026-09-30.)
- Helms et al. 2014. A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes. _Int J Sport Nutr Exerc Metab. 2014;24(2):127–138._ [doi:10.1123/ijsnem.2013-0054](https://doi.org/10.1123/ijsnem.2013-0054) · [PMID 24092765](https://pubmed.ncbi.nlm.nih.gov/24092765/) (DOI verified on 2026-09-30.)

## Projection

**Label:** Scientific source, with a Belay heuristic

Belay works out how many weeks you need to reach your goal if you lose a percentage of your current weight each week. The result is a range of dates, because the loss slows down as you lose weight.

**Keep in mind**

- Studies recommend a pace of 0.5 to 1% of body weight per week.
- In athletes, a faster pace (≈ 1%/week) came with less lean-mass gain (Garthe 2011).
- Run it again with your average weight at each weigh-in.

**Belay heuristic:** The 30% margin that gives the later date has no source: the whole date range is a Belay heuristic.

**Formula**

- Weeks (low) = ⌈ ln(goal / current weight) / ln(1 − pace) ⌉
- Weeks (high) = ⌈ 1.3 × weeks (low) ⌉
- Dates = today + weeks (low), and today + weeks (high)
- The pace is a percentage of your current weight: the kilos lost each week shrink over time.

**Limits**

- Garthe 2011 (24 elite athletes): at 0.7% per week, lean mass went up; the group aiming for 1.4% actually lost 1.0% per week and gained no lean mass.
- Helms 2014 recommends 0.5 to 1% of body weight per week to prepare a natural bodybuilding contest.
- Hall 2011 shows that body weight responds slowly to a change in intake, with a half-time of about a year: that explains the slowdown, but it does not size the margin.
- The projection only works out a weight loss.

**Sources**

- Garthe et al. 2011. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. _Int J Sport Nutr Exerc Metab. 2011;21(2):97–104._ [doi:10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97) · [PMID 21558571](https://pubmed.ncbi.nlm.nih.gov/21558571/) (DOI verified on 2026-09-30.)
- Helms et al. 2014. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. _J Int Soc Sports Nutr. 2014;11:20._ [doi:10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20) · [PMID 24864135](https://pubmed.ncbi.nlm.nih.gov/24864135/) (DOI verified on 2026-09-30.)
- Hall et al. 2011. Quantification of the effect of energy imbalance on bodyweight. _Lancet. 2011;378(9793):826–837._ [doi:10.1016/S0140-6736(11)60812-X](<https://doi.org/10.1016/S0140-6736(11)60812-X>) · [PMID 21872751](https://pubmed.ncbi.nlm.nih.gov/21872751/) (DOI verified on 2026-09-30.)

## BMI

**Label:** Scientific source

BMI divides your weight by your height squared. The WHO uses it to sort adults into ranges, the same at every age and for both sexes.

**Keep in mind**

- BMI doesn't tell muscle from fat.
- It's a population marker, not a diagnosis.
- In muscular people, it often overstates body fat.

**Formula**

- BMI = weight (kg) / height (m)²
- Shown to 0.1; the range is picked from the value shown.
- WHO ranges: under 18.5 · 18.5 to 25 · 25 to 30 · 30 and over. 25.0 belongs to 25 – 30.
- Belay suggests talking to a health professional below 18.5 and from 35 (WHO TRS 894 obesity class II).

**Limits**

- The WHO itself writes that BMI does not distinguish weight from muscle and weight from fat.
- Ode 2007 (226 athletes, 213 non-athletes): a BMI of 25 or more often wrongly flags excess fat in athletes; the authors call for caution.
- The same BMI does not mean the same body fat in every population.
- The range names in Belay are descriptive; they do not reuse the WHO's terms.

**Sources**

- World Health Organization 2000. Obesity: preventing and managing the global epidemic. Report of a WHO Consultation. _WHO Technical Report Series 894. Geneva: WHO; 2000._ ISBN 92 4 120894 5 · ISSN 0512-3054 · WHO IRIS handle 10665/42330 [Record read](https://iris.who.int/handle/10665/42330). (stable identifier, no DOI on 2026-09-30.)
- Ode et al. 2007. Body mass index as a predictor of percent fat in college athletes and nonathletes. _Med Sci Sports Exerc. 2007;39(3):403–409._ [doi:10.1249/01.mss.0000247008.19127.3e](https://doi.org/10.1249/01.mss.0000247008.19127.3e) · [PMID 17473765](https://pubmed.ncbi.nlm.nih.gov/17473765/) (DOI verified on 2026-09-30.)

## Body fat

**Label:** Scientific source

The US Navy method estimates your body fat from your height and a few girths taken with a tape measure. Belay then compares the result with published reference values for your age and formula.

**Keep in mind**

- It's an estimate, within about 4 points.
- It often overestimates lean people and underestimates people with more body fat.
- Always measure at the same spot, tape flat, without pulling tight.

**Formula**

- Male formula: % = 86.010 × log10(waist at the navel − neck) − 70.041 × log10(height) + 30.295
- Female formula: % = 163.205 × log10(waist at the narrowest + hips − neck) − 97.684 × log10(height) − 104.912
- All measurements in cm; result rounded to a whole number (DoDI 1308.3).
- These centimetre constants are the exact conversion of the inch constants in DoDI 1308.3 (36.76 and −78.387).
- Where to measure: the neck just below the Adam's apple; the waist at the navel (male formula) or at its narrowest (female formula); the hips at their widest.
- Reference values: Gallagher 2000, table 4 (standard) or table 5 (people of Asian origin), for ages 20–39, 40–59 and 60–79.

**Limits**

- In the original reports (602 men, 214 women, checked against underwater weighing), the standard error is about 3.5 to 3.7 points; individual errors of 8 points are not rare.
- Potter 2022 (US Marines, checked against DXA): lean people are overestimated and people with more body fat underestimated.
- The “±1%” in the DoDI measures agreement between trained measurers, not accuracy.
- The paper does not name body-fat ranges: it gives the body fat matching a BMI of 18.5, 25 and 30. Belay presents them that way, without a label.
- Table 5 was built from people living in Japan.
- The paper states that these are not definitive ranges, and that the values at low BMIs have wide confidence intervals: they are provisional reference values.

**Sources**

- Hodgdon & Beckett 1984. Prediction of percent body fat for U.S. Navy men from body circumferences and height. _Naval Health Research Center, San Diego. Report No. 84-11, 1984._ NHRC Report No. 84-11 · [DTIC AD-A143890](https://dtic.mil/docs/citations/ADA143890) · [doi:10.21236/ada143890](https://doi.org/10.21236/ada143890) (DOI verified on 2026-09-30.)
- Hodgdon & Beckett 1984. Prediction of percent body fat for U.S. Navy women from body circumferences and height. _Naval Health Research Center, San Diego. Report No. 84-29, 1984._ NHRC Report No. 84-29 · [DTIC AD-A146456](https://dtic.mil/docs/citations/ADA146456) · [doi:10.21236/ada146456](https://doi.org/10.21236/ada146456) (DOI verified on 2026-09-30.)
- Hodgdon & Friedl 1999. Development of the DoD Body Composition Estimation Equations. _Naval Health Research Center Technical Document No. 99-2B, September 1999._ NHRC Technical Document No. 99-2B · [DTIC AD-A370158](https://dtic.mil/docs/citations/ADA370158) · [doi:10.21236/ada370158](https://doi.org/10.21236/ada370158) (DOI verified on 2026-09-30.)
- U.S. Department of Defense 2002. DoD Physical Fitness and Body Fat Programs Procedures. _DoD Instruction 1308.3, 5 November 2002._ DoDI 1308.3, Enclosure 3, para E3.1.3 [Record read](https://det027inspectorgeneral.weebly.com/uploads/1/7/0/2/17029076/dodi1308.3_fitnessprogram_2002.pdf). (stable identifier, no DOI on 2026-09-30. Read on a third-party copy, not the official host.)
- Potter et al. 2022. Circumference-based predictions of body fat revisited: preliminary results from a US Marine Corps body composition survey. _Front Physiol. 2022;13:868627._ [doi:10.3389/fphys.2022.868627](https://doi.org/10.3389/fphys.2022.868627) · [PMID 35432005](https://pubmed.ncbi.nlm.nih.gov/35432005/) (DOI verified on 2026-09-30.)
- Gallagher et al. 2000. Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index. _Am J Clin Nutr. 2000;72(3):694–701._ [doi:10.1093/ajcn/72.3.694](https://doi.org/10.1093/ajcn/72.3.694) · [PMID 10966886](https://pubmed.ncbi.nlm.nih.gov/10966886/) (DOI verified on 2026-09-30.)

## Loss range

**Label:** Scientific source

Your range says how fast you want to lose, as a percentage of your average weight per week. Belay uses it to write “in your range” next to your loss per week. It runs from 0.5 to 1% by default, as studies recommend.

**Keep in mind**

- Studies recommend a pace of 0.5 to 1% of body weight per week.
- In athletes, a faster pace (≈ 1%/week) came with less lean-mass gain (Garthe 2011).
- Belay offers no more than 1% per week.

**Formula**

- Loss per week = (average of the week before − average of the week) / average of the week before × 100
- “In your range” when that loss, rounded to the tenth, lies between your minimum and your maximum.

**Limits**

- Helms 2014 recommends 0.5 to 1% of body weight per week to prepare a natural bodybuilding contest.
- Garthe 2011 (24 elite athletes): at 0.7% per week, lean mass went up; the group aiming for 1.4% actually lost 1.0% per week and gained no lean mass.
- Both sources studied trained athletes.

**Sources**

- Helms et al. 2014. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. _J Int Soc Sports Nutr. 2014;11:20._ [doi:10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20) · [PMID 24864135](https://pubmed.ncbi.nlm.nih.gov/24864135/) (DOI verified on 2026-09-30.)
- Garthe et al. 2011. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. _Int J Sport Nutr Exerc Metab. 2011;21(2):97–104._ [doi:10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97) · [PMID 21558571](https://pubmed.ncbi.nlm.nih.gov/21558571/) (DOI verified on 2026-09-30.)

## All verified references

- Brzycki M 1993. Strength testing—predicting a one-rep max from reps-to-fatigue. _Journal of Physical Education, Recreation & Dance. 1993;64(1):88–90._ [doi:10.1080/07303084.1993.10606684](https://doi.org/10.1080/07303084.1993.10606684) (DOI verified on 2026-09-30.)
- Reynolds JM, Gordon TJ, Robergs RA 2006. Prediction of one repetition maximum strength from multiple repetition maximum testing and anthropometry. _J Strength Cond Res. 2006;20(3):584–592._ [doi:10.1519/R-15304.1](https://doi.org/10.1519/R-15304.1) · [PMID 16937972](https://pubmed.ncbi.nlm.nih.gov/16937972/) (DOI verified on 2026-09-30.)
- LeSuer DA, McCormick JH, Mayhew JL, Wasserstein RL, Arnold MD 1997. The accuracy of prediction equations for estimating 1-RM performance in the bench press, squat, and deadlift. _J Strength Cond Res. 1997;11(4):211–213._ [doi:10.1519/00124278-199711000-00001](https://doi.org/10.1519/00124278-199711000-00001) (DOI verified on 2026-09-30.)
- Mayhew JL, Johnson BD, LaMonte MJ, Lauber D, Kemmler W 2008. Accuracy of prediction equations for determining one repetition maximum bench press in women before and after resistance training. _J Strength Cond Res. 2008;22(5):1570–1577._ [doi:10.1519/JSC.0b013e31817b02ad](https://doi.org/10.1519/JSC.0b013e31817b02ad) · [PMID 18714230](https://pubmed.ncbi.nlm.nih.gov/18714230/) (DOI verified on 2026-09-30.)
- Nuzzo JL, Pinto MD, Nosaka K, Steele J 2024. Maximal number of repetitions at percentages of the one repetition maximum: a meta-regression and moderator analysis of sex, age, training status, and exercise. _Sports Med. 2024;54(2):303–321._ [doi:10.1007/s40279-023-01937-7](https://doi.org/10.1007/s40279-023-01937-7) · [PMID 37792272](https://pubmed.ncbi.nlm.nih.gov/37792272/) (DOI verified on 2026-09-30.)
- Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO 1990. A new predictive equation for resting energy expenditure in healthy individuals. _Am J Clin Nutr. 1990;51(2):241–247._ [doi:10.1093/ajcn/51.2.241](https://doi.org/10.1093/ajcn/51.2.241) · [PMID 2305711](https://pubmed.ncbi.nlm.nih.gov/2305711/) (DOI verified on 2026-09-30.)
- Frankenfield D, Roth-Yousey L, Compher C 2005. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review. _J Am Diet Assoc. 2005;105(5):775–789._ [doi:10.1016/j.jada.2005.02.005](https://doi.org/10.1016/j.jada.2005.02.005) · [PMID 15883556](https://pubmed.ncbi.nlm.nih.gov/15883556/) (DOI verified on 2026-09-30.)
- Frankenfield DC, Rowe WA, Smith JS, Cooney RN 2003. Validation of several established equations for resting metabolic rate in obese and nonobese people. _J Am Diet Assoc. 2003;103(9):1152–1159._ [doi:10.1016/S0002-8223(03)00982-9](<https://doi.org/10.1016/S0002-8223(03)00982-9>) · [PMID 12963943](https://pubmed.ncbi.nlm.nih.gov/12963943/) (DOI verified on 2026-09-30.)
- Morton RW, Murphy KT, McKellar SR, Schoenfeld BJ, Henselmans M, Helms E, Aragon AA, Devries MC, Banfield L, Krieger JW, Phillips SM 2018. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. _Br J Sports Med. 2018;52(6):376–384._ [doi:10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608) · [PMID 28698222](https://pubmed.ncbi.nlm.nih.gov/28698222/) (DOI verified on 2026-09-30.)
- Jäger R, Kerksick CM, Campbell BI, Cribb PJ, Wells SD, Skwiat TM, Purpura M, Ziegenfuss TN, Ferrando AA, Arent SM, Smith-Ryan AE, Stout JR, Arciero PJ, Ormsbee MJ, Taylor LW, Wilborn CD, Kalman DS, Kreider RB, Willoughby DS, Hoffman JR, Krzykowski JL, Antonio J 2017. International Society of Sports Nutrition Position Stand: protein and exercise. _J Int Soc Sports Nutr. 2017;14:20._ [doi:10.1186/s12970-017-0177-8](https://doi.org/10.1186/s12970-017-0177-8) · [PMID 28642676](https://pubmed.ncbi.nlm.nih.gov/28642676/) (DOI verified on 2026-09-30.)
- Helms ER, Zinn C, Rowlands DS, Brown SR 2014. A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes. _Int J Sport Nutr Exerc Metab. 2014;24(2):127–138._ [doi:10.1123/ijsnem.2013-0054](https://doi.org/10.1123/ijsnem.2013-0054) · [PMID 24092765](https://pubmed.ncbi.nlm.nih.gov/24092765/) (DOI verified on 2026-09-30.)
- Helms ER, Aragon AA, Fitschen PJ 2014. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. _J Int Soc Sports Nutr. 2014;11:20._ [doi:10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20) · [PMID 24864135](https://pubmed.ncbi.nlm.nih.gov/24864135/) (DOI verified on 2026-09-30.)
- Hodgdon JA, Beckett MB 1984. Prediction of percent body fat for U.S. Navy men from body circumferences and height. _Naval Health Research Center, San Diego. Report No. 84-11, 1984._ NHRC Report No. 84-11 · [DTIC AD-A143890](https://dtic.mil/docs/citations/ADA143890) · [doi:10.21236/ada143890](https://doi.org/10.21236/ada143890) (DOI verified on 2026-09-30.)
- Hodgdon JA, Beckett MB 1984. Prediction of percent body fat for U.S. Navy women from body circumferences and height. _Naval Health Research Center, San Diego. Report No. 84-29, 1984._ NHRC Report No. 84-29 · [DTIC AD-A146456](https://dtic.mil/docs/citations/ADA146456) · [doi:10.21236/ada146456](https://doi.org/10.21236/ada146456) (DOI verified on 2026-09-30.)
- Hodgdon JA, Friedl K 1999. Development of the DoD Body Composition Estimation Equations. _Naval Health Research Center Technical Document No. 99-2B, September 1999._ NHRC Technical Document No. 99-2B · [DTIC AD-A370158](https://dtic.mil/docs/citations/ADA370158) · [doi:10.21236/ada370158](https://doi.org/10.21236/ada370158) (DOI verified on 2026-09-30.)
- Potter AW, Tharion WJ, Holden LD, Pazmino A, Looney DP, Friedl KE 2022. Circumference-based predictions of body fat revisited: preliminary results from a US Marine Corps body composition survey. _Front Physiol. 2022;13:868627._ [doi:10.3389/fphys.2022.868627](https://doi.org/10.3389/fphys.2022.868627) · [PMID 35432005](https://pubmed.ncbi.nlm.nih.gov/35432005/) (DOI verified on 2026-09-30.)
- Gallagher D, Heymsfield SB, Heo M, Jebb SA, Murgatroyd PR, Sakamoto Y 2000. Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index. _Am J Clin Nutr. 2000;72(3):694–701._ [doi:10.1093/ajcn/72.3.694](https://doi.org/10.1093/ajcn/72.3.694) · [PMID 10966886](https://pubmed.ncbi.nlm.nih.gov/10966886/) (DOI verified on 2026-09-30.)
- Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J 2011. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. _Int J Sport Nutr Exerc Metab. 2011;21(2):97–104._ [doi:10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97) · [PMID 21558571](https://pubmed.ncbi.nlm.nih.gov/21558571/) (DOI verified on 2026-09-30.)
- Hall KD, Sacks G, Chandramohan D, Chow CC, Wang YC, Gortmaker SL, Swinburn BA 2011. Quantification of the effect of energy imbalance on bodyweight. _Lancet. 2011;378(9793):826–837._ [doi:10.1016/S0140-6736(11)60812-X](<https://doi.org/10.1016/S0140-6736(11)60812-X>) · [PMID 21872751](https://pubmed.ncbi.nlm.nih.gov/21872751/) (DOI verified on 2026-09-30.)
- Hall KD 2008. What is the required energy deficit per unit weight loss? _Int J Obes. 2008;32(3):573–576._ [doi:10.1038/sj.ijo.0803720](https://doi.org/10.1038/sj.ijo.0803720) · [PMID 17848938](https://pubmed.ncbi.nlm.nih.gov/17848938/) (DOI verified on 2026-09-30.)
- Ribeiro B, Pereira A, Neves PP, Sousa AC, Ferraz R, Marques MC, Marinho DA, Neiva HP 2020. The role of specific warm-up during bench press and squat exercises: a novel approach. _Int J Environ Res Public Health. 2020;17(18):6882._ [doi:10.3390/ijerph17186882](https://doi.org/10.3390/ijerph17186882) · [PMID 32971729](https://pubmed.ncbi.nlm.nih.gov/32971729/) (DOI verified on 2026-09-30.)
- Ode JJ, Pivarnik JM, Reeves MJ, Knous JL 2007. Body mass index as a predictor of percent fat in college athletes and nonathletes. _Med Sci Sports Exerc. 2007;39(3):403–409._ [doi:10.1249/01.mss.0000247008.19127.3e](https://doi.org/10.1249/01.mss.0000247008.19127.3e) · [PMID 17473765](https://pubmed.ncbi.nlm.nih.gov/17473765/) (DOI verified on 2026-09-30.)
- Joint FAO/WHO/UNU Expert Consultation 2004. Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation, Rome, 17–24 October 2001. _FAO Food and Nutrition Technical Report Series 1. Rome: FAO; 2004._ ISBN 92-5-105212-3 · ISSN 1813-3932 [Record read](https://www.fao.org/4/y5686e/y5686e00.htm). (stable identifier, no DOI on 2026-09-30.)
- World Health Organization 2000. Obesity: preventing and managing the global epidemic. Report of a WHO Consultation. _WHO Technical Report Series 894. Geneva: WHO; 2000._ ISBN 92 4 120894 5 · ISSN 0512-3054 · WHO IRIS handle 10665/42330 [Record read](https://iris.who.int/handle/10665/42330). (stable identifier, no DOI on 2026-09-30.)
- U.S. Department of Defense 2002. DoD Physical Fitness and Body Fat Programs Procedures. _DoD Instruction 1308.3, 5 November 2002._ DoDI 1308.3, Enclosure 3, para E3.1.3 [Record read](https://det027inspectorgeneral.weebly.com/uploads/1/7/0/2/17029076/dodi1308.3_fitnessprogram_2002.pdf). (stable identifier, no DOI on 2026-09-30. Read on a third-party copy, not the official host.)
- International Weightlifting Federation 2020. Technical and Competition Rules & Regulations 2020. _IWF, in effect 1 January 2020._ IWF TCRR 2020, rule 3.3.3.6 [Record read](https://web.archive.org/web/20250707232059if_/https://iwf.sport/wp-content/uploads/downloads/2020/01/IWF_TCRR_2020.pdf). (stable identifier, no DOI on 2026-09-30.)
