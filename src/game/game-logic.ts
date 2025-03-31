// socket/gameLogic.ts
import { Server } from "socket.io";
import Table from "../db/Table"; // Adjust path to your models
import { Player, IPlayer } from "../db/Player"; // Adjust path to your models
import { TexasHoldem } from "poker-odds-calc";
import { shuffleDeck, getHandDescription } from "./socket-utils"; // Import utilities

const HAND_RESULT_DISPLAY_DURATION = 4000;

export async function startGame(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table || table.players.length < 2) {
      io.to(tableId).emit("error", "2 players required");
      return;
    }

    const deck = shuffleDeck();
    const players = table.players as unknown as IPlayer[];
    const dealerSeat = table.dealerSeat || 0;
    const smallBlindIndex = (dealerSeat + 1) % players.length;
    const bigBlindIndex = (dealerSeat + 2) % players.length;

    const playerUpdates = players.map((player, index) => {
      const update: any = {
        cards: [deck.pop()!, deck.pop()!],
        inHand: true,
        hasActed: false,
        consecutiveAfkRounds: 0,
        currentBet: 0,
      };
      if (index === smallBlindIndex) {
        update.chips = player.chips - table.smallBlind;
        update.currentBet = table.smallBlind;
      } else if (index === bigBlindIndex) {
        update.chips = player.chips - table.bigBlind;
        update.currentBet = table.bigBlind;
      }
      return Player.findOneAndUpdate({ _id: player._id, table: tableId }, update, { new: true });
    });

    await Promise.all([
      ...playerUpdates,
      Table.findByIdAndUpdate(
        tableId,
        {
          status: "playing",
          round: "preflop",
          deck,
          communityCards: [],
          pot: table.smallBlind + table.bigBlind,
          currentBet: table.bigBlind,
          currentPlayer: bigBlindIndex,
          dealerSeat,
        },
        { new: true }
      ),
    ]);

    const updatedTable = await Table.findById(tableId)
      .select("name maxPlayers buyIn smallBlind bigBlind gameType status communityCards pot dealerSeat currentPlayer currentBet round deck")
      .populate({ path: "players", select: "user seat chips cards username inHand currentBet hasActed consecutiveAfkRounds" })
      .populate({ path: "waitingPlayers", select: "user username" })
      .lean();

    io.to(tableId).emit("gameStarted", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);
    io.to(tableId).emit("dealCards", {
      tableId,
      players: updatedTable?.players.map((p: any) => ({
        user: p.user.toString(),
        seat: p.seat,
        cards: p.cards,
        chips: p.chips,
        username: p.username,
      })),
    });

    startTurnTimer(tableId, io);
  } catch (error) {
    console.error(`Error starting game on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Failed to start the game");
  }
}

export async function endGame(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) return;

    await Promise.all([
      Player.updateMany({ table: tableId }, { cards: ["", ""], inHand: false, currentBet: 0, hasActed: false }),
      Table.findByIdAndUpdate(tableId, { status: "waiting", round: "preflop", communityCards: [], pot: 0, currentBet: 0 }, { new: true }),
    ]);

    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
    io.to(tableId).emit("gameEnded", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);
  } catch (error) {
    console.error(`Error ending game on table ${tableId}:`, error);
  }
}

export async function advanceTurn(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) return;

    const players = table.players as unknown as IPlayer[];
    const activePlayers = players.filter((p) => p.inHand);

    if (activePlayers.length <= 1) {
      await endHand(tableId, io);
      return;
    }

    const allActed = activePlayers.every((p) => p.hasActed);
    if (allActed) {
      await nextRound(tableId, io);
      return;
    }

    let nextPlayerIndex = (table.currentPlayer + 1) % players.length;
    while (!players[nextPlayerIndex].inHand && nextPlayerIndex !== table.currentPlayer) {
      nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
    }

    await Table.findByIdAndUpdate(tableId, { currentPlayer: nextPlayerIndex }, { new: true });
    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();

    io.to(tableId).emit("turnUpdate", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);

    startTurnTimer(tableId, io);
  } catch (error) {
    console.error(`Error advancing turn on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Error advancing turn");
  }
}

