// socket/utils.ts
export function shuffleDeck(): string[] {
  const suits = ["s", "h", "d", "c"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = suits.flatMap((suit) => ranks.map((rank) => rank + suit));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const getHandDescription = (playerCards: string[], communityCards: string[]): string => {
  const allCards = [...playerCards, ...communityCards];
  const ranks = allCards.map((card) => card.slice(0, -1));
  const suits = allCards.map((card) => card.slice(-1));

  const rankCounts = ranks.reduce((acc, rank) => {
    acc[rank] = (acc[rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const suitCounts = suits.reduce((acc, suit) => {
    acc[suit] = (acc[suit] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const rankValues = ranks
    .map((rank) => {
      if (rank === "A") return 14;
      if (rank === "K") return 13;
      if (rank === "Q") return 12;
      if (rank === "J") return 11;
      if (rank === "T") return 10;
      return parseInt(rank);
    })
    .sort((a, b) => b - a);

  const isFlush = Object.values(suitCounts).some((count) => count >= 5);
  const isStraight = (() => {
    const uniqueRanks = Array.from(new Set(rankValues));
    if (uniqueRanks.length < 5) return false;
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) return true;
    }
    if (uniqueRanks.includes(14) && uniqueRanks.slice(-4).join("") === "5432") return true;
    return false;
  })();

  const counts = Object.values(rankCounts);
  const maxCount = Math.max(...counts);
  const pairs = counts.filter((c) => c === 2).length;

  if (isFlush && isStraight) return "Straight Flush";
  if (maxCount === 4) return "Four of a Kind";
  if (maxCount === 3 && pairs > 0) return "Full House";
  if (isFlush) return "Flush";
  if (isStraight) return "Straight";
  if (maxCount === 3) return "Three of a Kind";
  if (pairs === 2) return "Two Pair";
  if (pairs === 1) return "One Pair";

  const highCard = Object.keys(rankCounts)
    .sort((a, b) => {
      const aVal = a === "A" ? 14 : a === "K" ? 13 : a === "Q" ? 12 : a === "J" ? 11 : a === "T" ? 10 : parseInt(a);
      const bVal = b === "A" ? 14 : b === "K" ? 13 : b === "Q" ? 12 : b === "J" ? 11 : b === "T" ? 10 : parseInt(b);
      return bVal - aVal;
    })[0];
  return `High Card ${highCard}`;
};