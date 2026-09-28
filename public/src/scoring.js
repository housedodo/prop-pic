// All scoring rules live here. The factors are placeholders — tweak freely.

export const SCORING = {
  // Photos with less than this share of the color score nothing.
  minCoverage: 0.03,
  // Points for how much of the photo is the color; maxes out at `coverageFullAt`.
  coveragePoints: 60,
  coverageFullAt: 0.5,
  // Points for how close the matching pixels are to the exact target shade.
  accuracyPoints: 40,
  // Points per bonus item found in the photo in the target color.
  bonusItemPoints: 25,
  // Share of a detected object's box that must be the color to count as a bonus.
  bonusItemMinCoverage: 0.12,
};

export function scorePhoto({ coverage, accuracy, bonusFound = [] }, rules = SCORING) {
  if (coverage < rules.minCoverage) {
    return { coverage: 0, accuracy: 0, bonus: 0, total: 0 };
  }
  const coveragePts = Math.round(rules.coveragePoints * Math.min(1, coverage / rules.coverageFullAt));
  const accuracyPts = Math.round(rules.accuracyPoints * accuracy);
  const bonusPts = bonusFound.length * rules.bonusItemPoints;
  return {
    coverage: coveragePts,
    accuracy: accuracyPts,
    bonus: bonusPts,
    total: coveragePts + accuracyPts + bonusPts,
  };
}

export function totalScore(scores) {
  return scores.reduce((sum, s) => sum + (s ?? 0), 0);
}