function startTurnTimer(tableId: string, io: Server) {
  setTimeout(async () => {
    try {
      const table = await Table.findById(tableId).populate("players").lean();
      if (!table || !table.players.length) return;

      const player = table.players[table.currentPlayer] as unknown as IPlayer;
      if (!player) {
        await advanceTurn(tableId, io);
        return;
      }

      const mustAct = table.currentBet > player.currentBet;
      if (mustAct && !player.hasActed) {
        const update: any = {
          $inc: { consecutiveAfkRounds: 1 },
          hasActed: table.currentBet === player.currentBet,
          inHand: table.currentBet === player.currentBet ? player.inHand : false,
        };

        await Player.findOneAndUpdate({ _id: player._id, table: tableId }, update, { new: true });

        if (player.consecutiveAfkRounds + 1 >= 2) {
          await Promise.all([
            Table.findByIdAndUpdate(tableId, { $pull: { players: player._id }, $push: { waitingPlayers: player._id } }, { new: true }),
            Player.findOneAndUpdate({ _id: player._id, table: tableId }, { seat: -1, inHand: false }, { new: true }),
          ]);
          io.to(tableId).emit("playerRemoved", player._id);
        }

        await advanceTurn(tableId, io);
      } else if (player.hasActed) {
        await Player.findOneAndUpdate({ _id: player._id, table: tableId }, { consecutiveAfkRounds: 0 }, { new: true });
      }
    } catch (error) {
      console.error(`Error in turn timer on table ${tableId}:`, error);
    }
  }, 10000); // 10 seconds
}

