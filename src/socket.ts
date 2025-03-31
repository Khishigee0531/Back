import { Server, Socket } from "socket.io";
import mongoose, { ObjectId } from "mongoose";
import { TexasHoldem, Omaha } from "poker-odds-calc";
import { IPlayer, Player } from "./db/Player";
import Table from "./db/Table";
import { User } from "./db/Users";

interface SocketData {
  userId: string;
  tableId: string | null;
}

const HAND_RESULT_DISPLAY_DURATION = 4000;

const initializeSocket = (io: Server) => {
  io.on("connection", async(socket: Socket) => {
    
    console.log(`User connected: ${socket.id}`);
    let socketData: SocketData = { userId: "", tableId: null };
    const existingPlayer = await Player.findOne({socketId: socket.id})

    if(existingPlayer){
      socketData = { userId: existingPlayer.user.toString(), tableId: existingPlayer.table.toString() }
    }

    socket.on("getTableData", async (tableId: string) => {
      try {
        const table = await Table.findById(tableId).populate("players").populate("waitingPlayers").populate("messages.user").lean();
        if (!table) {
          return socket.emit("error", "Table not found")
        };
        socket.emit("tableData", table);
      } catch (error) {
        socket.emit("error", "Error fetching table data");
        console.error(error);
      }
    });

    socket.on("getLobbyList", async () => {
      const tables = await Table.find().lean();
      socket.emit("lobbyList", tables);
    });

    socket.on("sendMessage", async ({ lobbyId, userId, content }) => {
      const lobby = await Table.findById(lobbyId);
      if (!lobby) {
        socket.emit("error", { message: "Lobby not found" });
        return;
      }
    
      const message = { user: userId, content, timestamp: new Date() };
      lobby.messages.push(message);
      await lobby.save();
    
      const populatedLobby = await Table.findById(lobbyId)
        .populate("messages.user", "name")
        .exec();
    
      if (!populatedLobby) {
        socket.emit("error", { message: "Failed to populate lobby" });
        return;
      }
    
      const latestMessage = populatedLobby.messages[populatedLobby.messages.length - 1];
      io.to(lobbyId).emit("newMessage", {
        user: { _id: latestMessage.user._id, name: (latestMessage.user as any).name },
        content: latestMessage.content,
        timestamp: latestMessage.timestamp,
      });
    });

    socket.on("joinTable", async ({ userId, tableId }: { userId: string; tableId: string }) => {
      try {
        if(!userId){
          socket.join(tableId);
          const updatedTable = await Table.findById(tableId)
          .populate(["players", "waitingPlayers"])
          .lean();
          socket.emit("joinedTable", updatedTable);
          io.to(tableId).emit("tableUpdate", updatedTable);
          return;
        }
        const [table, user] = await Promise.all([
          Table.findById(tableId).populate("players").lean(),
          User.findById(userId)
        ])
        if (!table) {
          return socket.emit("error", "Table or user not found")
        };

        if (user) {
          if (user.amount < table.buyIn) {
            return socket.emit("error", "Insufficient funds");
          }
          if (table.players.length >= table.maxPlayers) {
            return socket.emit("error", "Table full");
          }

          socketData.userId = userId;
          socketData.tableId = tableId;
          socket.join(tableId);

          const existingPlayer = await Player.findOne({ user: user._id, table: table._id })
          console.log(existingPlayer)
          if (!existingPlayer) {
            const player = new Player({
              user: userId,
              table: tableId,
              socketId: socket.id,
              seat: -1,
              chips: table.buyIn,
              username: user.name,
              cards: table.gameType === "Omaha" ? ["", "", "", ""] : ["", ""],
              inHand: false,
              currentBet: 0,
              hasActed: false,
              consecutiveAfkRounds: 0,
            });
            console.log(player, "a")
            await player.save();
            await Table.findByIdAndUpdate(tableId, { $push: { waitingPlayers: player._id } });
          }
        }

        const updatedTable = await Table.findById(tableId)
          .populate("players")
          .populate("waitingPlayers")
          .lean();
        io.to(tableId).emit("tableUpdate", updatedTable);
        socket.emit("joinedTable", updatedTable);

      } catch (error) {
        socket.emit("error", "Error joining table");
        console.error(error);
      }
    });
    
    socket.on("joinSeat", async ({ tableId, seat, userId, chips }: { tableId: string; seat: number; userId: string; chips?: number }) => {
      try {
        const table = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
        if (!table || !userId) {
          return socket.emit("error", "Invalid table or user");
        }
    
        const player = await Player.findOne({ user: userId, table: tableId });
        if (!player) {
          return socket.emit("error", "Player not found");
        }
    
        const seatTaken = table.players.some((p: any) => p.seat === seat);
        if (seatTaken || seat < 0 || seat >= table.maxPlayers) {
          return socket.emit("error", "Invalid or taken seat");
        }
    
        const chipsToUse = chips && chips >= table.buyIn ? chips : table.buyIn;
        if (chips && chips < table.buyIn) {
          return socket.emit("error", `Chips must be at least ${table.buyIn}`);
        }
    
        await Promise.all([
          Player.findOneAndUpdate(
            { _id: player._id, table: tableId },
            { seat, inHand: false, chips: chipsToUse }, 
            { new: true }
          ),
          Table.findByIdAndUpdate(
            tableId,
            {
              $pull: { waitingPlayers: player._id },
              $push: { players: player._id },
            },
            { new: true }
          ),
        ]);
    
        const updatedTable = await Table.findById(tableId).populate("players").populate("waitingPlayers").lean();
        io.to(tableId).emit("tableUpdate", updatedTable);
        socket.emit("seatJoined", { table: updatedTable, seat });
    
        if (updatedTable!.players.length === 2 && updatedTable!.status === "waiting") {
          startGame(tableId, io);
        }
      } catch (error) {
        socket.emit("error", "Error joining seat");
        console.error(error);
      }
    });

    socket.on("addChips", async ({ tableId, userId, amount }: { tableId: string; userId: string; amount: number }) => {
      try {
        if (!tableId || !userId || !amount || amount <= 0) {
          return socket.emit("error", "Invalid table, user, or amount");
        }

        const [table, user] = await Promise.all([
          Table.findById(tableId).populate("players").lean(),
          User.findById(userId),
        ]);

        if (!table) {
          return socket.emit("error", "Table not found");
        }
        if (!user) {
          return socket.emit("error", "User not found");
        }

        if (user.amount < amount) {
          return socket.emit("error", "Insufficient balance");
        }

        const player = await Player.findOne({ user: userId, table: tableId });
        if (!player) {
          return socket.emit("error", "You must be at the table to add chips");
        }

        if (player.seat === -1) {
          return socket.emit("error", "You must be seated to add chips");
        }

        if (table.status === "playing") {
          return socket.emit("error", "Cannot add chips during an active hand");
        }

        await Promise.all([
          Player.findOneAndUpdate(
            { _id: player._id, table: tableId },
            { $inc: { chips: amount } },
            { new: true }
          ),
          User.findByIdAndUpdate(
            userId,
            { $inc: { amount: -amount } },
            { new: true }
          ),
        ]);

        const updatedTable = await Table.findById(tableId)
          .populate("players")
          .populate("waitingPlayers")
          .lean();

        io.to(tableId).emit("chipsAdded", { tableId, userId, amount });
        io.to(tableId).emit("tableUpdate", updatedTable);
        socket.emit("chipsAddedSuccess", { tableId, amount });

      } catch (error) {
        console.error(`Error adding chips for user ${userId} on table ${tableId}:`, error);
        socket.emit("error", "Failed to add chips");
      }
    });

    socket.on("leaveSeat", async ({ tableId, userId }) => {
      try {
        if (!tableId || !userId) {
          return socket.emit("error", "Invalid table or user");
        }
    
        const table = await Table.findById(tableId).populate("players").lean();
        if (!table) {
          return socket.emit("error", "Table not found");
        }
    
        const player = await Player.findOne({ user: userId, table: tableId });
        if (!player) {
          return socket.emit("error", "Player not found");
        }
    
        const user = await User.findById(userId);
        if (!user) {
          return socket.emit("error", "User not found");
        }
    
        let chipsToRefund = 0;
        const wasSeated = table.players.some(p => p._id.toString() === player._id);
        if (wasSeated) {
          chipsToRefund = player.chips;
          await User.findByIdAndUpdate(userId, { $inc: { amount: chipsToRefund } }, { new: true });
        }
    
        await Promise.all([
          Table.findByIdAndUpdate(
            tableId,
            {
              $pull: { players: player._id, waitingPlayers: player._id },
            },
            { new: true }
          ),
        ]);
    
        const updatedTable = await Table.findById(tableId)
          .populate("players")
          .populate("waitingPlayers")
          .lean();
    
        io.to(tableId).emit("tableUpdate", updatedTable);
        socket.emit("leftTable", { tableId, chipsRefunded: chipsToRefund });
    
        if (updatedTable && updatedTable.players.length < 2 && updatedTable.status === "playing") {
          await endGame(tableId, io);
        }
    
        socket.leave(tableId);
      } catch (error) {
        socket.emit("error", "Error leaving table");
        console.error(error);
      }
    });

    socket.on("gameAction", async ({ tableId, action, amount, userId }: { tableId: string; action: string; amount?: number; userId: string }) => {
      try {
        const table = await Table.findById(tableId).populate("players").lean();
        if (!table || table.status !== "playing") {
          return socket.emit("error", "Table or Game not in progress");
        }
    
        const player = await Player.findOne({ user: userId, table: tableId });
        if (!player || !player.inHand) {
          return socket.emit("error", "Player not found or Player not in hand");
        }
    
        // Validate turn
        if (!Array.isArray(table.players) || table.players.length === 0) {
          console.error("Table players array is empty or invalid:", table.players);
          return socket.emit("error", "No players found on table");
        }
        if (table.currentPlayer < 0 || table.currentPlayer >= table.players.length) {
          console.error("Invalid currentPlayer index:", table.currentPlayer, "Players length:", table.players.length);
          return socket.emit("error", "Invalid turn state");
        }
    
        const currentPlayer = table.players[table.currentPlayer] as unknown as IPlayer;
        if ((player._id as ObjectId).toString() !== (currentPlayer._id as ObjectId).toString()) {
          return socket.emit("error", "Not your turn");
        }
    
        let update: any = { hasActed: true, consecutiveAfkRounds: 0 };
        let tableUpdate: any = {};
    
        switch (action.toLowerCase()) {
          case "fold":
            update.inHand = false;
            break;
          case "check":
            if (player.currentBet < table.currentBet) {
              return socket.emit("error", "Cannot check, must call or raise");
            }
            break;
          case "call":
            const callAmount = table.currentBet - player.currentBet;
            if (player.chips < callAmount) {
              return socket.emit("error", "Insufficient chips to call");
            }
            update.chips = player.chips - callAmount;
            update.currentBet = table.currentBet;
            update.inHand = true;
            tableUpdate.$inc = { pot: callAmount };
            break;
          case "raise":
            if (!amount || amount <= table.currentBet) {
              return socket.emit("error", "Invalid raise amount: Must be greater than current bet");
            }
            const raiseAmount = amount - player.currentBet;
            if (player.chips < raiseAmount) {
              return socket.emit("error", "Insufficient chips to raise");
            }
            update.chips = player.chips - raiseAmount;
            update.currentBet = amount;
            tableUpdate.currentBet = amount;
            tableUpdate.$inc = { pot: raiseAmount };
            await Player.updateMany(
              { table: tableId, _id: { $ne: player._id } },
              { hasActed: false }
            );
            break;
          case "allin":
            const allInAmount = player.chips;
            if (allInAmount <= 0) {
              return socket.emit("error", "No chips to go all-in");
            }
            update.chips = 0;
            update.currentBet = player.currentBet + allInAmount;
            tableUpdate.$inc = { pot: allInAmount };
            if (update.currentBet > table.currentBet) {
              tableUpdate.currentBet = update.currentBet;
              await Player.updateMany(
                { table: tableId, _id: { $ne: player._id } },
                { hasActed: false }
              );
            }
            break;
          default:
            return socket.emit("error", `Unknown action: ${action}`);
        }
    
        await Promise.all([
          Player.findOneAndUpdate({ _id: player._id, table: tableId }, update, { new: true }),
          tableUpdate.$inc || tableUpdate.currentBet
            ? Table.findByIdAndUpdate(tableId, tableUpdate, { new: true })
            : Promise.resolve(),
        ]);

        io.to(tableId).emit("playerAction", {
          playerId: player._id,
          action: action.toLowerCase(),
          amount: action === "raise" || action === "call" || action === "allin" ? amount || table.currentBet - player.currentBet : undefined,
          timestamp: new Date(),
        });
    
        // Check if the hand should end due to all-in resolution
        const updatedTable = await Table.findById(tableId).populate("players").lean();
        const players = updatedTable?.players as unknown as IPlayer[];
        const activePlayers = players.filter((p) => p.inHand);
        const allInPlayers = activePlayers.filter((p) => p.chips === 0 && p.currentBet > 0);
        const maxBet = Math.max(...activePlayers.map(p => p.currentBet));
        const allBetsResolved = activePlayers.every(p => p.chips === 0 || p.currentBet === maxBet || !p.inHand);

        if (allInPlayers.length === activePlayers.length || (allInPlayers.length > 0 && allBetsResolved)) {
          await endHand(tableId, io);
          return;
        }
    
        advanceTurn(tableId, io);
      } catch (error) {
        console.error(`Error processing game action for user ${userId} on table ${tableId}:`, error);
        socket.emit("error", "Error processing action");
      }
    });

    socket.on("disconnect", async () => {
    // Only update player if userId is valid
      if (socketData.tableId && socketData.userId && mongoose.Types.ObjectId.isValid(socketData.userId)) {
        const player = await Player.findOneAndUpdate(
          { user: socketData.userId, table: socketData.tableId },
          { socketId: "" },
          { new: true }
        );
        if (player) {
          const updatedTable = await Table.findById(socketData.tableId)
            .populate("players")
            .populate("waitingPlayers")
            .lean();
          io.to(socketData.tableId).emit("tableUpdate", updatedTable);
          io.to(socketData.tableId).emit("playerDisconnected", player._id);
        }
      }
      console.log(`User disconnected: ${socket.id} with userId: ${socketData?.userId}`);
    });
  });
};