async function nextRound(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) return;

    await Player.updateMany({ table: tableId }, { hasActed: false, currentBet: 0 });

    let update: any = { currentPlayer: (table.dealerSeat + 1) % table.players.length, currentBet: 0 };
    switch (table.round) {
      case "preflop":
        update.round = "flop";
        update.communityCards = [table.deck.pop()!, table.deck.pop()!, table.deck.pop()!];
        break;
      case "flop":
        update.round = "turn";
        update.communityCards = [...table.communityCards, table.deck.pop()!];
        break;
      case "turn":
        update.round = "river";
        update.communityCards = [...table.communityCards, table.deck.pop()!];
        break;
      case "river":
        update.round = "showdown";
        await endHand(tableId, io);
        return;
      default:
        console.error(`Unexpected round state: ${table.round}`);
        return;
    }

    await Table.findByIdAndUpdate(tableId, update, { new: true });
    const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();

    io.to(tableId).emit("roundUpdate", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);

    startTurnTimer(tableId, io);
  } catch (error) {
    console.error(`Error in next round on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Error progressing to next round");
  }
}

async function endHand(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) return;

    const players = table.players as unknown as IPlayer[];
    const activePlayers = players.filter((p) => p.inHand);
    let winners: { playerId: string; chipsWon: number; handDescription?: string }[] = [];

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const tax = Math.floor(table.pot * table.tableFee);
      const potAfterTax = table.pot - tax;
      await Promise.all([
        Player.findOneAndUpdate({ _id: winner._id, table: tableId }, { $inc: { chips: potAfterTax } }, { new: true }),
        Table.findByIdAndUpdate(tableId, { $inc: { tableEarnings: tax } }, { new: true }),
      ]);
      winners = [{ playerId: (winner._id as any).toString(), chipsWon: potAfterTax }];
      io.to(tableId).emit("handResult", { winners });
    } else if (activePlayers.length > 1) {
      const allInPlayers = activePlayers.filter((p) => p.chips === 0 && p.currentBet > 0);
      const minAllInBet = allInPlayers.length ? Math.min(...allInPlayers.map((p) => p.currentBet)) : Infinity;
      const mainPotContributions = Math.min(minAllInBet, ...activePlayers.map((p) => p.currentBet));
      const mainPotBeforeTax = mainPotContributions * activePlayers.length;
      const mainPotTax = Math.floor(mainPotBeforeTax * table.tableFee);
      const mainPot = mainPotBeforeTax - mainPotTax;

      const sidePotContributions = activePlayers.map((p) => ({
        playerId: p._id,
        excess: Math.max(0, p.currentBet - mainPotContributions),
      }));
      const sidePotBeforeTax = sidePotContributions.reduce((sum, c) => sum + c.excess, 0);
      const sidePotTax = Math.floor(sidePotBeforeTax * table.tableFee);
      const sidePot = sidePotBeforeTax - sidePotTax;

      const totalTax = mainPotTax + sidePotTax;
      const game = new TexasHoldem();
      activePlayers.forEach((player) => game.addPlayer(player.cards));

      if (table.communityCards.length >= 3) {
        game.setBoard(table.communityCards);
        const result = game.calculate();
        const winningPlayers = result.getPlayers().filter((p) => p.getWinsPercentage() > 0);

        const mainPotPerWinner = Math.floor(mainPot / winningPlayers.length);
        const sidePotPerWinner =
          sidePot > 0 && winningPlayers.every((w) => !allInPlayers.some((a) => a.cards.join("") === w.getHand()))
            ? Math.floor(sidePot / winningPlayers.length)
            : 0;

        const updates: Promise<any>[] = [];
        winners = winningPlayers.map((win) => {
          const winner = players.find((p) => p.cards.join("") === win.getHand());
          if (winner) {
            const isAllInWinner = allInPlayers.some((a) => (a._id as any).toString() === (winner._id as any).toString());
            const chipsWon = isAllInWinner ? mainPotPerWinner : mainPotPerWinner + sidePotPerWinner;
            const handDescription = getHandDescription(winner.cards, table.communityCards);
            updates.push(
              Player.findOneAndUpdate({ _id: winner._id, table: tableId }, { $inc: { chips: chipsWon } }, { new: true })
            );
            return { playerId: (winner._id as any).toString(), chipsWon, handDescription };
          }
          return null;
        }).filter((w): w is { playerId: string; chipsWon: number; handDescription: string } => w !== null);

        activePlayers.forEach((player) => {
          if (!winners.some((w) => w.playerId === (player._id as any).toString()) && player.currentBet > mainPotContributions) {
            const excessBeforeTax = player.currentBet - mainPotContributions;
            const taxOnExcess = Math.floor(excessBeforeTax * table.tableFee);
            const refund = excessBeforeTax - taxOnExcess;
            updates.push(
              Player.findOneAndUpdate({ _id: player._id, table: tableId }, { $inc: { chips: refund } }, { new: true })
            );
          }
        });

        updates.push(Table.findByIdAndUpdate(tableId, { $inc: { tableEarnings: totalTax } }, { new: true }));
        await Promise.all(updates);
      }

      io.to(tableId).emit("handResult", { winners });
    }

    setTimeout(async () => {
      await Promise.all([
        Player.updateMany({ table: tableId }, { cards: ["", ""], inHand: false, currentBet: 0, hasActed: false }),
        Table.findByIdAndUpdate(tableId, { pot: 0, dealerSeat: (table.dealerSeat + 1) % players.length }, { new: true }),
      ]);

      const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
      io.to(tableId).emit("tableUpdate", updatedTable);

      if ((updatedTable?.players.length || 0) < 2) {
        await endGame(tableId, io);
      } else {
        await startGame(tableId, io);
      }
    }, HAND_RESULT_DISPLAY_DURATION);
  } catch (error) {
    console.error(`Error ending hand on table ${tableId}:`, error);
  }
}