async function startGame(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    
    if (!table || table.players.length < 2) {
      console.error(`Table ${tableId} not found or insufficient players`);
      io.to(tableId).emit("error", "2 players required");
      return;
    }

    const players = table.players as unknown as IPlayer[];

    // Move players with 0 or fewer chips to waitingPlayers
    const updates: Promise<any>[] = [];
    const validPlayers: IPlayer[] = [];
    const playersToMove: IPlayer[] = [];

    players.forEach(player => {
      if (player.chips <= 0) {
        playersToMove.push(player);
        updates.push(
          Player.findOneAndUpdate(
            { _id: player._id, table: tableId },
            { seat: -1, inHand: false },
            { new: true }
          ),
          Table.findByIdAndUpdate(
            tableId,
            {
              $pull: { players: player._id },
              $push: { waitingPlayers: player._id }
            },
            { new: true }
          )
        );
      } else {
        validPlayers.push(player);
      }
    });

    if (updates.length > 0) {
      await Promise.all(updates);
      playersToMove.forEach(player => {
        io.to(tableId).emit("playerMovedToWaiting", { playerId: player._id, username: player.username });
      });
    }

    // Check if there are still enough valid players
    if (validPlayers.length < 2) {
      await endGame(tableId, io);
      return;
    }

    // Proceed with game setup for valid players
    const deck = shuffleDeck();
    const dealerSeat = table.dealerSeat || 0;
    const smallBlindIndex = (dealerSeat + 1) % validPlayers.length;
    const bigBlindIndex = (dealerSeat + 2) % validPlayers.length;

    const playerUpdates = validPlayers.map((player, index) => {
      const update: any = {
        cards: table.gameType === "Omaha" ? [deck.pop()!, deck.pop()!,deck.pop()!,deck.pop()!] : [deck.pop()!, deck.pop()!],
        inHand: true,
        hasActed: false,
        consecutiveAfkRounds: 0,
        currentBet: 0,
      };
      if (index === smallBlindIndex) {
        if (player.chips < table.smallBlind) {
          update.chips = 0;
          update.currentBet = player.chips; // All-in for remaining chips
        } else {
          update.chips = player.chips - table.smallBlind;
          update.currentBet = table.smallBlind;
        }
      } else if (index === bigBlindIndex) {
        if (player.chips < table.bigBlind) {
          update.chips = 0;
          update.currentBet = player.chips; // All-in for remaining chips
        } else {
          update.chips = player.chips - table.bigBlind;
          update.currentBet = table.bigBlind;
        }
      }
      return Player.findOneAndUpdate(
        { _id: player._id, table: tableId },
        update,
        { new: true }
      );
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
          pot: validPlayers[smallBlindIndex].chips <= table.smallBlind ? validPlayers[smallBlindIndex].chips : table.smallBlind +
              (validPlayers[bigBlindIndex].chips <= table.bigBlind ? validPlayers[bigBlindIndex].chips : table.bigBlind),
          currentBet: validPlayers[bigBlindIndex].chips <= table.bigBlind ? validPlayers[bigBlindIndex].chips : table.bigBlind,
          currentPlayer: bigBlindIndex,
          dealerSeat,
        },
        { new: true }
      ),
    ]);

    const updatedTable = await Table.findById(tableId)
      .select(
        "name maxPlayers buyIn smallBlind bigBlind gameType status communityCards pot dealerSeat currentPlayer currentBet round deck"
      )
      .populate({
        path: "players",
        select:
          "user seat chips cards username inHand currentBet hasActed consecutiveAfkRounds",
      })
      .populate({
        path: "waitingPlayers",
        select: "user username",
      })
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

    if (!updatedTable) {
      console.error("Updated table is null");
      return;
    }
    const currentPlayer = updatedTable.players[bigBlindIndex] as unknown as IPlayer;
    io.to(tableId).emit("playerTurn", {
      playerId: currentPlayer._id,
      tableId,
      turnStartTime: new Date().toISOString(),
    });

    startTurnTimer(tableId, io);
  } catch (error) {
    console.error(`Error starting game on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Failed to start the game");
  }
}

async function endGame(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) {
      return console.log(table, "End game table not found")
    };

    await Promise.all([
      Player.updateMany(
        {table: tableId},
        {cards: table.gameType === "Omaha" ? ["", "", "", ""] : ["", ""], inHand: false, currentBet: 0, hasActed: false}
      ),
      Table.findByIdAndUpdate(
        tableId,
        {
          status: "waiting",
          round: "preflop",
          communityCards: [],
          pot: 0,
          currentBet: 0,
        },
        {new: true}
      )
    ])

    const updatedTable = await Table.findById(tableId)
    .populate("players")
    .populate("waitingPlayers")
    .lean()
    io.to(tableId).emit("gameEnded", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);
  } catch (error) {
    console.error(`Error ending game on table ${tableId}:`, error);
  }
}
async function advanceTurn(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) {
      return console.log("Advance turn table not found", table);
    }

    const players = table.players as unknown as IPlayer[];
    const activePlayers = players.filter((p) => p.inHand);

    if (activePlayers.length <= 1) {
      if (timers[tableId]) { clearTimeout(timers[tableId]) };
      await endHand(tableId, io);
      return;
    }

    const allActed = activePlayers.every((p) => p.hasActed);
    const maxBet = Math.max(...activePlayers.map(p => p.currentBet));
    const betsEqual = activePlayers.every(p => p.currentBet === maxBet || !p.inHand);

    if (allActed && betsEqual) {
      await nextRound(tableId, io);
      return;
    }

    let nextPlayerIndex = (table.currentPlayer + 1) % players.length;
    let loopedOnce = false;
    while (!players[nextPlayerIndex].inHand) {
      nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
      if (nextPlayerIndex === table.currentPlayer) {
        if (loopedOnce) break;
        loopedOnce = true;
      }
    }

    await Table.findByIdAndUpdate(tableId, { currentPlayer: nextPlayerIndex }, { new: true });
    const updatedTable = await Table.findById(tableId)
      .populate("players")
      .populate("waitingPlayers")
      .lean();

  
    if (!updatedTable) {
      console.error("Updated table is null");
      return;
    }

    const currentPlayer = updatedTable.players[nextPlayerIndex] as unknown as IPlayer;
    io.to(tableId).emit("playerTurn", {
      playerId: currentPlayer._id,
      tableId,
      turnStartTime: new Date().toISOString(),
    });

    io.to(tableId).emit("turnUpdate", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);

    startTurnTimer(tableId, io);

  } catch (error) {
    console.error(`Error advancing turn on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Error advancing turn");
  }
}
const timers: { [tableId: string]: NodeJS.Timeout } = {};

function startTurnTimer(tableId: string, io: Server) {
  console.log("startTurnTimer");
  if (timers[tableId]) {
    clearTimeout(timers[tableId]); // Clear any existing timer
  }

  timers[tableId] = setTimeout(async () => {
    try {
      console.log("startTurnTimer - 1 10sec wait");
      const table = await Table.findById(tableId).populate("players").lean();
      if (!table || !table.players.length || table.status !== "playing") {
        console.log(table, "startTurnTimer table not found, no players, or game not playing");
        return;
      }

      const player = table.players[table.currentPlayer] as unknown as IPlayer;
      if (!player) {
        console.error(`Player at index ${table.currentPlayer} is undefined on table ${tableId}`);
        await advanceTurn(tableId, io);
        return;
      }

      const mustAct = table.currentBet > player.currentBet;
      console.log("<<<Start turn timer?>>>");
      console.log("table current bet: " + table.currentBet, "player current bet: " + player.currentBet);
      console.log(player.hasActed, "player has acted");

      if (!player.hasActed) {
        let update: any = { hasActed: true };
        let tableUpdate: any = {};

        if (mustAct) {
          // Player must act (call/raise required), but is AFK -> Fold
          console.log(`Player ${player.username} AFK and must act, auto-folding`);
          update.inHand = false;
          update.$inc = { consecutiveAfkRounds: 1 };
        } else {
          // No bet to match, auto-check
          console.log(`Player ${player.username} AFK, auto-checking`);
          update.$inc = { consecutiveAfkRounds: 1 }; // Still increment AFK since they didn’t act
        }

        // Apply the automatic action
        await Promise.all([
          Player.findOneAndUpdate(
            { _id: player._id, table: tableId },
            update,
            { new: true }
          ),
          tableUpdate.$inc
            ? Table.findOneAndUpdate(tableId as any, tableUpdate, { new: true })
            : Promise.resolve(),
        ]);

        // Check if player should be removed due to consecutive AFK rounds
        if ((player.consecutiveAfkRounds + 1) >= 2) {
          console.log(`Player ${player.username} has ${player.consecutiveAfkRounds + 1} AFK rounds, removing from table`);
          await Promise.all([
            Table.findByIdAndUpdate(
              tableId,
              { $pull: { players: player._id }, $push: { waitingPlayers: player._id } },
              { new: true }
            ),
            Player.findOneAndUpdate(
              { _id: player._id, table: tableId },
              { seat: -1, inHand: false },
              { new: true }
            ),
          ]);
          io.to(tableId).emit("playerRemoved", player._id);
        }

        // Advance to the next player
        await advanceTurn(tableId, io);
      } else {
        // Player has already acted, no action needed, but don’t reset AFK counter here
        console.log(`Player ${player.username} has already acted, no auto-action needed`);
      }
    } catch (error) {
      console.error(`Error in turn timer on table ${tableId}:`, error);
    }
  }, 10000); // 10 seconds
}

async function nextRound(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) {
      return console.log(!table, "NextROund table not found")
    };
    await Player.updateMany({table: tableId}, {hasActed: false, currentBet:0});

    let update:any = { currentPlayer: (table.dealerSeat + 1) % table.players.length, currentBet: 0};
    switch(table.round){
      case "preflop":
        update.round = "flop";
        update.communityCards = [table.deck.pop()!, table.deck.pop()!, table.deck.pop()!];
        update.deck = [table.deck.pop()!, table.deck.pop()!, table.deck.pop()!]
        break;
      case "flop":
        update.round = "turn";
        update.communityCards = [...table.communityCards, table.deck.pop()];
        update.deck = [table.deck.pop()!]
        break;
      case "turn":
        update.round = "river";
        update.communityCards = [...table.communityCards, table.deck.pop()];
        update.deck = [table.deck.pop()!]
        break;
      case "river":
        update.round = "showdown";
        await endHand(tableId, io);
        return;
      default:
        console.error(`Unexpected round state: ${table.round}`);
        return;
    }

    await Table.findByIdAndUpdate(tableId, update, {new:true});
    const updatedTable = await Table.findById(tableId)
    .populate("players")
    .populate("waitingPlayers")
    .lean()

    io.to(tableId).emit("roundUpdate", updatedTable);
    io.to(tableId).emit("tableUpdate", updatedTable);

    startTurnTimer(tableId, io);

  } catch (error) {
    console.error(`Error in next round on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Error progressing to next round");
  }
}

const getHandDescription = (playerCards: string[], communityCards: string[]): string => {
  const allCards = [...playerCards, ...communityCards];
  const ranks = allCards.map(card => card.slice(0, -1)); // e.g., "A", "K", "2"
  const suits = allCards.map(card => card.slice(-1)); // e.g., "s", "h"
  
  // Count ranks and suits
  const rankCounts = ranks.reduce((acc, rank) => {
    acc[rank] = (acc[rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const suitCounts = suits.reduce((acc, suit) => {
    acc[suit] = (acc[suit] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const rankValues = ranks.map(rank => {
    if (rank === "A") return 14;
    if (rank === "K") return 13;
    if (rank === "Q") return 12;
    if (rank === "J") return 11;
    if (rank === "T") return 10;
    return parseInt(rank);
  }).sort((a, b) => b - a);
  
  const isFlush = Object.values(suitCounts).some(count => count >= 5);
  const isStraight = (() => {
    const uniqueRanks = Array.from(new Set(rankValues));
    if (uniqueRanks.length < 5) return false;
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) return true;
    }
    // Check Ace-low straight (A, 2, 3, 4, 5)
    if (uniqueRanks.includes(14) && uniqueRanks.slice(-4).join("") === "5432") return true;
    return false;
  })();

  const counts = Object.values(rankCounts);
  const maxCount = Math.max(...counts);
  const pairs = counts.filter(c => c === 2).length;

  if (isFlush && isStraight) return "Straight Flush";
  if (maxCount === 4) return "Four of a Kind";
  if (maxCount === 3 && pairs > 0) return "Full House";
  if (isFlush) return "Flush";
  if (isStraight) return "Straight";
  if (maxCount === 3) return "Three of a Kind";
  if (pairs === 2) return "Two Pair";
  if (pairs === 1) return "One Pair";
  
  const highCard = Object.keys(rankCounts).sort((a, b) => {
    const aVal = a === "A" ? 14 : a === "K" ? 13 : a === "Q" ? 12 : a === "J" ? 11 : a === "T" ? 10 : parseInt(a);
    const bVal = b === "A" ? 14 : b === "K" ? 13 : b === "Q" ? 12 : b === "J" ? 11 : b === "T" ? 10 : parseInt(b);
    return bVal - aVal;
  })[0];
  return `High Card ${highCard}`;
};

async function endHand(tableId: string, io: Server) {
  try {
    const table = await Table.findById(tableId).populate("players").lean();
    if (!table) return;
    if (timers[tableId]) clearTimeout(timers[tableId]);

    const players = table.players as unknown as IPlayer[];
    const activePlayers = players.filter((p) => p.inHand);

    let communityCards = table.communityCards;
    if (table.round !== "river" && activePlayers.length > 1) {
      const deck = table.deck.slice();
      while (communityCards.length < 5 && deck.length > 0) {
        communityCards.push(deck.pop()!);
      }
      await Table.findByIdAndUpdate(tableId, { communityCards, deck }, { new: true });
    }

    let winners: { playerId: string; chipsWon: number; handDescription?: string }[] = [];

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const tax = Math.floor(table.pot * table.tableFee);
      const potAfterTax = table.pot - tax;
      await Promise.all([
        Player.findOneAndUpdate(
          { _id: winner._id, table: tableId },
          { $inc: { chips: potAfterTax } },
          { new: true }
        ),
        Table.findByIdAndUpdate(
          tableId,
          { $inc: { tableEarnings: tax } },
          { new: true }
        ),
      ]);
      winners = [{ playerId: (winner._id as ObjectId).toString(), chipsWon: potAfterTax }];
      io.to(tableId).emit("handResult", { winners });
    } else if (activePlayers.length > 1) {
      const allInPlayers = activePlayers.filter((p) => p.chips === 0 && p.currentBet > 0);
      let minAllInBet: number
      let mainPotBeforeTax: number;
      let mainPotTax: number;
      let mainPot: number;

      if (allInPlayers.length > 0) {
        // All-in scenario: Split into main and side pots
        minAllInBet = Math.min(...activePlayers.map((p) => p.currentBet));
        mainPotBeforeTax = minAllInBet * activePlayers.length;
        mainPotTax = Math.floor(mainPotBeforeTax * table.tableFee);
        mainPot = mainPotBeforeTax - mainPotTax;
      } else {
        // No all-ins: Use the full pot
        mainPotBeforeTax = table.pot;
        mainPotTax = Math.floor(mainPotBeforeTax * table.tableFee);
        mainPot = mainPotBeforeTax - mainPotTax;
      }

      const contributions = activePlayers.map((p) => ({
        playerId: (p._id as ObjectId).toString(),
        totalBet: p.currentBet,
        mainPotContribution: allInPlayers.length > 0 ? Math.min(p.currentBet, minAllInBet ) : p.currentBet,
        excess: allInPlayers.length > 0 ? Math.max(0, p.currentBet - minAllInBet) : 0,
      }));

      const totalExcessBeforeTax = contributions.reduce((sum, c) => sum + c.excess, 0);
      const excessTax = Math.floor(totalExcessBeforeTax * table.tableFee);
      const totalExcessAfterTax = totalExcessBeforeTax - excessTax;

      const totalTax = mainPotTax + excessTax;

      const game = table.gameType === "Omaha" ? new Omaha() : new TexasHoldem();
      activePlayers.forEach((player) => game.addPlayer(player.cards));
      game.setBoard(communityCards);
      const result = game.calculate();
      const winningPlayers = result.getPlayers().filter((p) => p.getWinsPercentage() > 0);

      const updates: Promise<any>[] = [];
      winners = winningPlayers.map((win) => {
        const winner = activePlayers.find((p) => p.cards.join("") === win.getHand());
        if (winner) {
          const winnerContribution = contributions.find((c) => c.playerId === (winner._id as ObjectId).toString());
          if (!winnerContribution) return null;
          console.log(table.pot, mainPot);
          // Calculate chips won based on main pot (split among winners if multiple)
          const chipsPerWinner = mainPot / winningPlayers.length;
          const chipsWonBeforeTax = Math.min(chipsPerWinner, mainPot); // Cap at main pot
          const winnerTax = Math.floor(chipsWonBeforeTax * table.tableFee);
          const chipsWon = chipsWonBeforeTax - winnerTax;

          const handDescription = getHandDescription(winner.cards, communityCards);
          console.log(`Winner ${winner.username} won ${chipsWon} chips with ${handDescription}`);
          updates.push(
            Player.findOneAndUpdate(
              { _id: winner._id, table: tableId },
              { $inc: { chips: chipsWon } },
              { new: true }
            )
          );
          return { playerId: (winner._id as ObjectId).toString(), chipsWon, handDescription };
        }
        return null;
      }).filter((w): w is { playerId: string; chipsWon: number; handDescription: string } => w !== null);

      // Refund excess bets to non-winners (only in all-in scenarios)
      contributions.forEach((contribution) => {
        if (!winners.some((w) => w.playerId === contribution.playerId) && contribution.excess > 0) {
          const refundBeforeTax = contribution.excess;
          const refundTax = Math.floor(refundBeforeTax * table.tableFee);
          const refund = refundBeforeTax - refundTax;
          console.log(`Refunding ${refund} to player ${contribution.playerId}`);
          updates.push(
            Player.findOneAndUpdate(
              { _id: contribution.playerId, table: tableId },
              { $inc: { chips: refund } },
              { new: true }
            )
          );
        }
      });

      updates.push(
        Table.findByIdAndUpdate(
          tableId,
          { $inc: { tableEarnings: totalTax } },
          { new: true }
        )
      );

      await Promise.all(updates);
      io.to(tableId).emit("handResult", { winners });
    }

    setTimeout(async () => {
      await Promise.all([
        Player.updateMany(
          { table: tableId },
          { cards: table.gameType === "Omaha" ? ["", "", "", ""] : ["", ""], inHand: false, currentBet: 0, hasActed: false }
        ),
        Table.findByIdAndUpdate(
          tableId,
          {
            pot: 0,
            dealerSeat: (table.dealerSeat + 1) % players.length,
            communityCards: [],
            round: "preflop",
          },
          { new: true }
        ),
      ]);

      const updatedTable = await Table.findById(tableId)
        .populate("players")
        .populate("waitingPlayers")
        .lean();

      io.to(tableId).emit("tableUpdate", updatedTable);

      if ((updatedTable?.players.length || 0) < 2) {
        await endGame(tableId, io);
      } else {
        await startGame(tableId, io);
      }
    }, HAND_RESULT_DISPLAY_DURATION);

  } catch (error) {
    console.error(`Error ending hand on table ${tableId}:`, error);
    io.to(tableId).emit("error", "Error ending hand");
  }
}

function shuffleDeck(): string[] {
  const suits = ["s", "h", "d", "c"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = suits.flatMap((suit) => ranks.map((rank) => rank + suit));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export default initializeSocket;